const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const metaUsage = require('../services/metaUsageService');
const entityService = require('../services/metaEntityService');

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

router.get('/entity/:level/:id', async (req, res) => {
  try {
    const data = await entityService.getEntity(req.params.level, req.params.id, req.metaAccount);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/update', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const result = await entityService.updateEntity(
      req.body.accountId || 1,
      req.params.level,
      req.params.id,
      req.body,
      req.user?.email || req.user?.name || null,
      req.metaAccount
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/status', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    if (!req.body.status) return res.status(400).json({ error: 'status required' });
    const result = await entityService.updateEntityStatus(
      req.body.accountId || 1,
      req.params.level,
      req.params.id,
      req.body.status,
      req.user?.email || req.user?.name || null,
      req.metaAccount
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/duplicate', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const result = await entityService.duplicateEntity(
      req.body.accountId || 1,
      req.params.level,
      req.params.id,
      req.user?.email || req.user?.name || null,
      req.metaAccount
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
