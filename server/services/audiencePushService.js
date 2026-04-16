const crypto = require('crypto');
const metaApi = require('./metaApi');
const { query, queryOne, queryAll } = require('../db');

// Meta Customer Match requires SHA-256 of lowercase-trimmed email/phone.
function sha256Lower(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// Build the list of hashed emails and phones for a named first-party segment.
// We reverse-engineer the segment keys defined in intelligenceService.getAudienceSegments.
const SEGMENT_SQL = {
  all_visitors: `WHERE account_id = $1 AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  ad_click_visitors: `WHERE account_id = $1 AND (fbclid IS NOT NULL OR fbc IS NOT NULL) AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  browser_id_visitors: `WHERE account_id = $1 AND fbp IS NOT NULL AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  meta_native_leads: `WHERE account_id = $1 AND (meta_lead_id IS NOT NULL OR lower(COALESCE(source_event_type, '')) LIKE 'fb-lead%' OR lower(COALESCE(source_event_type, '')) LIKE '%instant%form%') AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  google_ads_leads: `WHERE account_id = $1 AND (gclid IS NOT NULL OR lower(COALESCE(utm_source, '')) = 'google') AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  landing_page_leads: `WHERE account_id = $1 AND ghl_contact_id IS NOT NULL AND (meta_lead_id IS NULL AND lower(COALESCE(source_event_type, '')) NOT LIKE 'fb-lead%') AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  known_contacts: `WHERE account_id = $1 AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  qualified_contacts: `WHERE account_id = $1 AND lower(COALESCE(current_stage, '')) LIKE '%qualif%' AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
  closed_contacts: `WHERE account_id = $1 AND (lower(COALESCE(current_stage, '')) LIKE '%closed%' OR COALESCE(revenue, 0) > 0) AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL)`,
};

async function buildSegmentData(accountId, segmentKey) {
  const where = SEGMENT_SQL[segmentKey];
  if (!where) throw new Error(`Unknown segment key: ${segmentKey}`);
  const rows = await queryAll(`
    SELECT email_hash, phone_hash, raw
    FROM visitors
    ${where}
  `, [accountId]);

  const emails = [];
  const phones = [];
  for (const row of rows) {
    // visitors.email_hash is already sha256(lowercase-trimmed-email).
    // Meta accepts that as-is for EMAIL schema.
    if (row.email_hash) emails.push(row.email_hash);
    if (row.phone_hash) phones.push(row.phone_hash);
  }
  return { emails, phones, totalRows: rows.length };
}

async function ensureCustomAudience(account, { segmentKey, segmentName }) {
  const push = await queryOne(`
    SELECT * FROM audience_pushes WHERE account_id = $1 AND segment_key = $2
  `, [account.id, segmentKey]);

  if (push && push.meta_audience_id) return push;

  const created = await metaApi.metaPost(`/${metaApi.contextAccountId(account)}/customaudiences`, {
    name: `AdCmd · ${segmentName || segmentKey}`,
    subtype: 'CUSTOM',
    description: `First-party audience pushed from Ad Command (${segmentKey}).`,
    customer_file_source: 'USER_PROVIDED_ONLY',
  }, account);

  const row = await queryOne(`
    INSERT INTO audience_pushes (account_id, segment_key, segment_name, meta_audience_id)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (account_id, segment_key) DO UPDATE SET
      meta_audience_id = EXCLUDED.meta_audience_id,
      segment_name = EXCLUDED.segment_name,
      updated_at = NOW()
    RETURNING *
  `, [account.id, segmentKey, segmentName || segmentKey, created.id]);
  return row;
}

async function uploadUsers(account, audienceId, emails, phones) {
  // Meta requires chunks <= 10,000 rows per call.
  const CHUNK = 5000;
  let total = 0;

  const send = async (schema, values) => {
    if (!values.length) return;
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
      const payload = {
        payload: {
          schema,
          data: slice.map(v => [v]),
        },
      };
      await metaApi.metaPost(`/${audienceId}/users`, payload, account);
      total += slice.length;
    }
  };

  await send('EMAIL_SHA256', emails);
  await send('PHONE_SHA256', phones);
  return total;
}

async function pushSegment(account, { segmentKey, segmentName }) {
  const push = await ensureCustomAudience(account, { segmentKey, segmentName });
  const { emails, phones, totalRows } = await buildSegmentData(account.id, segmentKey);

  if (emails.length === 0 && phones.length === 0) {
    await query(`
      UPDATE audience_pushes
      SET last_push_at = NOW(), last_push_count = 0, last_push_error = 'No hashable identifiers in segment', updated_at = NOW()
      WHERE id = $1
    `, [push.id]);
    return { meta_audience_id: push.meta_audience_id, uploaded: 0, total_rows: totalRows, warning: 'No emails/phones to hash' };
  }

  let uploaded = 0;
  let errorMessage = null;
  try {
    uploaded = await uploadUsers(account, push.meta_audience_id, emails, phones);
  } catch (err) {
    errorMessage = err.message || String(err);
  }

  await query(`
    UPDATE audience_pushes
    SET last_push_at = NOW(),
        last_push_count = $2,
        last_push_error = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [push.id, uploaded, errorMessage]);

  if (errorMessage) throw new Error(errorMessage);
  return { meta_audience_id: push.meta_audience_id, uploaded, total_rows: totalRows };
}

async function listPushes(accountId) {
  return queryAll(`
    SELECT * FROM audience_pushes WHERE account_id = $1 ORDER BY updated_at DESC
  `, [accountId]);
}

async function setAutoRefresh(pushId, enabled, hours = 24) {
  await query(`
    UPDATE audience_pushes
    SET auto_refresh = $2,
        refresh_interval_hours = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [pushId, !!enabled, Math.max(1, Math.min(168, parseInt(hours, 10) || 24))]);
}

async function refreshDue() {
  const rows = await queryAll(`
    SELECT ap.*, a.id AS account_pk
    FROM audience_pushes ap
    JOIN accounts a ON a.id = ap.account_id
    WHERE ap.auto_refresh = TRUE
      AND (ap.last_push_at IS NULL OR ap.last_push_at < NOW() - make_interval(hours => ap.refresh_interval_hours))
  `);
  const results = [];
  for (const row of rows) {
    try {
      const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [row.account_id]);
      const decrypted = await require('./accountService').getAccountById(row.account_id);
      const result = await pushSegment(decrypted, { segmentKey: row.segment_key, segmentName: row.segment_name });
      results.push({ push_id: row.id, ...result });
    } catch (err) {
      results.push({ push_id: row.id, error: err.message });
    }
  }
  return results;
}

function startBackgroundRefresh({ intervalMs = 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await refreshDue();
      const uploaded = results.reduce((s, r) => s + (r.uploaded || 0), 0);
      if (uploaded > 0) console.log(`[audiencePush] refreshed ${results.length} segment(s), uploaded ${uploaded} identifiers`);
    } catch (err) {
      console.error(`[audiencePush] background run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 10 * 60 * 1000).unref?.();
  return timer;
}

module.exports = {
  pushSegment,
  listPushes,
  setAutoRefresh,
  refreshDue,
  startBackgroundRefresh,
  buildSegmentData,
};
