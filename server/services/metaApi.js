const fetch = require('node-fetch');
const config = require('../config');
const metaUsage = require('./metaUsageService');
let metaCache; // lazy-loaded to avoid circular require
function getCache() {
  if (!metaCache) metaCache = require('./metaCache');
  return metaCache;
}

let cooldownUntil = 0;
let cooldownMessage = null;

// Per-account serial queue. Calls to the same account are processed one-at-a-time
// with a small delay between them. Calls to different accounts run concurrently.
const accountQueues = new Map(); // accountKey → Promise chain
const CALL_SPACING_MS = parseInt(process.env.META_CALL_SPACING_MS, 10) || 250;

function queueForAccount(accountKey, fn) {
  const prev = accountQueues.get(accountKey) || Promise.resolve();
  const next = prev.then(async () => {
    const result = await fn();
    await new Promise(r => setTimeout(r, CALL_SPACING_MS));
    return result;
  }, async () => {
    // If the prev call errored, still run this one (queue errors don't cascade).
    const result = await fn();
    await new Promise(r => setTimeout(r, CALL_SPACING_MS));
    return result;
  });
  accountQueues.set(accountKey, next.catch(() => {})); // swallow at tail
  return next;
}

function accountKeyFromContext(context = {}) {
  return context.id || context.meta_account_id || contextAccountId(context) || 'default';
}

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
    err.error_user_title = data.error.error_user_title || null;
    err.error_user_msg = data.error.error_user_msg || null;
    err.error_data = data.error.error_data || null;
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

function getCooldownRemainingSeconds() {
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

async function metaGet(endpoint, params = {}, context = {}) {
  assertNotCoolingDown();
  return queueForAccount(accountKeyFromContext(context), async () => {
    assertNotCoolingDown();
    const url = new URL(`${contextBase(context)}${endpoint}`);
    url.searchParams.set('access_token', contextToken(context));
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString());
    return parseResponse(res, { source: 'meta_get', method: 'GET', endpoint });
  });
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
  return queueForAccount(accountKeyFromContext(context), async () => {
    assertNotCoolingDown();
    const url = `${contextBase(context)}${endpoint}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: contextToken(context), ...body }),
    });
    return parseResponse(res, { source: 'meta_post', method: 'POST', endpoint });
  });
}

async function getAdAccounts(context = {}) {
  const cache = getCache();
  const token = contextToken(context);
  // Cache by token tail so different tokens don't collide.
  const tokenKey = (token || '').slice(-12);
  const { data } = await cache.wrap(
    {
      accountId: context.id || null,
      key: `ad_accounts::${tokenKey}`,
      freshMs: 60 * 60 * 1000,      // 1h — these rarely change
      staleMs: 24 * 60 * 60 * 1000, // 24h
    },
    () => metaGetAll('/me/adaccounts', {
      fields: 'id,name,account_id,currency,timezone_name,account_status',
      limit: '50',
    }, {}, context)
  );
  return data;
}

const EVENT_LABELS = {
  LEAD: 'Lead',
  PURCHASE: 'Purchase',
  COMPLETE_REGISTRATION: 'Registration',
  INITIATE_CHECKOUT: 'Initiate Checkout',
  ADD_TO_CART: 'Add to Cart',
  VIEW_CONTENT: 'View Content',
  CONTACT: 'Contact',
  SUBSCRIBE: 'Subscribe',
  SCHEDULE: 'Schedule',
  START_TRIAL: 'Start Trial',
  SUBMIT_APPLICATION: 'Submit Application',
  ADD_PAYMENT_INFO: 'Add Payment Info',
  ADD_TO_WISHLIST: 'Add to Wishlist',
  SEARCH: 'Search',
  DONATE: 'Donate',
  OTHER: 'Custom',
};

const OBJECTIVE_FALLBACK_EVENT = {
  OUTCOME_LEADS: 'LEAD',
  OUTCOME_SALES: 'PURCHASE',
  OUTCOME_TRAFFIC: 'LINK_CLICK',
  OUTCOME_ENGAGEMENT: 'LINK_CLICK',
  OUTCOME_APP_PROMOTION: 'INSTALL',
};

function labelForEvent(type) {
  if (!type) return null;
  const key = String(type).toUpperCase();
  if (EVENT_LABELS[key]) return EVENT_LABELS[key];
  return key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

function extractDesiredEvent(campaign) {
  const adsets = (campaign.adsets && campaign.adsets.data) || [];
  for (const adset of adsets) {
    const po = adset.promoted_object || {};
    if (po.custom_event_type) {
      return {
        event_type: po.custom_event_type,
        event_label: labelForEvent(po.custom_event_type),
        optimization_goal: adset.optimization_goal || null,
        pixel_id: po.pixel_id || null,
        source: 'promoted_object',
      };
    }
    if (adset.optimization_goal) {
      return {
        event_type: null,
        event_label: labelForEvent(adset.optimization_goal),
        optimization_goal: adset.optimization_goal,
        pixel_id: null,
        source: 'optimization_goal',
      };
    }
  }
  const fallback = OBJECTIVE_FALLBACK_EVENT[campaign.objective];
  if (fallback) {
    return {
      event_type: fallback,
      event_label: labelForEvent(fallback),
      optimization_goal: null,
      pixel_id: null,
      source: 'objective',
    };
  }
  return null;
}

async function getCampaigns(adAccountId, context = {}) {
  const id = adAccountId || contextAccountId(context);
  const cache = getCache();
  const { data: campaigns } = await cache.wrap(
    {
      accountId: context.id || id,
      key: `campaigns::${id}`,
      freshMs: 5 * 60 * 1000,      // 5 min fresh
      staleMs: 60 * 60 * 1000,     // 1 h max stale
    },
    async () => {
      const rows = await metaGetAll(`/${id}/campaigns`, {
        fields: 'id,name,objective,status,effective_status,daily_budget,lifetime_budget,buying_type,special_ad_categories,updated_time,adsets.limit(3){id,optimization_goal,promoted_object}',
        limit: '100',
      }, {}, context);
      for (const campaign of rows) {
        campaign.desired_event = extractDesiredEvent(campaign);
        delete campaign.adsets;
      }
      return rows;
    }
  );
  return campaigns;
}

async function _getAdSetsUncached(campaignId, context = {}) {
  const adsets = await metaGetAll(`/${campaignId}/adsets`, {
    fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,optimization_goal,billing_event,targeting,placements,attribution_spec,promoted_object,start_time,end_time,updated_time',
    limit: '100',
  }, {}, context);
  for (const adset of adsets) {
    const po = adset.promoted_object || {};
    if (po.custom_event_type) {
      adset.desired_event = {
        event_type: po.custom_event_type,
        event_label: labelForEvent(po.custom_event_type),
        optimization_goal: adset.optimization_goal || null,
        pixel_id: po.pixel_id || null,
        source: 'promoted_object',
      };
    } else if (adset.optimization_goal) {
      adset.desired_event = {
        event_type: null,
        event_label: labelForEvent(adset.optimization_goal),
        optimization_goal: adset.optimization_goal,
        pixel_id: null,
        source: 'optimization_goal',
      };
    }
  }
  return adsets;
}

async function getAdSets(campaignId, context = {}) {
  const cache = getCache();
  const { data } = await cache.wrap(
    {
      accountId: context.id || null,
      key: `adsets::${campaignId}`,
      freshMs: 5 * 60 * 1000,
      staleMs: 60 * 60 * 1000,
    },
    () => _getAdSetsUncached(campaignId, context)
  );
  return data;
}

async function getAds(adSetId, context = {}) {
  const cache = getCache();
  const { data } = await cache.wrap(
    {
      accountId: context.id || null,
      key: `ads::${adSetId}`,
      freshMs: 5 * 60 * 1000,
      staleMs: 60 * 60 * 1000,
    },
    () => metaGetAll(`/${adSetId}/ads`, {
      fields: 'id,name,status,effective_status,creative{id,title,body,call_to_action_type,image_url,video_id,thumbnail_url},preview_shareable_link,updated_time',
      limit: '100',
    }, {}, context)
  );
  return data;
}

async function getInsights(entityId, params = {}, context = {}) {
  const defaults = {
    fields: 'spend,impressions,clicks,reach,ctr,cpm,cpc,frequency,actions,action_values,cost_per_action_type',
    date_preset: 'yesterday',
    level: 'campaign',
  };
  const merged = { ...defaults, ...params };
  // TTL depends on how "live" the window is:
  //   - today       → 60s fresh, 5min stale
  //   - yesterday   → 30min fresh, 4h stale
  //   - historical  → 1h fresh, 24h stale
  const preset = String(merged.date_preset || '').toLowerCase();
  const isToday = preset === 'today' || (merged.time_range && String(merged.time_range).includes(new Date().toISOString().slice(0, 10)));
  const isYesterday = preset === 'yesterday';
  let freshMs, staleMs;
  if (isToday) { freshMs = 60 * 1000; staleMs = 5 * 60 * 1000; }
  else if (isYesterday) { freshMs = 30 * 60 * 1000; staleMs = 4 * 60 * 60 * 1000; }
  else { freshMs = 60 * 60 * 1000; staleMs = 24 * 60 * 60 * 1000; }

  const paramKey = JSON.stringify(Object.keys(merged).sort().reduce((o, k) => (o[k] = merged[k], o), {}));
  const cache = getCache();
  const { data } = await cache.wrap(
    {
      accountId: context.id || null,
      key: `insights::${entityId}::${paramKey}`,
      freshMs,
      staleMs,
    },
    () => metaGetAll(`/${entityId}/insights`, merged, { maxPages: 50 }, context)
  );
  return data;
}

async function getInsightsRange(entityId, since, until, level = 'campaign', context = {}) {
  return getInsights(entityId, {
    time_range: JSON.stringify({ since, until }),
    level,
    time_increment: 1,
  }, context);
}

function invalidateForEntity(accountId, entityId) {
  const cache = getCache();
  cache.invalidate(accountId, (key) => key.includes(entityId));
  // Also clear the campaigns/adsets/ads list caches since effective_status might have changed.
  cache.invalidate(accountId, (key) => key.startsWith('campaigns::') || key.startsWith('adsets::') || key.startsWith('ads::'));
}

async function updateStatus(entityId, status, context = {}) {
  const result = await metaPost(`/${entityId}`, { status }, context);
  invalidateForEntity(context.id || null, entityId);
  return result;
}

async function updateBudget(adSetId, dailyBudget, context = {}) {
  const result = await metaPost(`/${adSetId}`, { daily_budget: dailyBudget }, context);
  invalidateForEntity(context.id || null, adSetId);
  return result;
}

async function duplicateEntity(entityId, entityType, context = {}) {
  const result = await metaPost(`/${entityId}/copies`, {
    deep_copy: true,
    status_option: 'PAUSED',
  }, context);
  invalidateForEntity(context.id || null, entityId);
  return result;
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
  getCooldownRemainingSeconds,
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
  labelForEvent,
  extractDesiredEvent,
  EVENT_LABELS,
  invalidateForEntity,
};
