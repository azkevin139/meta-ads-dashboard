const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const intelligence = require('../services/intelligenceService');

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
    const current = intelligence.readTargets();
    const next = {
      account: { ...current.account, ...(req.body.account || {}) },
      campaigns: { ...current.campaigns, ...(req.body.campaigns || {}) },
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

router.get('/breakdowns', async (req, res) => {
  try {
    res.json({ data: await intelligence.getBreakdowns(req.query, req.metaAccount) });
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
