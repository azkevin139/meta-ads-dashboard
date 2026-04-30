const fetch = require('node-fetch');
const { queryAll, queryOne } = require('../db');
const ghl = require('./ghlService');
const conversationService = require('./ghlConversationService');

const GHL_V2_BASE = 'https://services.leadconnectorhq.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickFirst(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    return value;
  }
  return null;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function asArray(payload, keys) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(payload[key])) return payload[key];
    if (payload[key] && typeof payload[key] === 'object' && Array.isArray(payload[key][key])) {
      return payload[key][key];
    }
  }
  return [];
}

function isInboundMessage(message) {
  const candidates = [
    message.direction,
    message.messageDirection,
    message.message_direction,
    message.type,
    message.messageType,
    message.message_type,
    message.status,
  ].map((value) => String(value || '').toLowerCase());

  return candidates.some((value) => (
    value === 'inbound'
    || value === 'incoming'
    || value === 'received'
    || value.includes('inbound')
  ));
}

function messageTime(message) {
  return parseDate(pickFirst(
    message.dateAdded,
    message.date_added,
    message.createdAt,
    message.created_at,
    message.timestamp,
    message.time,
  ));
}

function messageId(message) {
  return pickFirst(message.id, message.messageId, message.message_id);
}

function messageChannel(message) {
  return pickFirst(
    message.messageType,
    message.message_type,
    message.channel,
    message.type,
    'Custom',
  );
}

function messageBody(message) {
  return pickFirst(message.body, message.message, message.text, message.content);
}

function conversationId(conversation) {
  return pickFirst(conversation.id, conversation.conversationId, conversation.conversation_id);
}

async function ghlV2Request(account, path, { query } = {}) {
  const token = ghl.decrypt(account.ghl_api_key_encrypted);
  if (!token) throw new Error('GHL API key not configured for this account');

  const url = new URL(`${GHL_V2_BASE}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
    });
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Version: '2021-07-28',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    const err = new Error(`GHL API ${response.status}: ${text.slice(0, 240)}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

async function listTrackedContacts(accountId, { sinceDays = 60, includeQualified = false, limit = 1000 } = {}) {
  const days = Math.max(1, Math.min(parseInt(sinceDays, 10) || 60, 365));
  const max = Math.max(1, Math.min(parseInt(limit, 10) || 1000, 10000));
  return queryAll(`
    WITH lead_rows AS (
      SELECT
        v.client_id,
        v.account_id,
        v.ghl_contact_id,
        v.qualified_at,
        COALESCE(
          NULLIF(v.raw->'ghl'->>'dateAdded', '')::timestamptz,
          NULLIF(v.raw->'ghl'->>'createdAt', '')::timestamptz,
          NULLIF(v.raw->'metadata'->>'created_time', '')::timestamptz,
          v.resolved_at,
          v.first_seen_at
        ) AS lead_time
      FROM visitors v
      WHERE v.account_id = $1
        AND v.ghl_contact_id IS NOT NULL
        AND ($2::boolean OR v.qualified_at IS NULL)
    )
    SELECT DISTINCT ON (ghl_contact_id)
      client_id, account_id, ghl_contact_id, qualified_at, lead_time
    FROM lead_rows
    WHERE lead_time >= NOW() - ($3::int * INTERVAL '1 day')
    ORDER BY ghl_contact_id, lead_time ASC
    LIMIT $4
  `, [accountId, includeQualified, days, max]);
}

async function searchConversations(account, contactId) {
  const payload = await ghlV2Request(account, '/conversations/search', {
    query: {
      locationId: account.ghl_location_id,
      contactId,
      limit: 20,
    },
  });
  return asArray(payload, ['conversations', 'data', 'items']);
}

async function listMessages(account, convId) {
  const payload = await ghlV2Request(account, `/conversations/${encodeURIComponent(convId)}/messages`, {
    query: { limit: 100 },
  });
  return asArray(payload, ['messages', 'data', 'items']);
}

async function findFirstInboundMessage(account, contactId) {
  const conversations = await searchConversations(account, contactId);
  let first = null;

  for (const conversation of conversations) {
    const convId = conversationId(conversation);
    const embedded = asArray(conversation, ['messages', 'lastMessages']);
    const messages = convId ? await listMessages(account, convId) : embedded;
    for (const message of messages) {
      if (!isInboundMessage(message)) continue;
      const at = messageTime(message) || new Date();
      if (!first || at < first.at) {
        first = { conversation, message, at };
      }
    }
  }

  return first;
}

async function backfillAccount(accountId, options = {}) {
  const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.ghl_api_key_encrypted || !account.ghl_location_id) {
    throw new Error(`Account ${accountId} is missing GHL credentials or locationId`);
  }

  const dryRun = options.dryRun === true;
  const delayMs = Math.max(0, Math.min(parseInt(options.delayMs, 10) || 150, 2000));
  const contacts = await listTrackedContacts(accountId, options);
  const summary = {
    account_id: Number(accountId),
    dry_run: dryRun,
    since_days: Math.max(1, Math.min(parseInt(options.sinceDays, 10) || 60, 365)),
    scanned: contacts.length,
    conversations_found: 0,
    inbound_replies_found: 0,
    qualified: 0,
    already_qualified: 0,
    no_conversation: 0,
    no_inbound_reply: 0,
    errors: [],
    samples: [],
  };

  for (const contact of contacts) {
    try {
      if (contact.qualified_at) {
        summary.already_qualified += 1;
        continue;
      }

      const first = await findFirstInboundMessage(account, contact.ghl_contact_id);
      if (!first) {
        summary.no_inbound_reply += 1;
        continue;
      }

      summary.inbound_replies_found += 1;
      summary.conversations_found += 1;
      const convId = conversationId(first.conversation);
      const payload = {
        type: 'InboundMessage',
        contactId: contact.ghl_contact_id,
        locationId: account.ghl_location_id,
        conversationId: convId,
        messageId: messageId(first.message),
        messageType: messageChannel(first.message),
        dateAdded: first.at.toISOString(),
        body: messageBody(first.message),
        source: 'ghl_conversation_backfill',
      };

      if (!dryRun) {
        const result = await conversationService.processInboundMessage(payload);
        if (result?.reason === 'qualified') summary.qualified += 1;
      } else {
        summary.qualified += 1;
      }

      if (summary.samples.length < 10) {
        summary.samples.push({
          client_id: contact.client_id,
          ghl_contact_id: contact.ghl_contact_id,
          conversation_id: convId || null,
          message_id: messageId(first.message) || null,
          inbound_at: first.at.toISOString(),
          dry_run: dryRun,
        });
      }
    } catch (err) {
      summary.errors.push({
        ghl_contact_id: contact.ghl_contact_id,
        message: err.message || String(err),
      });
    }

    if (delayMs) await sleep(delayMs);
  }

  return summary;
}

async function backfillAllAccounts(options = {}) {
  const accounts = await queryAll(`
    SELECT id
    FROM accounts
    WHERE ghl_api_key_encrypted IS NOT NULL
      AND ghl_location_id IS NOT NULL
    ORDER BY id
  `);
  const results = [];
  for (const account of accounts) {
    results.push(await backfillAccount(account.id, options));
  }
  return results;
}

module.exports = {
  backfillAccount,
  backfillAllAccounts,
  listTrackedContacts,
  findFirstInboundMessage,
  isInboundMessage,
};
