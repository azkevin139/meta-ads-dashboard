const metaApi = require('./metaApi');
const { logAction } = require('./actionService');

const LEVEL_CONFIG = {
  campaign: {
    readFields: [
      'id','name','status','effective_status','objective','buying_type','daily_budget','lifetime_budget',
      'special_ad_categories','start_time','stop_time','smart_promotion_type','created_time','updated_time'
    ],
    allowedUpdateFields: ['name','status','objective','buying_type','daily_budget','lifetime_budget','special_ad_categories','start_time','stop_time'],
  },
  adset: {
    readFields: [
      'id','name','status','effective_status','daily_budget','lifetime_budget','bid_strategy','bid_amount',
      'optimization_goal','billing_event','targeting','promoted_object','start_time','end_time',
      'attribution_spec','updated_time'
    ],
    allowedUpdateFields: [
      'name','status','daily_budget','lifetime_budget','bid_strategy','bid_amount','optimization_goal',
      'billing_event','targeting','promoted_object','start_time','end_time','attribution_spec'
    ],
  },
};

function assertLevel(level) {
  if (!LEVEL_CONFIG[level]) throw new Error(`Unsupported level: ${level}`);
  return LEVEL_CONFIG[level];
}

function requireAccountId(accountId) {
  const parsed = parseInt(accountId, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('accountId required');
  return parsed;
}

function moneyToCents(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n * 100);
}

function compactTargeting(targeting = {}) {
  const flexible = targeting.flexible_spec || [];
  return {
    age_min: targeting.age_min || null,
    age_max: targeting.age_max || null,
    genders: targeting.genders || [],
    locales: targeting.locales || [],
    geo_locations: targeting.geo_locations || {},
    excluded_geo_locations: targeting.excluded_geo_locations || {},
    custom_audiences: (targeting.custom_audiences || []).map(a => ({ id: a.id, name: a.name || null })),
    excluded_custom_audiences: (targeting.excluded_custom_audiences || []).map(a => ({ id: a.id, name: a.name || null })),
    interests: flexible.flatMap(block => (block.interests || []).map(i => ({ id: i.id, name: i.name }))),
    publisher_platforms: targeting.publisher_platforms || [],
    facebook_positions: targeting.facebook_positions || [],
    instagram_positions: targeting.instagram_positions || [],
    messenger_positions: targeting.messenger_positions || [],
    audience_network_positions: targeting.audience_network_positions || [],
    device_platforms: targeting.device_platforms || [],
    raw: targeting,
  };
}

function normalizeEntity(level, data) {
  if (level === 'campaign') {
    return {
      level,
      id: data.id,
      name: data.name,
      status: data.status,
      effective_status: data.effective_status,
      objective: data.objective || null,
      buying_type: data.buying_type || null,
      daily_budget: data.daily_budget ? Number(data.daily_budget) : null,
      lifetime_budget: data.lifetime_budget ? Number(data.lifetime_budget) : null,
      special_ad_categories: data.special_ad_categories || [],
      start_time: data.start_time || null,
      stop_time: data.stop_time || null,
      smart_promotion_type: data.smart_promotion_type || null,
      created_time: data.created_time || null,
      updated_time: data.updated_time || null,
      meta: data,
    };
  }

  const targeting = compactTargeting(data.targeting || {});
  return {
    level,
    id: data.id,
    name: data.name,
    status: data.status,
    effective_status: data.effective_status,
    daily_budget: data.daily_budget ? Number(data.daily_budget) : null,
    lifetime_budget: data.lifetime_budget ? Number(data.lifetime_budget) : null,
    bid_strategy: data.bid_strategy || null,
    bid_amount: data.bid_amount ? Number(data.bid_amount) : null,
    optimization_goal: data.optimization_goal || null,
    billing_event: data.billing_event || null,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    attribution_spec: data.attribution_spec || [],
    promoted_object: data.promoted_object || {},
    targeting,
    updated_time: data.updated_time || null,
    meta: data,
  };
}

async function getEntity(level, id, context = {}) {
  const cfg = assertLevel(level);
  const data = await metaApi.metaGet(`/${id}`, { fields: cfg.readFields.join(',') }, context);
  return normalizeEntity(level, data);
}

function buildCampaignUpdatePayload(input = {}) {
  const payload = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.status !== undefined) payload.status = input.status;
  if (input.objective !== undefined) payload.objective = input.objective;
  if (input.buying_type !== undefined) payload.buying_type = input.buying_type;
  if (input.daily_budget !== undefined) payload.daily_budget = moneyToCents(input.daily_budget);
  if (input.lifetime_budget !== undefined) payload.lifetime_budget = moneyToCents(input.lifetime_budget);
  if (input.special_ad_categories !== undefined) payload.special_ad_categories = input.special_ad_categories || [];
  if (input.start_time !== undefined) payload.start_time = input.start_time || null;
  if (input.stop_time !== undefined) payload.stop_time = input.stop_time || null;
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  return payload;
}

function buildAdsetUpdatePayload(input = {}, currentTargeting = {}) {
  const payload = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.status !== undefined) payload.status = input.status;
  if (input.daily_budget !== undefined) payload.daily_budget = moneyToCents(input.daily_budget);
  if (input.lifetime_budget !== undefined) payload.lifetime_budget = moneyToCents(input.lifetime_budget);
  if (input.bid_strategy !== undefined) payload.bid_strategy = input.bid_strategy;
  if (input.bid_amount !== undefined) payload.bid_amount = moneyToCents(input.bid_amount);
  if (input.optimization_goal !== undefined) payload.optimization_goal = input.optimization_goal;
  if (input.billing_event !== undefined) payload.billing_event = input.billing_event;
  if (input.start_time !== undefined) payload.start_time = input.start_time || null;
  if (input.end_time !== undefined) payload.end_time = input.end_time || null;
  if (input.attribution_spec !== undefined) payload.attribution_spec = input.attribution_spec || [];
  if (input.promoted_object !== undefined) payload.promoted_object = input.promoted_object || {};

  if (input.targeting !== undefined) {
    const nextTargeting = { ...currentTargeting, ...input.targeting };
    if (input.targeting.genders && input.targeting.genders.length === 0) delete nextTargeting.genders;
    if (input.targeting.locales && input.targeting.locales.length === 0) delete nextTargeting.locales;
    if (input.targeting.custom_audiences) nextTargeting.custom_audiences = input.targeting.custom_audiences.map(id => ({ id }));
    if (input.targeting.excluded_custom_audiences) nextTargeting.excluded_custom_audiences = input.targeting.excluded_custom_audiences.map(id => ({ id }));
    if (input.targeting.interests) nextTargeting.flexible_spec = input.targeting.interests.length ? [{ interests: input.targeting.interests }] : [];
    payload.targeting = JSON.stringify(nextTargeting);
  }

  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  return payload;
}

async function updateEntity(accountId, level, id, rawInput = {}, performedBy = null, context = {}) {
  assertLevel(level);
  const resolvedAccountId = requireAccountId(accountId);
  const before = await getEntity(level, id, context);
  let payload;

  if (level === 'campaign') {
    payload = buildCampaignUpdatePayload(rawInput);
  } else {
    payload = buildAdsetUpdatePayload(rawInput, before.meta.targeting || {});
  }

  if (!Object.keys(payload).length) throw new Error('No editable fields provided');

  await metaApi.metaPost(`/${id}`, payload, context);
  const after = await getEntity(level, id, context);

  await logAction(resolvedAccountId, level, id, after.name || before.name || id, 'entity_update', {
    changed_fields: Object.keys(payload),
    before,
    after,
    internal_tags: rawInput.internal_tags || [],
    performed_by: performedBy,
  });

  return { success: true, level, id, before, after };
}

async function updateEntityStatus(accountId, level, id, status, performedBy = null, context = {}) {
  const resolvedAccountId = requireAccountId(accountId);
  const before = await getEntity(level, id, context);
  await metaApi.updateStatus(id, status, context);
  const after = await getEntity(level, id, context);
  await logAction(resolvedAccountId, level, id, after.name || before.name || id, 'status_change', {
    previous_status: before.status,
    new_status: status,
    performed_by: performedBy,
  });
  return { success: true, level, id, before, after };
}

async function duplicateEntity(accountId, level, id, performedBy = null, context = {}) {
  const resolvedAccountId = requireAccountId(accountId);
  const before = await getEntity(level, id, context);
  const result = await metaApi.duplicateEntity(id, level, context);
  await logAction(resolvedAccountId, level, id, before.name || id, 'duplicate', {
    source_id: id,
    result,
    performed_by: performedBy,
  });
  return { success: true, level, id, result };
}

module.exports = {
  getEntity,
  updateEntity,
  updateEntityStatus,
  duplicateEntity,
};
