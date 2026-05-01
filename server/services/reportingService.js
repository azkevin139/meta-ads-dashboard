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
      -- V1 qualification (engagement-based, persisted by ghlConversationService).
      COUNT(*) FILTER (WHERE qualified_at IS NOT NULL)::int AS qualified_leads,
      COUNT(*) FILTER (WHERE lead_source = 'meta_lead_form' AND qualified_at IS NOT NULL)::int AS meta_qualified_leads,
      COUNT(*) FILTER (WHERE lead_source = 'website_form' AND qualified_at IS NOT NULL)::int AS website_qualified_leads,
      -- Transitional dual-display: legacy stage-based qualified count, kept for one cycle.
      COUNT(*) FILTER (WHERE ${isQualifiedExpression('scoped')})::int AS qualified_leads_stage,
      COUNT(*) FILTER (WHERE first_inbound_reply_at IS NOT NULL)::int AS replied_leads,
      COUNT(*) FILTER (WHERE lead_source = 'meta_lead_form' AND first_inbound_reply_at IS NOT NULL)::int AS meta_replied_leads,
      COUNT(*) FILTER (WHERE lead_source = 'website_form' AND first_inbound_reply_at IS NOT NULL)::int AS website_replied_leads,
      COUNT(*) FILTER (WHERE first_outbound_at IS NOT NULL)::int AS contacted_leads,
      COUNT(*) FILTER (WHERE normalized_stage IN ('booked', 'showed'))::int AS booked_count,
      COUNT(*) FILTER (WHERE lead_source = 'meta_lead_form' AND normalized_stage IN ('booked', 'showed'))::int AS meta_booked_count,
      COUNT(*) FILTER (WHERE lead_source = 'website_form' AND normalized_stage IN ('booked', 'showed'))::int AS website_booked_count,
      COUNT(*) FILTER (WHERE normalized_stage = 'closed_won' OR COALESCE(revenue, 0) > 0)::int AS won_count,
      COUNT(*) FILTER (WHERE lead_source = 'meta_lead_form' AND (normalized_stage = 'closed_won' OR COALESCE(revenue, 0) > 0))::int AS meta_won_count,
      COUNT(*) FILTER (WHERE lead_source = 'website_form' AND (normalized_stage = 'closed_won' OR COALESCE(revenue, 0) > 0))::int AS website_won_count,
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
    meta_qualified_leads: Number(row?.meta_qualified_leads) || 0,
    website_qualified_leads: Number(row?.website_qualified_leads) || 0,
    qualified_leads_stage: Number(row?.qualified_leads_stage) || 0,
    replied_leads: Number(row?.replied_leads) || 0,
    meta_replied_leads: Number(row?.meta_replied_leads) || 0,
    website_replied_leads: Number(row?.website_replied_leads) || 0,
    contacted_leads: Number(row?.contacted_leads) || 0,
    unqualified_leads: Number(row?.unqualified_leads) || 0,
    booked_count: Number(row?.booked_count) || 0,
    meta_booked_count: Number(row?.meta_booked_count) || 0,
    website_booked_count: Number(row?.website_booked_count) || 0,
    won_count: Number(row?.won_count) || 0,
    meta_won_count: Number(row?.meta_won_count) || 0,
    website_won_count: Number(row?.website_won_count) || 0,
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
        COALESCE(ads.creative_meta->>'image_url', ads.creative_meta->>'thumbnail_url') AS creative_image_url,
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
      GROUP BY ads.meta_ad_id, COALESCE(ads.name, ads.meta_ad_id), COALESCE(ads.creative_meta->>'image_url', ads.creative_meta->>'thumbnail_url')
    ),
    lead_rows AS (
      SELECT
        v.ad_id,
        ${dedupeKeyExpression('v')} AS dedupe_key,
        (v.qualified_at IS NOT NULL) AS is_qualified,
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
      m.creative_image_url,
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
      creative_image_url: row.creative_image_url || null,
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

async function getCreativeCoverage(accountId, range) {
  const row = await queryOne(`
    WITH ad_insights AS (
      SELECT COUNT(DISTINCT ads.meta_ad_id)::int AS ad_level_ads
      FROM daily_insights di
      JOIN ads ON ads.id = di.ad_id
      WHERE di.account_id = $1
        AND di.level = 'ad'
        AND di.date BETWEEN $2::date AND $3::date
    ),
    lead_rows AS (
      SELECT
        ${dedupeKeyExpression('v')} AS dedupe_key,
        v.ad_id,
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
      COALESCE((SELECT ad_level_ads FROM ad_insights), 0)::int AS ad_level_ads,
      COUNT(*)::int AS total_leads,
      COUNT(*) FILTER (WHERE ad_id IS NOT NULL)::int AS attributed_leads
    FROM scoped
  `, [accountId, range.since, range.until, REPORTING_TIMEZONE]);
  const adLevelAds = Number(row?.ad_level_ads) || 0;
  const totalLeads = Number(row?.total_leads) || 0;
  const attributedLeads = Number(row?.attributed_leads) || 0;
  const attributionRate = rate(attributedLeads, totalLeads);
  const ready = adLevelAds > 0 && (totalLeads === 0 || attributionRate >= 20);
  return {
    ready,
    status: ready ? 'ready' : 'unavailable',
    reason_code: !adLevelAds
      ? 'ad_level_insights_missing'
      : (totalLeads > 0 && attributionRate < 20 ? 'lead_attribution_coverage_low' : null),
    ad_level_ads: adLevelAds,
    total_leads: totalLeads,
    attributed_leads: attributedLeads,
    attributed_lead_rate: attributionRate,
    minimum_attributed_lead_rate: 20,
  };
}

function buildCreativeLeaderboard(creatives, coverage) {
  const rows = Array.isArray(creatives) ? creatives : [];
  const eligible = coverage?.ready && rows.length > 0;
  const byClicks = [...rows].sort((a, b) => (Number(b.clicks) || 0) - (Number(a.clicks) || 0))[0] || null;
  const byLeads = [...rows].sort((a, b) => (Number(b.total_leads) || 0) - (Number(a.total_leads) || 0))[0] || null;
  const byQualified = [...rows].sort((a, b) => {
    const qualifiedDelta = (Number(b.qualified_leads) || 0) - (Number(a.qualified_leads) || 0);
    if (qualifiedDelta) return qualifiedDelta;
    const aCpql = Number(a.cost_per_qualified_lead) || Number.MAX_SAFE_INTEGER;
    const bCpql = Number(b.cost_per_qualified_lead) || Number.MAX_SAFE_INTEGER;
    if (aCpql !== bCpql) return aCpql - bCpql;
    return (Number(b.total_leads) || 0) - (Number(a.total_leads) || 0);
  })[0] || null;
  return {
    available: eligible,
    coverage,
    winners: {
      most_clicked: byClicks,
      most_leads: byLeads,
      most_qualified: byQualified,
    },
    rows,
  };
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
    cost_per_replied_lead: cost(meta.spend, leads.replied_leads),
    click_to_lead_rate: rate(leads.total_leads, meta.clicks),
    visit_to_website_lead_rate: rate(leads.website_leads, website.visits),
    qualified_rate: rate(leads.qualified_leads, leads.total_leads),
    reply_rate: rate(leads.replied_leads, leads.contacted_leads),
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
    'meta_qualified_leads',
    'website_qualified_leads',
    'qualified_leads_stage',
    'replied_leads',
    'meta_replied_leads',
    'website_replied_leads',
    'contacted_leads',
    'booked_count',
    'meta_booked_count',
    'website_booked_count',
    'won_count',
    'meta_won_count',
    'website_won_count',
    'cpl',
    'cost_per_qualified_lead',
    'cost_per_replied_lead',
    'reply_rate',
  ];
  return Object.fromEntries(keys.map((key) => [key, pctDelta(current[key], previous[key])]));
}

async function getLeadReport(accountId, params = {}) {
  const range = resolveRange(params);
  const previous = previousRange(range);

  const cacheKey = reportCacheKey(accountId, range);
  const cached = reportCacheGet(cacheKey);
  if (cached) return cached;

  const [meta, dailySpend, leads, website, pipeline, creativePerformance, creativeCoverage, health] = await Promise.all([
    getMetaMetrics(accountId, range),
    getDailySpend(accountId, range),
    getLeadMetrics(accountId, range),
    getWebsiteMetrics(accountId, range),
    getPipeline(accountId, range),
    getCreativePerformance(accountId, range),
    getCreativeCoverage(accountId, range),
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

  const creativeLeaderboard = buildCreativeLeaderboard(creativePerformance, creativeCoverage);
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
      total_leads: 'Deduped people who submitted a Meta lead form or website form. Dedupe priority: LINXIO contact ID, phone hash, email hash, Meta lead ID, client ID.',
      meta_leads: 'Deduped leads whose acquisition source is a Meta native lead form or Instant Form.',
      website_leads: 'Deduped leads whose acquisition source is a website or landing-page form submission.',
      qualified_leads: 'A lead from Meta or the website that replied to outreach by WhatsApp, SMS, email, Facebook Messenger, Instagram, or live chat. Recorded from LINXIO conversation activity.',
      meta_qualified_leads: 'Qualified leads whose acquisition source is Meta native lead forms.',
      website_qualified_leads: 'Qualified leads whose acquisition source is website or landing-page forms.',
      qualified_leads_stage: 'Transitional comparison only: how the previous methodology counted qualified leads using normalized pipeline stage. Will be removed after one reporting cycle.',
      replied_leads: 'Leads who sent any inbound conversation message after their lead was created. Useful for separating responsiveness from sales-readiness.',
      contacted_leads: 'Leads we sent a first outbound message to via LINXIO.',
      reply_rate: 'replied_leads / contacted_leads. Tells you how often outreach actually starts a conversation.',
      acquisition_source: 'Meta daily insights are the source of truth for spend, impressions, reach, and clicks.',
      pipeline_source: 'LINXIO-derived lifecycle state is the source of truth for sales pipeline progression. Pipeline status is separate from qualification.',
      creative_name: 'Creative names come from the Meta ad name at ad/creative level.',
      creative_performance: 'Creative performance combines Meta ad-level delivery with deduped LINXIO lead outcomes attributed to the same Meta ad ID. Leaderboard is shown only when ad-level data and lead attribution coverage are sufficient.',
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
      qualifiedLeads: leads.meta_qualified_leads,
      bookedCount: leads.meta_booked_count,
      wonCount: leads.meta_won_count,
      },
    meta_funnel: {
      impressions: meta.impressions,
      reach: meta.reach,
      link_clicks: meta.clicks,
      meta_form_leads: leads.meta_leads,
      qualified_leads: leads.meta_qualified_leads,
      booked_count: leads.meta_booked_count,
      won_count: leads.meta_won_count,
    },
    websiteFunnel: {
      visits: website.visits,
      pageviews: website.pageviews,
      formSubmissions: leads.website_leads,
      qualifiedLeads: leads.website_qualified_leads,
      bookedCount: leads.website_booked_count,
      wonCount: leads.website_won_count,
    },
    website_funnel: {
      visits: website.visits,
      pageviews: website.pageviews,
      form_submissions: leads.website_leads,
      qualified_leads: leads.website_qualified_leads,
      booked_count: leads.website_booked_count,
      won_count: leads.website_won_count,
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
    creativeLeaderboard,
    creative_leaderboard: creativeLeaderboard,
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
