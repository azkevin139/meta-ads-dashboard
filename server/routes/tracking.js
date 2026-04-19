const express = require('express');
const { sendError } = require('../errorResponse');
const tracking = require('../services/trackingService');
const diagnostics = require('../services/trackingDiagnosticsService');
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
  let metaAccountId = null;
  let accountId = null;
  try {
    const body = ensureObject(req.body);
    metaAccountId = ensureNonEmptyString(body.meta_account_id, 'meta_account_id required');
    diagnostics.recordAttempt({ metaAccountId, pageUrl: body.page_url });
    const visitor = await tracking.recordEvent({
      ...body,
      meta_account_id: metaAccountId,
      event_name: optionalTrimmedString(body.event_name, 100) || 'PageView',
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
    const body = ensureObject(req.body);
    metaAccountId = ensureNonEmptyString(body.meta_account_id, 'meta_account_id required');
    diagnostics.recordAttempt({ metaAccountId, pageUrl: body.page_url });
    const visitor = await tracking.recordEvent({
      ...body,
      meta_account_id: metaAccountId,
      event_name: ensureNonEmptyString(body.event_name, 'event_name required'),
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
