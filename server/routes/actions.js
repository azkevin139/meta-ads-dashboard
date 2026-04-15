const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const actionService = require('../services/actionService');
const metaUsage = require('../services/metaUsageService');

// Role guard — only operators and admins can make changes
function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

async function ensureSafeWrite(req, res) {
  const usage = await metaUsage.fetchLiveStatus(false, req.metaAccount);
  if (!usage.safe_to_write) {
    res.status(429).json({ error: `Meta API write pressure is too high right now. Wait ${usage.estimated_regain_seconds || 0}s before trying again.` });
    return false;
  }
  return true;
}

// POST /api/actions/pause
// Body: { accountId, entityType, metaEntityId }
router.post('/pause', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const { accountId, entityType, metaEntityId } = req.body;
    if (!entityType || !metaEntityId) {
      return res.status(400).json({ error: 'entityType and metaEntityId required' });
    }
    const result = await actionService.pauseEntity(accountId || 1, entityType, metaEntityId, req.metaAccount);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/actions/resume
router.post('/resume', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const { accountId, entityType, metaEntityId } = req.body;
    if (!entityType || !metaEntityId) {
      return res.status(400).json({ error: 'entityType and metaEntityId required' });
    }
    const result = await actionService.resumeEntity(accountId || 1, entityType, metaEntityId, req.metaAccount);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/actions/budget
// Body: { accountId, metaAdSetId, newBudget (in dollars, not cents) }
router.post('/budget', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const { accountId, metaAdSetId, newBudget } = req.body;
    if (!metaAdSetId || newBudget === undefined) {
      return res.status(400).json({ error: 'metaAdSetId and newBudget required' });
    }
    const result = await actionService.updateBudget(accountId || 1, metaAdSetId, parseFloat(newBudget), req.metaAccount);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/actions/duplicate
// Body: { accountId, entityType, metaEntityId }
router.post('/duplicate', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const { accountId, entityType, metaEntityId } = req.body;
    if (!entityType || !metaEntityId) {
      return res.status(400).json({ error: 'entityType and metaEntityId required' });
    }
    const result = await actionService.duplicateEntity(accountId || 1, entityType, metaEntityId, req.metaAccount);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
