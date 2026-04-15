const fetch = require('node-fetch');
const config = require('../config');
const metaUsage = require('./metaUsageService');

const BASE = config.meta.baseUrl();
const TOKEN = config.meta.accessToken;

async function parseResponse(res, context) {
  metaUsage.recordHeaders(res.headers, context);
  const data = await res.json();

  if (data.error) {
    const err = new Error(data.error.message);
    err.code = data.error.code;
    err.type = data.error.type;
    err.error_subcode = data.error.error_subcode || null;
    metaUsage.recordError(err);
    throw err;
  }

  return data;
}

async function metaGet(endpoint, params = {}) {
  const url = new URL(`${BASE}${endpoint}`);
  url.searchParams.set('access_token', TOKEN);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  return parseResponse(res, { source: 'meta_get', method: 'GET', endpoint });
}

async function metaGetAll(endpoint, params = {}, options = {}) {
  const limit = String(options.limit || params.limit || 100);
  const maxPages = options.maxPages || 25;
  let page = 0;
  let nextUrl = null;
  const rows = [];
  const paging = { complete: true, pages: 0, truncated: false };

  do {
    let data;
    if (nextUrl) {
      const res = await fetch(nextUrl);
      data = await parseResponse(res, { source: 'meta_get_all', method: 'GET', endpoint });
    } else {
      data = await metaGet(endpoint, { ...params, limit });
    }

    rows.push(...(data.data || []));
    page += 1;
    paging.pages = page;
    nextUrl = data.paging && data.paging.next ? data.paging.next : null;

    if (nextUrl && page >= maxPages) {
      paging.complete = false;
      paging.truncated = true;
      break;
    }
  } while (nextUrl);

  rows._paging = paging;
  return rows;
}

async function metaPost(endpoint, body = {}) {
  const url = `${BASE}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: TOKEN, ...body }),
  });
  return parseResponse(res, { source: 'meta_post', method: 'POST', endpoint });
}

async function getAdAccounts() {
  return metaGetAll('/me/adaccounts', {
    fields: 'id,name,account_id,currency,timezone_name,account_status',
    limit: '50',
  });
}

async function getCampaigns(adAccountId) {
  const id = adAccountId || config.meta.adAccountId;
  return metaGetAll(`/${id}/campaigns`, {
    fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,updated_time',
    limit: '100',
  });
}

async function getAdSets(campaignId) {
  return metaGetAll(`/${campaignId}/adsets`, {
    fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,targeting,placements,attribution_spec,start_time,end_time,updated_time',
    limit: '100',
  });
}

async function getAds(adSetId) {
  return metaGetAll(`/${adSetId}/ads`, {
    fields: 'id,name,status,effective_status,creative{id,title,body,call_to_action_type,image_url,video_id,thumbnail_url},preview_shareable_link,updated_time',
    limit: '100',
  });
}

async function getInsights(entityId, params = {}) {
  const defaults = {
    fields: 'spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
    date_preset: 'yesterday',
    level: 'campaign',
  };
  const merged = { ...defaults, ...params };
  return metaGetAll(`/${entityId}/insights`, merged, { maxPages: 50 });
}

async function getInsightsRange(entityId, since, until, level = 'campaign') {
  return getInsights(entityId, {
    time_range: JSON.stringify({ since, until }),
    level,
    time_increment: 1,
  });
}

async function updateStatus(entityId, status) {
  return metaPost(`/${entityId}`, { status });
}

async function updateBudget(adSetId, dailyBudget) {
  return metaPost(`/${adSetId}`, { daily_budget: dailyBudget });
}

async function duplicateEntity(entityId, entityType) {
  return metaPost(`/${entityId}/copies`, {
    deep_copy: true,
    status_option: 'PAUSED',
  });
}

function parseActions(actions) {
  if (!actions || !Array.isArray(actions)) return {};
  const result = {};
  for (const a of actions) {
    const type = a.action_type;
    const val = parseInt(a.value, 10) || 0;
    if (type.includes('lead')) result.leads = (result.leads || 0) + val;
    else if (type.includes('purchase')) result.purchases = (result.purchases || 0) + val;
    else if (type.includes('complete_registration')) result.registrations = (result.registrations || 0) + val;
    else if (type === 'link_click') result.link_clicks = (result.link_clicks || 0) + val;
    else if (type === 'landing_page_view') result.landing_page_views = (result.landing_page_views || 0) + val;
    result[type] = val;
  }
  return result;
}

function parseActionValues(actionValues) {
  if (!actionValues || !Array.isArray(actionValues)) return 0;
  let total = 0;
  for (const a of actionValues) {
    if (a.action_type.includes('purchase') || a.action_type.includes('lead')) {
      total += parseFloat(a.value) || 0;
    }
  }
  return total;
}

module.exports = {
  metaGet,
  metaGetAll,
  metaPost,
  getAdAccounts,
  getCampaigns,
  getAdSets,
  getAds,
  getInsights,
  getInsightsRange,
  updateStatus,
  updateBudget,
  duplicateEntity,
  parseActions,
  parseActionValues,
};
