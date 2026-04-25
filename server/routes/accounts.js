const express = require('express');
const { sendError } = require('../errorResponse');
const accountService = require('../services/accountService');
const accountAccess = require('../services/accountAccessService');
const tokenHealth = require('../services/tokenHealthService');
const ghl = require('../services/ghlService');
const ghlMcp = require('../services/ghlMcpService');
const securityAudit = require('../services/securityAuditService');
const {
  ensureBoolean,
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
    securityAudit.fromRequest(req, {
      action: 'admin.denied',
      target_type: 'accounts_route',
      target_id: req.path,
      result: 'denied',
    });
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
    await securityAudit.fromRequest(req, {
      action: 'account.created_or_token_imported',
      target_type: 'account',
      target_id: String(account.id),
      account_id: account.id,
      after_json: account,
    });
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/discover', adminOnly, async (req, res) => {
  try {
    const body = ensureObject(req.body);
    const discovered = await accountService.discoverAccountsForToken(ensureNonEmptyString(body.token, 'token required'));
    await securityAudit.fromRequest(req, {
      action: 'account.token_discovered',
      target_type: 'account_token',
      after_json: { discovered_count: discovered.accounts?.length || 0 },
    });
    res.json(discovered);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/import', adminOnly, async (req, res) => {
  try {
    const imported = await accountService.importAccountsFromToken(ensureObject(req.body));
    await securityAudit.fromRequest(req, {
      action: 'account.token_imported',
      target_type: 'account',
      after_json: { imported_count: imported.length, accounts: imported },
    });
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
    await securityAudit.fromRequest(req, {
      action: 'account.metadata_synced',
      target_type: 'account',
      target_id: accountId ? String(accountId) : 'all',
      account_id: accountId,
      after_json: result,
    });
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
    await securityAudit.fromRequest(req, {
      action: 'account.token_checked',
      target_type: 'account',
      target_id: String(accountId),
      account_id: accountId,
      after_json: result,
    });
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
    await securityAudit.fromRequest(req, {
      action: 'ghl.credentials_saved',
      target_type: 'account',
      target_id: String(accountId),
      account_id: accountId,
      after_json: { locationId, configured: true },
    });
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/:id/ghl', adminOnly, async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    await ghl.clearGhlCredentials(accountId);
    await securityAudit.fromRequest(req, {
      action: 'ghl.credentials_deleted',
      target_type: 'account',
      target_id: String(accountId),
      account_id: accountId,
    });
    res.json({ success: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/ghl/sync', adminOnly, async (req, res) => {
  try {
    const body = ensureObject(req.body || {});
    const accountId = parseInt(req.params.id, 10);
    const result = await ghl.syncAccountById(accountId, {
      mode: body.mode ? ensureEnum(body.mode, ['incremental', 'full', 'range'], 'mode must be incremental, full, or range') : 'incremental',
      sinceOverride: body.since ? ensureNonEmptyString(body.since, 'since must be a non-empty string') : undefined,
      untilOverride: body.until ? ensureNonEmptyString(body.until, 'until must be a non-empty string') : undefined,
      maxPages: optionalInteger(body.maxPages, 'maxPages must be a positive integer'),
    });
    await securityAudit.fromRequest(req, {
      action: 'ghl.sync_triggered',
      target_type: 'account',
      target_id: String(accountId),
      account_id: accountId,
      after_json: { options: body, result },
    });
    res.json({ success: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id/mcp-status', adminOnly, async (req, res) => {
  try {
    const status = await ghlMcp.getConnectionStatus(parseInt(req.params.id, 10));
    res.json(status);
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:id/mcp-config', adminOnly, async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const body = ensureObject(req.body || {});
    const result = await ghlMcp.saveConfig(accountId, {
      enabled: body.enabled === undefined ? undefined : ensureBoolean(body.enabled, 'enabled must be true or false'),
      mode: body.mode === undefined ? undefined : ensureEnum(body.mode, ['disabled', 'read_only'], 'mode must be disabled or read_only'),
    });
    await securityAudit.fromRequest(req, {
      action: 'ghl_mcp.config_saved',
      target_type: 'account',
      target_id: String(accountId),
      account_id: accountId,
      after_json: {
        enabled: result.enabled,
        mode: result.mode,
        location_id: result.location_id,
      },
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/mcp-test', adminOnly, async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const result = await ghlMcp.testConnection(accountId);
    await securityAudit.fromRequest(req, {
      action: 'ghl_mcp.test_triggered',
      target_type: 'account',
      target_id: String(accountId),
      account_id: accountId,
      after_json: {
        status: result.status,
        reason_code: result.reason_code,
        available_tools: result.available_tools,
        missing_tools: result.missing_tools,
      },
    });
    res.json({ success: true, data: result });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/product-mode', adminOnly, async (req, res) => {
  try {
    const accountId = parseInt(req.params.id, 10);
    const body = ensureObject(req.body || {});
    const account = await accountService.updateProductMode(accountId, {
      productMode: body.product_mode ? ensureEnum(body.product_mode, ['general', 'lead_gen'], 'product_mode must be general or lead_gen') : 'general',
      fastSyncEnabled: body.fast_sync_enabled === undefined ? undefined : ensureBoolean(body.fast_sync_enabled, 'fast_sync_enabled must be true or false'),
    });
    await securityAudit.fromRequest(req, {
      action: 'account.product_mode_changed',
      target_type: 'account',
      target_id: String(account.id),
      account_id: account.id,
      after_json: {
        product_mode: account.product_mode,
        fast_sync_enabled: account.fast_sync_enabled,
      },
    });
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/default', adminOnly, async (req, res) => {
  try {
    const account = await accountService.setDefaultAccount(parseInt(req.params.id, 10));
    await securityAudit.fromRequest(req, {
      action: 'account.default_changed',
      target_type: 'account',
      target_id: String(account.id),
      account_id: account.id,
      after_json: account,
    });
    res.json({ success: true, data: account });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
