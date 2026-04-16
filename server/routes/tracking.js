const express = require('express');
const { sendError } = require('../errorResponse');
const tracking = require('../services/trackingService');
const { ensureNonEmptyString, ensureObject, optionalTrimmedString } = require('../validation');

const router = express.Router();

function setTrackCors(req, res, next) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
}

router.use(setTrackCors);

router.post('/pageview', async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const metaAccountId = ensureNonEmptyString(body.meta_account_id, 'meta_account_id required');
    const visitor = await tracking.recordEvent({
      ...body,
      meta_account_id: metaAccountId,
      event_name: optionalTrimmedString(body.event_name, 100) || 'PageView',
      metadata: {
        user_agent: req.headers['user-agent'] || null,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
      },
    });
    res.json({ success: true, client_id: visitor.client_id });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/event', async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const visitor = await tracking.recordEvent({
      ...body,
      meta_account_id: ensureNonEmptyString(body.meta_account_id, 'meta_account_id required'),
      event_name: ensureNonEmptyString(body.event_name, 'event_name required'),
    });
    res.json({ success: true, client_id: visitor.client_id });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
