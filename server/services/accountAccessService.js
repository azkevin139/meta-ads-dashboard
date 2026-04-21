const { queryOne } = require('../db');
const accountService = require('./accountService');

function forbidden(message = 'Account access denied') {
  const err = new Error(message);
  err.httpStatus = 403;
  return err;
}

async function hasExplicitAccess(userId, accountId) {
  const row = await queryOne(`
    SELECT 1
    FROM user_account_access
    WHERE user_id = $1 AND account_id = $2
    LIMIT 1
  `, [userId, accountId]);
  return Boolean(row);
}

async function resolveAuthorizedAccount(req, requestedAccountId = null, { allowAdminOverride = false } = {}) {
  const active = req.metaAccount || null;
  const requested = requestedAccountId ? parseInt(requestedAccountId, 10) : null;
  if (requested && (!Number.isInteger(requested) || requested <= 0)) throw forbidden('Invalid account id');

  if (!requested || requested === active?.id) {
    if (!active?.id) throw forbidden('No active account');
    return active;
  }

  if (req.user?.role === 'admin' && allowAdminOverride) {
    const account = await accountService.getAccountById(requested);
    if (!account) throw forbidden('Account not found');
    return account;
  }

  if (req.user?.id && await hasExplicitAccess(req.user.id, requested)) {
    const account = await accountService.getAccountById(requested);
    if (!account) throw forbidden('Account not found');
    return account;
  }

  throw forbidden();
}

async function assertCanSwitchToAccount(req, accountId) {
  return resolveAuthorizedAccount(req, accountId, { allowAdminOverride: true });
}

module.exports = {
  resolveAuthorizedAccount,
  assertCanSwitchToAccount,
};
