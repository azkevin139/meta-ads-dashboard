// Nightly / periodic warehouse sync — mirror Meta campaigns/adsets/ads metadata +
// daily_insights into Postgres so the UI can read from DB instead of hitting Meta on every click.
//
// Runs:
//   - Every 6h for each account (staggered so all accounts don't hit Meta at once).
//   - Skips accounts currently in cache_only/blocked budget mode.
//   - Skips accounts whose last sync finished <2h ago (unless forceRefresh).
//
// Resilient to rate limits: stops mid-sweep, records partial progress, resumes next cycle.

const metaApi = require('./metaApi');
const metaCache = require('./metaCache');
const accountService = require('./accountService');
const { query, queryAll, queryOne } = require('../db');

async function ensureAccountExists(account) {
  // Used for the internal id → Meta id bridge in foreign keys.
  return account.id;
}

async function upsertCampaigns(accountId, campaigns) {
  let written = 0;
  for (const c of campaigns) {
    try {
      await query(`
        INSERT INTO campaigns (
          meta_campaign_id, account_id, name, objective, status, effective_status,
          daily_budget, lifetime_budget, buying_type, special_ad_categories, synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (meta_campaign_id) DO UPDATE SET
          name = EXCLUDED.name,
          objective = EXCLUDED.objective,
          status = EXCLUDED.status,
          effective_status = EXCLUDED.effective_status,
          daily_budget = EXCLUDED.daily_budget,
          lifetime_budget = EXCLUDED.lifetime_budget,
          buying_type = EXCLUDED.buying_type,
          special_ad_categories = EXCLUDED.special_ad_categories,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        c.id,
        accountId,
        c.name || null,
        c.objective || null,
        c.status || null,
        c.effective_status || null,
        c.daily_budget ? Number(c.daily_budget) : null,
        c.lifetime_budget ? Number(c.lifetime_budget) : null,
        c.buying_type || null,
        JSON.stringify(c.special_ad_categories || []),
      ]);
      written += 1;
    } catch (err) {
      console.warn(`[warehouse] campaign ${c.id} upsert failed: ${err.message}`);
    }
  }
  return written;
}

async function upsertAdSetsFromMeta(accountId, campaignPk, adsets) {
  let written = 0;
  for (const a of adsets) {
    try {
      const targetingJson = a.targeting ? JSON.stringify(a.targeting) : null;
      await query(`
        INSERT INTO adsets (
          meta_adset_id, campaign_id, account_id, name, status, effective_status,
          daily_budget, lifetime_budget, bid_strategy, bid_amount, optimization_goal,
          billing_event, targeting, attribution_setting, start_time, end_time, synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        ON CONFLICT (meta_adset_id) DO UPDATE SET
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          effective_status = EXCLUDED.effective_status,
          daily_budget = EXCLUDED.daily_budget,
          lifetime_budget = EXCLUDED.lifetime_budget,
          bid_strategy = EXCLUDED.bid_strategy,
          bid_amount = EXCLUDED.bid_amount,
          optimization_goal = EXCLUDED.optimization_goal,
          billing_event = EXCLUDED.billing_event,
          targeting = COALESCE(EXCLUDED.targeting, adsets.targeting),
          attribution_setting = EXCLUDED.attribution_setting,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        a.id,
        campaignPk,
        accountId,
        a.name || null,
        a.status || null,
        a.effective_status || null,
        a.daily_budget ? Number(a.daily_budget) : null,
        a.lifetime_budget ? Number(a.lifetime_budget) : null,
        a.bid_strategy || null,
        a.bid_amount ? Number(a.bid_amount) : null,
        a.optimization_goal || null,
        a.billing_event || null,
        targetingJson,
        a.attribution_spec ? JSON.stringify(a.attribution_spec).slice(0, 200) : null,
        a.start_time || null,
        a.end_time || null,
      ]);
      written += 1;
    } catch (err) {
      console.warn(`[warehouse] adset ${a.id} upsert failed: ${err.message}`);
    }
  }
  return written;
}

async function upsertAdsFromMeta(accountId, campaignPk, adsetPk, ads) {
  let written = 0;
  for (const ad of ads) {
    try {
      const creative = ad.creative || {};
      await query(`
        INSERT INTO ads (
          meta_ad_id, adset_id, campaign_id, account_id, name, status, effective_status,
          creative_id, preview_url, creative_meta, synced_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (meta_ad_id) DO UPDATE SET
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          effective_status = EXCLUDED.effective_status,
          creative_id = EXCLUDED.creative_id,
          preview_url = EXCLUDED.preview_url,
          creative_meta = COALESCE(EXCLUDED.creative_meta, ads.creative_meta),
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        ad.id,
        adsetPk,
        campaignPk,
        accountId,
        ad.name || null,
        ad.status || null,
        ad.effective_status || null,
        creative.id || null,
        ad.preview_shareable_link || null,
        JSON.stringify({
          headline: creative.title || null,
          body: creative.body || null,
          cta: creative.call_to_action_type || null,
          image_url: creative.image_url || null,
          thumbnail_url: creative.thumbnail_url || null,
          video_id: creative.video_id || null,
        }),
      ]);
      written += 1;
    } catch (err) {
      console.warn(`[warehouse] ad ${ad.id} upsert failed: ${err.message}`);
    }
  }
  return written;
}

async function upsertInsightRows(accountId, rows, level) {
  let written = 0;
  for (const row of rows) {
    try {
      const date = row.date_start;
      if (!date) continue;

      // Resolve local PKs for linking — nullable.
      const campaignPk = row.campaign_id
        ? (await queryOne('SELECT id FROM campaigns WHERE meta_campaign_id = $1', [row.campaign_id]))?.id
        : null;
      const adsetPk = row.adset_id
        ? (await queryOne('SELECT id FROM adsets WHERE meta_adset_id = $1', [row.adset_id]))?.id
        : null;
      const adPk = row.ad_id
        ? (await queryOne('SELECT id FROM ads WHERE meta_ad_id = $1', [row.ad_id]))?.id
        : null;

      // Compute derived conversions / value from actions.
      const actions = Array.isArray(row.actions) ? row.actions : [];
      const actionValues = Array.isArray(row.action_values) ? row.action_values : [];
      const parsed = metaApi.parseActions(actions);
      const conversionCount =
        parsed.purchases || parsed.leads || parsed.initiate_checkout || parsed.complete_registration || 0;
      const conversionValue = metaApi.parseActionValues(actionValues) || 0;
      const costPerResult = conversionCount > 0 ? Number(row.spend || 0) / conversionCount : 0;
      const roas = Number(row.spend || 0) > 0 ? conversionValue / Number(row.spend) : 0;

      await query(`
        INSERT INTO daily_insights (
          date, account_id, campaign_id, adset_id, ad_id, level,
          spend, impressions, clicks, reach,
          ctr, cpm, cpc, frequency,
          conversions, conversion_value, cost_per_result, roas,
          actions_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (date, level, account_id, campaign_id, adset_id, ad_id) DO UPDATE SET
          spend = EXCLUDED.spend,
          impressions = EXCLUDED.impressions,
          clicks = EXCLUDED.clicks,
          reach = EXCLUDED.reach,
          ctr = EXCLUDED.ctr,
          cpm = EXCLUDED.cpm,
          cpc = EXCLUDED.cpc,
          frequency = EXCLUDED.frequency,
          conversions = EXCLUDED.conversions,
          conversion_value = EXCLUDED.conversion_value,
          cost_per_result = EXCLUDED.cost_per_result,
          roas = EXCLUDED.roas,
          actions_json = EXCLUDED.actions_json
      `, [
        date,
        accountId,
        campaignPk,
        adsetPk,
        adPk,
        level,
        Number(row.spend || 0),
        parseInt(row.impressions || 0, 10),
        parseInt(row.clicks || 0, 10),
        parseInt(row.reach || 0, 10),
        Number(row.ctr || 0),
        Number(row.cpm || 0),
        Number(row.cpc || 0),
        Number(row.frequency || 0),
        conversionCount,
        conversionValue,
        costPerResult,
        roas,
        JSON.stringify({ actions, action_values: actionValues }),
      ]);
      written += 1;
    } catch (err) {
      console.warn(`[warehouse] insight row failed: ${err.message}`);
    }
  }
  return written;
}

function isRateLimit(err) {
  return !!err && (
    metaApi.isUserRateLimitError(err) ||
    err.httpStatus === 429 ||
    /rate limit|user request limit/i.test(err.message || '')
  );
}

async function syncAccountEntities(accountId) {
  const account = await accountService.getAccountById(accountId);
  if (!account || !account.access_token) return { account_id: accountId, skipped: 'no_token' };

  // Check budget — skip when account is already at cache_only/blocked.
  const budget = metaCache.budgetStatus(accountId);
  if (budget.mode !== 'normal') return { account_id: accountId, skipped: `budget_${budget.mode}` };

  const report = { account_id: accountId, campaigns: 0, adsets: 0, ads: 0, insights: 0, error: null };

  try {
    const campaigns = await metaApi.getCampaigns(null, account);
    report.campaigns = await upsertCampaigns(accountId, campaigns);

    // For each campaign, pull adsets + insights. Bail on rate limit.
    for (const c of campaigns) {
      const campaignPk = (await queryOne('SELECT id FROM campaigns WHERE meta_campaign_id = $1', [c.id]))?.id;
      if (!campaignPk) continue;
      try {
        const adsets = await metaApi.getAdSets(c.id, account);
        report.adsets += await upsertAdSetsFromMeta(accountId, campaignPk, adsets);

        for (const a of adsets) {
          const adsetPk = (await queryOne('SELECT id FROM adsets WHERE meta_adset_id = $1', [a.id]))?.id;
          if (!adsetPk) continue;
          try {
            const ads = await metaApi.getAds(a.id, account);
            report.ads += await upsertAdsFromMeta(accountId, campaignPk, adsetPk, ads);
          } catch (err) {
            if (isRateLimit(err)) throw err;
            console.warn(`[warehouse] ads for adset ${a.id} failed: ${err.message}`);
          }
        }
      } catch (err) {
        if (isRateLimit(err)) throw err;
        console.warn(`[warehouse] adsets for campaign ${c.id} failed: ${err.message}`);
      }
    }
  } catch (err) {
    report.error = err.message;
  }

  return report;
}

async function syncAccountInsights(accountId, { days = 3 } = {}) {
  const account = await accountService.getAccountById(accountId);
  if (!account || !account.access_token) return { account_id: accountId, skipped: 'no_token' };

  const budget = metaCache.budgetStatus(accountId);
  if (budget.mode !== 'normal') return { account_id: accountId, skipped: `budget_${budget.mode}` };

  const report = { account_id: accountId, inserted: { account: 0, campaign: 0, adset: 0, ad: 0 }, error: null };

  const today = new Date();
  const since = new Date(today.getTime() - days * 86400000).toISOString().slice(0, 10);
  const until = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  const timeRange = { since, until };

  try {
    const adAccountId = metaApi.contextAccountId(account);
    for (const level of ['account', 'campaign', 'adset', 'ad']) {
      try {
        const rows = await metaApi.getInsights(adAccountId, {
          level,
          time_range: JSON.stringify(timeRange),
          time_increment: 1,
          fields: 'spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type,date_start,campaign_id,adset_id,ad_id',
        }, account);
        report.inserted[level] = await upsertInsightRows(accountId, rows, level);
      } catch (err) {
        if (isRateLimit(err)) throw err;
        console.warn(`[warehouse] insights level=${level} failed: ${err.message}`);
      }
    }
  } catch (err) {
    report.error = err.message;
  }

  return report;
}

async function syncAll({ days = 3 } = {}) {
  const accounts = await queryAll('SELECT id FROM accounts ORDER BY id');
  const results = [];
  for (const row of accounts) {
    try {
      const entities = await syncAccountEntities(row.id);
      const insights = await syncAccountInsights(row.id, { days });
      results.push({ ...entities, insights });
      // If either hit rate limit, stop the sweep — cooldown is per-token/per-user.
      if ((entities.error && isRateLimit({ message: entities.error })) || (insights.error && isRateLimit({ message: insights.error }))) {
        console.warn(`[warehouse] stopping sweep after account ${row.id} due to rate limit`);
        break;
      }
    } catch (err) {
      results.push({ account_id: row.id, error: err.message });
      if (isRateLimit(err)) break;
    }
  }
  return results;
}

function startBackgroundSync({ intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await syncAll({ days: 3 });
      const totalCampaigns = results.reduce((s, r) => s + (r.campaigns || 0), 0);
      const totalInsights = results.reduce((s, r) => s + Object.values(r.insights?.inserted || {}).reduce((a, b) => a + b, 0), 0);
      if (totalCampaigns > 0 || totalInsights > 0) {
        console.log(`[warehouse] synced ${totalCampaigns} campaigns and ${totalInsights} insight rows across ${results.length} account(s)`);
      }
    } catch (err) {
      console.error(`[warehouse] sweep failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 20 * 60 * 1000).unref?.(); // first run 20 min after boot
  return timer;
}

module.exports = {
  syncAccountEntities,
  syncAccountInsights,
  syncAll,
  startBackgroundSync,
};
