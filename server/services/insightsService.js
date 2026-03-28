const { queryAll, queryOne } = require('../db');

// ─── OVERVIEW KPIs ────────────────────────────────────────

async function getOverview(accountId, days = 7) {
  // Sum of account-level insights for the date range
  const row = await queryOne(`
    SELECT
      COALESCE(SUM(spend), 0)         AS total_spend,
      COALESCE(SUM(impressions), 0)   AS total_impressions,
      COALESCE(SUM(clicks), 0)        AS total_clicks,
      COALESCE(SUM(reach), 0)         AS total_reach,
      COALESCE(SUM(conversions), 0)   AS total_conversions,
      COALESCE(SUM(conversion_value), 0) AS total_conversion_value,
      CASE WHEN SUM(impressions) > 0
        THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2)
        ELSE 0 END AS avg_ctr,
      CASE WHEN SUM(impressions) > 0
        THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2)
        ELSE 0 END AS avg_cpm,
      CASE WHEN SUM(clicks) > 0
        THEN ROUND(SUM(spend) / SUM(clicks), 2)
        ELSE 0 END AS avg_cpc,
      CASE WHEN SUM(conversions) > 0
        THEN ROUND(SUM(spend) / SUM(conversions), 2)
        ELSE 0 END AS avg_cpa,
      CASE WHEN SUM(spend) > 0
        THEN ROUND(SUM(conversion_value) / SUM(spend), 2)
        ELSE 0 END AS avg_roas,
      COUNT(DISTINCT date) AS days_with_data
    FROM daily_insights
    WHERE account_id = $1
      AND level = 'account'
      AND date >= CURRENT_DATE - ($2 || ' days')::interval
  `, [accountId, days]);

  return row;
}

// Compare selected range vs prior equivalent range
// e.g. 7d = last 7 days vs the 7 days before that
async function getOverviewDeltas(accountId, days = 7) {
  // Current period
  const current = await queryOne(`
    SELECT
      COALESCE(SUM(spend), 0) AS spend,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(conversions), 0) AS conversions,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2) ELSE 0 END AS ctr,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) ELSE 0 END AS cpm,
      CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(spend) / SUM(clicks), 2) ELSE 0 END AS cpc,
      CASE WHEN SUM(conversions) > 0 THEN ROUND(SUM(spend) / SUM(conversions), 2) ELSE 0 END AS cost_per_result,
      CASE WHEN SUM(spend) > 0 THEN ROUND(SUM(conversion_value) / SUM(spend), 2) ELSE 0 END AS roas
    FROM daily_insights
    WHERE account_id = $1 AND level = 'account'
      AND date >= CURRENT_DATE - ($2 || ' days')::interval
  `, [accountId, days]);

  // Previous period (same length, immediately before)
  const previous = await queryOne(`
    SELECT
      COALESCE(SUM(spend), 0) AS spend,
      COALESCE(SUM(impressions), 0) AS impressions,
      COALESCE(SUM(clicks), 0) AS clicks,
      COALESCE(SUM(conversions), 0) AS conversions,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(clicks)::numeric / SUM(impressions) * 100, 2) ELSE 0 END AS ctr,
      CASE WHEN SUM(impressions) > 0 THEN ROUND(SUM(spend) / SUM(impressions) * 1000, 2) ELSE 0 END AS cpm,
      CASE WHEN SUM(clicks) > 0 THEN ROUND(SUM(spend) / SUM(clicks), 2) ELSE 0 END AS cpc,
      CASE WHEN SUM(conversions) > 0 THEN ROUND(SUM(spend) / SUM(conversions), 2) ELSE 0 END AS cost_per_result,
      CASE WHEN SUM(spend) > 0 THEN ROUND(SUM(conversion_value) / SUM(spend), 2) ELSE 0 END AS roas
    FROM daily_insights
    WHERE account_id = $1 AND level = 'account'
      AND date >= CURRENT_DATE - ($2 * 2 || ' days')::interval
      AND date < CURRENT_DATE - ($2 || ' days')::interval
  `, [accountId, days]);

  const deltas = {};
  for (const key of ['spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpm', 'cpc', 'cost_per_result', 'roas']) {
    const prev = parseFloat(previous[key]) || 0;
    const curr = parseFloat(current[key]) || 0;
    deltas[key] = prev > 0 ? Math.round((curr - prev) / prev * 100) : 0;
  }

  return { current, previous, deltas };
}

// ─── CAMPAIGN TABLE ───────────────────────────────────────

async function getCampaignInsights(accountId, days = 7, activeOnly = true) {
  return queryAll(`
    SELECT
      c.id,
      c.meta_campaign_id,
      c.name,
      c.objective,
      c.status,
      c.effective_status,
      c.daily_budget,
      COALESCE(SUM(di.spend), 0)       AS spend,
      COALESCE(SUM(di.impressions), 0) AS impressions,
      COALESCE(SUM(di.clicks), 0)      AS clicks,
      COALESCE(SUM(di.conversions), 0) AS conversions,
      CASE WHEN SUM(di.impressions) > 0
        THEN ROUND(SUM(di.clicks)::numeric / SUM(di.impressions) * 100, 2)
        ELSE 0 END AS ctr,
      CASE WHEN SUM(di.impressions) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.impressions) * 1000, 2)
        ELSE 0 END AS cpm,
      CASE WHEN SUM(di.conversions) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.conversions), 2)
        ELSE 0 END AS cpa,
      CASE WHEN SUM(di.spend) > 0
        THEN ROUND(SUM(di.conversion_value) / SUM(di.spend), 2)
        ELSE 0 END AS roas,
      ROUND(AVG(di.frequency), 2) AS avg_frequency
    FROM campaigns c
    LEFT JOIN daily_insights di
      ON di.campaign_id = c.id
      AND di.level = 'campaign'
      AND di.date >= CURRENT_DATE - ($2 || ' days')::interval
    WHERE c.account_id = $1
      ${activeOnly ? "AND c.status = 'ACTIVE'" : ''}
    GROUP BY c.id
    ORDER BY COALESCE(SUM(di.spend), 0) DESC
  `, [accountId, days]);
}

// 3-day trend for a campaign
async function getCampaignTrend(campaignId, days = 3) {
  return queryAll(`
    SELECT date, spend, ctr, cpc, cost_per_result AS cpa, roas, frequency, conversions
    FROM daily_insights
    WHERE campaign_id = $1 AND level = 'campaign'
    ORDER BY date DESC
    LIMIT $2
  `, [campaignId, days]);
}

// ─── AD SET TABLE ─────────────────────────────────────────

async function getAdSetInsights(campaignId, days = 7, activeOnly = true) {
  return queryAll(`
    SELECT
      a.id,
      a.meta_adset_id,
      a.name,
      a.status,
      a.effective_status,
      a.daily_budget,
      a.bid_strategy,
      a.targeting_summary,
      a.placements,
      a.attribution_setting,
      COALESCE(SUM(di.spend), 0)       AS spend,
      COALESCE(SUM(di.impressions), 0) AS impressions,
      COALESCE(SUM(di.clicks), 0)      AS clicks,
      COALESCE(SUM(di.conversions), 0) AS conversions,
      CASE WHEN SUM(di.impressions) > 0
        THEN ROUND(SUM(di.clicks)::numeric / SUM(di.impressions) * 100, 2)
        ELSE 0 END AS ctr,
      CASE WHEN SUM(di.impressions) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.impressions) * 1000, 2)
        ELSE 0 END AS cpm,
      CASE WHEN SUM(di.conversions) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.conversions), 2)
        ELSE 0 END AS cpa,
      CASE WHEN SUM(di.spend) > 0
        THEN ROUND(SUM(di.conversion_value) / SUM(di.spend), 2)
        ELSE 0 END AS roas,
      ROUND(AVG(di.frequency), 2) AS avg_frequency
    FROM adsets a
    LEFT JOIN daily_insights di
      ON di.adset_id = a.id
      AND di.level = 'adset'
      AND di.date >= CURRENT_DATE - ($2 || ' days')::interval
    WHERE a.campaign_id = $1
      ${activeOnly ? "AND a.status = 'ACTIVE'" : ''}
    GROUP BY a.id
    ORDER BY COALESCE(SUM(di.spend), 0) DESC
  `, [campaignId, days]);
}

// ─── AD TABLE ─────────────────────────────────────────────

async function getAdInsights(adSetId, days = 7, activeOnly = true) {
  return queryAll(`
    SELECT
      a.id,
      a.meta_ad_id,
      a.name,
      a.status,
      a.effective_status,
      a.creative_id,
      a.preview_url,
      a.creative_meta,
      COALESCE(SUM(di.spend), 0)       AS spend,
      COALESCE(SUM(di.impressions), 0) AS impressions,
      COALESCE(SUM(di.clicks), 0)      AS clicks,
      COALESCE(SUM(di.conversions), 0) AS conversions,
      CASE WHEN SUM(di.impressions) > 0
        THEN ROUND(SUM(di.clicks)::numeric / SUM(di.impressions) * 100, 2)
        ELSE 0 END AS ctr,
      CASE WHEN SUM(di.impressions) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.impressions) * 1000, 2)
        ELSE 0 END AS cpm,
      CASE WHEN SUM(di.clicks) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.clicks), 2)
        ELSE 0 END AS cpc,
      CASE WHEN SUM(di.conversions) > 0
        THEN ROUND(SUM(di.spend) / SUM(di.conversions), 2)
        ELSE 0 END AS cpa,
      CASE WHEN SUM(di.spend) > 0
        THEN ROUND(SUM(di.conversion_value) / SUM(di.spend), 2)
        ELSE 0 END AS roas
    FROM ads a
    LEFT JOIN daily_insights di
      ON di.ad_id = a.id
      AND di.level = 'ad'
      AND di.date >= CURRENT_DATE - ($2 || ' days')::interval
    WHERE a.adset_id = $1
      ${activeOnly ? "AND a.status = 'ACTIVE'" : ''}
    GROUP BY a.id
    ORDER BY COALESCE(SUM(di.spend), 0) DESC
  `, [adSetId, days]);
}

// ─── TREND DATA (for charts) ──────────────────────────────

async function getTrend(entityId, level, days = 30) {
  const col = level === 'account' ? 'account_id'
    : level === 'campaign' ? 'campaign_id'
    : level === 'adset' ? 'adset_id'
    : 'ad_id';

  return queryAll(`
    SELECT date, spend, impressions, clicks, ctr, cpm, cpc, frequency, conversions, cost_per_result, roas
    FROM daily_insights
    WHERE ${col} = $1 AND level = $2
    ORDER BY date ASC
    LIMIT $3
  `, [entityId, level, days]);
}

// ─── ACTIVE CAMPAIGNS COUNT ───────────────────────────────

async function getActiveCampaignCount(accountId) {
  const row = await queryOne(`
    SELECT COUNT(*) AS count FROM campaigns
    WHERE account_id = $1 AND status = 'ACTIVE'
  `, [accountId]);
  return parseInt(row.count, 10);
}

module.exports = {
  getOverview,
  getOverviewDeltas,
  getCampaignInsights,
  getCampaignTrend,
  getAdSetInsights,
  getAdInsights,
  getTrend,
  getActiveCampaignCount,
};
