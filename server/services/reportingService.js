const { queryOne, queryAll } = require('../db');

const REPORTING_TIMEZONE = 'Asia/Dubai';
const DEFAULT_PRESET = '7d';
const REPORT_CACHE_TTL_MS = 60 * 1000;
const REPORT_CACHE_MAX_ENTRIES = 256;
const reportCache = new Map();

function reportCacheKey(accountId, range) {
  return `${accountId}|${range.since}|${range.until}|${range.preset}`;
}

function reportCacheGet(key) {
  const entry = reportCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    reportCache.delete(key);
    return null;
  }
  return entry.value;
}

function reportCachePut(key, value) {
  if (reportCache.size >= REPORT_CACHE_MAX_ENTRIES) {
    const oldest = reportCache.keys().next().value;
    if (oldest !== undefined) reportCache.delete(oldest);
  }
  reportCache.set(key, { value, expiresAt: Date.now() + REPORT_CACHE_TTL_MS });
}

function parseDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
  return value;
}

function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateOnly(date);
}

function diffDaysInclusive(since, until) {
  const a = new Date(`${since}T00:00:00.000Z`);
  const b = new Date(`${until}T00:00:00.000Z`);
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400000) + 1);
}

function resolveRange({ since, until, preset } = {}) {
  const explicitSince = parseDateOnly(since);
  const explicitUntil = parseDateOnly(until);
  if (explicitSince && explicitUntil && explicitUntil >= explicitSince) {
    return { since: explicitSince, until: explicitUntil, preset: 'custom' };
  }

  const now = new Date();
  // Dubai has no daylight saving time; UTC+4 keeps date preset behavior stable.
  const dubaiNow = new Date(now.getTime() + 4 * 3600000);
  const today = toDateOnly(dubaiNow);
  const selected = preset || DEFAULT_PRESET;

  if (selected === 'today') return { since: today, until: today, preset: selected };
  if (selected === 'yesterday') {
    const y = addDays(today, -1);
    return { since: y, until: y, preset: selected };
  }
  if (selected === '14d') return { since: addDays(today, -14), until: addDays(today, -1), preset: selected };
  if (selected === '30d') return { since: addDays(today, -30), until: addDays(today, -1), preset: selected };
  if (selected === '60d') return { since: addDays(today, -60), until: addDays(today, -1), preset: selected };
  if (selected === 'this_month') return { since: `${today.slice(0, 7)}-01`, until: today, preset: selected };
  return { since: addDays(today, -7), until: addDays(today, -1), preset: '7d' };
}

function previousRange(range) {
  const days = diffDaysInclusive(range.since, range.until);
  const until = addDays(range.since, -1);
  return {
    since: addDays(until, -(days - 1)),
    until,
    preset: 'previous_period',
  };
}

function pctDelta(current, previous) {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (!b && !a) return 0;
  if (!b) return null;
  return Number((((a - b) / b) * 100).toFixed(1));
}

function rate(numerator, denominator) {
  const n = Number(numerator) || 0;
  const d = Number(denominator) || 0;
  return d ? Number(((n / d) * 100).toFixed(2)) : 0;
}

function cost(amount, count) {
  const value = Number(amount) || 0;
  const qty = Number(count) || 0;
  return qty ? Number((value / qty).toFixed(2)) : 0;
}

function isQualifiedExpression(alias = 'lead_rows') {
  return `${alias}.normalized_stage IN ('qualified', 'booked', 'showed', 'closed_won')`;
}

// Canonical lead-acquisition timestamp. All report sections that scope by
// "leads acquired in this period" must use this expression.
function leadTimeExpression(alias = 'v') {
  return `COALESCE(
    NULLIF(${alias}.raw->'ghl'->>'dateAdded', '')::timestamptz,
    NULLIF(${alias}.raw->'ghl'->>'createdAt', '')::timestamptz,
    NULLIF(${alias}.raw->'metadata'->>'created_time', '')::timestamptz,
    ${alias}.resolved_at,
    ${alias}.first_seen_at
  )`;
}

// Shared gating filter: row qualifies as a "lead" if it carries any identity.
function leadIdentityFilter(alias = 'v') {
  return `(
    ${alias}.meta_lead_id IS NOT NULL
    OR ${alias}.ghl_contact_id IS NOT NULL
    OR ${alias}.email_hash IS NOT NULL
    OR ${alias}.phone_hash IS NOT NULL
  )`;
}

function dedupeKeyExpression(alias = 'v') {
  return `COALESCE(
    NULLIF(${alias}.ghl_contact_id, ''),
    NULLIF(${alias}.phone_hash, ''),
    NULLIF(${alias}.email_hash, ''),
    NULLIF(${alias}.meta_lead_id, ''),
    ${alias}.client_id
  )`;
}

async function getMetaMetrics(accountId, range) {
  const row = await queryOne(`
    SELECT
      COALESCE(SUM(spend), 0) AS spend,
      COALESCE(SUM(impressions), 0)::bigint AS impressions,
      COALESCE(SUM(reach), 0)::bigint AS reach,
      COALESCE(SUM(clicks), 0)::bigint AS clicks,
      COALESCE(SUM(
        COALESCE((
          SELECT SUM((action->>'value')::numeric)
          FROM jsonb_array_elements(COALESCE(actions_json->'actions', '[]'::jsonb)) action
          WHERE action->>'action_type' = 'link_click'
        ), 0)
      ), 0)::bigint AS link_clicks
    FROM daily_insights
    WHERE account_id = $1
      AND level = 'account'
      AND date BETWEEN $2::date AND $3::date
  `, [accountId, range.since, range.until]);
  const spend = Number(row?.spend) || 0;
  const clicks = Number(row?.link_clicks) || Number(row?.clicks) || 0;
  return {
    spend,
    impressions: Number(row?.impressions) || 0,
    reach: Number(row?.reach) || 0,
    clicks,
    cpc: cost(spend, clicks),
  };
}

async function getDailySpend(accountId, range) {
  // Zero-fill missing days so charts don't silently drop empty days.
  const rows = await queryAll(`
    SELECT d::date AS date, COALESCE(SUM(di.spend), 0) AS spend
    FROM generate_series($2::date, $3::date, INTERVAL '1 day') d
    LEFT JOIN daily_insights di
      ON di.date = d::date
      AND di.account_id = $1
      AND di.level = 'account'
    GROUP BY d
    ORDER BY d
  `, [accountId, range.since, range.until]);
  return rows.map((row) => ({
    date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date).slice(0, 10),
    spend: Number(row.spend) || 0,
  }));
}

async function getLeadMetrics(accountId, range) {
  const row = await queryOne(`
    WITH lead_rows AS (
      SELECT
        v.*,
        ${dedupeKeyExpression('v')} AS dedupe_key,
        CASE
          WHEN v.meta_lead_id IS NOT NULL
            OR lower(COALESCE(v.source_event_type, '')) LIKE 'fb-lead%'
            OR lower(COALESCE(v.source_event_type, '')) LIKE '%instant%form%'
          THEN 'meta_lead_form'
          ELSE 'website_form'
        END AS lead_source,
        ${leadTimeExpression('v')} AS lead_time
      FROM visitors v
      WHERE v.account_id = $1
        AND ${leadIdentityFilter('v')}
    ),
    scoped AS (
      SELECT DISTINCT ON (dedupe_key) *
      FROM lead_rows
      WHERE (lead_time AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY dedupe_key, lead_time ASC
    )
    SELECT
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE lead_source = 'meta_lead_form')::int AS meta_leads,
      COUNT(*) FILTER (WHERE lead_source = 'website_form')::int AS website_leads,
      COUNT(*) FILTER (WHERE ${isQualifiedExpression('scoped')})::int AS qualified_leads,
      COUNT(*) FILTER (WHERE normalized_stage IN ('booked', 'showed'))::int AS booked_count,
      COUNT(*) FILTER (WHERE normalized_stage = 'closed_won' OR COALESCE(revenue, 0) > 0)::int AS won_count,
      COUNT(*) FILTER (WHERE normalized_stage = 'closed_lost')::int AS lost_count,
      COUNT(*) FILTER (WHERE normalized_stage IS NULL OR normalized_stage IN ('new_lead', 'contacted'))::int AS unqualified_leads,
      COUNT(*) FILTER (WHERE normalized_stage IS NULL)::int AS null_stage_count
    FROM scoped
  `, [accountId, range.since, range.until, REPORTING_TIMEZONE]);
  return {
    total_leads: Number(row?.total_leads) || 0,
    meta_leads: Number(row?.meta_leads) || 0,
    website_leads: Number(row?.website_leads) || 0,
    qualified_leads: Number(row?.qualified_leads) || 0,
    unqualified_leads: Number(row?.unqualified_leads) || 0,
    booked_count: Number(row?.booked_count) || 0,
    won_count: Number(row?.won_count) || 0,
    lost_count: Number(row?.lost_count) || 0,
    null_stage_count: Number(row?.null_stage_count) || 0,
  };
}

async function getWebsiteMetrics(accountId, range) {
  const row = await queryOne(`
    SELECT
      COUNT(DISTINCT client_id)::int AS visits,
      COUNT(*) FILTER (WHERE event_name = 'PageView')::int AS pageviews
    FROM visitor_events
    WHERE account_id = $1
      AND (fired_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
  `, [accountId, range.since, range.until, REPORTING_TIMEZONE]);
  return {
    visits: Number(row?.visits) || 0,
    pageviews: Number(row?.pageviews) || 0,
  };
}

async function getPipeline(accountId, range) {
  // Cohort: leads acquired in this period, grouped by their CURRENT
  // normalized_stage. Same lead_time anchor + dedupe as getLeadMetrics so
  // the funnel and pipeline counts reconcile.
  return queryAll(`
    WITH lead_rows AS (
      SELECT
        v.*,
        ${dedupeKeyExpression('v')} AS dedupe_key,
        ${leadTimeExpression('v')} AS lead_time
      FROM visitors v
      WHERE v.account_id = $1
        AND ${leadIdentityFilter('v')}
    ),
    scoped AS (
      SELECT DISTINCT ON (dedupe_key) *
      FROM lead_rows
      WHERE (lead_time AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      ORDER BY dedupe_key, lead_time ASC
    )
    SELECT
      COALESCE(normalized_stage, 'unknown') AS stage,
      COUNT(*)::int AS count
    FROM scoped
    GROUP BY COALESCE(normalized_stage, 'unknown')
    ORDER BY count DESC, stage
  `, [accountId, range.since, range.until, REPORTING_TIMEZONE]);
}

async function getCreativePerformance(accountId, range) {
  return queryAll(`
    WITH meta_rows AS (
      SELECT
        ads.meta_ad_id,
        COALESCE(ads.name, ads.meta_ad_id) AS creative_name,
        COALESCE(SUM(di.spend), 0) AS spend,
        COALESCE(SUM(di.impressions), 0)::bigint AS impressions,
        COALESCE(SUM(di.clicks), 0)::bigint AS clicks,
        COALESCE(SUM(
          COALESCE((
            SELECT SUM((action->>'value')::numeric)
            FROM jsonb_array_elements(COALESCE(di.actions_json->'actions', '[]'::jsonb)) action
            WHERE action->>'action_type' = 'link_click'
          ), 0)
        ), 0)::bigint AS link_clicks
      FROM daily_insights di
      JOIN ads ON ads.id = di.ad_id
      WHERE di.account_id = $1
        AND di.level = 'ad'
        AND di.date BETWEEN $2::date AND $3::date
      GROUP BY ads.meta_ad_id, COALESCE(ads.name, ads.meta_ad_id)
    ),
    lead_rows AS (
      SELECT
        v.ad_id,
        ${dedupeKeyExpression('v')} AS dedupe_key,
        ${isQualifiedExpression('v')} AS is_qualified,
        v.normalized_stage,
        v.revenue,
        ${leadTimeExpression('v')} AS lead_time
      FROM visitors v
      WHERE v.account_id = $1
        AND v.ad_id IS NOT NULL
        AND ${leadIdentityFilter('v')}
    ),
    scoped_leads AS (
      SELECT *
      FROM lead_rows
      WHERE (lead_time AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
    ),
    deduped_leads AS (
      SELECT DISTINCT ON (ad_id, dedupe_key) *
      FROM scoped_leads
      ORDER BY ad_id, dedupe_key, lead_time ASC
    ),
    lead_stats AS (
      SELECT
        ad_id,
        COUNT(*)::int AS total_leads,
        COUNT(*) FILTER (WHERE is_qualified)::int AS qualified_leads,
        COUNT(*) FILTER (WHERE normalized_stage IN ('booked', 'showed'))::int AS booked_count,
        COUNT(*) FILTER (WHERE normalized_stage = 'closed_won' OR COALESCE(revenue, 0) > 0)::int AS won_count
      FROM deduped_leads
      GROUP BY ad_id
    )
    SELECT
      m.meta_ad_id,
      m.creative_name,
      m.spend,
      m.impressions,
      COALESCE(NULLIF(m.link_clicks, 0), m.clicks) AS clicks,
      COALESCE(ls.total_leads, 0)::int AS total_leads,
      COALESCE(ls.qualified_leads, 0)::int AS qualified_leads,
      COALESCE(ls.booked_count, 0)::int AS booked_count,
      COALESCE(ls.won_count, 0)::int AS won_count
    FROM meta_rows m
    LEFT JOIN lead_stats ls ON ls.ad_id = m.meta_ad_id
    ORDER BY COALESCE(ls.qualified_leads, 0) DESC, COALESCE(ls.total_leads, 0) DESC, m.spend DESC
    LIMIT 12
  `, [accountId, range.since, range.until, REPORTING_TIMEZONE]).then((rows) => rows.map((row) => {
    const spend = Number(row.spend) || 0;
    const clicks = Number(row.clicks) || 0;
    const leads = Number(row.total_leads) || 0;
    const qualified = Number(row.qualified_leads) || 0;
    return {
      meta_ad_id: row.meta_ad_id,
      creative_name: row.creative_name,
      source_name: 'Meta ad name',
      spend,
      impressions: Number(row.impressions) || 0,
      clicks,
      total_leads: leads,
      qualified_leads: qualified,
      booked_count: Number(row.booked_count) || 0,
      won_count: Number(row.won_count) || 0,
      cpl: cost(spend, leads),
      cost_per_qualified_lead: cost(spend, qualified),
      click_to_lead_rate: rate(leads, clicks),
    };
  }));
}

async function getHealthSummary(accountId) {
  const rows = await queryAll(`
    WITH latest AS (
      SELECT DISTINCT ON (source, dataset)
        source, dataset, status, partial_reason, error_summary, finished_at, started_at
      FROM sync_runs
      WHERE account_id = $1
      ORDER BY source, dataset, started_at DESC
    )
    SELECT *
    FROM latest
    ORDER BY source, dataset
  `, [accountId]);
  return rows.map((row) => ({
    source: row.source,
    dataset: row.dataset,
    status: row.status,
    reason_code: row.partial_reason,
    error_summary: row.error_summary,
    last_attempted_at: row.started_at,
    last_finished_at: row.finished_at,
  }));
}

function buildDerived(meta, website, leads) {
  return {
    cpl: cost(meta.spend, leads.total_leads),
    cost_per_qualified_lead: cost(meta.spend, leads.qualified_leads),
    click_to_lead_rate: rate(leads.total_leads, meta.clicks),
    visit_to_website_lead_rate: rate(leads.website_leads, website.visits),
    qualified_rate: rate(leads.qualified_leads, leads.total_leads),
  };
}

function withComparisons(current, previous) {
  const keys = [
    'spend',
    'impressions',
    'clicks',
    'visits',
    'total_leads',
    'meta_leads',
    'website_leads',
    'qualified_leads',
    'booked_count',
    'won_count',
    'cpl',
    'cost_per_qualified_lead',
  ];
  return Object.fromEntries(keys.map((key) => [key, pctDelta(current[key], previous[key])]));
}

async function getLeadReport(accountId, params = {}) {
  const range = resolveRange(params);
  const previous = previousRange(range);

  const cacheKey = reportCacheKey(accountId, range);
  const cached = reportCacheGet(cacheKey);
  if (cached) return cached;

  const [meta, dailySpend, leads, website, pipeline, creativePerformance, health] = await Promise.all([
    getMetaMetrics(accountId, range),
    getDailySpend(accountId, range),
    getLeadMetrics(accountId, range),
    getWebsiteMetrics(accountId, range),
    getPipeline(accountId, range),
    getCreativePerformance(accountId, range),
    getHealthSummary(accountId),
  ]);
  const [prevMeta, prevLeads, prevWebsite] = await Promise.all([
    getMetaMetrics(accountId, previous),
    getLeadMetrics(accountId, previous),
    getWebsiteMetrics(accountId, previous),
  ]);

  if (leads.total_leads > 0 && leads.null_stage_count / leads.total_leads > 0.05) {
    console.warn('[reportingService] high NULL normalized_stage coverage', {
      account_id: accountId,
      range,
      total_leads: leads.total_leads,
      null_stage_count: leads.null_stage_count,
    });
  }

  const currentFlat = { ...meta, ...website, ...leads, ...buildDerived(meta, website, leads) };
  const previousFlat = { ...prevMeta, ...prevWebsite, ...prevLeads, ...buildDerived(prevMeta, prevWebsite, prevLeads) };

  const payload = {
    contract_version: 'lead-report.v1',
    timezone: REPORTING_TIMEZONE,
    range,
    previous_range: previous,
    comparison: {
      range: previous,
      deltas_pct: withComparisons(currentFlat, previousFlat),
    },
    definitions: {
      total_leads: 'Deduped people who submitted a Meta lead form or website form. Dedupe priority: GHL contact ID, phone hash, email hash, Meta lead ID, client ID.',
      qualified_leads: 'V1 reporting KPI: normalized GHL stage is qualified/booked/showed/closed_won, or an approved engagement/interest signal is present.',
      engaged_leads: 'Supporting KPI for reply/engagement signals. Kept separate from official qualified leads until score rules are mapped.',
      acquisition_source: 'Meta daily insights are the source of truth for spend, impressions, reach, and clicks.',
      pipeline_source: 'GoHighLevel-derived lifecycle state is the source of truth for qualification and pipeline outcomes.',
      creative_name: 'Creative names come from the Meta ad name at ad/creative level.',
      creative_performance: 'Creative performance combines Meta ad-level delivery with deduped GHL/lead outcomes attributed to the same Meta ad ID.',
    },
    summary: currentFlat,
    previous_summary: previousFlat,
    deltas_pct: withComparisons(currentFlat, previousFlat),
    dailySpend,
    daily_spend: dailySpend,
    metaFunnel: {
      impressions: meta.impressions,
      reach: meta.reach,
      linkClicks: meta.clicks,
      metaFormLeads: leads.meta_leads,
      qualifiedLeads: leads.qualified_leads,
      bookedCount: leads.booked_count,
      wonCount: leads.won_count,
    },
    meta_funnel: {
      impressions: meta.impressions,
      reach: meta.reach,
      link_clicks: meta.clicks,
      meta_form_leads: leads.meta_leads,
      qualified_leads: leads.qualified_leads,
      booked_count: leads.booked_count,
      won_count: leads.won_count,
    },
    websiteFunnel: {
      visits: website.visits,
      pageviews: website.pageviews,
      formSubmissions: leads.website_leads,
      qualifiedLeads: leads.qualified_leads,
      bookedCount: leads.booked_count,
      wonCount: leads.won_count,
    },
    website_funnel: {
      visits: website.visits,
      pageviews: website.pageviews,
      form_submissions: leads.website_leads,
      qualified_leads: leads.qualified_leads,
      booked_count: leads.booked_count,
      won_count: leads.won_count,
    },
    leadQuality: {
      totalLeads: leads.total_leads,
      qualifiedLeads: leads.qualified_leads,
      unqualifiedLeads: leads.unqualified_leads,
      qualifiedRate: currentFlat.qualified_rate,
      leadScore: null,
      leadScoreStatus: 'unmapped',
    },
    lead_quality: {
      total_leads: leads.total_leads,
      qualified_leads: leads.qualified_leads,
      unqualified_leads: leads.unqualified_leads,
      qualified_rate: currentFlat.qualified_rate,
      lead_score: null,
      lead_score_status: 'unmapped',
    },
    pipeline,
    creativePerformance,
    creative_performance: creativePerformance,
    freshness: health,
    health,
  };
  reportCachePut(cacheKey, payload);
  return payload;
}

module.exports = {
  REPORTING_TIMEZONE,
  resolveRange,
  previousRange,
  getLeadReport,
};
