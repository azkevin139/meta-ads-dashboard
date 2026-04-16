const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const metaUsage = require('../services/metaUsageService');
const entityService = require('../services/metaEntityService');
const { ensureEnum, ensureInteger, ensureNonEmptyString, ensureObject } = require('../validation');

const ENTITY_LEVELS = ['campaign', 'adset', 'ad'];

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
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const data = await entityService.getEntity(level, ensureNonEmptyString(req.params.id, 'id required'), req.metaAccount);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/update', adminOrOperator, async (req, res) => {
  try {
    if (!(await ensureSafeWrite(req, res))) return;
    const body = ensureObject(req.body);
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const result = await entityService.updateEntity(
      body.accountId || 1,
      level,
      ensureNonEmptyString(req.params.id, 'id required'),
      body,
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
    const body = ensureObject(req.body);
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const status = ensureNonEmptyString(body.status, 'status required');
    const result = await entityService.updateEntityStatus(
      body.accountId || 1,
      level,
      ensureNonEmptyString(req.params.id, 'id required'),
      status,
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
    const body = ensureObject(req.body);
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const result = await entityService.duplicateEntity(
      body.accountId || 1,
      level,
      ensureNonEmptyString(req.params.id, 'id required'),
      req.user?.email || req.user?.name || null,
      req.metaAccount
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
