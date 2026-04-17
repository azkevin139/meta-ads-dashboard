const fs = require('fs');
const path = require('path');
const metaApi = require('./metaApi');
const { query, queryOne, queryAll } = require('../db');
const accountService = require('./accountService');

const DATA_DIR = path.join(__dirname, '..', 'data');
const TARGETS_FILE = path.join(DATA_DIR, 'targets.json');

const DEFAULT_TARGETS = {
  primary_event: 'Initiate Checkout',
  target_cpa: 80,
  target_roas: 1.5,
  max_frequency: 3.5,
  min_spend_before_judgment: 50,
  scale_budget_pct: 20,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readTargets() {
  try {
    if (!fs.existsSync(TARGETS_FILE)) return { account: DEFAULT_TARGETS, campaigns: {} };
    return { account: DEFAULT_TARGETS, campaigns: {}, ...JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8')) };
  } catch (err) {
    return { account: DEFAULT_TARGETS, campaigns: {} };
  }
}

function writeTargets(targets) {
  ensureDataDir();
  fs.writeFileSync(TARGETS_FILE, JSON.stringify(targets, null, 2));
  return targets;
}

function targetForCampaign(campaignId) {
  const targets = readTargets();
  return { ...DEFAULT_TARGETS, ...(targets.account || {}), ...((targets.campaigns || {})[campaignId] || {}) };
}

function parseActionCount(actions, candidates) {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const action of actions) {
    if (candidates.includes(action.action_type)) total += parseInt(action.value, 10) || 0;
  }
  return total;
}

function parseActionValue(actionValues, candidates) {
  if (!Array.isArray(actionValues)) return 0;
  let total = 0;
  for (const action of actionValues) {
    if (candidates.includes(action.action_type)) total += parseFloat(action.value) || 0;
  }
  return total;
}

function parseFunnel(actions = []) {
  return {
    link_clicks: parseActionCount(actions, ['link_click']),
    landing_page_views: parseActionCount(actions, ['landing_page_view']),
    initiate_checkouts: parseActionCount(actions, ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout']),
    leads: parseActionCount(actions, ['offsite_conversion.fb_pixel_lead', 'lead']),
    purchases: parseActionCount(actions, ['offsite_conversion.fb_pixel_purchase', 'purchase']),
    registrations: parseActionCount(actions, ['offsite_conversion.fb_pixel_complete_registration', 'complete_registration']),
  };
}

function primaryResultFromActions(actions, primaryEvent) {
  const key = String(primaryEvent || '').toLowerCase();
  const typeMap = {
    'initiate checkout': ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout'],
    purchase: ['offsite_conversion.fb_pixel_purchase', 'purchase'],
    lead: ['offsite_conversion.fb_pixel_lead', 'lead'],
    registration: ['offsite_conversion.fb_pixel_complete_registration', 'complete_registration'],
  };
  const types = typeMap[key] || typeMap['initiate checkout'];
  return parseActionCount(actions, types);
}

function confidenceFor(row, targets, results, funnel) {
  const spend = parseFloat(row.spend) || 0;
  const frequency = parseFloat(row.frequency) || 0;
  if (results >= 10 && spend >= targets.min_spend_before_judgment * 3 && frequency <= targets.max_frequency) return 'Strong';
  if (results >= 3 || spend >= targets.min_spend_before_judgment) return 'Directional';
  if (funnel.link_clicks >= 50 && funnel.landing_page_views === 0) return 'Weak tracking';
  return 'Weak';
}

function evaluateRow(row) {
  const campaignId = row.campaign_id;
  const targets = targetForCampaign(campaignId);
  const spend = parseFloat(row.spend) || 0;
  const ctr = parseFloat(row.ctr) || 0;
  const cpm = parseFloat(row.cpm) || 0;
  const cpc = parseFloat(row.cpc) || 0;
  const frequency = parseFloat(row.frequency) || 0;
  const funnel = parseFunnel(row.actions);
  const results = primaryResultFromActions(row.actions, targets.primary_event);
  const cpa = results > 0 ? spend / results : 0;
  const confidence = confidenceFor(row, targets, results, funnel);
  const recs = [];

  if (spend >= targets.min_spend_before_judgment * 2 && results === 0) {
    recs.push({
      queue: 'Kill Waste',
      urgency: 'critical',
      action: 'Pause or cut budget',
      reason: `Spent ${spend.toFixed(2)} with zero ${targets.primary_event} results.`,
    });
  }
  if (results >= 3 && cpa > targets.target_cpa * 1.35) {
    recs.push({
      queue: 'Kill Waste',
      urgency: 'high',
      action: 'Reduce budget or test new angle',
      reason: `CPA ${cpa.toFixed(2)} is above target ${targets.target_cpa}.`,
    });
  }
  if (results >= 3 && cpa > 0 && cpa <= targets.target_cpa * 0.75 && confidence !== 'Weak') {
    recs.push({
      queue: 'Scale Winners',
      urgency: 'medium',
      action: `Scale ${targets.scale_budget_pct}% if delivery is stable`,
      reason: `CPA ${cpa.toFixed(2)} is below target ${targets.target_cpa}.`,
    });
  }
  if (frequency >= targets.max_frequency && ctr < 1) {
    recs.push({
      queue: 'Refresh Creative',
      urgency: 'high',
      action: 'Duplicate with new creative',
      reason: `Frequency ${frequency.toFixed(2)} is high and CTR is ${ctr.toFixed(2)}%.`,
    });
  }
  if (funnel.link_clicks >= 50 && funnel.landing_page_views / Math.max(funnel.link_clicks, 1) < 0.35) {
    recs.push({
      queue: 'Needs Tracking Review',
      urgency: 'medium',
      action: 'Check landing page load and pixel event firing',
      reason: `${funnel.landing_page_views} landing page views from ${funnel.link_clicks} link clicks.`,
    });
  }
  if (!recs.length) {
    recs.push({
      queue: confidence === 'Weak' ? 'Needs More Data' : 'Watch Closely',
      urgency: 'low',
      action: confidence === 'Weak' ? 'Wait for more spend/results' : 'Monitor',
      reason: confidence === 'Weak' ? 'Not enough signal to make a confident change.' : 'No rule breach detected.',
    });
  }

  return {
    id: campaignId,
    name: row.campaign_name || row.name || campaignId,
    spend,
    ctr,
    cpm,
    cpc,
    frequency,
    results,
    cpa,
    confidence,
    targets,
    funnel,
    recommendations: recs,
  };
}

async function getAccountContext(context = {}) {
  const [accounts, dbAccount, metaAccounts] = await Promise.all([
    accountService.listAccounts().catch(() => []),
    context?.id ? queryOne('SELECT id, meta_account_id, name, label, currency, timezone FROM accounts WHERE id = $1', [context.id]).catch(() => null) : null,
    metaApi.getAdAccounts(context).catch(() => []),
  ]);
  const internalAccount = dbAccount || accountService.publicAccount(context);
  return {
    internal_account: internalAccount,
    accounts,
    meta_accounts: metaAccounts,
    configured_meta_account_id: metaApi.contextAccountId(context),
  };
}

async function getDecisionRules({ since, until, preset } = {}, context = {}) {
  const params = {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';

  const rows = await metaApi.getInsights(metaApi.contextAccountId(context), params, context);
  const data = rows.map(evaluateRow);
  const queues = {};
  for (const item of data) {
    const top = item.recommendations[0];
    if (!queues[top.queue]) queues[top.queue] = [];
    queues[top.queue].push(item);
  }
  return { data, queues, meta: { paging: rows._paging || null } };
}

async function getFunnel({ since, until, preset } = {}, context = {}) {
  const params = {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions,cost_per_action_type',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';
  const rows = await metaApi.getInsights(metaApi.contextAccountId(context), params, context);
  return rows.map(row => {
    const funnel = parseFunnel(row.actions);
    const spend = parseFloat(row.spend) || 0;
    return {
      id: row.campaign_id,
      name: row.campaign_name,
      spend,
      impressions: parseInt(row.impressions, 10) || 0,
      clicks: parseInt(row.clicks, 10) || 0,
      ...funnel,
      cost_per_lpv: funnel.landing_page_views ? spend / funnel.landing_page_views : 0,
      cost_per_checkout: funnel.initiate_checkouts ? spend / funnel.initiate_checkouts : 0,
      cost_per_purchase: funnel.purchases ? spend / funnel.purchases : 0,
    };
  });
}

async function getFirstPartyFunnel({ since, until, preset } = {}, context = {}) {
  const params = since && until ? { since, until } : { preset: preset || 'yesterday' };
  const metaRows = await getFunnel(params, context);
  const accountId = context?.id || null;
  if (!accountId) return metaRows.map(row => ({ ...row, page_visits: 0, ghl_contacted: 0, qualified: 0, closed: 0, revenue: 0, true_roas: 0 }));

  const range = resolveDateRange({ since, until, preset });
  const rows = await queryAll(`
    SELECT
      v.campaign_id,
      COUNT(DISTINCT v.client_id) AS page_visits,
      COUNT(DISTINCT CASE WHEN v.ghl_contact_id IS NOT NULL OR v.meta_lead_id IS NOT NULL OR v.email_hash IS NOT NULL THEN v.client_id END) AS leads,
      COUNT(DISTINCT CASE WHEN lower(COALESCE(v.current_stage, '')) LIKE '%contact%' THEN v.client_id END) AS ghl_contacted,
      COUNT(DISTINCT CASE WHEN lower(COALESCE(v.current_stage, '')) LIKE '%qualif%' THEN v.client_id END) AS qualified,
      COUNT(DISTINCT CASE WHEN lower(COALESCE(v.current_stage, '')) LIKE '%closed%' OR COALESCE(v.revenue, 0) > 0 THEN v.client_id END) AS closed,
      COALESCE(SUM(v.revenue), 0) AS revenue
    FROM visitors v
    WHERE v.account_id = $1
      AND v.campaign_id IS NOT NULL
      AND v.first_seen_at::date BETWEEN $2::date AND $3::date
    GROUP BY v.campaign_id
  `, [accountId, range.since, range.until]);
  const tracked = Object.fromEntries(rows.map(row => [String(row.campaign_id), row]));
  return metaRows.map(row => {
    const t = tracked[String(row.id)] || {};
    const revenue = parseFloat(t.revenue) || 0;
    return {
      ...row,
      page_visits: parseInt(t.page_visits, 10) || 0,
      leads: Math.max(row.leads || 0, parseInt(t.leads, 10) || 0),
      ghl_contacted: parseInt(t.ghl_contacted, 10) || 0,
      qualified: parseInt(t.qualified, 10) || 0,
      closed: parseInt(t.closed, 10) || 0,
      revenue,
      true_roas: row.spend > 0 ? revenue / row.spend : 0,
    };
  });
}

async function getContactDetail({ clientId, contactId } = {}, context = {}) {
  const accountId = context?.id || null;
  if (!clientId && !contactId) throw new Error('clientId or contactId required');

  const visitor = await queryOne(`
    SELECT * FROM visitors
    WHERE ${clientId ? 'client_id = $1' : 'ghl_contact_id = $1'}
    ${accountId ? 'AND account_id = $2' : ''}
    LIMIT 1
  `, accountId ? [clientId || contactId, accountId] : [clientId || contactId]);

  if (!visitor) return null;

  const events = await queryAll(`
    SELECT event_name, page_url, campaign_id, adset_id, ad_id, value, currency, metadata, fired_at
    FROM visitor_events
    WHERE client_id = $1
    ORDER BY fired_at ASC
  `, [visitor.client_id]);

  // Collect every distinct ad this visitor interacted with
  const adIds = new Set();
  if (visitor.ad_id) adIds.add(visitor.ad_id);
  for (const e of events) if (e.ad_id) adIds.add(e.ad_id);

  const ads = [];
  for (const adId of adIds) {
    try {
      const ad = await metaApi.metaGet(`/${adId}`, {
        fields: 'id,name,status,effective_status,adset_id,campaign_id,creative{id,title,body,image_url,thumbnail_url,object_story_spec}',
      }, context);
      const creative = ad.creative || {};
      const story = creative.object_story_spec || {};
      const link = story.link_data || {};
      const video = story.video_data || {};
      ads.push({
        id: ad.id,
        name: ad.name,
        status: ad.effective_status || ad.status,
        adset_id: ad.adset_id,
        campaign_id: ad.campaign_id,
        headline: link.name || video.title || creative.title || '',
        body: link.message || video.message || creative.body || '',
        image_url: link.picture || video.image_url || creative.image_url || creative.thumbnail_url || null,
      });
    } catch (err) {
      ads.push({ id: adId, name: null, error: err.message });
    }
  }

  // Resolve campaign and adset names for context
  const campaignIds = new Set();
  const adsetIds = new Set();
  if (visitor.campaign_id) campaignIds.add(visitor.campaign_id);
  if (visitor.adset_id) adsetIds.add(visitor.adset_id);
  for (const a of ads) {
    if (a.campaign_id) campaignIds.add(a.campaign_id);
    if (a.adset_id) adsetIds.add(a.adset_id);
  }
  const campaignMap = {};
  for (const cid of campaignIds) {
    try {
      const c = await metaApi.metaGet(`/${cid}`, { fields: 'id,name,objective' }, context);
      campaignMap[cid] = c;
    } catch (e) { /* skip */ }
  }

  return {
    visitor,
    events,
    ads_seen: ads,
    campaigns: campaignMap,
  };
}

async function getJourney({ clientId, contactId, limit = 20 } = {}, context = {}) {
  const accountId = context?.id || null;
  const values = [];
  const filters = [];
  if (accountId) {
    values.push(accountId);
    filters.push(`v.account_id = $${values.length}`);
  }
  if (clientId) {
    values.push(clientId);
    filters.push(`v.client_id = $${values.length}`);
  }
  if (contactId) {
    values.push(contactId);
    filters.push(`v.ghl_contact_id = $${values.length}`);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  values.push(Math.min(parseInt(limit, 10) || 20, 100));
  const visitors = await queryAll(`
    SELECT * FROM visitors v
    ${where}
    ORDER BY v.last_seen_at DESC
    LIMIT $${values.length}
  `, values);
  const data = [];
  for (const visitor of visitors) {
    const events = await queryAll(`
      SELECT event_name, page_url, value, currency, metadata, fired_at
      FROM visitor_events
      WHERE client_id = $1
      ORDER BY fired_at ASC
      LIMIT 200
    `, [visitor.client_id]);
    data.push({ visitor, events });
  }
  return data;
}

async function getTrueRoas({ since, until, preset } = {}, context = {}) {
  const params = {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,actions,action_values',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';
  const metaRows = await metaApi.getInsights(metaApi.contextAccountId(context), params, context);
  const accountId = context?.id || null;
  const range = resolveDateRange({ since, until, preset });
  const visitorRows = accountId ? await queryAll(`
    SELECT campaign_id, COALESCE(SUM(revenue), 0) AS revenue, COUNT(*) FILTER (WHERE revenue > 0) AS closed
    FROM visitors
    WHERE account_id = $1
      AND campaign_id IS NOT NULL
      AND first_seen_at::date BETWEEN $2::date AND $3::date
    GROUP BY campaign_id
  `, [accountId, range.since, range.until]) : [];
  const firstParty = Object.fromEntries(visitorRows.map(row => [String(row.campaign_id), row]));
  return metaRows.map(row => {
    const spend = parseFloat(row.spend) || 0;
    const metaRevenue = parseActionValue(row.action_values, ['offsite_conversion.fb_pixel_purchase', 'purchase']);
    const tracked = firstParty[String(row.campaign_id)] || {};
    const revenue = parseFloat(tracked.revenue) || 0;
    return {
      id: row.campaign_id,
      name: row.campaign_name || row.campaign_id,
      spend,
      meta_reported_roas: spend > 0 ? metaRevenue / spend : 0,
      meta_reported_revenue: metaRevenue,
      first_party_revenue: revenue,
      true_roas: spend > 0 ? revenue / spend : 0,
      closed: parseInt(tracked.closed, 10) || 0,
    };
  }).sort((a, b) => b.spend - a.spend);
}

function daysAgoIso(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function resolveDateRange({ since, until, preset } = {}) {
  if (since && until) return { since, until };
  const selected = preset || 'yesterday';
  if (selected === 'today') {
    const today = new Date().toISOString().slice(0, 10);
    return { since: today, until: today };
  }
  const untilDate = daysAgoIso(1);
  if (selected === '30d') return { since: daysAgoIso(30), until: untilDate };
  if (selected === '7d') return { since: daysAgoIso(7), until: untilDate };
  return { since: untilDate, until: untilDate };
}

async function getAudienceHealth(context = {}) {
  const accountId = context?.id || null;
  const adAccountId = metaApi.contextAccountId(context);
  const audiences = await metaApi.metaGetAll(`/${adAccountId}/customaudiences`, {
    fields: 'id,name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,updated_time',
    limit: '100',
  }, { maxPages: 5 }, context);
  if (accountId) {
    for (const audience of audiences) {
      const upperBound = Number(audience.approximate_count_upper_bound) || null;
      const lowerBound = Number(audience.approximate_count_lower_bound) || null;
      await query(`
        INSERT INTO audience_snapshots (account_id, audience_id, name, subtype, approximate_count, delivery_status, operation_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
      `, [
        accountId,
        audience.id,
        audience.name || null,
        audience.subtype || null,
        upperBound || lowerBound,
        JSON.stringify(audience.delivery_status || {}),
        JSON.stringify(audience.operation_status || {}),
      ]).catch(() => null);
    }
  }
  return audiences.map(audience => {
    const lowerBound = Number(audience.approximate_count_lower_bound) || 0;
    const upperBound = Number(audience.approximate_count_upper_bound) || lowerBound;
    const size = upperBound || lowerBound;
    return {
      id: audience.id,
      name: audience.name,
      subtype: audience.subtype,
      approximate_count: size,
      approximate_count_lower_bound: lowerBound,
      approximate_count_upper_bound: upperBound,
      status: size > 5000 ? 'healthy' : size >= 1000 ? 'watch' : 'too_small',
      delivery_status: audience.delivery_status || null,
      operation_status: audience.operation_status || null,
      updated_time: audience.updated_time || null,
    };
  }).sort((a, b) => a.approximate_count - b.approximate_count);
}

async function getAudienceSegments({ since, until, preset } = {}, context = {}) {
  const accountId = context?.id || null;
  const range = resolveDateRange({ since, until, preset });
  const firstParty = [];

  if (accountId) {
    const rows = await queryAll(`
      WITH base AS (
        SELECT v.*
        FROM visitors v
        WHERE v.account_id = $1
          AND v.last_seen_at::date BETWEEN $2::date AND $3::date
      ),
      event_counts AS (
        SELECT client_id, COUNT(*) AS touches
        FROM visitor_events
        WHERE account_id = $1
          AND fired_at::date BETWEEN $2::date AND $3::date
        GROUP BY client_id
      )
      SELECT *
      FROM (
        SELECT 'all_visitors' AS key, 'All tracked website visitors' AS name, 'first_party' AS source, 'Website visitors with an anonymous dashboard client ID.' AS description, COUNT(DISTINCT client_id) AS size FROM base
        UNION ALL
        SELECT 'ad_click_visitors', 'Visitors with Meta click ID', 'first_party', 'Visitors carrying fbclid or _fbc from a Meta ad click.', COUNT(DISTINCT client_id) FROM base WHERE fbclid IS NOT NULL OR fbc IS NOT NULL
        UNION ALL
        SELECT 'browser_id_visitors', 'Visitors with Meta browser ID', 'first_party', 'Visitors carrying _fbp, useful for attribution diagnostics and matching.', COUNT(DISTINCT client_id) FROM base WHERE fbp IS NOT NULL
        UNION ALL
        SELECT 'multi_touch_visitors', 'Multi-touch visitors', 'first_party', 'Anonymous visitors with two or more recorded touchpoints.', COUNT(DISTINCT b.client_id) FROM base b JOIN event_counts e ON e.client_id = b.client_id WHERE e.touches >= 2
        UNION ALL
        SELECT 'meta_native_leads', 'Meta native leads', 'first_party', 'Lead form submissions from Meta (native Instant Form), captured via Meta lead webhook or GHL.', COUNT(DISTINCT client_id) FROM base WHERE meta_lead_id IS NOT NULL OR lower(COALESCE(source_event_type, '')) LIKE 'fb-lead%' OR lower(COALESCE(source_event_type, '')) LIKE '%instant%form%'
        UNION ALL
        SELECT 'google_ads_leads', 'Google Ads form submitters', 'first_party', 'Landing-page form submits attributed to Google Ads (gclid or utm_source=google).', COUNT(DISTINCT client_id) FROM base WHERE (gclid IS NOT NULL OR lower(COALESCE(utm_source, '')) = 'google') AND (email_hash IS NOT NULL OR phone_hash IS NOT NULL OR ghl_contact_id IS NOT NULL)
        UNION ALL
        SELECT 'landing_page_leads', 'Landing page form submitters', 'first_party', 'Contacts who submitted a form on your landing page (not native Meta form).', COUNT(DISTINCT client_id) FROM base WHERE ghl_contact_id IS NOT NULL AND (meta_lead_id IS NULL AND lower(COALESCE(source_event_type, '')) NOT LIKE 'fb-lead%')
        UNION ALL
        SELECT 'non_converted_contacts', 'Non-converted contacts', 'first_party', 'Known first-party contacts who have not yet converted. Useful for later-step suppression-safe retargeting.', COUNT(DISTINCT client_id) FROM base WHERE (email_hash IS NOT NULL OR phone_hash IS NOT NULL) AND NOT (meta_lead_id IS NOT NULL OR ghl_contact_id IS NOT NULL OR lower(COALESCE(current_stage, '')) LIKE '%book%' OR lower(COALESCE(current_stage, '')) LIKE '%appoint%' OR lower(COALESCE(current_stage, '')) LIKE '%closed%' OR COALESCE(revenue, 0) > 0)
        UNION ALL
        SELECT 'converted_contacts', 'Converted / excluded contacts', 'first_party', 'Contacts who already converted, submitted a lead, booked, or reached a closed/revenue stage. Use as a global exclusion audience.', COUNT(DISTINCT client_id) FROM base WHERE meta_lead_id IS NOT NULL OR ghl_contact_id IS NOT NULL OR lower(COALESCE(current_stage, '')) LIKE '%book%' OR lower(COALESCE(current_stage, '')) LIKE '%appoint%' OR lower(COALESCE(current_stage, '')) LIKE '%closed%' OR COALESCE(revenue, 0) > 0
        UNION ALL
        SELECT 'known_contacts', 'Resolved contacts', 'first_party', 'Visitors matched to an email, phone, GHL contact, or Meta lead ID.', COUNT(DISTINCT client_id) FROM base WHERE email_hash IS NOT NULL OR phone_hash IS NOT NULL OR ghl_contact_id IS NOT NULL OR meta_lead_id IS NOT NULL
        UNION ALL
        SELECT 'qualified_contacts', 'Qualified contacts', 'first_party', 'Contacts whose current stage includes qualified.', COUNT(DISTINCT client_id) FROM base WHERE lower(COALESCE(current_stage, '')) LIKE '%qualif%'
        UNION ALL
        SELECT 'closed_contacts', 'Closed or revenue contacts', 'first_party', 'Contacts with closed stage language or tracked revenue.', COUNT(DISTINCT client_id) FROM base WHERE lower(COALESCE(current_stage, '')) LIKE '%closed%' OR COALESCE(revenue, 0) > 0
      ) segments
      ORDER BY size DESC, name
    `, [accountId, range.since, range.until]);

    firstParty.push(...rows.map(row => ({
      key: row.key,
      name: row.name,
      source: row.source,
      description: row.description,
      size: parseInt(row.size, 10) || 0,
      retargeting_status: parseInt(row.size, 10) >= 100 ? 'ready_to_build' : parseInt(row.size, 10) > 0 ? 'too_small' : 'waiting_for_data',
      audience_id: null,
      usable_in_adset: false,
    })));
  }

  const metaAudiences = await getAudienceHealth(context);
  const metaSegments = metaAudiences.map(audience => ({
    key: `meta_${audience.id}`,
    name: audience.name || audience.id,
    source: 'meta_custom_audience',
    description: `${audience.subtype || 'Custom'} audience already available in Meta.`,
    size: audience.approximate_count || 0,
    lower_bound: audience.approximate_count_lower_bound || 0,
    upper_bound: audience.approximate_count_upper_bound || audience.approximate_count || 0,
    retargeting_status: audience.status,
    audience_id: audience.id,
    subtype: audience.subtype || null,
    delivery_status: audience.delivery_status || null,
    operation_status: audience.operation_status || null,
    usable_in_adset: true,
  }));

  return {
    range,
    first_party: firstParty,
    meta: metaSegments,
    data: [...firstParty, ...metaSegments],
  };
}

async function getBreakdowns({ breakdown = 'publisher_platform', since, until, preset } = {}, context = {}) {
  const allowed = new Set(['publisher_platform', 'platform_position', 'impression_device', 'age', 'gender', 'country', 'region']);
  const selected = allowed.has(breakdown) ? breakdown : 'publisher_platform';
  const params = {
    level: 'campaign',
    breakdowns: selected,
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpc,actions',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';
  const rows = await metaApi.getInsights(metaApi.contextAccountId(context), params, context);
  return rows.map(row => {
    const targets = targetForCampaign(row.campaign_id);
    const results = primaryResultFromActions(row.actions, targets.primary_event);
    const spend = parseFloat(row.spend) || 0;
    return {
      ...row,
      breakdown: selected,
      segment: row[selected] || 'unknown',
      results,
      cpa: results ? spend / results : 0,
    };
  });
}

async function getCreativeLibrary({ since, until, preset } = {}, context = {}) {
  const insightParams = {
    level: 'ad',
    fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpc,frequency,actions',
  };
  if (since && until) insightParams.time_range = JSON.stringify({ since, until });
  else insightParams.date_preset = preset || 'yesterday';

  const insightRows = await metaApi.getInsights(metaApi.contextAccountId(context), insightParams, context);
  const insightsByAd = Object.fromEntries(insightRows.map(row => [row.ad_id, row]));
  const adIds = Object.keys(insightsByAd);
  const groups = {};

  for (const adId of adIds.slice(0, 150)) {
    let ad;
    try {
      ad = await metaApi.metaGet(`/${adId}`, {
        fields: 'id,name,creative{id,title,body,call_to_action_type,thumbnail_url,image_url,object_story_spec}',
      }, context);
    } catch (err) {
      ad = { id: adId, name: insightsByAd[adId].ad_name, creative: {} };
    }
    const creative = ad.creative || {};
    const story = creative.object_story_spec || {};
    const link = story.link_data || {};
    const video = story.video_data || {};
    const key = creative.id || `${link.name || video.title || creative.title || ''}|${link.message || video.message || creative.body || ''}`;
    const row = insightsByAd[adId];
    const targets = targetForCampaign(row.campaign_id);
    const results = primaryResultFromActions(row.actions, targets.primary_event);
    const spend = parseFloat(row.spend) || 0;

    if (!groups[key]) {
      groups[key] = {
        creative_id: creative.id || null,
        headline: link.name || video.title || creative.title || '',
        primary_text: link.message || video.message || creative.body || '',
        cta: link.call_to_action?.type || video.call_to_action?.type || creative.call_to_action_type || '',
        image_url: link.picture || video.image_url || creative.image_url || creative.thumbnail_url || '',
        ads: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        results: 0,
      };
    }
    groups[key].ads += 1;
    groups[key].spend += spend;
    groups[key].impressions += parseInt(row.impressions, 10) || 0;
    groups[key].clicks += parseInt(row.clicks, 10) || 0;
    groups[key].results += results;
  }

  return Object.values(groups).map(group => ({
    ...group,
    ctr: group.impressions ? group.clicks / group.impressions * 100 : 0,
    cpa: group.results ? group.spend / group.results : 0,
  })).sort((a, b) => b.spend - a.spend);
}

module.exports = {
  DEFAULT_TARGETS,
  getAccountContext,
  readTargets,
  writeTargets,
  getDecisionRules,
  getFunnel,
  getFirstPartyFunnel,
  getJourney,
  getContactDetail,
  getTrueRoas,
  getAudienceHealth,
  getAudienceSegments,
  getBreakdowns,
  getCreativeLibrary,
};
