const crypto = require('crypto');
const { query, queryAll, queryOne } = require('../db');
const config = require('../config');
const metaApi = require('./metaApi');

function encryptionKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(token) {
  if (!token) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(config.accountTokenSecret), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptWithSecret(value, secret) {
  if (!value) return null;
  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(':');
  if (!ivRaw || !tagRaw || !encryptedRaw) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function decryptToken(value) {
  const secrets = [config.accountTokenSecret, ...(config.legacyAccountTokenSecrets || [])];
  for (const secret of secrets) {
    try {
      return decryptWithSecret(value, secret);
    } catch (err) {
      // try the next configured legacy secret
    }
  }
  return null;
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

function normalizeMetaAccountId(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw.startsWith('act_') ? raw : `act_${raw}`;
}

async function fetchMetaAccountDetails(metaAccountId, token) {
  const normalizedId = normalizeMetaAccountId(metaAccountId);
  if (!normalizedId || !token) return null;
  return metaApi.metaGet(`/${normalizedId}`, {
    fields: 'id,name,account_id,currency,timezone_name,account_status',
  }, { access_token: token });
}

function normalizeDiscoveredAccount(account = {}) {
  const metaAccountId = normalizeMetaAccountId(account.id || account.meta_account_id || account.account_id);
  return {
    id: metaAccountId,
    meta_account_id: metaAccountId,
    account_id: account.account_id || metaAccountId.replace(/^act_/, ''),
    name: account.name || metaAccountId,
    currency: account.currency || null,
    timezone: account.timezone_name || account.timezone || null,
    account_status: account.account_status || null,
  };
}

async function discoverAccountsForToken(token) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) throw new Error('Meta token required');
  const [profile, accounts] = await Promise.all([
    metaApi.metaGet('/me', { fields: 'id,name' }, { access_token: cleanToken }),
    metaApi.getAdAccounts({ access_token: cleanToken }),
  ]);

  return {
    user: {
      id: profile.id || null,
      name: profile.name || null,
    },
    data: accounts.map(normalizeDiscoveredAccount),
    meta: {
      paging: accounts._paging || null,
    },
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
  const metaAccountId = normalizeMetaAccountId(input.meta_account_id);
  if (!token) throw new Error('Meta token required');
  if (!metaAccountId) throw new Error('Meta ad account ID required');

  const details = await fetchMetaAccountDetails(metaAccountId, token);
  const name = String(details?.name || input.name || input.label || metaAccountId).trim();
  const label = String(input.label || name || metaAccountId || 'Meta account').trim();
  const currency = details?.currency || input.currency || null;
  const timezone = details?.timezone_name || input.timezone || null;

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
    name,
    label,
    currency,
    timezone,
    encryptToken(token),
    token.slice(-4),
    Boolean(input.is_active),
  ]);
  return publicAccount(row);
}

async function importAccountsFromToken(input = {}) {
  const token = String(input.token || input.access_token || '').trim();
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const makeFirstDefault = Boolean(input.make_first_default);
  if (!token) throw new Error('Meta token required');
  if (!accounts.length) throw new Error('At least one Meta ad account is required');

  const imported = [];
  for (const [index, account] of accounts.entries()) {
    const metaAccountId = normalizeMetaAccountId(account.meta_account_id || account.id || account.account_id);
    if (!metaAccountId) continue;
    const name = String(account.name || account.label || metaAccountId).trim();
    const saved = await createAccount({
      token,
      meta_account_id: metaAccountId,
      name,
      label: account.label || name,
      currency: account.currency || 'USD',
      timezone: account.timezone || account.timezone_name || 'UTC',
      is_active: makeFirstDefault && imported.length === 0,
    });
    imported.push(saved);
  }

  if (!imported.length) throw new Error('No valid Meta ad accounts were provided');
  return imported;
}

async function refreshAccountMetadata(accountId = null) {
  const rows = await queryAll(`
    SELECT *
    FROM accounts
    ${accountId ? 'WHERE id = $1' : ''}
    ORDER BY id
  `, accountId ? [accountId] : []);

  const refreshed = [];
  const failed = [];
  for (const row of rows) {
    const token = decryptToken(row.encrypted_token) || row.access_token;
    if (!token) {
      failed.push({ id: row.id, meta_account_id: row.meta_account_id, error: 'No stored token' });
      continue;
    }

    try {
      const details = await fetchMetaAccountDetails(row.meta_account_id, token);
      const updated = await queryOne(`
        UPDATE accounts
        SET name = $2,
            currency = $3,
            timezone = $4,
            updated_at = NOW()
        WHERE id = $1
        RETURNING id, meta_account_id, name, label, currency, timezone, is_active, token_last4, created_at, updated_at
      `, [
        row.id,
        details?.name || row.name,
        details?.currency || row.currency || null,
        details?.timezone_name || row.timezone || null,
      ]);
      refreshed.push(publicAccount(updated));
    } catch (err) {
      failed.push({ id: row.id, meta_account_id: row.meta_account_id, error: err.message });
    }
  }

  return { refreshed, failed };
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
  discoverAccountsForToken,
  createAccount,
  importAccountsFromToken,
  refreshAccountMetadata,
  setDefaultAccount,
  updateSessionAccount,
  publicAccount,
};
