const fs = require('fs');
const path = require('path');
const metaApi = require('./metaApi');
const config = require('../config');
const { queryOne } = require('../db');

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

async function getAccountContext() {
  const [dbAccount, metaAccounts] = await Promise.all([
    queryOne('SELECT id, meta_account_id, name, currency, timezone FROM accounts WHERE is_active = true ORDER BY id LIMIT 1').catch(() => null),
    metaApi.getAdAccounts().catch(() => []),
  ]);
  return {
    internal_account: dbAccount || { id: 1, meta_account_id: config.meta.adAccountId, name: 'Meta account', currency: 'USD' },
    meta_accounts: metaAccounts,
    configured_meta_account_id: config.meta.adAccountId,
  };
}

async function getDecisionRules({ since, until, preset } = {}) {
  const params = {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';

  const rows = await metaApi.getInsights(config.meta.adAccountId, params);
  const data = rows.map(evaluateRow);
  const queues = {};
  for (const item of data) {
    const top = item.recommendations[0];
    if (!queues[top.queue]) queues[top.queue] = [];
    queues[top.queue].push(item);
  }
  return { data, queues, meta: { paging: rows._paging || null } };
}

async function getFunnel({ since, until, preset } = {}) {
  const params = {
    level: 'campaign',
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,reach,actions,cost_per_action_type',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';
  const rows = await metaApi.getInsights(config.meta.adAccountId, params);
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

async function getBreakdowns({ breakdown = 'publisher_platform', since, until, preset } = {}) {
  const allowed = new Set(['publisher_platform', 'platform_position', 'impression_device', 'age', 'gender', 'country', 'region']);
  const selected = allowed.has(breakdown) ? breakdown : 'publisher_platform';
  const params = {
    level: 'campaign',
    breakdowns: selected,
    fields: 'campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpc,actions',
  };
  if (since && until) params.time_range = JSON.stringify({ since, until });
  else params.date_preset = preset || 'yesterday';
  const rows = await metaApi.getInsights(config.meta.adAccountId, params);
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

async function getCreativeLibrary({ since, until, preset } = {}) {
  const insightParams = {
    level: 'ad',
    fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpm,cpc,frequency,actions',
  };
  if (since && until) insightParams.time_range = JSON.stringify({ since, until });
  else insightParams.date_preset = preset || 'yesterday';

  const insightRows = await metaApi.getInsights(config.meta.adAccountId, insightParams);
  const insightsByAd = Object.fromEntries(insightRows.map(row => [row.ad_id, row]));
  const adIds = Object.keys(insightsByAd);
  const groups = {};

  for (const adId of adIds.slice(0, 150)) {
    let ad;
    try {
      ad = await metaApi.metaGet(`/${adId}`, {
        fields: 'id,name,creative{id,title,body,call_to_action_type,thumbnail_url,image_url,object_story_spec}',
      });
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
  getBreakdowns,
  getCreativeLibrary,
};
