const crypto = require('crypto');
const { query, queryOne } = require('../db');
const diagnostics = require('./trackingDiagnosticsService');
const { normalizeStage } = require('./lifecycleStageService');

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function hashIdentity(value) {
  const text = clean(value);
  if (!text) return null;
  return crypto.createHash('sha256').update(text.toLowerCase()).digest('hex');
}

function fbcFromFbclid(fbclid) {
  const id = clean(fbclid);
  if (!id) return null;
  return `fb.1.${Math.floor(Date.now() / 1000)}.${id}`;
}

async function resolveAccountId(input = {}) {
  if (input.account_id) return parseInt(input.account_id, 10) || null;
  const metaAccountId = clean(input.meta_account_id);
  if (!metaAccountId) return null;
  const account = await queryOne('SELECT id FROM accounts WHERE meta_account_id = $1', [metaAccountId]);
  return account?.id || null;
}

async function upsertVisitor(input = {}) {
  const clientId = clean(input.client_id);
  if (!clientId) throw new Error('client_id required');
  const accountId = await resolveAccountId(input);
  const emailHash = clean(input.email_hash) || hashIdentity(input.email);
  const phoneHash = clean(input.phone_hash) || hashIdentity(input.phone);
  const fbc = clean(input.fbc) || fbcFromFbclid(input.fbclid);
  const normalizedStage = normalizeStage(input.current_stage || input.stage, {
    revenue: input.revenue,
    metaLeadId: input.meta_lead_id,
    sourceEventType: input.source_event_type,
  });

  return queryOne(`
    INSERT INTO visitors (
      client_id, account_id, meta_account_id, fbclid, fbc, fbp,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      ad_id, adset_id, campaign_id, referrer, landing_page,
      email_hash, phone_hash, ghl_contact_id, meta_lead_id,
      current_stage, normalized_stage, revenue, currency, raw, first_seen_at, last_seen_at, resolved_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW(),NOW(),CASE WHEN $17::text IS NOT NULL OR $18::text IS NOT NULL OR $19::text IS NOT NULL OR $20::text IS NOT NULL THEN NOW() ELSE NULL END)
    ON CONFLICT (client_id) DO UPDATE SET
      account_id = COALESCE(EXCLUDED.account_id, visitors.account_id),
      meta_account_id = COALESCE(EXCLUDED.meta_account_id, visitors.meta_account_id),
      fbclid = COALESCE(EXCLUDED.fbclid, visitors.fbclid),
      fbc = COALESCE(EXCLUDED.fbc, visitors.fbc),
      fbp = COALESCE(EXCLUDED.fbp, visitors.fbp),
      utm_source = COALESCE(EXCLUDED.utm_source, visitors.utm_source),
      utm_medium = COALESCE(EXCLUDED.utm_medium, visitors.utm_medium),
      utm_campaign = COALESCE(EXCLUDED.utm_campaign, visitors.utm_campaign),
      utm_content = COALESCE(EXCLUDED.utm_content, visitors.utm_content),
      utm_term = COALESCE(EXCLUDED.utm_term, visitors.utm_term),
      ad_id = COALESCE(EXCLUDED.ad_id, visitors.ad_id),
      adset_id = COALESCE(EXCLUDED.adset_id, visitors.adset_id),
      campaign_id = COALESCE(EXCLUDED.campaign_id, visitors.campaign_id),
      referrer = COALESCE(EXCLUDED.referrer, visitors.referrer),
      landing_page = COALESCE(visitors.landing_page, EXCLUDED.landing_page),
      email_hash = COALESCE(EXCLUDED.email_hash, visitors.email_hash),
      phone_hash = COALESCE(EXCLUDED.phone_hash, visitors.phone_hash),
      ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, visitors.ghl_contact_id),
      meta_lead_id = COALESCE(EXCLUDED.meta_lead_id, visitors.meta_lead_id),
      current_stage = COALESCE(EXCLUDED.current_stage, visitors.current_stage),
      normalized_stage = COALESCE(EXCLUDED.normalized_stage, visitors.normalized_stage),
      revenue = GREATEST(COALESCE(EXCLUDED.revenue, 0), COALESCE(visitors.revenue, 0)),
      currency = COALESCE(EXCLUDED.currency, visitors.currency),
      raw = COALESCE(visitors.raw, '{}'::jsonb) || COALESCE(EXCLUDED.raw, '{}'::jsonb),
      last_seen_at = NOW(),
      resolved_at = CASE WHEN visitors.resolved_at IS NULL AND (EXCLUDED.email_hash IS NOT NULL OR EXCLUDED.phone_hash IS NOT NULL OR EXCLUDED.ghl_contact_id IS NOT NULL OR EXCLUDED.meta_lead_id IS NOT NULL) THEN NOW() ELSE visitors.resolved_at END
    RETURNING *
  `, [
    clientId,
    accountId,
    clean(input.meta_account_id),
    clean(input.fbclid),
    fbc,
    clean(input.fbp),
    clean(input.utm_source),
    clean(input.utm_medium),
    clean(input.utm_campaign),
    clean(input.utm_content),
    clean(input.utm_term),
    clean(input.ad_id),
    clean(input.adset_id),
    clean(input.campaign_id),
    clean(input.referrer),
    clean(input.page_url || input.landing_page),
    emailHash,
    phoneHash,
    clean(input.ghl_contact_id),
    clean(input.meta_lead_id),
    clean(input.current_stage || input.stage),
    normalizedStage,
    input.revenue === undefined || input.revenue === null ? null : Number(input.revenue) || 0,
    clean(input.currency) || 'USD',
    JSON.stringify(input.raw || input.metadata || {}),
  ]);
}

async function recordEvent(input = {}) {
  const visitor = await upsertVisitor(input);
  const eventName = clean(input.event_name) || 'PageView';
  await query(`
    INSERT INTO visitor_events (client_id, account_id, event_name, page_url, campaign_id, adset_id, ad_id, value, currency, metadata, fired_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
  `, [
    visitor.client_id,
    visitor.account_id,
    eventName,
    clean(input.page_url),
    clean(input.campaign_id) || visitor.campaign_id,
    clean(input.adset_id) || visitor.adset_id,
    clean(input.ad_id) || visitor.ad_id,
    input.value === undefined || input.value === null ? null : Number(input.value) || 0,
    clean(input.currency) || visitor.currency || 'USD',
    JSON.stringify(input.metadata || {}),
  ]);
  return visitor;
}

async function handleGhlWebhook(input = {}) {
  const clientId = clean(input.client_id || input.contact?.customFields?.client_id || input.customData?.client_id);
  const ghlContactId = clean(input.ghl_contact_id || input.contact_id || input.contact?.id);
  if (!clientId && !ghlContactId) throw new Error('client_id or GHL contact ID required');

  let existing = null;
  if (!clientId && ghlContactId) {
    existing = await queryOne('SELECT * FROM visitors WHERE ghl_contact_id = $1 ORDER BY last_seen_at DESC LIMIT 1', [ghlContactId]);
  }

  return recordEvent({
    ...input,
    client_id: clientId || existing?.client_id || `ghl_${ghlContactId}`,
    ghl_contact_id: ghlContactId,
    email: input.email || input.contact?.email,
    phone: input.phone || input.contact?.phone,
    current_stage: input.stage || input.pipeline_stage || input.contact?.stage,
    revenue: input.revenue || input.value || input.opportunity?.monetaryValue,
    event_name: input.event_name || 'GHLStageChange',
    metadata: input,
  });
}

async function handleMetaLead(input = {}) {
  return recordEvent({
    ...input,
    client_id: clean(input.client_id) || clean(input.meta_lead_id || input.leadgen_id) || `lead_${Date.now()}`,
    meta_lead_id: clean(input.meta_lead_id || input.leadgen_id),
    email: input.email,
    phone: input.phone,
    event_name: input.event_name || 'MetaLead',
    metadata: input,
  });
}

async function getHealth(accountId) {
  const id = accountId ? parseInt(accountId, 10) : null;
  const whereVisitors = id ? 'WHERE account_id = $1' : '';
  const whereEvents = id ? 'WHERE account_id = $1' : '';
  const params = id ? [id] : [];
  const account = id ? await queryOne('SELECT id, meta_account_id, label, name FROM accounts WHERE id = $1', [id]) : null;

  const visitors = await queryOne(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '24 hours') AS last_24h,
      COUNT(*) FILTER (WHERE last_seen_at > NOW() - INTERVAL '1 hour') AS last_1h,
      COUNT(*) FILTER (WHERE fbclid IS NOT NULL) AS with_fbclid,
      COUNT(*) FILTER (WHERE ghl_contact_id IS NOT NULL OR meta_lead_id IS NOT NULL OR email_hash IS NOT NULL) AS resolved,
      MAX(last_seen_at) AS last_seen_at
    FROM visitors ${whereVisitors}
  `, params);

  const events = await queryOne(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE fired_at > NOW() - INTERVAL '24 hours') AS last_24h,
      COUNT(*) FILTER (WHERE fired_at > NOW() - INTERVAL '1 hour') AS last_1h,
      MAX(fired_at) AS last_fired_at
    FROM visitor_events ${whereEvents}
  `, params);

  const total = parseInt(visitors.total, 10) || 0;
  const withFbclid = parseInt(visitors.with_fbclid, 10) || 0;
  const last24h = parseInt(visitors.last_24h, 10) || 0;

  let status = 'no_data';
  if (last24h > 0) status = 'live';
  else if (total > 0) status = 'stale';

  const selectedDiagnostics = diagnostics.get(account?.meta_account_id || null);
  const latestDiagnostics = diagnostics.latest();
  const accountMismatch = Boolean(
    account?.meta_account_id &&
    latestDiagnostics?.meta_account_id &&
    latestDiagnostics.meta_account_id !== account.meta_account_id
  );

  return {
    status,
    account_id: id,
    meta_account_id: account?.meta_account_id || null,
    visitors: {
      total,
      last_24h: last24h,
      last_1h: parseInt(visitors.last_1h, 10) || 0,
      with_fbclid: withFbclid,
      resolved: parseInt(visitors.resolved, 10) || 0,
      last_seen_at: visitors.last_seen_at,
      fbclid_rate: total > 0 ? Math.round((withFbclid / total) * 100) : 0,
    },
    events: {
      total: parseInt(events.total, 10) || 0,
      last_24h: parseInt(events.last_24h, 10) || 0,
      last_1h: parseInt(events.last_1h, 10) || 0,
      last_fired_at: events.last_fired_at,
    },
    diagnostics: {
      selected: selectedDiagnostics,
      latest: latestDiagnostics,
      account_mismatch: accountMismatch,
    },
  };
}

module.exports = {
  recordEvent,
  upsertVisitor,
  handleGhlWebhook,
  handleMetaLead,
  hashIdentity,
  getHealth,
};
