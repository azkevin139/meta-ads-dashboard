const metaApi = require('./metaApi');
const metaCache = require('./metaCache');
const tracking = require('./trackingService');
const { query, queryAll, queryOne } = require('../db');
const accountService = require('./accountService');

const LEAD_CAMPAIGN_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION']);
const MAX_ADS_PER_ACCOUNT = parseInt(process.env.META_LEAD_SYNC_MAX_ADS_PER_ACCOUNT, 10) || 20;
const MAX_ACCOUNTS_PER_RUN = parseInt(process.env.META_LEAD_SYNC_MAX_ACCOUNTS_PER_RUN, 10) || 3;

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

async function listLeadAds(context) {
  const adAccountId = metaApi.contextAccountId(context);
  // Single account-wide ads query filtered by the lead-gen objective — this is one call instead of N+1.
  try {
    const ads = await metaApi.metaGetAll(`/${adAccountId}/ads`, {
      fields: 'id,name,adset_id,campaign_id,effective_status,campaign{id,objective,effective_status}',
      effective_status: JSON.stringify(['ACTIVE', 'PAUSED']),
      limit: '200',
    }, { maxPages: 10 }, context);
    return ads.filter(ad => {
      const c = ad.campaign || {};
      return LEAD_CAMPAIGN_OBJECTIVES.has(String(c.objective || '').toUpperCase())
        && String(c.effective_status || '').toUpperCase() !== 'DELETED';
    }).slice(0, MAX_ADS_PER_ACCOUNT);
  } catch (err) {
    if (metaApi.isUserRateLimitError(err) || err.httpStatus === 429) throw err;
    console.warn(`[leadSync] could not list ads for account ${adAccountId}: ${err.message}`);
    return [];
  }
}

async function fetchLeadsForAd(adId, sinceUnix, context) {
  const params = { fields: 'id,created_time,ad_id,adset_id,campaign_id,form_id,platform,field_data', limit: '200' };
  if (sinceUnix) params.filtering = JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: sinceUnix }]);
  try {
    return await metaApi.metaGetAll(`/${adId}/leads`, params, { maxPages: 10 }, context);
  } catch (err) {
    if (err.code === 100 || err.message?.includes('does not support')) return [];
    throw err;
  }
}

async function syncAccountLeads(account, { sinceOverride } = {}) {
  if (!account || !account.id) throw new Error('Account required');

  const cooldownRemaining = metaApi.getCooldownRemainingSeconds();
  if (cooldownRemaining > 0) {
    return {
      account_id: account.id,
      meta_account_id: account.meta_account_id,
      imported: 0,
      skipped: 0,
      error: `Skipped due to Meta cooldown (${cooldownRemaining}s remaining)`,
    };
  }

  const budget = metaCache.budgetStatus(account.id);
  if (budget.mode !== 'normal') {
    return {
      account_id: account.id,
      meta_account_id: account.meta_account_id,
      imported: 0,
      skipped: 0,
      error: `Skipped due to call budget mode: ${budget.mode}`,
    };
  }

  const sinceRow = await queryOne('SELECT last_leads_sync_at FROM accounts WHERE id = $1', [account.id]);
  const sinceTs = sinceOverride ? new Date(sinceOverride) : (sinceRow?.last_leads_sync_at ? new Date(sinceRow.last_leads_sync_at) : null);
  const sinceUnix = sinceTs ? Math.floor(sinceTs.getTime() / 1000) : null;

  let imported = 0;
  let skipped = 0;
  let errorMessage = null;

  try {
    const ads = await listLeadAds(account);
    for (const ad of ads) {
      let leads;
      try {
        leads = await fetchLeadsForAd(ad.id, sinceUnix, account);
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
    SET last_leads_sync_at = NOW(),
        last_leads_sync_count = $2,
        last_leads_sync_error = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [account.id, imported, errorMessage]);

  return { account_id: account.id, meta_account_id: account.meta_account_id, imported, skipped, error: errorMessage };
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
    ORDER BY COALESCE(last_leads_sync_at, to_timestamp(0)) ASC, id ASC
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
};
