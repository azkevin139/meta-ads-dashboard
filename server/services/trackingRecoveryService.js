const fs = require('fs');
const path = require('path');
const { queryOne, queryAll } = require('../db');
const metaLeadSync = require('./metaLeadSyncService');
const ghl = require('./ghlService');
const warehouse = require('./warehouseSyncService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUTAGE_FILE = path.join(DATA_DIR, 'tracking-outages.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readOutages() {
  try {
    if (!fs.existsSync(OUTAGE_FILE)) return {};
    return JSON.parse(fs.readFileSync(OUTAGE_FILE, 'utf8'));
  } catch (_err) {
    return {};
  }
}

function writeOutages(data) {
  ensureDataDir();
  fs.writeFileSync(OUTAGE_FILE, JSON.stringify(data, null, 2));
  return data;
}

function validateDate(value, name) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${name} must be YYYY-MM-DD`);
  return text;
}

function parseActionCount(actions, candidates) {
  if (!actions || !Array.isArray(actions.actions)) return 0;
  return actions.actions.reduce((sum, row) => {
    const type = String(row.action_type || '');
    if (!candidates.includes(type)) return sum;
    return sum + (parseInt(row.value, 10) || 0);
  }, 0);
}

async function saveWindow(accountId, { outage_start, outage_end, notes }) {
  const start = validateDate(outage_start, 'outage_start');
  const end = validateDate(outage_end, 'outage_end');
  if (start > end) throw new Error('outage_end must be on or after outage_start');
  const data = readOutages();
  data[String(accountId)] = {
    outage_start: start,
    outage_end: end,
    notes: notes ? String(notes).trim().slice(0, 1000) : '',
    updated_at: new Date().toISOString(),
  };
  writeOutages(data);
  return data[String(accountId)];
}

function getWindow(accountId) {
  const data = readOutages();
  return data[String(accountId)] || null;
}

async function getSummary(accountId) {
  const window = getWindow(accountId);
  if (!window) {
    return {
      outage_window: null,
      buckets: [],
      note: 'No outage window configured',
    };
  }

  const params = [accountId, window.outage_start, window.outage_end];
  const native = await queryOne(`
    SELECT
      COUNT(*) AS pageviews,
      COUNT(DISTINCT client_id) AS visitors
    FROM visitor_events
    WHERE account_id = $1
      AND event_name = 'PageView'
      AND fired_at::date BETWEEN $2::date AND $3::date
  `, params);

  const recoverable = await queryOne(`
    SELECT
      COUNT(DISTINCT CASE WHEN meta_lead_id IS NOT NULL OR lower(COALESCE(source_event_type, '')) LIKE 'fb-lead%' OR lower(COALESCE(source_event_type, '')) LIKE '%instant%form%' THEN client_id END) AS imported_meta_leads,
      COUNT(DISTINCT CASE WHEN ghl_contact_id IS NOT NULL THEN client_id END) AS ghl_contacts,
      COUNT(DISTINCT CASE WHEN lower(COALESCE(current_stage, '')) LIKE '%book%' OR lower(COALESCE(current_stage, '')) LIKE '%appoint%' THEN client_id END) AS bookings,
      COUNT(DISTINCT CASE WHEN lower(COALESCE(current_stage, '')) LIKE '%closed%' OR COALESCE(revenue, 0) > 0 THEN client_id END) AS conversions
    FROM visitors
    WHERE account_id = $1
      AND last_seen_at::date BETWEEN $2::date AND $3::date
  `, params);

  const aggregateRows = await queryAll(`
    SELECT
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(spend), 0) AS spend,
      actions_json
    FROM daily_insights
    WHERE account_id = $1
      AND level = 'account'
      AND date BETWEEN $2::date AND $3::date
  `, params);
  const actionsJsonRows = await queryAll(`
    SELECT actions_json
    FROM daily_insights
    WHERE account_id = $1
      AND level = 'account'
      AND date BETWEEN $2::date AND $3::date
  `, params);

  const metaClicks = parseInt(aggregateRows[0]?.clicks, 10) || 0;
  const metaSpend = parseFloat(aggregateRows[0]?.spend) || 0;
  const metaLandingPageViews = actionsJsonRows.reduce((sum, row) => sum + parseActionCount(row.actions_json || {}, ['landing_page_view']), 0);

  return {
    outage_window: window,
    buckets: [
      {
        key: 'native_tracked_visits',
        label: 'Native tracked visits',
        status: 'lost',
        count: parseInt(native.visitors, 10) || 0,
        detail: `${parseInt(native.pageviews, 10) || 0} pageviews reached the tracker during the outage window.`,
        confidence: 'high',
      },
      {
        key: 'imported_meta_leads',
        label: 'Imported Meta leads',
        status: 'recoverable',
        count: parseInt(recoverable.imported_meta_leads, 10) || 0,
        detail: 'Recoverable known contacts from Meta native lead forms.',
        confidence: 'high',
      },
      {
        key: 'ghl_contacts',
        label: 'GHL contacts',
        status: 'recoverable',
        count: parseInt(recoverable.ghl_contacts, 10) || 0,
        detail: 'Recoverable known contacts synced from GHL.',
        confidence: 'medium',
      },
      {
        key: 'bookings',
        label: 'Bookings / appointments',
        status: 'recoverable',
        count: parseInt(recoverable.bookings, 10) || 0,
        detail: 'Recoverable booked-call contacts inferred from CRM stage.',
        confidence: 'medium',
      },
      {
        key: 'meta_aggregate_traffic',
        label: 'Meta aggregate traffic',
        status: 'recoverable',
        count: metaLandingPageViews,
        clicks: metaClicks,
        spend: metaSpend,
        detail: 'Aggregate Meta landing page views/clicks from warehouse insights.',
        confidence: 'high',
      },
      {
        key: 'server_log_page_hits',
        label: 'Server / CDN page hits',
        status: 'unavailable',
        count: 0,
        detail: 'Not connected in this app. Optional future import from external logs.',
        confidence: 'unknown',
      },
    ],
  };
}

async function runBackfill(accountId, { outage_start, outage_end }) {
  const start = validateDate(outage_start, 'outage_start');
  const end = validateDate(outage_end, 'outage_end');
  if (start > end) throw new Error('outage_end must be on or after outage_start');

  const [meta, ghlResult, warehouseResult] = await Promise.all([
    metaLeadSync.syncAccountById(accountId, { sinceOverride: start }).catch((err) => ({ error: err.message })),
    ghl.syncAccountById(accountId, { sinceOverride: start }).catch((err) => ({ error: err.message })),
    warehouse.syncAccountInsightsRange(accountId, { since: start, until: end, levels: ['account'] }).catch((err) => ({ error: err.message })),
  ]);

  return {
    outage_start: start,
    outage_end: end,
    meta_leads: meta,
    ghl_contacts: ghlResult,
    meta_aggregate: warehouseResult,
  };
}

module.exports = {
  getWindow,
  saveWindow,
  getSummary,
  runBackfill,
};
