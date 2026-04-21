const crypto = require('crypto');
const { queryOne } = require('../db');

const FRESHNESS_WINDOW_MS = 5 * 60 * 1000;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function payloadHash(req) {
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function header(req, name) {
  return clean(req.header(name));
}

function getSentAt(req) {
  return header(req, 'x-adcommand-sent-at') ||
    header(req, 'x-webhook-timestamp') ||
    header(req, 'x-ghl-timestamp');
}

function assertFreshIfPresent(req) {
  const sentAt = getSentAt(req);
  if (!sentAt) return;
  const time = Date.parse(sentAt);
  if (!Number.isFinite(time)) {
    const err = new Error('Invalid webhook timestamp');
    err.httpStatus = 401;
    throw err;
  }
  if (Math.abs(Date.now() - time) > FRESHNESS_WINDOW_MS) {
    const err = new Error('Stale webhook event');
    err.httpStatus = 401;
    throw err;
  }
}

function providerEventId(req, source, body = {}) {
  const explicit = header(req, 'x-adcommand-event-id') ||
    header(req, 'x-webhook-event-id') ||
    header(req, 'x-ghl-event-id') ||
    header(req, 'x-wh-event-id') ||
    header(req, 'x-hub-delivery') ||
    clean(body.eventId) ||
    clean(body.event_id) ||
    clean(body.id);
  if (explicit) return explicit;
  return `${source}:${payloadHash(req)}`;
}

async function reserve(source, eventId, hash) {
  const row = await queryOne(`
    INSERT INTO webhook_event_ledger (source, event_id, payload_hash)
    VALUES ($1, $2, $3)
    ON CONFLICT (source, event_id) DO NOTHING
    RETURNING id
  `, [source, eventId, hash]);
  return Boolean(row);
}

async function reserveRequest(req, source, body = {}) {
  assertFreshIfPresent(req);
  const eventId = providerEventId(req, source, body);
  const hash = payloadHash(req);
  const accepted = await reserve(source, eventId, hash);
  return { accepted, event_id: eventId, payload_hash: hash };
}

async function reserveExplicit(source, eventId, req) {
  const id = clean(eventId);
  if (!id) return { accepted: true, event_id: null };
  assertFreshIfPresent(req);
  const hash = payloadHash(req);
  const accepted = await reserve(source, id, hash);
  return { accepted, event_id: id, payload_hash: hash };
}

module.exports = {
  reserveRequest,
  reserveExplicit,
  assertFreshIfPresent,
};
