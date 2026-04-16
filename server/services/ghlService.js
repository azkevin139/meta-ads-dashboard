const fetch = require('node-fetch');
const crypto = require('crypto');
const { query, queryAll, queryOne } = require('../db');
const accountService = require('./accountService');
const config = require('../config');

// GHL has two API flavors:
//   v1: https://rest.gohighlevel.com/v1/  (Location API keys, "Bearer <key>")
//   v2: https://services.leadconnectorhq.com/  (Private Integration tokens, "Bearer <token>", Version header)
// We try v2 first then fall back to v1.

const V1_BASE = 'https://rest.gohighlevel.com/v1';
const V2_BASE = 'https://services.leadconnectorhq.com';

function encryptionKey() {
  return crypto.createHash('sha256').update(config.authSecret).digest();
}
function encrypt(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}
function decrypt(blob) {
  if (!blob) return null;
  const [iv, tag, ct] = String(blob).split(':');
  if (!iv || !tag || !ct) return null;
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

function hashIdentity(value) {
  if (!value) return null;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

async function ghlRequest(account, path, { method = 'GET', query: qs, body } = {}) {
  const key = decrypt(account.ghl_api_key_encrypted);
  if (!key) throw new Error('GHL API key not configured for this account');
  const locationId = account.ghl_location_id || null;

  // Try v2 first
  const v2Url = new URL(`${V2_BASE}${path}`);
  if (locationId) v2Url.searchParams.set('locationId', locationId);
  if (qs) Object.entries(qs).forEach(([k, v]) => v !== undefined && v2Url.searchParams.set(k, v));

  const v2Res = await fetch(v2Url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (v2Res.ok) return v2Res.json();
  if (v2Res.status === 401 || v2Res.status === 404 || v2Res.status === 400) {
    // Fall back to v1
    const v1Url = new URL(`${V1_BASE}${path}`);
    if (qs) Object.entries(qs).forEach(([k, v]) => v !== undefined && v1Url.searchParams.set(k, v));
    const v1Res = await fetch(v1Url.toString(), {
      method,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!v1Res.ok) {
      const text = await v1Res.text();
      const err = new Error(`GHL API ${v1Res.status}: ${text.substring(0, 200)}`);
      err.status = v1Res.status;
      throw err;
    }
    return v1Res.json();
  }

  const text = await v2Res.text();
  const err = new Error(`GHL API ${v2Res.status}: ${text.substring(0, 200)}`);
  err.status = v2Res.status;
  throw err;
}

async function testConnection(apiKey, locationId) {
  const account = {
    ghl_api_key_encrypted: encrypt(apiKey),
    ghl_location_id: locationId || null,
  };
  try {
    const data = await ghlRequest(account, '/locations/search', { query: { limit: 1 } });
    return { ok: true, flavor: data?.locations ? 'v2' : 'v1', sample: data };
  } catch (err) {
    if (err.status === 401) throw new Error('Invalid GHL API key');
    // Some v2 tokens can't hit /locations/search; try a contacts probe as fallback
    try {
      const contacts = await ghlRequest(account, '/contacts/', { query: { limit: 1 } });
      return { ok: true, flavor: 'v1', sample: contacts };
    } catch (err2) {
      throw err2;
    }
  }
}

async function saveGhlCredentials(accountId, { apiKey, locationId }) {
  if (!apiKey) throw new Error('GHL API key required');
  await testConnection(apiKey, locationId);
  await query(`
    UPDATE accounts
    SET ghl_api_key_encrypted = $2,
        ghl_location_id = $3,
        ghl_last_sync_error = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [accountId, encrypt(apiKey), locationId || null]);
  return { success: true };
}

async function clearGhlCredentials(accountId) {
  await query(`
    UPDATE accounts
    SET ghl_api_key_encrypted = NULL,
        ghl_location_id = NULL,
        ghl_last_sync_error = NULL,
        updated_at = NOW()
    WHERE id = $1
  `, [accountId]);
  return { success: true };
}

async function listContacts(account, { since, limit = 100 } = {}) {
  // v1: GET /contacts/?limit=&startAfterId=&query=
  // v2: GET /contacts/?locationId=&limit=&startAfter=
  const params = { limit };
  if (since) params.startAfter = new Date(since).toISOString();
  const data = await ghlRequest(account, '/contacts/', { query: params });
  // Both flavors return { contacts: [...], meta: {...} }
  return data.contacts || data.data || [];
}

function pickCustomField(contact, wantedKeys) {
  const candidates = [];
  if (Array.isArray(contact.customFields)) candidates.push(...contact.customFields);
  if (Array.isArray(contact.customField)) candidates.push(...contact.customField);
  const names = wantedKeys.map(k => String(k).toLowerCase());
  for (const f of candidates) {
    const key = String(f.key || f.fieldKey || f.name || '').toLowerCase();
    if (names.some(n => key.includes(n))) {
      return f.value ?? f.fieldValue ?? null;
    }
  }
  return null;
}

function pickFirst(...values) {
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
}

// GHL v2 returns attributionSource (first-touch) and lastAttributionSource (most recent).
// GHL v1 mirrors these into customFields with various naming conventions.
// Unified shape: { campaign_id, ad_id, adset_id, utm_*, source, source_event_type, lead_form_id, lead_form_name, fbclid, gclid }
function extractAttribution(contact) {
  const last = contact.lastAttributionSource || contact.last_attribution_source || {};
  const first = contact.attributionSource || contact.attribution_source || {};
  // Prefer last-touch (that's what caused the current stage), fall back to first-touch, then customFields.
  const pick = (lastKey, firstKey, ...fieldKeys) =>
    pickFirst(last[lastKey], first[firstKey || lastKey], pickCustomField(contact, fieldKeys));

  return {
    campaign_id: pick('campaignId', null, 'campaign_id', 'campaignId'),
    adset_id: pick('adGroupId', null, 'adset_id', 'adSetId', 'adgroup_id'),
    ad_id: pick('adId', null, 'ad_id', 'adId'),
    utm_source: pick('utmSource', null, 'utm_source'),
    utm_medium: pick('utmMedium', null, 'utm_medium'),
    utm_campaign: pick('utmCampaign', null, 'utm_campaign'),
    utm_content: pick('utmContent', null, 'utm_content'),
    utm_term: pick('utmTerm', null, 'utm_term'),
    source: pick('sessionSource', 'sessionSource', 'source', 'ad_source'),
    source_event_type: pickFirst(
      last.sourceType,
      last.source_type,
      first.sourceType,
      pickCustomField(contact, ['source_event_type', 'source_type'])
    ),
    lead_form_id: pickFirst(
      last.mediumId,
      first.mediumId,
      last.parentId,
      pickCustomField(contact, ['lead_form_id', 'parent_id', 'form_id'])
    ),
    lead_form_name: pickFirst(
      last.parentName,
      first.parentName,
      pickCustomField(contact, ['lead_form_name', 'parent_name', 'form_name'])
    ),
    fbclid: pick('fbclid', null, 'fbclid'),
    gclid: pick('gclid', null, 'gclid'),
    referrer: pick('referrer', null, 'referrer'),
    landing_page: pick('url', 'url', 'landing_page', 'page_url'),
  };
}

function normaliseContact(contact) {
  const clientId = pickCustomField(contact, ['client_id', 'adcmd_client_id', 'visitor_id']);
  const stage = contact.opportunity?.stage || contact.pipelineStageId || contact.pipeline_stage || pickCustomField(contact, ['stage', 'pipeline']) || contact.type || null;
  const revenue = Number(contact.opportunity?.monetaryValue || contact.monetaryValue || pickCustomField(contact, ['revenue', 'lifetime_value'])) || 0;
  const attribution = extractAttribution(contact);
  return {
    ghl_contact_id: contact.id || contact.contact_id || contact.contactId,
    client_id: clientId,
    email: contact.email || null,
    phone: contact.phone || contact.phone_number || null,
    first_name: contact.firstName || contact.first_name || null,
    last_name: contact.lastName || contact.last_name || null,
    stage,
    revenue,
    tags: contact.tags || [],
    attribution,
    raw: contact,
  };
}

async function upsertContactAttribution(account, normalised) {
  const emailHash = normalised.email ? hashIdentity(normalised.email) : null;
  const phoneHash = normalised.phone ? hashIdentity(normalised.phone) : null;
  const attr = normalised.attribution || {};

  // Find by client_id first (most precise), then by email hash, then phone hash.
  let existing = null;
  if (normalised.client_id) {
    existing = await queryOne('SELECT client_id FROM visitors WHERE client_id = $1', [normalised.client_id]);
  }
  if (!existing && emailHash) {
    existing = await queryOne('SELECT client_id FROM visitors WHERE email_hash = $1 ORDER BY last_seen_at DESC LIMIT 1', [emailHash]);
  }
  if (!existing && phoneHash) {
    existing = await queryOne('SELECT client_id FROM visitors WHERE phone_hash = $1 ORDER BY last_seen_at DESC LIMIT 1', [phoneHash]);
  }

  const clientId = existing?.client_id || normalised.client_id || `ghl_${normalised.ghl_contact_id}`;

  await query(`
    INSERT INTO visitors (
      client_id, account_id, meta_account_id,
      email_hash, phone_hash, ghl_contact_id,
      current_stage, revenue, currency,
      campaign_id, adset_id, ad_id,
      utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      fbclid, gclid, source, source_event_type,
      lead_form_id, lead_form_name, referrer, landing_page,
      raw, first_seen_at, last_seen_at, resolved_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW(), NOW(), NOW())
    ON CONFLICT (client_id) DO UPDATE SET
      account_id = COALESCE(EXCLUDED.account_id, visitors.account_id),
      email_hash = COALESCE(EXCLUDED.email_hash, visitors.email_hash),
      phone_hash = COALESCE(EXCLUDED.phone_hash, visitors.phone_hash),
      ghl_contact_id = COALESCE(EXCLUDED.ghl_contact_id, visitors.ghl_contact_id),
      current_stage = COALESCE(EXCLUDED.current_stage, visitors.current_stage),
      revenue = GREATEST(COALESCE(EXCLUDED.revenue, 0), COALESCE(visitors.revenue, 0)),
      campaign_id = COALESCE(visitors.campaign_id, EXCLUDED.campaign_id),
      adset_id = COALESCE(visitors.adset_id, EXCLUDED.adset_id),
      ad_id = COALESCE(visitors.ad_id, EXCLUDED.ad_id),
      utm_source = COALESCE(visitors.utm_source, EXCLUDED.utm_source),
      utm_medium = COALESCE(visitors.utm_medium, EXCLUDED.utm_medium),
      utm_campaign = COALESCE(visitors.utm_campaign, EXCLUDED.utm_campaign),
      utm_content = COALESCE(visitors.utm_content, EXCLUDED.utm_content),
      utm_term = COALESCE(visitors.utm_term, EXCLUDED.utm_term),
      fbclid = COALESCE(visitors.fbclid, EXCLUDED.fbclid),
      gclid = COALESCE(visitors.gclid, EXCLUDED.gclid),
      source = COALESCE(visitors.source, EXCLUDED.source),
      source_event_type = COALESCE(visitors.source_event_type, EXCLUDED.source_event_type),
      lead_form_id = COALESCE(visitors.lead_form_id, EXCLUDED.lead_form_id),
      lead_form_name = COALESCE(visitors.lead_form_name, EXCLUDED.lead_form_name),
      referrer = COALESCE(visitors.referrer, EXCLUDED.referrer),
      landing_page = COALESCE(visitors.landing_page, EXCLUDED.landing_page),
      raw = COALESCE(visitors.raw, '{}'::jsonb) || COALESCE(EXCLUDED.raw, '{}'::jsonb),
      last_seen_at = NOW(),
      resolved_at = COALESCE(visitors.resolved_at, NOW())
  `, [
    clientId,
    account.id,
    account.meta_account_id,
    emailHash,
    phoneHash,
    normalised.ghl_contact_id,
    normalised.stage,
    normalised.revenue || 0,
    'USD',
    attr.campaign_id || null,
    attr.adset_id || null,
    attr.ad_id || null,
    attr.utm_source || null,
    attr.utm_medium || null,
    attr.utm_campaign || null,
    attr.utm_content || null,
    attr.utm_term || null,
    attr.fbclid || null,
    attr.gclid || null,
    attr.source || null,
    attr.source_event_type || null,
    attr.lead_form_id || null,
    attr.lead_form_name || null,
    attr.referrer || null,
    attr.landing_page || null,
    JSON.stringify({ ghl: normalised.raw || {} }),
  ]);

  return { client_id: clientId, resolved: Boolean(existing), attribution: attr };
}

async function syncAccount(account) {
  if (!account?.ghl_api_key_encrypted) {
    throw new Error('GHL not configured for this account');
  }
  let imported = 0;
  let matched = 0;
  let errorMessage = null;
  const since = account.ghl_last_sync_at ? new Date(account.ghl_last_sync_at).getTime() - 3600 * 1000 : null; // 1h overlap
  try {
    const contacts = await listContacts(account, { since, limit: 200 });
    for (const contact of contacts) {
      const normalised = normaliseContact(contact);
      if (!normalised.ghl_contact_id) continue;
      const result = await upsertContactAttribution(account, normalised);
      imported += 1;
      if (result.resolved) matched += 1;
    }
  } catch (err) {
    errorMessage = err.message || String(err);
  }

  await query(`
    UPDATE accounts
    SET ghl_last_sync_at = NOW(),
        ghl_last_sync_count = $2,
        ghl_last_sync_error = $3,
        updated_at = NOW()
    WHERE id = $1
  `, [account.id, imported, errorMessage]);

  return { account_id: account.id, imported, matched, error: errorMessage };
}

async function syncAccountById(accountId) {
  const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!account) throw new Error('Account not found');
  return syncAccount(account);
}

async function syncAllConfigured() {
  const rows = await queryAll('SELECT * FROM accounts WHERE ghl_api_key_encrypted IS NOT NULL ORDER BY id');
  const results = [];
  for (const row of rows) {
    try {
      results.push(await syncAccount(row));
    } catch (err) {
      results.push({ account_id: row.id, error: err.message });
    }
  }
  return results;
}

function startBackgroundSync({ intervalMs = 6 * 3600 * 1000 } = {}) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const results = await syncAllConfigured();
      const total = results.reduce((s, r) => s + (r.imported || 0), 0);
      if (total > 0) console.log(`[ghlSync] imported ${total} contact(s) across ${results.length} account(s)`);
    } catch (err) {
      console.error(`[ghlSync] background run failed: ${err.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  setTimeout(run, 5 * 60 * 1000).unref?.();
  return timer;
}

async function getStatus(accountId) {
  const row = await queryOne(`
    SELECT id, ghl_api_key_encrypted IS NOT NULL AS configured,
           ghl_location_id, ghl_last_sync_at, ghl_last_sync_count, ghl_last_sync_error
    FROM accounts WHERE id = $1
  `, [accountId]);
  if (!row) return null;
  return {
    account_id: row.id,
    configured: row.configured,
    location_id: row.ghl_location_id,
    last_sync_at: row.ghl_last_sync_at,
    last_sync_count: row.ghl_last_sync_count || 0,
    last_sync_error: row.ghl_last_sync_error,
  };
}

module.exports = {
  saveGhlCredentials,
  clearGhlCredentials,
  testConnection,
  syncAccountById,
  syncAllConfigured,
  startBackgroundSync,
  getStatus,
  encrypt,
  decrypt,
};
