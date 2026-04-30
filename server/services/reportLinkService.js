const crypto = require('crypto');
const { query, queryOne, queryAll } = require('../db');

const TOKEN_BYTES = 32;
const DEFAULT_ALLOWED_PRESETS = ['today', 'yesterday', '7d', '14d', '30d', 'this_month'];

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function publicLink(row, { includeToken = false, token = null } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    account_id: row.account_id,
    name: row.name,
    preset_restrictions: Array.isArray(row.preset_restrictions) ? row.preset_restrictions : [],
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    last_viewed_at: row.last_viewed_at,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    is_active: !row.revoked_at && (!row.expires_at || new Date(row.expires_at).getTime() > Date.now()),
    ...(includeToken ? { token, url_path: `/report/${token}` } : {}),
  };
}

function normalizePresetRestrictions(value) {
  if (!Array.isArray(value) || !value.length) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => DEFAULT_ALLOWED_PRESETS.includes(item));
}

function cleanExpiresAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error('Invalid report link expiration');
    err.httpStatus = 400;
    throw err;
  }
  return date.toISOString();
}

async function createLink(accountId, {
  name = null,
  presetRestrictions = [],
  expiresAt = null,
  createdByUserId = null,
} = {}) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
  const row = await queryOne(`
    INSERT INTO report_links (
      account_id, name, token_hash, preset_restrictions, expires_at, created_by_user_id
    ) VALUES ($1,$2,$3,$4::jsonb,$5,$6)
    RETURNING *
  `, [
    accountId,
    name ? String(name).trim().slice(0, 200) : null,
    hashToken(token),
    JSON.stringify(normalizePresetRestrictions(presetRestrictions)),
    cleanExpiresAt(expiresAt),
    createdByUserId || null,
  ]);
  return publicLink(row, { includeToken: true, token });
}

async function listLinks(accountId) {
  const rows = await queryAll(`
    SELECT *
    FROM report_links
    WHERE account_id = $1
    ORDER BY created_at DESC
  `, [accountId]);
  return rows.map(publicLink);
}

async function revokeLink(accountId, linkId, revokedByUserId = null) {
  const row = await queryOne(`
    UPDATE report_links
    SET revoked_at = COALESCE(revoked_at, NOW()),
        revoked_by_user_id = COALESCE($3, revoked_by_user_id),
        updated_at = NOW()
    WHERE id = $1
      AND account_id = $2
    RETURNING *
  `, [linkId, accountId, revokedByUserId || null]);
  if (!row) {
    const err = new Error('Report link not found');
    err.httpStatus = 404;
    throw err;
  }
  return publicLink(row);
}

async function resolveToken(token) {
  const clean = String(token || '').trim();
  if (!clean) {
    const err = new Error('Report token required');
    err.httpStatus = 401;
    throw err;
  }
  const row = await queryOne(`
    SELECT rl.*, a.label AS account_label, a.name AS account_name, a.meta_account_id, a.currency
    FROM report_links rl
    JOIN accounts a ON a.id = rl.account_id
    WHERE rl.token_hash = $1
    LIMIT 1
  `, [hashToken(clean)]);
  if (!row) {
    const err = new Error('Invalid report link');
    err.httpStatus = 401;
    throw err;
  }
  if (row.revoked_at) {
    const err = new Error('Report link revoked');
    err.httpStatus = 403;
    throw err;
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) {
    const err = new Error('Report link expired');
    err.httpStatus = 403;
    throw err;
  }
  return row;
}

function enforcePresetRestriction(link, params = {}) {
  const restrictions = Array.isArray(link.preset_restrictions) ? link.preset_restrictions : [];
  if (!restrictions.length) return;
  const requested = params.preset || (params.since || params.until ? 'custom' : '7d');
  if (!restrictions.includes(requested)) {
    const err = new Error('Report date range is not allowed for this link');
    err.httpStatus = 403;
    throw err;
  }
}

async function recordView(link, req, params = {}) {
  await query(`
    INSERT INTO report_link_views (report_link_id, account_id, ip, user_agent, preset, since, until)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
  `, [
    link.id,
    link.account_id,
    req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    req.headers['user-agent'] || null,
    params.preset || null,
    params.since || null,
    params.until || null,
  ]);
  await query(`
    UPDATE report_links
    SET last_viewed_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
  `, [link.id]);
}

module.exports = {
  DEFAULT_ALLOWED_PRESETS,
  hashToken,
  createLink,
  listLinks,
  revokeLink,
  resolveToken,
  enforcePresetRestriction,
  recordView,
  publicLink,
};
