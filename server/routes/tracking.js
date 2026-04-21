const express = require('express');
const { sendError } = require('../errorResponse');
const tracking = require('../services/trackingService');
const diagnostics = require('../services/trackingDiagnosticsService');
const trackingSecurity = require('../services/trackingSecurityService');
const { ensureObject } = require('../validation');

const router = express.Router();
let rateLimit;
try { rateLimit = require('express-rate-limit'); } catch (_err) { rateLimit = null; }

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
if (rateLimit) {
  router.use(rateLimit({
    windowMs: 60 * 1000,
    max: parseInt(process.env.TRACKING_IP_RATE_LIMIT_PER_MINUTE || '', 10) || 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Tracking rate limit exceeded' },
  }));
}

router.post('/pageview', async (req, res) => {
  let metaAccountId = null;
  let accountId = null;
  try {
    ensureObject(req.body);
    const body = await trackingSecurity.validateRequest(req);
    metaAccountId = body.meta_account_id;
    diagnostics.recordAttempt({ metaAccountId, pageUrl: body.page_url });
    const visitor = await tracking.recordEvent({
      ...body,
      meta_account_id: metaAccountId,
      event_name: body.event_name || 'PageView',
      metadata: {
        user_agent: req.headers['user-agent'] || null,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
      },
    });
    accountId = visitor.account_id || null;
    diagnostics.recordSuccess({ metaAccountId, accountId, status: 200, pageUrl: body.page_url });
    console.info('[tracking.pageview]', JSON.stringify({
      meta_account_id: metaAccountId,
      account_id: accountId,
      status: 200,
      client_id: visitor.client_id,
      page_url: body.page_url || null,
    }));
    res.json({ success: true, client_id: visitor.client_id });
  } catch (err) {
    diagnostics.recordFailure({
      metaAccountId,
      accountId,
      status: 400,
      error: err.message,
      pageUrl: req.body && req.body.page_url,
    });
    console.error('[tracking.pageview]', JSON.stringify({
      meta_account_id: metaAccountId,
      account_id: accountId,
      status: 400,
      error: err.message,
      page_url: req.body && req.body.page_url || null,
    }));
    sendError(res, err);
  }
});

router.post('/event', async (req, res) => {
  let metaAccountId = null;
  let accountId = null;
  try {
    ensureObject(req.body);
    const body = await trackingSecurity.validateRequest(req, { requireEventName: true });
    metaAccountId = body.meta_account_id;
    diagnostics.recordAttempt({ metaAccountId, pageUrl: body.page_url });
    const visitor = await tracking.recordEvent({
      ...body,
      meta_account_id: metaAccountId,
      event_name: body.event_name,
    });
    accountId = visitor.account_id || null;
    diagnostics.recordSuccess({ metaAccountId, accountId, status: 200, pageUrl: body.page_url });
    res.json({ success: true, client_id: visitor.client_id });
  } catch (err) {
    diagnostics.recordFailure({
      metaAccountId,
      accountId,
      status: 400,
      error: err.message,
      pageUrl: req.body && req.body.page_url,
    });
    sendError(res, err);
  }
});

module.exports = router;
