// Phase 1C of the qualification rebuild.
//
// V1 qualification rule (strict): a lead is qualified when
//   1. visitor row exists for the contact and was acquired via Meta or website form
//      (matches the D6 lead-source discriminator in reportingService),
//   2. an inbound message arrives over a text-conversational channel
//      (whatsapp, sms, email, facebook_messenger, instagram, live_chat),
//   3. the inbound timestamp is strictly greater than the visitor's
//      first_outbound_at.
//
// Events are stored durably in ghl_conversation_events so reporting can
// read persisted facts. Idempotency is enforced by UNIQUE(message_id).
const { query, queryOne } = require('../db');

// GHL channel value (from webhook payload) -> canonical lowercase token.
const CHANNEL_MAP = {
  SMS: 'sms',
  Email: 'email',
  WhatsApp: 'whatsapp',
  FB: 'facebook_messenger',
  IG: 'instagram',
  Webchat: 'live_chat',
  Phone: 'phone',
  Voicemail: 'voicemail',
  GMB: 'gmb',
  Custom: 'custom',
};

const QUALIFYING_CHANNELS = new Set([
  'whatsapp', 'sms', 'email', 'facebook_messenger', 'instagram', 'live_chat',
]);

function normalizeChannel(raw) {
  if (!raw) return 'other';
  const key = String(raw).trim();
  if (CHANNEL_MAP[key]) return CHANNEL_MAP[key];
  return key.toLowerCase().replace(/\s+/g, '_');
}

function isQualifyingChannel(channel) {
  return QUALIFYING_CHANNELS.has(channel);
}

function pickFirst(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function bodyPreview(text) {
  if (!text) return null;
  return String(text).slice(0, 200);
}

function extractCommonFields(payload) {
  const p = payload || {};
  const messageId = pickFirst(p.messageId, p.message_id, p.id);
  const conversationId = pickFirst(p.conversationId, p.conversation_id);
  const ghlContactId = pickFirst(p.contactId, p.contact_id, p.contact?.id);
  const locationId = pickFirst(p.locationId, p.location_id, p.location?.id);
  const channelRaw = pickFirst(p.messageType, p.message_type, p.type, p.channel);
  const dateAdded = pickFirst(p.dateAdded, p.date_added, p.timestamp, p.createdAt);
  const body = pickFirst(p.body, p.message, p.text);
  let eventAt = null;
  if (dateAdded) {
    const d = new Date(dateAdded);
    if (!Number.isNaN(d.getTime())) eventAt = d.toISOString();
  }
  return {
    messageId: messageId ? String(messageId) : null,
    conversationId: conversationId ? String(conversationId) : null,
    ghlContactId: ghlContactId ? String(ghlContactId) : null,
    locationId: locationId ? String(locationId) : null,
    channel: normalizeChannel(channelRaw),
    eventAt,
    bodyPreview: bodyPreview(body),
  };
}

async function resolveAccountId(locationId, ghlContactId) {
  if (locationId) {
    const row = await queryOne('SELECT id FROM accounts WHERE ghl_location_id = $1 LIMIT 1', [locationId]);
    if (row) return Number(row.id);
  }
  if (ghlContactId) {
    const row = await queryOne('SELECT account_id FROM visitors WHERE ghl_contact_id = $1 LIMIT 1', [ghlContactId]);
    if (row?.account_id) return Number(row.account_id);
  }
  return null;
}

async function findVisitor(accountId, ghlContactId) {
  if (!accountId || !ghlContactId) return null;
  return queryOne(
    'SELECT * FROM visitors WHERE account_id = $1 AND ghl_contact_id = $2 LIMIT 1',
    [accountId, ghlContactId],
  );
}

// D6 says every visitor with an identity is either meta_lead_form or
// website_form, so any visitor row that reaches this layer satisfies
// the source gate. Kept as a function so future stricter source columns
// can plug in here without touching call sites.
function visitorSatisfiesSourceGate(visitor) {
  return Boolean(visitor);
}

async function insertEvent({ accountId, fields, direction, payload }) {
  return queryOne(
    `
    INSERT INTO ghl_conversation_events (
      account_id, ghl_contact_id, conversation_id, message_id, direction,
      channel, body_preview, ghl_event_at, raw
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    ON CONFLICT (message_id) DO NOTHING
    RETURNING id
    `,
    [
      accountId,
      fields.ghlContactId,
      fields.conversationId,
      fields.messageId,
      direction,
      fields.channel,
      fields.bodyPreview,
      fields.eventAt,
      JSON.stringify(payload || {}),
    ],
  );
}

async function processInboundMessage(payload) {
  const fields = extractCommonFields(payload);
  if (!fields.messageId || !fields.ghlContactId) {
    return { ok: false, reason: 'missing_message_or_contact_id' };
  }
  const accountId = await resolveAccountId(fields.locationId, fields.ghlContactId);
  if (!accountId) return { ok: false, reason: 'unmapped_account' };

  const inserted = await insertEvent({ accountId, fields, direction: 'inbound', payload });
  if (!inserted) return { ok: true, reason: 'duplicate' };

  const visitor = await findVisitor(accountId, fields.ghlContactId);
  if (!visitor) return { ok: true, reason: 'event_logged_no_visitor' };

  const allowedChannel = isQualifyingChannel(fields.channel);
  const sourceOk = visitorSatisfiesSourceGate(visitor);
  const hasOutbound = visitor.first_outbound_at != null;
  const replyAfterOutbound = fields.eventAt
    && hasOutbound
    && new Date(fields.eventAt) > new Date(visitor.first_outbound_at);
  const shouldQualify = !visitor.qualified_at && allowedChannel && sourceOk && replyAfterOutbound;

  await query(
    `
    UPDATE visitors SET
      first_inbound_reply_at = LEAST(
        COALESCE(first_inbound_reply_at, $2::timestamptz),
        $2::timestamptz
      ),
      qualified_at      = CASE WHEN $3::boolean THEN $2::timestamptz ELSE qualified_at END,
      qualified_reason  = CASE WHEN $3::boolean THEN 'inbound_reply'  ELSE qualified_reason  END,
      qualified_channel = CASE WHEN $3::boolean THEN $4               ELSE qualified_channel END,
      last_seen_at      = GREATEST(COALESCE(last_seen_at, $2::timestamptz), $2::timestamptz)
    WHERE client_id = $1
    `,
    [visitor.client_id, fields.eventAt, shouldQualify, fields.channel],
  );

  return {
    ok: true,
    reason: shouldQualify ? 'qualified' : 'event_logged',
    client_id: visitor.client_id,
  };
}

async function processOutboundMessage(payload) {
  const fields = extractCommonFields(payload);
  if (!fields.messageId || !fields.ghlContactId) {
    return { ok: false, reason: 'missing_message_or_contact_id' };
  }
  const accountId = await resolveAccountId(fields.locationId, fields.ghlContactId);
  if (!accountId) return { ok: false, reason: 'unmapped_account' };

  const inserted = await insertEvent({ accountId, fields, direction: 'outbound', payload });
  if (!inserted) return { ok: true, reason: 'duplicate' };

  const visitor = await findVisitor(accountId, fields.ghlContactId);
  if (!visitor) return { ok: true, reason: 'event_logged_no_visitor' };

  await query(
    `
    UPDATE visitors SET
      first_outbound_at = LEAST(
        COALESCE(first_outbound_at, $2::timestamptz),
        $2::timestamptz
      )
    WHERE client_id = $1
    `,
    [visitor.client_id, fields.eventAt],
  );

  return { ok: true, client_id: visitor.client_id };
}

module.exports = {
  processInboundMessage,
  processOutboundMessage,
  normalizeChannel,
  isQualifyingChannel,
  QUALIFYING_CHANNELS,
  // exported for the reconciliation job (Phase 2)
  extractCommonFields,
  resolveAccountId,
};
