const metaApi = require('./metaApi');
const accountService = require('./accountService');
const { query, queryAll } = require('../db');

const SYSTEM_USER_TYPES = new Set(['SYSTEM_USER', 'SYSTEM_USER_APP']);

// Meta's /debug_token endpoint tells you:
//   - data.expires_at (0 if long-lived / never expires)
//   - data.data_access_expires_at
//   - data.scopes (permissions)
//   - data.type (USER | SYSTEM_USER | PAGE | APP)
//   - data.is_valid
async function inspectToken(token) {
  if (!token) throw new Error('token required');
  // debug_token needs an app access token; Meta accepts the same user token as the inspector.
  const url = `https://graph.facebook.com/v21.0/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`;
  const fetch = require('node-fetch');
  const res = await fetch(url);
  const body = await res.json();
  if (body.error) {
    const err = new Error(body.error.message);
    err.code = body.error.code;
    throw err;
  }
  return body.data || {};
}

function normaliseExpiry(raw) {
  if (!raw || Number(raw) === 0) return null; // Meta returns 0 for long-lived / never
  const ms = Number(raw) * 1000;
  return new Date(ms);
}

async function checkAccount(accountRow) {
  const token = accountRow.access_token || accountService.decryptToken(accountRow.encrypted_token);
  if (!token) {
    await query(`
      UPDATE accounts
      SET token_checked_at = NOW(),
          token_last_error = 'No stored token'
      WHERE id = $1
    `, [accountRow.id]);
    return { account_id: accountRow.id, error: 'No stored token' };
  }

  try {
    const info = await inspectToken(token);
    const expiresAt = normaliseExpiry(info.expires_at);
    const dataExpires = normaliseExpiry(info.data_access_expires_at);
    const isSystemUser = SYSTEM_USER_TYPES.has(String(info.type || '').toUpperCase());

    await query(`
      UPDATE accounts
      SET token_expires_at = $2,
          token_checked_at = NOW(),
          token_scopes = $3,
          token_is_system_user = $4,
          token_last_error = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [
      accountRow.id,
      expiresAt,
      JSON.stringify(info.scopes || []),
      isSystemUser,
    ]);

    return {
      account_id: accountRow.id,
      meta_account_id: accountRow.meta_account_id,
      expires_at: expiresAt,
      data_access_expires_at: dataExpires,
      is_system_user: isSystemUser,
      is_valid: info.is_valid !== false,
      scopes: info.scopes || [],
      app_id: info.app_id || null,
      type: info.type || null,
    };
  } catch (err) {
    await query(`
      UPDATE accounts
      SET token_checked_at = NOW(),
          token_last_error = $2
      WHERE id = $1
    `, [accountRow.id, err.message || String(err)]);
    return { account_id: accountRow.id, error: err.message };
  }
}

async function checkAllAccounts() {
  const rows = await queryAll('SELECT id, meta_account_id, access_token, encrypted_token FROM accounts ORDER BY id');
  const results = [];
  for (const row of rows) {
    results.push(await checkAccount(row));
  }
  return results;
}

async function getAccountsHealthSummary() {
  return queryAll(`
    SELECT id, meta_account_id, label, name, is_active,
           token_expires_at, token_checked_at, token_is_system_user,
           token_scopes, token_last_error, token_last4
    FROM accounts
    ORDER BY is_active DESC, id
  `);
}

function daysUntil(timestamp) {
  if (!timestamp) return null;
  const diff = new Date(timestamp).getTime() - Date.now();
  return Math.ceil(diff / (24 * 3600 * 1000));
}

function warningLevel(row) {
  if (row.token_last_error) return 'error';
  if (row.token_is_system_user) return 'ok';
  if (!row.token_expires_at) return 'ok';
  const days = daysUntil(row.token_expires_at);
  if (days === null) return 'ok';
  if (days <= 3) return 'critical';
  if (days <= 14) return 'warning';
  return 'ok';
}

function startBackgroundCheck({ intervalMs = 24 * 3600 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await checkAllAccounts();
      const expiring = results.filter(r => r.expires_at && daysUntil(r.expires_at) <= 14);
      if (expiring.length) {
        console.warn(`[tokenHealth] ${expiring.length} Meta token(s) expiring within 14 days`);
      }
    } catch (err) {
      console.error(`[tokenHealth] check failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  // First run 2 minutes after boot.
  setTimeout(run, 2 * 60 * 1000).unref?.();
  return timer;
}

module.exports = {
  inspectToken,
  checkAccount,
  checkAllAccounts,
  getAccountsHealthSummary,
  daysUntil,
  warningLevel,
  startBackgroundCheck,
};
