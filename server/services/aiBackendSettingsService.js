const crypto = require('crypto');
const { query, queryOne } = require('../db');
const config = require('../config');

function encryptionKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(config.accountTokenSecret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
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

function decrypt(value) {
  const secrets = [config.accountTokenSecret, ...(config.legacyAccountTokenSecrets || [])];
  for (const secret of secrets) {
    try {
      return decryptWithSecret(value, secret);
    } catch (_err) {
      // try next
    }
  }
  return null;
}

async function readRow() {
  return queryOne(`
    SELECT id, openai_api_key_encrypted, openai_project_id, openai_model, updated_at
    FROM ai_backend_settings
    WHERE id = 1
  `, []);
}

async function getEffectiveSettings() {
  const row = await readRow();
  const dbApiKey = decrypt(row?.openai_api_key_encrypted);
  return {
    apiKey: dbApiKey || config.openai.apiKey || '',
    projectId: row?.openai_project_id || config.openai.projectId || '',
    model: row?.openai_model || config.openai.model,
    source: dbApiKey ? 'db_override' : config.openai.apiKey ? 'env' : 'none',
    updatedAt: row?.updated_at || null,
    dbConfigured: Boolean(dbApiKey),
  };
}

async function saveSettings({ apiKey, projectId, model } = {}) {
  const current = await readRow();
  const nextEncrypted = apiKey !== undefined
    ? (apiKey ? encrypt(apiKey) : null)
    : (current?.openai_api_key_encrypted || null);
  const nextProjectId = projectId !== undefined
    ? (String(projectId || '').trim() || null)
    : (current?.openai_project_id || null);
  const nextModel = model !== undefined
    ? (String(model || '').trim() || null)
    : (current?.openai_model || null);

  const row = await query(`
    INSERT INTO ai_backend_settings (id, openai_api_key_encrypted, openai_project_id, openai_model, updated_at)
    VALUES (1, $1, $2, $3, NOW())
    ON CONFLICT (id) DO UPDATE SET
      openai_api_key_encrypted = EXCLUDED.openai_api_key_encrypted,
      openai_project_id = EXCLUDED.openai_project_id,
      openai_model = EXCLUDED.openai_model,
      updated_at = NOW()
    RETURNING id, openai_project_id, openai_model, updated_at
  `, [nextEncrypted, nextProjectId, nextModel]);
  return row.rows[0];
}

async function getStatus() {
  const effective = await getEffectiveSettings();
  return {
    configured: Boolean(effective.apiKey),
    source: effective.source,
    project_configured: Boolean(effective.projectId),
    model: effective.model,
    project_id: effective.projectId || null,
    updated_at: effective.updatedAt,
  };
}

module.exports = {
  getEffectiveSettings,
  saveSettings,
  getStatus,
};

