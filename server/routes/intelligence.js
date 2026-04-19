const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const intelligence = require('../services/intelligenceService');
const tracking = require('../services/trackingService');
const trackingRecovery = require('../services/trackingRecoveryService');
const audiencePush = require('../services/audiencePushService');
const touchSequences = require('../services/touchSequenceService');
const {
  ensureArray,
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

router.get('/touch-sequences', async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.json({ data: [], defaults: touchSequences.DEFAULT_SEVEN_TOUCH_TEMPLATE });
    const data = await touchSequences.listSequences(accountId);
    res.json({ data, defaults: touchSequences.DEFAULT_SEVEN_TOUCH_TEMPLATE });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/touch-sequences', adminOrOperator, async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.status(400).json({ error: 'No active account' });
    const body = ensureObject(req.body);
    const steps = ensureArray(body.steps, 'steps required');
    const result = await touchSequences.saveSequence(accountId, {
      id: body.id,
      name: ensureNonEmptyString(body.name, 'name required'),
      description: optionalTrimmedString(body.description, 1000),
      threshold_default: body.threshold_default,
      n8n_webhook_url: optionalTrimmedString(body.n8n_webhook_url, 2000),
      enabled: body.enabled,
      steps,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/touch-sequences/:id', adminOrOperator, async (req, res) => {
  try {
    const accountId = req.metaAccount?.id;
    if (!accountId) return res.status(400).json({ error: 'No active account' });
    await touchSequences.deleteSequence(accountId, ensureInteger(req.params.id, 'id must be a positive integer'));
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/touch-sequences/run-monitor', adminOrOperator, async (req, res) => {
  try {
    const account = req.metaAccount;
    if (!account?.id) return res.status(400).json({ error: 'No active account' });
    const result = await touchSequences.runMonitorForAccount(account);
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/touch-sequences/:id/run-monitor', adminOrOperator, async (req, res) => {
  try {
    const account = req.metaAccount;
    if (!account?.id) return res.status(400).json({ error: 'No active account' });
    const result = await touchSequences.runMonitorForSequence(account, ensureInteger(req.params.id, 'id must be a positive integer'));
    res.json({ success: true, data: result });
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

router.get('/tracking-recovery', async (req, res) => {
  try {
    const accountId = req.query.accountId || req.metaAccount?.id || null;
    if (!accountId) return res.json({ outage_window: null, buckets: [], note: 'No active account' });
    const summary = await trackingRecovery.getSummary(parseInt(accountId, 10));
    res.json(summary);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tracking-recovery', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const accountId = body.accountId ? ensureInteger(body.accountId, 'accountId must be a positive integer') : req.metaAccount?.id;
    if (!accountId) return res.status(400).json({ error: 'No active account' });
    const saved = await trackingRecovery.saveWindow(accountId, {
      outage_start: ensureNonEmptyString(body.outage_start, 'outage_start required'),
      outage_end: ensureNonEmptyString(body.outage_end, 'outage_end required'),
      notes: optionalTrimmedString(body.notes, 1000),
    });
    res.json({ success: true, data: saved });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/tracking-recovery/backfill', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const accountId = body.accountId ? ensureInteger(body.accountId, 'accountId must be a positive integer') : req.metaAccount?.id;
    if (!accountId) return res.status(400).json({ error: 'No active account' });
    const window = await trackingRecovery.saveWindow(accountId, {
      outage_start: ensureNonEmptyString(body.outage_start, 'outage_start required'),
      outage_end: ensureNonEmptyString(body.outage_end, 'outage_end required'),
      notes: optionalTrimmedString(body.notes, 1000),
    });
    const result = await trackingRecovery.runBackfill(accountId, window);
    res.json({ success: true, data: result });
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
