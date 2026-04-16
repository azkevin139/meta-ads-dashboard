const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const intelligence = require('../services/intelligenceService');
const tracking = require('../services/trackingService');
const audiencePush = require('../services/audiencePushService');
const {
  ensureBoolean,
  ensureInteger,
  ensureNonEmptyString,
  ensureObject,
  optionalInteger,
  optionalTrimmedString,
} = require('../validation');

function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

router.get('/account-context', async (req, res) => {
  try {
    res.json(await intelligence.getAccountContext(req.metaAccount));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/targets', async (req, res) => {
  try {
    res.json({ data: intelligence.readTargets(), defaults: intelligence.DEFAULT_TARGETS });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/targets', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const current = intelligence.readTargets();
    const next = {
      account: { ...current.account, ...(body.account || {}) },
      campaigns: { ...current.campaigns, ...(body.campaigns || {}) },
    };
    res.json({ data: intelligence.writeTargets(next) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/rules', async (req, res) => {
  try {
    res.json(await intelligence.getDecisionRules(req.query, req.metaAccount));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/funnel', async (req, res) => {
  try {
    res.json({ data: await intelligence.getFunnel(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/first-party-funnel', async (req, res) => {
  try {
    res.json({ data: await intelligence.getFirstPartyFunnel(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/journey', async (req, res) => {
  try {
    res.json({ data: await intelligence.getJourney(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/contact', async (req, res) => {
  try {
    const detail = await intelligence.getContactDetail(req.query, req.metaAccount);
    if (!detail) return res.status(404).json({ error: 'Contact not found' });
    res.json({ data: detail });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/true-roas', async (req, res) => {
  try {
    res.json({ data: await intelligence.getTrueRoas(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audience-health', async (req, res) => {
  try {
    res.json({ data: await intelligence.getAudienceHealth(req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audience-segments', async (req, res) => {
  try {
    res.json(await intelligence.getAudienceSegments(req.query, req.metaAccount));
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/breakdowns', async (req, res) => {
  try {
    res.json({ data: await intelligence.getBreakdowns(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/audience-pushes', async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.json({ data: [] });
    const rows = await audiencePush.listPushes(accountId);
    res.json({ data: rows });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/audience-push', adminOrOperator, async (req, res) => {
  try {
    const account = req.metaAccount;
    if (!account?.id) return res.status(400).json({ error: 'No active account' });
    const body = ensureObject(req.body);
    const segmentKey = ensureNonEmptyString(body.segmentKey, 'segmentKey required');
    const segmentName = optionalTrimmedString(body.segmentName, 200);
    const result = await audiencePush.pushSegment(account, { segmentKey, segmentName });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/audience-push/:id/auto-refresh', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    await audiencePush.setAutoRefresh(
      ensureInteger(req.params.id, 'id must be a positive integer'),
      ensureBoolean(body.enabled, 'enabled must be true or false'),
      optionalInteger(body.hours, 'hours must be a positive integer')
    );
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/tracking-health', async (req, res) => {
  try {
    const accountId = req.query.accountId || req.metaAccount?.id || null;
    const health = await tracking.getHealth(accountId);
    res.json(health);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/creative-library', async (req, res) => {
  try {
    res.json({ data: await intelligence.getCreativeLibrary(req.query, req.metaAccount) });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
