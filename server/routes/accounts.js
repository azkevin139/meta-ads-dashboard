const express = require('express');
const { sendError } = require('../errorResponse');
const accountService = require('../services/accountService');
const accountAccess = require('../services/accountAccessService');
const tokenHealth = require('../services/tokenHealthService');
const ghl = require('../services/ghlService');
const {
  ensureInteger,
  ensureEnum,
  ensureNonEmptyString,
  ensureObject,
  optionalInteger,
  optionalTrimmedString,
} = require('../validation');

const router = express.Router();

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

router.get('/', async (req, res) => {
  try {
    const accounts = await accountService.listAccounts();
    res.json({
      data: accounts,
      active: accountService.publicAccount(req.metaAccount),
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/active', async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const accountId = ensureInteger(body.accountId, 'accountId required');
    await accountAccess.assertCanSwitchToAccount(req, accountId);
    const account = await accountService.updateSessionAccount(req.user.session_token_hash, accountId);
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/', adminOnly, async (req, res) => {
  try {
    const account = await accountService.createAccount(req.body);
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/discover', adminOnly, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const discovered = await accountService.discoverAccountsForToken(ensureNonEmptyString(body.token, 'token required'));
    res.json(discovered);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/import', adminOnly, async (req, res) => {
  try {
    const imported = await accountService.importAccountsFromToken(ensureObject(req.body));
    res.json({ success: true, data: imported });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/sync-metadata', adminOnly, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const accountId = body.accountId ? ensureInteger(body.accountId, 'accountId must be a positive integer') : null;
    const result = await accountService.refreshAccountMetadata(accountId);
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/token-health', async (req, res) => {
  try {
    const rows = await tokenHealth.getAccountsHealthSummary();
    const data = rows.map(row => ({
      id: row.id,
      meta_account_id: row.meta_account_id,
      label: row.label || row.name,
      is_active: row.is_active,
      token_last4: row.token_last4,
      expires_at: row.token_expires_at,
      checked_at: row.token_checked_at,
      is_system_user: row.token_is_system_user,
      scopes: row.token_scopes || [],
      last_error: row.token_last_error,
      days_until_expiry: tokenHealth.daysUntil(row.token_expires_at),
      status: tokenHealth.warningLevel(row),
    }));
    res.json({ data });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/token-check', adminOnly, async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const row = await require('../db').queryOne(
      'SELECT id, meta_account_id, access_token, encrypted_token FROM accounts WHERE id = $1',
      [accountId]
    );
    if (!row) return res.status(404).json({ error: 'Account not found' });
    const result = await tokenHealth.checkAccount(row);
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id/ghl', adminOnly, async (req, res) => {
  try {
    const status = await ghl.getStatus(parseInt(req.params.id, 10));
    if (!status) return res.status(404).json({ error: 'Account not found' });
    res.json(status);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/ghl', adminOnly, async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const body = ensureObject(req.body);
    const apiKey = ensureNonEmptyString(body.apiKey, 'apiKey required');
    const locationId = ensureNonEmptyString(body.locationId, 'locationId required');
    const result = await ghl.saveGhlCredentials(accountId, { apiKey, locationId });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/:id/ghl', adminOnly, async (req, res) => {
  try {
    await ghl.clearGhlCredentials(parseInt(req.params.id, 10));
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/ghl/sync', adminOnly, async (req, res) => {
  try {
    const body = ensureObject(req.body || {});
    const result = await ghl.syncAccountById(parseInt(req.params.id, 10), {
      mode: body.mode ? ensureEnum(body.mode, ['incremental', 'full', 'range'], 'mode must be incremental, full, or range') : 'incremental',
      sinceOverride: body.since ? ensureNonEmptyString(body.since, 'since must be a non-empty string') : undefined,
      untilOverride: body.until ? ensureNonEmptyString(body.until, 'until must be a non-empty string') : undefined,
      maxPages: optionalInteger(body.maxPages, 'maxPages must be a positive integer'),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/default', adminOnly, async (req, res) => {
  try {
    const account = await accountService.setDefaultAccount(parseInt(req.params.id, 10));
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
