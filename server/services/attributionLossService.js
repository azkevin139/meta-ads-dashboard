const { queryAll } = require('../db');
const reporting = require('./reportingService');

const REPORTING_TIMEZONE = reporting.REPORTING_TIMEZONE || 'Asia/Dubai';

function pct(part, whole) {
  const numerator = Number(part) || 0;
  const denominator = Number(whole) || 0;
  return denominator ? Number(((numerator / denominator) * 100).toFixed(2)) : 0;
}

function leadTimeExpression(alias = 'v') {
  return `COALESCE(
    NULLIF(${alias}.raw->'ghl'->>'dateAdded', '')::timestamptz,
    NULLIF(${alias}.raw->'ghl'->>'createdAt', '')::timestamptz,
    NULLIF(${alias}.raw->'metadata'->>'created_time', '')::timestamptz,
    ${alias}.resolved_at,
    ${alias}.first_seen_at
  )`;
}

function dedupeKeyExpression(alias = 'v') {
  return `COALESCE(
    NULLIF(${alias}.ghl_contact_id, ''),
    NULLIF(${alias}.phone_hash, ''),
    NULLIF(${alias}.email_hash, ''),
    NULLIF(${alias}.meta_lead_id, ''),
    NULLIF(${alias}.client_id, '')
  )`;
}

function leadIdentityFilter(alias = 'v') {
  return `(
    ${alias}.meta_lead_id IS NOT NULL
    OR ${alias}.ghl_contact_id IS NOT NULL
    OR ${alias}.email_hash IS NOT NULL
    OR ${alias}.phone_hash IS NOT NULL
  )`;
}

function classify(row) {
  const total = Number(row.total_leads) || 0;
  const missing = {
    ad_id: Number(row.missing_ad_id) || 0,
    campaign_id: Number(row.missing_campaign_id) || 0,
    source_event_type: Number(row.missing_source_event_type) || 0,
    fbclid: Number(row.missing_fbclid) || 0,
    fbc: Number(row.missing_fbc) || 0,
    fbp: Number(row.missing_fbp) || 0,
    gclid: Number(row.missing_gclid) || 0,
    ghl_contact_id: Number(row.missing_ghl_contact_id) || 0,
    unmatched_replied_contacts: Number(row.unmatched_replied_contacts) || 0,
  };
  return {
    account_id: Number(row.account_id),
    range: row.range,
    timezone: row.timezone,
    total_leads: total,
    missing,
    rates: Object.fromEntries(Object.entries(missing).map(([key, value]) => [key, pct(value, total)])),
    status: total === 0
      ? 'no_leads'
      : (pct(missing.campaign_id + missing.source_event_type + missing.ghl_contact_id, total) > 20 ? 'attention' : 'ok'),
  };
}

async function getLoss(accountId, params = {}) {
  const range = reporting.resolveRange(params);
  const timezone = params.timezone || REPORTING_TIMEZONE;
  const rows = await queryAll(`
    WITH lead_rows AS (
      SELECT
        v.*,
        COALESCE(clink.canonical_lead_id::text, ${dedupeKeyExpression('v')}) AS dedupe_key,
        ${leadTimeExpression('v')} AS lead_time
      FROM visitors v
      LEFT JOIN canonical_lead_links clink
        ON clink.account_id = v.account_id
       AND clink.source_type = 'visitor'
       AND clink.source_id = v.client_id
      WHERE v.account_id = $1
        AND ${leadIdentityFilter('v')}
    ),
    scoped AS (
      SELECT DISTINCT ON (dedupe_key)
        *
      FROM lead_rows
      WHERE dedupe_key IS NOT NULL
        AND (lead_time AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY dedupe_key, lead_time ASC NULLS LAST
    ),
    unmatched AS (
      SELECT COUNT(DISTINCT gce.ghl_contact_id)::int AS unmatched_replied_contacts
      FROM ghl_conversation_events gce
      LEFT JOIN visitors v
        ON v.account_id = gce.account_id
       AND v.ghl_contact_id = gce.ghl_contact_id
      WHERE gce.account_id = $1
        AND gce.direction = 'inbound'
        AND gce.ghl_contact_id IS NOT NULL
        AND (COALESCE(gce.ghl_event_at, gce.received_at) AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
        AND v.client_id IS NULL
    )
    SELECT
      $1::int AS account_id,
      jsonb_build_object('since', $2::text, 'until', $3::text, 'preset', $5::text) AS range,
      $4::text AS timezone,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE NULLIF(ad_id, '') IS NULL)::int AS missing_ad_id,
      COUNT(*) FILTER (WHERE NULLIF(campaign_id, '') IS NULL)::int AS missing_campaign_id,
      COUNT(*) FILTER (WHERE NULLIF(source_event_type, '') IS NULL)::int AS missing_source_event_type,
      COUNT(*) FILTER (WHERE NULLIF(fbclid, '') IS NULL)::int AS missing_fbclid,
      COUNT(*) FILTER (WHERE NULLIF(fbc, '') IS NULL)::int AS missing_fbc,
      COUNT(*) FILTER (WHERE NULLIF(fbp, '') IS NULL)::int AS missing_fbp,
      COUNT(*) FILTER (WHERE NULLIF(gclid, '') IS NULL)::int AS missing_gclid,
      COUNT(*) FILTER (WHERE NULLIF(ghl_contact_id, '') IS NULL)::int AS missing_ghl_contact_id,
      COALESCE((SELECT unmatched_replied_contacts FROM unmatched), 0)::int AS unmatched_replied_contacts
    FROM scoped
  `, [accountId, range.since, range.until, timezone, range.preset || 'custom']);
  return classify(rows[0] || {
    account_id: accountId,
    range,
    timezone,
    total_leads: 0,
  });
}

async function getLossForAccounts(params = {}) {
  const accountId = params.accountId ? Number(params.accountId) : null;
  if (accountId) return [await getLoss(accountId, params)];

  const accounts = await queryAll(`
    SELECT DISTINCT account_id
    FROM visitors
    WHERE account_id IS NOT NULL
    ORDER BY account_id
  `);
  const results = [];
  for (const row of accounts) {
    results.push(await getLoss(Number(row.account_id), params));
  }
  return results;
}

module.exports = {
  getLoss,
  getLossForAccounts,
};
