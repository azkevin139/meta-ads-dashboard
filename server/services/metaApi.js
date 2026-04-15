const fetch = require('node-fetch');
const config = require('../config');
const metaUsage = require('./metaUsageService');

let cooldownUntil = 0;
let cooldownMessage = null;

function contextBase(context = {}) {
  return `https://graph.facebook.com/${context.apiVersion || config.meta.apiVersion || 'v21.0'}`;
}

function contextToken(context = {}) {
  return context.access_token || context.accessToken || config.meta.accessToken;
}

function contextAccountId(context = {}) {
  return context.meta_account_id || context.adAccountId || config.meta.adAccountId;
}

function isUserRateLimitError(error = {}) {
  const message = String(error.message || '').toLowerCase();
  return error.code === 17 ||
    error.code === 4 ||
    error.code === 613 ||
    message.includes('user request limit reached') ||
    message.includes('rate limit') ||
    message.includes('too many calls');
}

async function parseResponse(res, context) {
  metaUsage.recordHeaders(res.headers, context);
  const data = await res.json();

  if (data.error) {
    const err = new Error(data.error.message);
    err.code = data.error.code;
    err.type = data.error.type;
    err.error_subcode = data.error.error_subcode || null;
    if (isUserRateLimitError(data.error)) {
      const retryHeader = res.headers && res.headers.get ? parseInt(res.headers.get('retry-after'), 10) : 0;
      err.httpStatus = 429;
      err.retryAfterSeconds = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : 15 * 60;
      err.limitType = 'meta_user_request_limit';
      cooldownUntil = Date.now() + err.retryAfterSeconds * 1000;
      cooldownMessage = err.message;
    }
    metaUsage.recordError(err);
    throw err;
  }

  return data;
}

function assertNotCoolingDown() {
  const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
  if (remaining > 0) {
    const err = new Error(cooldownMessage || 'Meta user request limit reached');
    err.httpStatus = 429;
    err.retryAfterSeconds = remaining;
    err.limitType = 'meta_user_request_limit';
    throw err;
  }
  cooldownUntil = 0;
  cooldownMessage = null;
}

async function metaGet(endpoint, params = {}, context = {}) {
  assertNotCoolingDown();
  const url = new URL(`${contextBase(context)}${endpoint}`);
  url.searchParams.set('access_token', contextToken(context));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }

  const res = await fetch(url.toString());
  return parseResponse(res, { source: 'meta_get', method: 'GET', endpoint });
}

async function metaGetAll(endpoint, params = {}, options = {}, context = {}) {
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
      data = await metaGet(endpoint, { ...params, limit }, context);
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

async function metaPost(endpoint, body = {}, context = {}) {
  assertNotCoolingDown();
  const url = `${contextBase(context)}${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: contextToken(context), ...body }),
  });
  return parseResponse(res, { source: 'meta_post', method: 'POST', endpoint });
}

async function getAdAccounts(context = {}) {
  return metaGetAll('/me/adaccounts', {
    fields: 'id,name,account_id,currency,timezone_name,account_status',
    limit: '50',
  }, {}, context);
}

async function getCampaigns(adAccountId, context = {}) {
  const id = adAccountId || contextAccountId(context);
  return metaGetAll(`/${id}/campaigns`, {
    fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,updated_time',
    limit: '100',
  }, {}, context);
}

async function getAdSets(campaignId, context = {}) {
  return metaGetAll(`/${campaignId}/adsets`, {
    fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,targeting,placements,attribution_spec,start_time,end_time,updated_time',
    limit: '100',
  }, {}, context);
}

async function getAds(adSetId, context = {}) {
  return metaGetAll(`/${adSetId}/ads`, {
    fields: 'id,name,status,effective_status,creative{id,title,body,call_to_action_type,image_url,video_id,thumbnail_url},preview_shareable_link,updated_time',
    limit: '100',
  }, {}, context);
}

async function getInsights(entityId, params = {}, context = {}) {
  const defaults = {
    fields: 'spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
    date_preset: 'yesterday',
    level: 'campaign',
  };
  const merged = { ...defaults, ...params };
  return metaGetAll(`/${entityId}/insights`, merged, { maxPages: 50 }, context);
}

async function getInsightsRange(entityId, since, until, level = 'campaign', context = {}) {
  return getInsights(entityId, {
    time_range: JSON.stringify({ since, until }),
    level,
    time_increment: 1,
  }, context);
}

async function updateStatus(entityId, status, context = {}) {
  return metaPost(`/${entityId}`, { status }, context);
}

async function updateBudget(adSetId, dailyBudget, context = {}) {
  return metaPost(`/${adSetId}`, { daily_budget: dailyBudget }, context);
}

async function duplicateEntity(entityId, entityType, context = {}) {
  return metaPost(`/${entityId}/copies`, {
    deep_copy: true,
    status_option: 'PAUSED',
  }, context);
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
  isUserRateLimitError,
  contextAccountId,
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
