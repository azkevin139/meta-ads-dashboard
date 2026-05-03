const metaApi = require('./metaApi');
const metaCache = require('./metaCache');
const tracking = require('./trackingService');
const { query, queryAll, queryOne } = require('../db');
const accountService = require('./accountService');
const syncTruth = require('./syncTruthService');

const LEAD_CAMPAIGN_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION']);
const MAX_ADS_PER_ACCOUNT = parseInt(process.env.META_LEAD_SYNC_MAX_ADS_PER_ACCOUNT, 10) || 20;
const MAX_ACCOUNTS_PER_RUN = parseInt(process.env.META_LEAD_SYNC_MAX_ACCOUNTS_PER_RUN, 10) || 3;
const DEFAULT_MANUAL_MAX_ADS = parseInt(process.env.META_LEAD_SYNC_MANUAL_MAX_ADS, 10) || 250;
const ARCHIVED_AD_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO', 'ARCHIVED'];

function findFieldValue(fieldData = [], candidates) {
  const wanted = candidates.map(c => String(c).toLowerCase());
  for (const item of fieldData) {
    const name = String(item.name || '').toLowerCase();
    if (wanted.includes(name) && Array.isArray(item.values) && item.values.length) {
      return item.values[0];
    }
  }
  return null;
}

function buildLeadPayload(lead, { accountId, metaAccountId }) {
  const fields = Array.isArray(lead.field_data) ? lead.field_data : [];
  const email = findFieldValue(fields, ['email', 'email_address', 'work_email']);
  const phone = findFieldValue(fields, ['phone_number', 'phone', 'mobile', 'telephone']);
  const firstName = findFieldValue(fields, ['first_name', 'full_name']);
  const lastName = findFieldValue(fields, ['last_name']);

  return {
    account_id: accountId,
    meta_account_id: metaAccountId,
    client_id: `meta_lead_${lead.id}`,
    meta_lead_id: lead.id,
    campaign_id: lead.campaign_id || null,
    adset_id: lead.adset_id || null,
    ad_id: lead.ad_id || null,
    email,
    phone,
    event_name: 'MetaLead',
    current_stage: 'lead_captured',
    metadata: {
      form_id: lead.form_id || null,
      created_time: lead.created_time || null,
      platform: lead.platform || null,
      first_name: firstName,
      last_name: lastName,
      all_fields: fields,
    },
    raw: lead,
  };
}

function normalizeSyncOptions(options = {}) {
  const mode = ['incremental', 'full', 'range'].includes(options.mode) ? options.mode : 'incremental';
  const sinceOverride = options.sinceOverride ? new Date(options.sinceOverride) : null;
  const untilOverride = options.untilOverride ? new Date(options.untilOverride) : null;
  if (sinceOverride && Number.isNaN(sinceOverride.getTime())) throw new Error('Invalid leads sync sinceOverride');
  if (untilOverride && Number.isNaN(untilOverride.getTime())) throw new Error('Invalid leads sync untilOverride');
  if (mode === 'range' && !sinceOverride) throw new Error('range sync requires sinceOverride');
  if (sinceOverride && untilOverride && untilOverride < sinceOverride) throw new Error('leads sync untilOverride must be on or after sinceOverride');
  const includeArchived = options.includeArchived === true || mode !== 'incremental';
  const maxAds = Math.max(1, Math.min(parseInt(options.maxAds, 10) || (mode === 'incremental' ? MAX_ADS_PER_ACCOUNT : DEFAULT_MANUAL_MAX_ADS), 1000));
  return { mode, sinceOverride, untilOverride, includeArchived, maxAds };
}

async function listLeadAds(context, options = {}) {
  const adAccountId = metaApi.contextAccountId(context);
  // Single account-wide ads query filtered by the lead-gen objective — this is one call instead of N+1.
  try {
    const params = {
      fields: 'id,name,adset_id,campaign_id,effective_status,campaign{id,objective,effective_status}',
      limit: '200',
    };
    if (options.includeArchived) params.effective_status = JSON.stringify(ARCHIVED_AD_STATUSES);
    else params.effective_status = JSON.stringify(['ACTIVE', 'PAUSED']);
    const ads = await metaApi.metaGetAll(`/${adAccountId}/ads`, params, { maxPages: 10 }, context);
    return ads.filter(ad => {
      const c = ad.campaign || {};
      return LEAD_CAMPAIGN_OBJECTIVES.has(String(c.objective || '').toUpperCase())
        && String(c.effective_status || '').toUpperCase() !== 'DELETED';
    }).slice(0, options.maxAds || MAX_ADS_PER_ACCOUNT);
  } catch (err) {
    if (metaApi.isUserRateLimitError(err) || err.httpStatus === 429) throw err;
    console.warn(`[leadSync] could not list ads for account ${adAccountId}: ${err.message}`);
    return [];
  }
}

async function fetchLeadsForAd(adId, sinceUnix, untilUnix, context) {
  const params = { fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,platform,field_data', limit: '200' };
  const filtering = [];
  if (sinceUnix) filtering.push({ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix });
  if (untilUnix) filtering.push({ field: 'time_created', operator: 'LESS_THAN', value: untilUnix });
  if (filtering.length) params.filtering = JSON.stringify(filtering);
  try {
    return await metaApi.metaGetAll(`/${adId}/leads`, params, { maxPages: 10 }, context);
  } catch (err) {
    if (err.code === 100 || err.message?.includes('does not support')) return [];
    throw err;
  }
}

async function syncAccountLeads(account, options = {}) {
  if (!account || !account.id) throw new Error('Account required');
  options = normalizeSyncOptions(options);

  const sinceRow = await queryOne('SELECT last_leads_sync_success_at, last_leads_sync_at FROM accounts WHERE id = $1', [account.id]);
  const sinceTs = options.sinceOverride || (options.mode === 'incremental'
    ? (sinceRow?.last_leads_sync_success_at || sinceRow?.last_leads_sync_at ? new Date(sinceRow.last_leads_sync_success_at || sinceRow.last_leads_sync_at) : null)
    : null);
  const untilTs = options.untilOverride || null;
  const run = await syncTruth.startRun({
    source: 'meta',
    dataset: 'leads',
    accountId: account.id,
    mode: options.mode,
    coverageStart: sinceTs ? sinceTs.toISOString() : null,
    coverageEnd: untilTs ? untilTs.toISOString() : null,
    triggeredBy: options.triggeredBy || null,
    requestId: options.requestId || null,
    metadata: {
      include_archived: options.includeArchived,
      max_ads: options.maxAds,
    },
  });

  const cooldownRemaining = metaApi.getCooldownRemainingSeconds();
  if (cooldownRemaining > 0) {
    await syncTruth.finishRun(run.id, {
      status: 'skipped',
      partialReason: 'meta_rate_limited',
      errorSummary: `Skipped due to Meta cooldown (${cooldownRemaining}s remaining)`,
    });
    return {
      account_id: account.id,
      meta_account_id: account.meta_account_id,
      imported: 0,
      skipped: 0,
      error: `Skipped due to Meta cooldown (${cooldownRemaining}s remaining)`,
      sync_run_id: run.id,
      sync_status: 'skipped',
    };
  }

  const budget = metaCache.budgetStatus(account.id);
  if (budget.mode !== 'normal') {
    await syncTruth.finishRun(run.id, {
      status: 'skipped',
      partialReason: 'meta_rate_limited',
      errorSummary: `Skipped due to call budget mode: ${budget.mode}`,
      metadata: { budget },
    });
    return {
      account_id: account.id,
      meta_account_id: account.meta_account_id,
      imported: 0,
      skipped: 0,
      error: `Skipped due to call budget mode: ${budget.mode}`,
      sync_run_id: run.id,
      sync_status: 'skipped',
    };
  }

  const sinceUnix = sinceTs ? Math.floor(sinceTs.getTime() / 1000) : null;
  const untilUnix = untilTs ? Math.floor(untilTs.getTime() / 1000) : null;

  let imported = 0;
  let skipped = 0;
  let scanned = 0;
  let adCount = 0;
  let errorMessage = null;

  try {
    const ads = await listLeadAds(account, options);
    adCount = ads.length;
    for (const ad of ads) {
      let leads;
      try {
        leads = await fetchLeadsForAd(ad.id, sinceUnix, untilUnix, account);
      } catch (err) {
        // If we hit the user rate limit mid-sync, bail early and try again next cycle.
        if (metaApi.isUserRateLimitError(err) || err.httpStatus === 429) {
          console.warn(`[leadSync] rate limit hit for account ${account.id}, stopping early`);
          errorMessage = `Stopped early at ad ${ad.id}: ${err.message}`;
          break;
        }
        console.warn(`[leadSync] ad ${ad.id} failed: ${err.message}`);
        continue;
      }
      scanned += leads.length;
      for (const lead of leads) {
        const payload = buildLeadPayload(lead, {
          accountId: account.id,
          metaAccountId: account.meta_account_id,
        });
        try {
          await tracking.recordEvent(payload);
          imported += 1;
        } catch (err) {
          skipped += 1;
          console.warn(`[leadSync] failed to upsert lead ${lead.id}: ${err.message}`);
        }
      }
    }
  } catch (err) {
    errorMessage = err.message || String(err);
  }

  await query(`
    UPDATE accounts
    SET last_leads_sync_attempted_at = NOW(),
        last_leads_sync_at = NOW(),
        last_leads_sync_success_at = CASE WHEN $8::text IS NULL THEN NOW() ELSE last_leads_sync_success_at END,
        last_leads_sync_count = $2,
        last_leads_sync_scan_count = $3,
        last_leads_sync_ad_count = $4,
        last_leads_sync_mode = $5,
        last_leads_sync_since = $6,
        last_leads_sync_until = $7,
        last_leads_sync_error = $8,
        updated_at = NOW()
    WHERE id = $1
  `, [account.id, imported, scanned, adCount, options.mode, sinceTs ? sinceTs.toISOString() : null, untilTs ? untilTs.toISOString() : null, errorMessage]);

  const syncStatus = errorMessage ? (scanned > 0 || imported > 0 ? 'partial' : 'failed') : 'success';
  await syncTruth.finishRun(run.id, {
    status: syncStatus,
    attemptedCount: scanned,
    importedCount: imported,
    skippedCount: skipped,
    errorCount: errorMessage || skipped ? 1 : 0,
    partialReason: errorMessage ? (/rate limit|user request limit/i.test(errorMessage) ? 'meta_rate_limited' : 'meta_sync_partial') : null,
    errorSummary: errorMessage,
    metadata: {
      ad_count: adCount,
      include_archived: options.includeArchived,
      max_ads: options.maxAds,
    },
  });

  return {
    account_id: account.id,
    meta_account_id: account.meta_account_id,
    mode: options.mode,
    since: sinceTs ? sinceTs.toISOString() : null,
    until: untilTs ? untilTs.toISOString() : null,
    include_archived: options.includeArchived,
    scanned,
    ad_count: adCount,
    imported,
    skipped,
    error: errorMessage,
    sync_run_id: run.id,
    sync_status: syncStatus,
  };
}

async function syncAccountById(accountId, options = {}) {
  const account = await accountService.getAccountById(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.access_token) throw new Error('Account has no stored token');
  return syncAccountLeads(account, options);
}

async function syncAllAccounts() {
  const rows = await queryAll(`
    SELECT id
    FROM accounts
    WHERE COALESCE(is_active, false) = true
       OR product_mode = 'lead_gen'
       OR COALESCE(fast_sync_enabled, false) = true
    ORDER BY COALESCE(last_leads_sync_success_at, last_leads_sync_at, to_timestamp(0)) ASC, id ASC
    LIMIT $1
  `, [MAX_ACCOUNTS_PER_RUN]);
  const results = [];
  for (const row of rows) {
    if (metaApi.getCooldownRemainingSeconds() > 0) {
      results.push({ account_id: row.id, error: 'Skipped due to active Meta cooldown' });
      break;
    }
    try {
      const result = await syncAccountById(row.id);
      results.push(result);
      // If an account hit the limit, stop the whole sweep — the cooldown is global per token
      // and we'll come back in 15 min.
      if (result.error && /rate limit|user request limit/i.test(result.error)) {
        console.warn(`[leadSync] global cooldown engaged after account ${row.id}, aborting sweep`);
        break;
      }
    } catch (err) {
      results.push({ account_id: row.id, error: err.message });
      if (/rate limit|user request limit/i.test(err.message)) break;
    }
  }
  return results;
}

async function getLeadFormRegistry(accountId, { since, until } = {}) {
  const account = await accountService.getAccountById(accountId);
  if (!account) throw new Error(`Account ${accountId} not found`);

  const params = [accountId];
  let where = `
    WHERE v.account_id = $1
      AND v.meta_lead_id IS NOT NULL
  `;
  if (since) {
    params.push(new Date(since).toISOString());
    where += ` AND ve.fired_at >= $${params.length}::timestamptz`;
  }
  if (until) {
    params.push(new Date(until).toISOString());
    where += ` AND ve.fired_at <= $${params.length}::timestamptz`;
  }

  const forms = await queryAll(`
    SELECT
      COALESCE(ve.metadata->>'form_id', v.raw->'metadata'->>'form_id', 'unknown') AS form_id,
      COUNT(DISTINCT v.meta_lead_id) AS lead_count,
      COUNT(DISTINCT v.ad_id) AS ad_count,
      MIN(ve.fired_at) AS first_seen_at,
      MAX(ve.fired_at) AS last_seen_at,
      ARRAY_REMOVE(ARRAY_AGG(DISTINCT v.campaign_id), NULL) AS campaign_ids
    FROM visitors v
    LEFT JOIN visitor_events ve
      ON ve.client_id = v.client_id
     AND ve.event_name = 'MetaLead'
    ${where}
    GROUP BY COALESCE(ve.metadata->>'form_id', v.raw->'metadata'->>'form_id', 'unknown')
    ORDER BY lead_count DESC, form_id
  `, params);

  const status = await queryOne(`
    SELECT last_leads_sync_at, last_leads_sync_attempted_at, last_leads_sync_success_at,
           last_leads_sync_count, last_leads_sync_scan_count, last_leads_sync_ad_count,
           last_leads_sync_mode, last_leads_sync_since, last_leads_sync_until, last_leads_sync_error
    FROM accounts WHERE id = $1
  `, [accountId]);

  return {
    account_id: accountId,
    meta_account_id: account.meta_account_id,
    sync: {
      last_sync_at: status?.last_leads_sync_at || null,
      last_attempted_sync_at: status?.last_leads_sync_attempted_at || null,
      last_successful_sync_at: status?.last_leads_sync_success_at || null,
      last_sync_count: status?.last_leads_sync_count || 0,
      last_scan_count: status?.last_leads_sync_scan_count || 0,
      last_ad_count: status?.last_leads_sync_ad_count || 0,
      last_sync_mode: status?.last_leads_sync_mode || 'incremental',
      last_sync_since: status?.last_leads_sync_since || null,
      last_sync_until: status?.last_leads_sync_until || null,
      last_sync_error: status?.last_leads_sync_error || null,
    },
    forms: forms.map((row) => ({
      form_id: row.form_id,
      lead_count: parseInt(row.lead_count, 10) || 0,
      ad_count: parseInt(row.ad_count, 10) || 0,
      first_seen_at: row.first_seen_at,
      last_seen_at: row.last_seen_at,
      campaign_ids: row.campaign_ids || [],
      coverage: row.form_id === 'unknown' ? 'partial' : 'imported_history',
    })),
  };
}

function startBackgroundSync({ intervalMs = 15 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await syncAllAccounts();
      const total = results.reduce((sum, r) => sum + (r.imported || 0), 0);
      if (total > 0) console.log(`[leadSync] imported ${total} leads across ${results.length} account(s)`);
    } catch (err) {
      console.error(`[leadSync] background run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  // Kick off first run on a short delay so server startup isn't blocked.
  setTimeout(run, 30 * 1000).unref?.();
  return timer;
}

module.exports = {
  syncAccountLeads,
  syncAccountById,
  syncAllAccounts,
  startBackgroundSync,
  getLeadFormRegistry,
};
