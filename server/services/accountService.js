const crypto = require('crypto');
const { query, queryAll, queryOne } = require('../db');
const config = require('../config');

function encryptionKey() {
  return crypto.createHash('sha256').update(config.authSecret).digest();
}

function encryptToken(token) {
  if (!token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptToken(value) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function publicAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    meta_account_id: row.meta_account_id,
    name: row.name,
    label: row.label || row.name,
    currency: row.currency,
    timezone: row.timezone,
    is_active: row.is_active,
    token_last4: row.token_last4 || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function envAccount() {
  if (!config.meta.accessToken || !config.meta.adAccountId) return null;
  return {
    id: null,
    meta_account_id: config.meta.adAccountId,
    name: 'Environment Meta Account',
    label: 'Environment Meta Account',
    currency: 'USD',
    timezone: 'UTC',
    access_token: config.meta.accessToken,
  };
}

async function listAccounts() {
  const rows = await queryAll(`
    SELECT id, meta_account_id, name, label, currency, timezone, is_active, token_last4, created_at, updated_at
    FROM accounts
    ORDER BY is_active DESC, label NULLS LAST, name
  `);
  return rows.map(publicAccount);
}

async function getAccountById(id) {
  if (!id) return null;
  const row = await queryOne('SELECT * FROM accounts WHERE id = $1', [id]);
  if (!row) return null;
  const token = decryptToken(row.encrypted_token) || row.access_token;
  return { ...row, access_token: token };
}

async function getDefaultAccount() {
  const row = await queryOne(`
    SELECT * FROM accounts
    WHERE is_active = true
    ORDER BY id
    LIMIT 1
  `);
  if (row) {
    const token = decryptToken(row.encrypted_token) || row.access_token;
    return { ...row, access_token: token };
  }
  return envAccount();
}

async function getActiveAccountForSession(sessionOrUser) {
  if (sessionOrUser?.active_account_id) {
    const selected = await getAccountById(sessionOrUser.active_account_id);
    if (selected) return selected;
  }
  return getDefaultAccount();
}

async function createAccount(input = {}) {
  const token = String(input.token || input.access_token || '').trim();
  const metaAccountId = String(input.meta_account_id || '').trim();
  const label = String(input.label || input.name || metaAccountId || 'Meta account').trim();
  if (!token) throw new Error('Meta token required');
  if (!metaAccountId) throw new Error('Meta ad account ID required');

  if (input.is_active) {
    await query('UPDATE accounts SET is_active = false');
  }

  const row = await queryOne(`
    INSERT INTO accounts (meta_account_id, name, label, currency, timezone, encrypted_token, token_last4, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (meta_account_id) DO UPDATE SET
      name = EXCLUDED.name,
      label = EXCLUDED.label,
      currency = EXCLUDED.currency,
      timezone = EXCLUDED.timezone,
      encrypted_token = EXCLUDED.encrypted_token,
      token_last4 = EXCLUDED.token_last4,
      is_active = CASE WHEN EXCLUDED.is_active THEN true ELSE accounts.is_active END,
      updated_at = NOW()
    RETURNING id, meta_account_id, name, label, currency, timezone, is_active, token_last4, created_at, updated_at
  `, [
    metaAccountId,
    input.name || label,
    label,
    input.currency || 'USD',
    input.timezone || 'UTC',
    encryptToken(token),
    token.slice(-4),
    Boolean(input.is_active),
  ]);
  return publicAccount(row);
}

async function setDefaultAccount(accountId) {
  const account = await getAccountById(accountId);
  if (!account) throw new Error('Account not found');
  await query('UPDATE accounts SET is_active = false');
  await query('UPDATE accounts SET is_active = true, updated_at = NOW() WHERE id = $1', [account.id]);
  return publicAccount({ ...account, is_active: true });
}

async function updateSessionAccount(tokenHash, accountId) {
  const account = await getAccountById(accountId);
  if (!account) throw new Error('Account not found');
  await query('UPDATE user_sessions SET active_account_id = $1 WHERE token = $2', [account.id, tokenHash]);
  return publicAccount(account);
}

module.exports = {
  encryptToken,
  decryptToken,
  listAccounts,
  getAccountById,
  getDefaultAccount,
  getActiveAccountForSession,
  createAccount,
  setDefaultAccount,
  updateSessionAccount,
  publicAccount,
};
