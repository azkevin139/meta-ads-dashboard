const { queryOne } = require('../db');
const { badRequest } = require('../validation');

const accountWindows = new Map();
const ACCOUNT_LIMIT_PER_MINUTE = parseInt(process.env.TRACKING_ACCOUNT_RATE_LIMIT_PER_MINUTE || '', 10) || 3000;
const MAX_PAYLOAD_BYTES = parseInt(process.env.TRACKING_MAX_PAYLOAD_BYTES || '', 10) || 20 * 1024;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function limitedString(value, field, maxLen, { required = false } = {}) {
  const text = clean(value);
  if (!text) {
    if (required) throw badRequest(`${field} required`);
    return undefined;
  }
  if (text.length > maxLen) throw badRequest(`${field} too long`);
  return text;
}

function validateMetaAccountId(value) {
  const text = limitedString(value, 'meta_account_id', 64, { required: true });
  if (!/^act_\d+$/.test(text)) throw badRequest('meta_account_id invalid');
  return text;
}

function validateUrl(value, field) {
  const text = limitedString(value, field, 2000);
  if (!text) return undefined;
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_err) {
    throw badRequest(`${field} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw badRequest(`${field} must be http or https`);
  return text;
}

function normalizePayload(body = {}, { requireEventName = false } = {}) {
  const eventName = limitedString(body.event_name, 'event_name', 100, { required: requireEventName });
  if (eventName && !/^[A-Za-z0-9_ .:-]+$/.test(eventName)) throw badRequest('event_name invalid');

  return {
    meta_account_id: validateMetaAccountId(body.meta_account_id),
    client_id: limitedString(body.client_id, 'client_id', 128, { required: true }),
    event_name: eventName,
    page_url: validateUrl(body.page_url, 'page_url'),
    landing_page: validateUrl(body.landing_page, 'landing_page'),
    page_title: limitedString(body.page_title, 'page_title', 300),
    referrer: validateUrl(body.referrer, 'referrer'),
    fbclid: limitedString(body.fbclid, 'fbclid', 500),
    fbc: limitedString(body.fbc, 'fbc', 500),
    fbp: limitedString(body.fbp, 'fbp', 500),
    utm_source: limitedString(body.utm_source, 'utm_source', 300),
    utm_medium: limitedString(body.utm_medium, 'utm_medium', 300),
    utm_campaign: limitedString(body.utm_campaign, 'utm_campaign', 300),
    utm_content: limitedString(body.utm_content, 'utm_content', 300),
    utm_term: limitedString(body.utm_term, 'utm_term', 300),
    ad_id: limitedString(body.ad_id, 'ad_id', 100),
    adset_id: limitedString(body.adset_id, 'adset_id', 100),
    campaign_id: limitedString(body.campaign_id, 'campaign_id', 100),
    value: body.value,
    currency: limitedString(body.currency, 'currency', 10),
  };
}

function originFromHeader(value) {
  const text = clean(value);
  if (!text) return null;
  try {
    return new URL(text).origin;
  } catch (_err) {
    return null;
  }
}

function payloadSize(req) {
  if (req.rawBody) return req.rawBody.length;
  try {
    return Buffer.byteLength(JSON.stringify(req.body || {}));
  } catch (_err) {
    return 0;
  }
}

async function getAccountSecurity(metaAccountId) {
  return queryOne(
    'SELECT id, meta_account_id, tracking_allowed_origins FROM accounts WHERE meta_account_id = $1',
    [metaAccountId]
  );
}

function checkPayloadSize(req) {
  if (payloadSize(req) > MAX_PAYLOAD_BYTES) throw badRequest('tracking payload too large');
}

function checkAccountRate(metaAccountId) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const current = accountWindows.get(metaAccountId);
  const next = !current || now - current.startedAt >= windowMs
    ? { startedAt: now, count: 1 }
    : { startedAt: current.startedAt, count: current.count + 1 };
  accountWindows.set(metaAccountId, next);
  if (next.count > ACCOUNT_LIMIT_PER_MINUTE) {
    const err = new Error('Tracking rate limit exceeded');
    err.httpStatus = 429;
    throw err;
  }
}

async function checkOrigin(metaAccountId, originHeader) {
  const account = await getAccountSecurity(metaAccountId);
  const allowed = Array.isArray(account?.tracking_allowed_origins)
    ? account.tracking_allowed_origins.map(originFromHeader).filter(Boolean)
    : [];
  if (!allowed.length) {
    if (!originHeader) console.warn(`[tracking] no origin header for ${metaAccountId}; origin allowlist not configured`);
    return account;
  }

  const origin = originFromHeader(originHeader);
  if (!origin || !allowed.includes(origin)) {
    const err = new Error('Origin not allowed for tracking account');
    err.httpStatus = 403;
    throw err;
  }
  return account;
}

async function validateRequest(req, { requireEventName = false } = {}) {
  checkPayloadSize(req);
  const payload = normalizePayload(req.body, { requireEventName });
  checkAccountRate(payload.meta_account_id);
  await checkOrigin(payload.meta_account_id, req.headers.origin);
  return payload;
}

module.exports = {
  validateRequest,
  normalizePayload,
  originFromHeader,
};
