const express = require('express');
const { sendError } = require('../errorResponse');
const router = express.Router();
const metaUsage = require('../services/metaUsageService');
const entityService = require('../services/metaEntityService');
const accountAccess = require('../services/accountAccessService');
const metaScope = require('../services/metaScopeService');
const { ensureEnum, ensureInteger, ensureNonEmptyString, ensureObject } = require('../validation');

const ENTITY_LEVELS = ['campaign', 'adset', 'ad'];

function adminOrOperator(req, res, next) {
  if (!req.user || !['admin', 'operator'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Operator or admin access required' });
  }
  next();
}

async function ensureSafeWrite(req, res, account = req.metaAccount) {
  const usage = await metaUsage.fetchLiveStatus(false, account);
  if (!usage.safe_to_write) {
    res.status(429).json({ error: `Meta API write pressure is too high right now. Wait ${usage.estimated_regain_seconds || 0}s before trying again.` });
    return false;
  }
  return true;
}

router.get('/entity/:level/:id', async (req, res) => {
  try {
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const id = ensureNonEmptyString(req.params.id, 'id required');
    const scope = await metaScope.resolveAuthorizedMetaScope(req, metaScope.entityRequestForLevel(level, id));
    const data = await entityService.getEntity(level, id, scope.account);
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/update', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const account = await accountAccess.resolveAuthorizedAccount(req, body.accountId, { allowAdminOverride: true });
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const id = ensureNonEmptyString(req.params.id, 'id required');
    await metaScope.resolveAuthorizedMetaScope(req, {
      requestedAccountId: account.id,
      ...metaScope.entityRequestForLevel(level, id),
    });
    if (!(await ensureSafeWrite(req, res, account))) return;
    const result = await entityService.updateEntity(
      account.id,
      level,
      id,
      body,
      req.user?.email || req.user?.name || null,
      account
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/status', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const account = await accountAccess.resolveAuthorizedAccount(req, body.accountId, { allowAdminOverride: true });
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const id = ensureNonEmptyString(req.params.id, 'id required');
    await metaScope.resolveAuthorizedMetaScope(req, {
      requestedAccountId: account.id,
      ...metaScope.entityRequestForLevel(level, id),
    });
    if (!(await ensureSafeWrite(req, res, account))) return;
    const status = ensureNonEmptyString(body.status, 'status required');
    const result = await entityService.updateEntityStatus(
      account.id,
      level,
      id,
      status,
      req.user?.email || req.user?.name || null,
      account
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/entity/:level/:id/duplicate', adminOrOperator, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const account = await accountAccess.resolveAuthorizedAccount(req, body.accountId, { allowAdminOverride: true });
    const level = ensureEnum(req.params.level, ENTITY_LEVELS, 'Invalid entity level');
    const id = ensureNonEmptyString(req.params.id, 'id required');
    await metaScope.resolveAuthorizedMetaScope(req, {
      requestedAccountId: account.id,
      ...metaScope.entityRequestForLevel(level, id),
    });
    if (!(await ensureSafeWrite(req, res, account))) return;
    const result = await entityService.duplicateEntity(
      account.id,
      level,
      id,
      req.user?.email || req.user?.name || null,
      account
    );
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
