const { queryOne, queryAll } = require('../db');

const REPORTING_TIMEZONE = 'Asia/Dubai';
const DEFAULT_PRESET = '7d';

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
  return `
    (
      ${alias}.normalized_stage IN ('qualified', 'booked', 'showed', 'closed_won')
      OR lower(COALESCE(${alias}.current_stage, '')) LIKE '%qualified%'
      OR lower(COALESCE(${alias}.current_stage, '')) LIKE '%interested%'
    )
  `;
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

async function getLeadMetrics(accountId, range) {
  const row = await queryOne(`
    WITH lead_rows AS (
      SELECT
        v.*,
        COALESCE(
          NULLIF(v.ghl_contact_id, ''),
          NULLIF(v.phone_hash, ''),
          NULLIF(v.email_hash, ''),
          NULLIF(v.meta_lead_id, ''),
          v.client_id
        ) AS dedupe_key,
        CASE
          WHEN v.meta_lead_id IS NOT NULL
            OR lower(COALESCE(v.source_event_type, '')) LIKE 'fb-lead%'
            OR lower(COALESCE(v.source_event_type, '')) LIKE '%instant%form%'
          THEN 'meta_lead_form'
          ELSE 'website_form'
        END AS lead_source,
        COALESCE(
          NULLIF(v.raw->'ghl'->>'dateAdded', '')::timestamptz,
          NULLIF(v.raw->'ghl'->>'createdAt', '')::timestamptz,
          NULLIF(v.raw->'metadata'->>'created_time', '')::timestamptz,
          v.resolved_at,
          v.first_seen_at
        ) AS lead_time
      FROM visitors v
      WHERE v.account_id = $1
        AND (
          v.meta_lead_id IS NOT NULL
          OR v.ghl_contact_id IS NOT NULL
          OR v.email_hash IS NOT NULL
          OR v.phone_hash IS NOT NULL
        )
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
      COUNT(*) FILTER (WHERE normalized_stage IS NULL OR normalized_stage IN ('new_lead', 'contacted', 'closed_lost'))::int AS unqualified_leads
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
  return queryAll(`
    SELECT
      COALESCE(normalized_stage, 'unknown') AS stage,
      COUNT(DISTINCT COALESCE(NULLIF(ghl_contact_id, ''), NULLIF(phone_hash, ''), NULLIF(email_hash, ''), client_id))::int AS count
    FROM visitors
    WHERE account_id = $1
      AND (last_seen_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
      AND (ghl_contact_id IS NOT NULL OR email_hash IS NOT NULL OR phone_hash IS NOT NULL OR meta_lead_id IS NOT NULL)
    GROUP BY COALESCE(normalized_stage, 'unknown')
    ORDER BY count DESC, stage
  `, [accountId, range.since, range.until, REPORTING_TIMEZONE]);
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

  const [meta, leads, website, pipeline, health] = await Promise.all([
    getMetaMetrics(accountId, range),
    getLeadMetrics(accountId, range),
    getWebsiteMetrics(accountId, range),
    getPipeline(accountId, range),
    getHealthSummary(accountId),
  ]);
  const [prevMeta, prevLeads, prevWebsite] = await Promise.all([
    getMetaMetrics(accountId, previous),
    getLeadMetrics(accountId, previous),
    getWebsiteMetrics(accountId, previous),
  ]);

  const currentFlat = { ...meta, ...website, ...leads, ...buildDerived(meta, website, leads) };
  const previousFlat = { ...prevMeta, ...prevWebsite, ...prevLeads, ...buildDerived(prevMeta, prevWebsite, prevLeads) };

  return {
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
    },
    summary: currentFlat,
    previous_summary: previousFlat,
    deltas_pct: withComparisons(currentFlat, previousFlat),
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
    freshness: health,
    health,
  };
}

module.exports = {
  REPORTING_TIMEZONE,
  resolveRange,
  previousRange,
  getLeadReport,
};
