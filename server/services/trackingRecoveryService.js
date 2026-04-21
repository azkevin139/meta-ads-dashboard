const { queryOne, queryAll } = require('../db');
const metaLeadSync = require('./metaLeadSyncService');
const ghl = require('./ghlService');
const warehouse = require('./warehouseSyncService');
const diagnostics = require('./trackingDiagnosticsService');
const syncTruth = require('./syncTruthService');

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
  return queryOne(`
    INSERT INTO tracking_outage_windows (
      account_id, outage_start, outage_end, notes, status, updated_at
    ) VALUES ($1,$2,$3,$4,'active',NOW())
    ON CONFLICT (account_id) WHERE status = 'active' DO UPDATE SET
      outage_start = EXCLUDED.outage_start,
      outage_end = EXCLUDED.outage_end,
      notes = EXCLUDED.notes,
      updated_at = NOW()
    RETURNING
      id,
      outage_start::text,
      outage_end::text,
      notes,
      status,
      last_backfill_at,
      last_backfill,
      created_at,
      updated_at
  `, [accountId, start, end, notes ? String(notes).trim().slice(0, 1000) : '']);
}

async function getWindow(accountId, { includeRecovered = false } = {}) {
  return queryOne(`
    SELECT
      id,
      outage_start::text,
      outage_end::text,
      notes,
      status,
      last_backfill_at,
      last_backfill,
      created_at,
      updated_at
    FROM tracking_outage_windows
    WHERE account_id = $1
      AND ($2::boolean = TRUE OR status = 'active')
    ORDER BY
      CASE status WHEN 'active' THEN 1 WHEN 'recovered' THEN 2 ELSE 3 END,
      updated_at DESC
    LIMIT 1
  `, [accountId, includeRecovered === true]);
}

async function getSummary(accountId) {
  const window = await getWindow(accountId);
  if (!window) {
    return {
      outage_window: null,
      buckets: [],
      reconciliation: [],
      warnings: [],
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
      COUNT(DISTINCT CASE WHEN normalized_stage IN ('booked', 'showed') THEN client_id END) AS bookings,
      COUNT(DISTINCT CASE WHEN normalized_stage IN ('closed_won', 'closed_lost') OR COALESCE(revenue, 0) > 0 THEN client_id END) AS conversions
    FROM visitors
    WHERE account_id = $1
      AND last_seen_at::date BETWEEN $2::date AND $3::date
  `, params);

  const aggregateRows = await queryAll(`
    SELECT
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(spend), 0) AS spend
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
  const nativeVisitors = parseInt(native.visitors, 10) || 0;
  const nativePageviews = parseInt(native.pageviews, 10) || 0;
  const importedMetaLeads = parseInt(recoverable.imported_meta_leads, 10) || 0;
  const ghlContacts = parseInt(recoverable.ghl_contacts, 10) || 0;
  const bookings = parseInt(recoverable.bookings, 10) || 0;
  const conversions = parseInt(recoverable.conversions, 10) || 0;

  const warnings = [
    'Imported leads are not anonymous visitors.',
    'Warehouse aggregate traffic is account-level Meta reporting, not reconstructed identity.',
    'Bookings are inferred from CRM stage values.',
  ];
  if (!window.last_backfill_at) warnings.push('No partial backfill has been run for this outage window yet.');
  if (metaLandingPageViews > 0 && nativeVisitors === 0) warnings.push('Meta aggregate landing page views exist while native tracked visits are near zero.');

  const reconciliation = [
    {
      metric: 'Visits',
      native: nativeVisitors,
      meta: null,
      ghl: null,
      warehouse: metaLandingPageViews,
      delta: metaLandingPageViews - nativeVisitors,
      notes: 'Native tracked visitors vs Meta aggregate landing page views during outage window.',
    },
    {
      metric: 'Pageviews',
      native: nativePageviews,
      meta: null,
      ghl: null,
      warehouse: metaLandingPageViews,
      delta: metaLandingPageViews - nativePageviews,
      notes: 'Native pageview events vs Meta aggregate LPVs.',
    },
    {
      metric: 'Leads',
      native: 0,
      meta: importedMetaLeads,
      ghl: null,
      warehouse: null,
      delta: importedMetaLeads,
      notes: 'Known leads recovered from Meta native lead forms.',
    },
    {
      metric: 'Contacts',
      native: null,
      meta: null,
      ghl: ghlContacts,
      warehouse: null,
      delta: ghlContacts,
      notes: 'CRM contacts imported from GHL during the outage window.',
    },
    {
      metric: 'Bookings',
      native: null,
      meta: null,
      ghl: bookings,
      warehouse: null,
      delta: bookings,
      notes: 'Bookings inferred from CRM stage.',
    },
    {
      metric: 'Conversions',
      native: null,
      meta: null,
      ghl: conversions,
      warehouse: null,
      delta: conversions,
      notes: 'Closed/revenue contacts inferred from CRM state.',
    },
    {
      metric: 'Spend',
      native: null,
      meta: null,
      ghl: null,
      warehouse: metaSpend,
      delta: null,
      notes: 'Warehouse aggregate spend for context only.',
      format: 'currency',
    },
  ];

  return {
    outage_window: window,
    buckets: [
      {
        key: 'native_tracked_visits',
        label: 'Native tracked visits',
        status: 'lost',
        source: 'native_tracked',
        count: nativeVisitors,
        detail: `${nativePageviews} pageviews reached the tracker during the outage window.`,
        confidence: 'high',
      },
      {
        key: 'imported_meta_leads',
        label: 'Imported Meta leads',
        status: 'recoverable',
        source: 'imported_meta',
        count: importedMetaLeads,
        detail: 'Recoverable known contacts from Meta native lead forms.',
        confidence: 'high',
      },
      {
        key: 'ghl_contacts',
        label: 'GHL contacts',
        status: 'recoverable',
        source: 'imported_ghl',
        count: ghlContacts,
        detail: 'Recoverable known contacts synced from GHL.',
        confidence: 'medium',
      },
      {
        key: 'bookings',
        label: 'Bookings / appointments',
        status: 'recoverable',
        source: 'imported_ghl',
        count: bookings,
        detail: 'Recoverable booked-call contacts inferred from CRM stage.',
        confidence: 'medium',
      },
      {
        key: 'meta_aggregate_traffic',
        label: 'Meta aggregate traffic',
        status: 'recoverable',
        source: 'warehouse_aggregate',
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
        source: 'unavailable',
        count: 0,
        detail: 'Not connected in this app. Optional future import from external logs.',
        confidence: 'unknown',
      },
    ],
    reconciliation,
    warnings,
  };
}

async function runBackfill(accountId, { outage_start, outage_end }) {
  const start = validateDate(outage_start, 'outage_start');
  const end = validateDate(outage_end, 'outage_end');
  if (start > end) throw new Error('outage_end must be on or after outage_start');
  const run = await syncTruth.startRun({
    source: 'recovery',
    dataset: 'tracking_outage_backfill',
    accountId,
    mode: 'range',
    coverageStart: start,
    coverageEnd: end,
  });

  const [meta, ghlResult, warehouseResult] = await Promise.all([
    metaLeadSync.syncAccountById(accountId, { sinceOverride: start, triggeredBy: 'tracking_recovery' }).catch((err) => ({ error: err.message })),
    ghl.syncAccountById(accountId, { sinceOverride: start, triggeredBy: 'tracking_recovery' }).catch((err) => ({ error: err.message })),
    warehouse.syncAccountInsightsRange(accountId, { since: start, until: end, levels: ['account'] }).catch((err) => ({ error: err.message })),
  ]);
  const errorCount = [meta, ghlResult, warehouseResult].filter((result) => result?.error).length;

  const lastBackfill = {
      meta_leads: meta,
      ghl_contacts: ghlResult,
      meta_aggregate: warehouseResult,
  };
  await queryOne(`
    INSERT INTO tracking_outage_windows (
      account_id, outage_start, outage_end, status, last_backfill_at, last_backfill, updated_at
    ) VALUES ($1,$2,$3,'active',NOW(),$4::jsonb,NOW())
    ON CONFLICT (account_id) WHERE status = 'active' DO UPDATE SET
      outage_start = EXCLUDED.outage_start,
      outage_end = EXCLUDED.outage_end,
      last_backfill_at = EXCLUDED.last_backfill_at,
      last_backfill = EXCLUDED.last_backfill,
      updated_at = NOW()
    RETURNING id
  `, [accountId, start, end, JSON.stringify(lastBackfill)]);
  await syncTruth.finishRun(run.id, {
    status: errorCount ? 'partial' : 'success',
    attemptedCount: 3,
    importedCount: [meta, ghlResult, warehouseResult].filter((result) => !result?.error).length,
    errorCount,
    partialReason: errorCount ? 'outage_window_applied' : null,
    errorSummary: errorCount ? [meta, ghlResult, warehouseResult].map((result) => result?.error).filter(Boolean).join(' | ') : null,
    coverageStart: start,
    coverageEnd: end,
    metadata: {
      meta_leads: meta,
      ghl_contacts: ghlResult,
      meta_aggregate: warehouseResult,
    },
  });

  return {
    outage_start: start,
    outage_end: end,
    meta_leads: meta,
    ghl_contacts: ghlResult,
    meta_aggregate: warehouseResult,
    sync_run_id: run.id,
  };
}

async function getAlerts(accountId, { hours = 24 } = {}) {
  const account = await queryOne('SELECT id, meta_account_id, name, label FROM accounts WHERE id = $1', [accountId]);
  if (!account) {
    return {
      account_id: accountId,
      window_hours: hours,
      alerts: [],
      summary: {
        native_pageviews: 0,
        native_visitors: 0,
        imported_meta_leads: 0,
        imported_ghl_contacts: 0,
      },
    };
  }

  const params = [accountId, hours];
  const recent = await queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE event_name = 'PageView') AS native_pageviews,
      COUNT(DISTINCT client_id) FILTER (WHERE event_name = 'PageView') AS native_visitors
    FROM visitor_events
    WHERE account_id = $1
      AND fired_at > NOW() - ($2::int * INTERVAL '1 hour')
  `, params);

  const recoverable = await queryOne(`
    SELECT
      COUNT(DISTINCT CASE WHEN meta_lead_id IS NOT NULL OR lower(COALESCE(source_event_type, '')) LIKE 'fb-lead%' OR lower(COALESCE(source_event_type, '')) LIKE '%instant%form%' THEN client_id END) AS imported_meta_leads,
      COUNT(DISTINCT CASE WHEN ghl_contact_id IS NOT NULL THEN client_id END) AS imported_ghl_contacts
    FROM visitors
    WHERE account_id = $1
      AND last_seen_at > NOW() - ($2::int * INTERVAL '1 hour')
  `, params);

  const nativePageviews = parseInt(recent.native_pageviews, 10) || 0;
  const nativeVisitors = parseInt(recent.native_visitors, 10) || 0;
  const importedMetaLeads = parseInt(recoverable.imported_meta_leads, 10) || 0;
  const importedGhlContacts = parseInt(recoverable.imported_ghl_contacts, 10) || 0;
  const recoverableKnown = importedMetaLeads + importedGhlContacts;
  const diag = diagnostics.get(account.meta_account_id);

  const alerts = [];
  if (recoverableKnown > 0 && nativePageviews === 0) {
    alerts.push({
      code: 'tracking_outage_known_activity_without_pageviews',
      severity: 'critical',
      source: 'native_tracked',
      title: 'Known lead activity with zero native pageviews',
      message: `Imported activity exists in the last ${hours}h (${importedMetaLeads} Meta leads, ${importedGhlContacts} GHL contacts) but native tracked pageviews are zero.`,
      action: 'Check the website snippet, selected account, and browser network requests for /api/track/pageview.',
    });
  } else if (recoverableKnown >= 3 && nativePageviews > 0 && nativePageviews <= 2) {
    alerts.push({
      code: 'tracking_low_native_volume_vs_known_activity',
      severity: 'warning',
      source: 'outage_affected',
      title: 'Native tracking volume is abnormally low',
      message: `The last ${hours}h shows ${recoverableKnown} recoverable lead/contact records but only ${nativePageviews} native pageviews.`,
      action: 'Confirm the tracker is firing on every landing page and SPA route.',
    });
  }

  if (diag?.failure_count && diag.last_failure_at) {
    const lastFailureAgeMs = Date.now() - new Date(diag.last_failure_at).getTime();
    if (Number.isFinite(lastFailureAgeMs) && lastFailureAgeMs <= hours * 60 * 60 * 1000) {
      alerts.push({
        code: 'tracking_ingest_failures_recent',
        severity: 'warning',
        source: 'native_tracked',
        title: 'Recent tracking ingest failures',
        message: `The tracker recorded ${diag.failure_count} failed ingest attempts recently for ${account.meta_account_id}.`,
        action: diag.last_error ? `Last error: ${diag.last_error}` : 'Check browser console logs and network requests.',
      });
    }
  }

  return {
    account_id: accountId,
    meta_account_id: account.meta_account_id,
    account_name: account.label || account.name || null,
    window_hours: hours,
    alerts,
    summary: {
      native_pageviews: nativePageviews,
      native_visitors: nativeVisitors,
      imported_meta_leads: importedMetaLeads,
      imported_ghl_contacts: importedGhlContacts,
    },
  };
}

module.exports = {
  getWindow,
  saveWindow,
  getSummary,
  runBackfill,
  getAlerts,
};
