const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { sendError } = require('../errorResponse');
const tracking = require('../services/trackingService');
const webhookSecurity = require('../services/webhookSecurityService');
const ghlConversation = require('../services/ghlConversationService');
const { ensureObject } = require('../validation');

const router = express.Router();

function timingSafeEq(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function verifyMetaSignature(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    return config.isProduction
      ? { ok: false, reason: 'secret_not_configured' }
      : { ok: true, reason: 'no_secret_configured' };
  }
  const provided = req.header('x-hub-signature-256');
  if (!provided) return { ok: false, reason: 'missing_signature' };
  if (!req.rawBody) return { ok: false, reason: 'no_raw_body' };
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return timingSafeEq(expected, provided) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

function verifyGhlSignature(req) {
  const secret = process.env.GHL_WEBHOOK_SECRET;
  if (!secret) {
    return config.isProduction
      ? { ok: false, reason: 'secret_not_configured' }
      : { ok: true, reason: 'no_secret_configured' };
  }
  const provided = req.header('x-wh-signature') || req.header('x-ghl-signature');
  if (!provided) return { ok: false, reason: 'missing_signature' };
  if (!req.rawBody) return { ok: false, reason: 'no_raw_body' };
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return timingSafeEq(expected, provided) || timingSafeEq(`sha256=${expected}`, provided)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

router.post('/ghl', async (req, res) => {
  const check = verifyGhlSignature(req);
  if (!check.ok) {
    console.warn(`[webhook] GHL signature rejected: ${check.reason}`);
    return res.status(check.reason === 'secret_not_configured' ? 503 : 401).json({ error: 'Invalid signature' });
  }
  if (check.reason === 'no_secret_configured') {
    console.warn('[webhook] GHL webhook accepted WITHOUT signature check — set GHL_WEBHOOK_SECRET to enforce.');
  }
  try {
    const body = ensureObject(req.body);
    const replay = await webhookSecurity.reserveRequest(req, 'ghl', body);
    if (!replay.accepted) {
      console.warn(`[webhook] GHL duplicate rejected: ${replay.event_id}`);
      return res.json({ success: true, duplicate: true });
    }
    const eventType = String(body.type || body.event || '').toLowerCase();
    if (eventType === 'inboundmessage' || eventType === 'inbound_message') {
      const result = await ghlConversation.processInboundMessage(body);
      return res.json({ success: true, kind: 'inbound_message', ...result });
    }
    if (eventType === 'outboundmessage' || eventType === 'outbound_message') {
      const result = await ghlConversation.processOutboundMessage(body);
      return res.json({ success: true, kind: 'outbound_message', ...result });
    }
    const visitor = await tracking.handleGhlWebhook(body);
    res.json({ success: true, client_id: visitor.client_id });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/meta-leads', async (req, res) => {
  const check = verifyMetaSignature(req);
  if (!check.ok) {
    console.warn(`[webhook] Meta signature rejected: ${check.reason}`);
    return res.status(check.reason === 'secret_not_configured' ? 503 : 401).json({ error: 'Invalid signature' });
  }
  if (check.reason === 'no_secret_configured') {
    console.warn('[webhook] Meta webhook accepted WITHOUT signature check — set META_APP_SECRET to enforce.');
  }
  // existing handler continues below
  try {
    const body = ensureObject(req.body);
    const replay = await webhookSecurity.reserveRequest(req, 'meta-leads', body);
    if (!replay.accepted) {
      console.warn(`[webhook] Meta duplicate rejected: ${replay.event_id}`);
      return res.json({ success: true, duplicate: true, count: 0 });
    }
    const entries = Array.isArray(body.entry) ? body.entry : [body];
    const results = [];
    let duplicates = 0;
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [entry];
      for (const change of changes) {
        const value = change.value || change;
        const eventId = value.leadgen_id || value.meta_lead_id || value.id;
        const itemReplay = await webhookSecurity.reserveExplicit('meta-lead-item', eventId, req);
        if (!itemReplay.accepted) {
          duplicates += 1;
          continue;
        }
        const visitor = await tracking.handleMetaLead({
          ...value,
          meta_lead_id: value.leadgen_id || value.meta_lead_id,
          campaign_id: value.campaign_id,
          adset_id: value.adset_id,
          ad_id: value.ad_id,
          raw: value,
        });
        results.push(visitor.client_id);
      }
    }
    res.json({ success: true, count: results.length, duplicates });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/meta-leads', (req, res) => {
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (config.isProduction && !verifyToken) {
    return res.status(503).send('Verify token not configured');
  }
  if (verifyToken && req.query['hub.verify_token'] !== verifyToken) {
    return res.status(403).send('Invalid verify token');
  }
  res.send(req.query['hub.challenge'] || 'ok');
});

module.exports = router;
module.exports.verifyMetaSignature = verifyMetaSignature;
module.exports.verifyGhlSignature = verifyGhlSignature;
