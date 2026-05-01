const fetch = require('node-fetch');
const { queryAll, queryOne } = require('../db');
const ghl = require('./ghlService');
const conversationService = require('./ghlConversationService');

const GHL_V2_BASE = 'https://services.leadconnectorhq.com';
const DEFAULT_RECONCILIATION_CHANNELS = [
  'whatsapp',
  'email',
  'sms',
  'facebook_messenger',
  'instagram',
  'live_chat',
];

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

function contactId(contact) {
  return pickFirst(contact.id, contact.contactId, contact.contact_id);
}

function contactEmail(contact) {
  return pickFirst(contact.email, contact.emailAddress, contact.email_address);
}

function contactPhone(contact) {
  return pickFirst(contact.phone, contact.phoneNumber, contact.phone_number);
}

function hashIdentity(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(text.toLowerCase()).digest('hex');
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

function parseNextContactCursor(data, contacts, limit) {
  const meta = data?.meta || data?.metadata || {};
  const nextUrl = meta.nextPageUrl || meta.next_page_url || data?.nextPageUrl || data?.next_page_url;
  if (nextUrl) {
    try {
      const url = new URL(nextUrl);
      const startAfter = url.searchParams.get('startAfter');
      const startAfterId = url.searchParams.get('startAfterId');
      if (startAfter || startAfterId) return { startAfter, startAfterId };
    } catch (_err) {}
  }
  const nextStartAfter = meta.startAfter || meta.nextStartAfter || data?.startAfter || data?.nextStartAfter;
  const nextStartAfterId = meta.startAfterId || meta.nextStartAfterId || data?.startAfterId || data?.nextStartAfterId;
  if (nextStartAfter || nextStartAfterId) return { startAfter: nextStartAfter || null, startAfterId: nextStartAfterId || null };
  if (contacts.length === limit) {
    const lastId = contactId(contacts[contacts.length - 1]);
    const lastStartAfter = contacts[contacts.length - 1]?.startAfter;
    if (Array.isArray(lastStartAfter)) return { startAfter: lastStartAfter[0], startAfterId: lastStartAfter[1] };
    if (lastId) return { startAfter: null, startAfterId: lastId };
  }
  return null;
}

async function listContactsPage(account, { limit = 100, cursor } = {}) {
  const query = {
    locationId: account.ghl_location_id,
    limit,
  };
  if (cursor?.startAfter) query.startAfter = cursor.startAfter;
  if (cursor?.startAfterId) query.startAfterId = cursor.startAfterId;
  const payload = await ghlV2Request(account, '/contacts/', { query });
  const contacts = asArray(payload, ['contacts', 'data', 'items']);
  return {
    contacts,
    nextCursor: parseNextContactCursor(payload, contacts, limit),
    total: payload?.meta?.total || payload?.total || null,
  };
}

async function listAllContacts(account, { limit = 100, maxContacts = 10000, maxPages = 500 } = {}) {
  const all = [];
  let cursor = null;
  const pageLimit = Math.max(1, Math.min(parseInt(limit, 10) || 100, 100));
  const contactCap = Math.max(1, Math.min(parseInt(maxContacts, 10) || 10000, 50000));
  const pageCap = Math.max(1, Math.min(parseInt(maxPages, 10) || 500, 1000));
  const seenIds = new Set();
  let expectedTotal = null;
  for (let page = 0; page < pageCap && all.length < contactCap; page += 1) {
    const result = await listContactsPage(account, { limit: pageLimit, cursor });
    if (result.total && !expectedTotal) expectedTotal = Number(result.total) || null;
    const uniqueContacts = [];
    for (const contact of result.contacts) {
      const id = contactId(contact);
      if (id && seenIds.has(id)) continue;
      if (id) seenIds.add(id);
      uniqueContacts.push(contact);
    }
    all.push(...uniqueContacts.slice(0, contactCap - all.length));
    if (expectedTotal && all.length >= expectedTotal) break;
    if (!uniqueContacts.length && result.contacts.length) break;
    if (!result.nextCursor || result.contacts.length < pageLimit) break;
    cursor = result.nextCursor;
  }
  return all;
}

function normalizeAllowedChannels(channels) {
  const source = Array.isArray(channels) && channels.length ? channels : DEFAULT_RECONCILIATION_CHANNELS;
  return new Set(source.map((channel) => conversationService.normalizeChannel(channel)));
}

async function findFirstInboundMessage(account, contactId, { channels } = {}) {
  const allowedChannels = channels ? normalizeAllowedChannels(channels) : null;
  const conversations = await searchConversations(account, contactId);
  let first = null;

  for (const conversation of conversations) {
    const convId = conversationId(conversation);
    const embedded = asArray(conversation, ['messages', 'lastMessages']);
    const messages = convId ? await listMessages(account, convId) : embedded;
    for (const message of messages) {
      if (!isInboundMessage(message)) continue;
      const channel = conversationService.normalizeChannel(messageChannel(message));
      if (allowedChannels && !allowedChannels.has(channel)) continue;
      const at = messageTime(message) || new Date();
      if (!first || at < first.at) {
        first = { conversation, message, at };
      }
    }
  }

  return first;
}

async function matchLocalLead(accountId, contact) {
  const ghlContactId = contactId(contact);
  const emailHash = hashIdentity(contactEmail(contact));
  const phoneHash = hashIdentity(contactPhone(contact));
  const baseSelect = `
    SELECT client_id, account_id, ghl_contact_id, email_hash, phone_hash, qualified_at, first_inbound_reply_at
    FROM visitors
    WHERE account_id = $1
      AND (
        meta_lead_id IS NOT NULL
        OR ghl_contact_id IS NOT NULL
        OR email_hash IS NOT NULL
        OR phone_hash IS NOT NULL
      )
  `;

  if (ghlContactId) {
    const row = await queryOne(`${baseSelect} AND ghl_contact_id = $2 ORDER BY resolved_at DESC NULLS LAST, first_seen_at DESC NULLS LAST LIMIT 1`, [accountId, ghlContactId]);
    if (row) return { visitor: row, match_method: 'ghl_contact_id' };
  }
  if (emailHash) {
    const row = await queryOne(`${baseSelect} AND email_hash = $2 ORDER BY resolved_at DESC NULLS LAST, first_seen_at DESC NULLS LAST LIMIT 1`, [accountId, emailHash]);
    if (row) return { visitor: row, match_method: 'email_hash' };
  }
  if (phoneHash) {
    const row = await queryOne(`${baseSelect} AND phone_hash = $2 ORDER BY resolved_at DESC NULLS LAST, first_seen_at DESC NULLS LAST LIMIT 1`, [accountId, phoneHash]);
    if (row) return { visitor: row, match_method: 'phone_hash' };
  }

  return {
    visitor: null,
    match_method: null,
    identity: { email_hash: emailHash, phone_hash: phoneHash },
  };
}

async function insertBackfilledEvent({ accountId, contact, first }) {
  const ghlContactId = contactId(contact);
  const convId = conversationId(first.conversation);
  const payload = {
    source: 'ghl_full_reconciliation',
    contact,
    message: first.message,
  };
  const fields = {
    ghlContactId,
    conversationId: convId ? String(convId) : null,
    messageId: messageId(first.message) ? String(messageId(first.message)) : null,
    channel: conversationService.normalizeChannel(messageChannel(first.message)),
    eventAt: first.at.toISOString(),
    bodyPreview: String(messageBody(first.message) || '').slice(0, 200) || null,
  };
  const syntheticId = fields.messageId || `reconcile:${accountId}:${ghlContactId}:${fields.eventAt}:${fields.channel}`;
  await queryOne(`
    INSERT INTO ghl_conversation_events (
      account_id, ghl_contact_id, conversation_id, message_id, direction,
      channel, body_preview, ghl_event_at, raw
    ) VALUES ($1, $2, $3, $4, 'inbound', $5, $6, $7, $8::jsonb)
    ON CONFLICT (message_id) DO NOTHING
    RETURNING id
  `, [
    accountId,
    ghlContactId,
    fields.conversationId,
    syntheticId,
    fields.channel,
    fields.bodyPreview,
    fields.eventAt,
    JSON.stringify(payload),
  ]);
  return fields;
}

async function qualifyMatchedVisitor({ accountId, visitor, contact, first }) {
  const fields = await insertBackfilledEvent({ accountId, contact, first });
  const result = await queryOne(`
    UPDATE visitors
    SET
      ghl_contact_id = COALESCE(ghl_contact_id, $2),
      first_inbound_reply_at = LEAST(
        COALESCE(first_inbound_reply_at, $3::timestamptz),
        $3::timestamptz
      ),
      qualified_at = CASE
        WHEN qualified_at IS NULL THEN $3::timestamptz
        ELSE qualified_at
      END,
      qualified_reason = CASE
        WHEN qualified_at IS NULL THEN 'inbound_reply'
        ELSE qualified_reason
      END,
      qualified_channel = CASE
        WHEN qualified_at IS NULL THEN $4
        ELSE qualified_channel
      END,
      last_seen_at = GREATEST(COALESCE(last_seen_at, $3::timestamptz), $3::timestamptz)
    WHERE account_id = $1
      AND client_id = $5
    RETURNING qualified_at
  `, [
    accountId,
    contactId(contact),
    first.at.toISOString(),
    fields.channel,
    visitor.client_id,
  ]);
  return result;
}

async function reconcileQualifiedLeadsForAccount(accountId, options = {}) {
  const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!account) throw new Error(`Account ${accountId} not found`);
  if (!account.ghl_api_key_encrypted || !account.ghl_location_id) {
    throw new Error(`Account ${accountId} is missing GHL credentials or locationId`);
  }

  const dryRun = options.dryRun !== false;
  const delayMs = Math.max(0, Math.min(parseInt(options.delayMs, 10) || 150, 2000));
  const progress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const channels = Array.isArray(options.channels) && options.channels.length
    ? options.channels
    : DEFAULT_RECONCILIATION_CHANNELS;
  const contacts = await listAllContacts(account, options);
  const report = {
    account_id: Number(accountId),
    location_id: account.ghl_location_id,
    dry_run: dryRun,
    channels,
    scanned_contacts: contacts.length,
    contacts_with_inbound_reply: 0,
    matched_to_local_leads: 0,
    newly_qualified: 0,
    already_qualified: 0,
    unmatched_replied_contacts: 0,
    match_methods: {
      ghl_contact_id: 0,
      email_hash: 0,
      phone_hash: 0,
    },
    unmatched: [],
    errors: [],
    samples: [],
  };

  for (let index = 0; index < contacts.length; index += 1) {
    const contact = contacts[index];
    if (progress && (index === 0 || (index + 1) % 25 === 0 || index + 1 === contacts.length)) {
      progress({
        scanned: index + 1,
        total: contacts.length,
        contacts_with_inbound_reply: report.contacts_with_inbound_reply,
        matched_to_local_leads: report.matched_to_local_leads,
        newly_qualified: report.newly_qualified,
        unmatched_replied_contacts: report.unmatched_replied_contacts,
        errors: report.errors.length,
      });
    }
    const ghlContactId = contactId(contact);
    if (!ghlContactId) continue;
    try {
      const first = await findFirstInboundMessage(account, ghlContactId, { channels });
      if (!first) {
        if (delayMs) await sleep(delayMs);
        continue;
      }
      report.contacts_with_inbound_reply += 1;

      const match = await matchLocalLead(accountId, contact);
      if (!match.visitor) {
        report.unmatched_replied_contacts += 1;
        if (report.unmatched.length < 100) {
          report.unmatched.push({
            ghl_contact_id: ghlContactId,
            name: pickFirst(contact.fullName, contact.contactName, `${contact.firstName || ''} ${contact.lastName || ''}`.trim()) || null,
            email: contactEmail(contact),
            phone: contactPhone(contact),
            first_inbound_at: first.at.toISOString(),
            channel: conversationService.normalizeChannel(messageChannel(first.message)),
          });
        }
        if (delayMs) await sleep(delayMs);
        continue;
      }

      report.matched_to_local_leads += 1;
      report.match_methods[match.match_method] = (report.match_methods[match.match_method] || 0) + 1;
      if (match.visitor.qualified_at) {
        report.already_qualified += 1;
      } else {
        report.newly_qualified += 1;
        if (!dryRun) {
          await qualifyMatchedVisitor({ accountId, visitor: match.visitor, contact, first });
        }
      }

      if (report.samples.length < 20) {
        report.samples.push({
          client_id: match.visitor.client_id,
          ghl_contact_id: ghlContactId,
          match_method: match.match_method,
          first_inbound_at: first.at.toISOString(),
          channel: conversationService.normalizeChannel(messageChannel(first.message)),
          would_qualify: !match.visitor.qualified_at,
        });
      }
    } catch (err) {
      report.errors.push({
        ghl_contact_id: ghlContactId,
        message: err.message || String(err),
      });
    }
    if (delayMs) await sleep(delayMs);
  }

  return report;
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
  reconcileQualifiedLeadsForAccount,
  listTrackedContacts,
  listAllContacts,
  findFirstInboundMessage,
  isInboundMessage,
  matchLocalLead,
  DEFAULT_RECONCILIATION_CHANNELS,
};
