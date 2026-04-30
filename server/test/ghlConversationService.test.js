const test = require('node:test');
const assert = require('node:assert/strict');

function withStubbedDb(stub, body) {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/ghlConversationService');
  const previousDb = require.cache[dbPath];
  const previousService = require.cache[servicePath];
  delete require.cache[servicePath];
  require.cache[dbPath] = { exports: stub };
  try {
    return body(require('../services/ghlConversationService'));
  } finally {
    if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
    if (previousService) require.cache[servicePath] = previousService; else delete require.cache[servicePath];
  }
}

function makeStub({ accountByLocation = null, visitor = null, insertReturns = { id: 1 } } = {}) {
  const calls = { queries: [], updates: [] };
  return {
    calls,
    stub: {
      queryOne: async (sql, params) => {
        calls.queries.push({ sql, params });
        if (/FROM accounts WHERE ghl_location_id/.test(sql)) {
          return accountByLocation ? { id: accountByLocation } : null;
        }
        if (/FROM visitors WHERE ghl_contact_id =/.test(sql) && /SELECT account_id/.test(sql)) {
          return visitor ? { account_id: visitor.account_id } : null;
        }
        if (/FROM visitors\s+WHERE ghl_contact_id = \$2/.test(sql)) {
          return visitor;
        }
        if (/INSERT INTO ghl_conversation_events/.test(sql)) {
          return insertReturns; // null = duplicate
        }
        return null;
      },
      query: async (sql, params) => {
        calls.updates.push({ sql, params });
        return { rowCount: 1 };
      },
      queryAll: async () => [],
    },
  };
}

test('processInboundMessage qualifies matched contact on first inbound reply', async () => {
  const visitor = {
    client_id: 'c1', account_id: 11, ghl_contact_id: 'ghl_1',
    meta_lead_id: 'meta_lead_1',
    first_outbound_at: null,
    qualified_at: null,
  };
  const { stub, calls } = makeStub({ accountByLocation: 11, visitor });
  await withStubbedDb(stub, async (svc) => {
    const result = await svc.processInboundMessage({
      type: 'InboundMessage', locationId: 'loc1', contactId: 'ghl_1',
      messageId: 'msg-1', conversationId: 'conv1',
      messageType: 'WhatsApp', dateAdded: '2026-04-30T11:00:00.000Z',
      body: 'Hi I am interested',
    });
    assert.equal(result.ok, true);
    assert.equal(result.reason, 'qualified');
    const update = calls.updates.find((u) => /UPDATE visitors SET\s+first_inbound_reply_at/.test(u.sql));
    assert.ok(update, 'visitor update issued');
    assert.equal(update.params[2], true, 'shouldQualify flag was true');
    assert.equal(update.params[3], 'whatsapp', 'channel normalized to whatsapp');
    assert.equal(update.params[4], 11, 'resolved account is stamped when visitor account is missing');
  });
});

test('processInboundMessage qualifies without message id, channel, or event timestamp', async () => {
  const visitor = {
    client_id: 'c2', account_id: 11, ghl_contact_id: 'ghl_2',
    meta_lead_id: 'meta_lead_2', first_outbound_at: null, qualified_at: null,
  };
  const { stub, calls } = makeStub({ accountByLocation: 11, visitor });
  await withStubbedDb(stub, async (svc) => {
    const result = await svc.processInboundMessage({
      type: 'InboundMessage', locationId: 'loc1', contactId: 'ghl_2',
    });
    assert.equal(result.reason, 'qualified');
    const update = calls.updates.find((u) => /UPDATE visitors SET\s+first_inbound_reply_at/.test(u.sql));
    assert.equal(update.params[2], true, 'shouldQualify flag was true');
    assert.match(update.params[1], /^\d{4}-\d{2}-\d{2}T/, 'received-time fallback was used');
  });
});

test('processInboundMessage does not overwrite already-qualified contacts', async () => {
  const visitor = {
    client_id: 'c3', account_id: 11, ghl_contact_id: 'ghl_3',
    meta_lead_id: 'meta_3',
    first_outbound_at: '2026-04-30T10:00:00.000Z',
    qualified_at: '2026-04-30T10:30:00.000Z',
  };
  const { stub, calls } = makeStub({ accountByLocation: 11, visitor });
  await withStubbedDb(stub, async (svc) => {
    const result = await svc.processInboundMessage({
      type: 'InboundMessage', locationId: 'loc1', contactId: 'ghl_3',
      messageId: 'msg-3', messageType: 'Voicemail', dateAdded: '2026-04-30T11:00:00.000Z',
    });
    assert.equal(result.reason, 'event_logged');
    const update = calls.updates.find((u) => /UPDATE visitors SET\s+first_inbound_reply_at/.test(u.sql));
    assert.equal(update.params[2], false, 'already-qualified contact must not qualify again');
  });
});

test('processInboundMessage is idempotent on duplicate message_id', async () => {
  const { stub, calls } = makeStub({
    accountByLocation: 11,
    visitor: { client_id: 'c4', account_id: 11, ghl_contact_id: 'ghl_4', first_outbound_at: null, qualified_at: null, meta_lead_id: 'meta_4' },
    insertReturns: null, // simulate ON CONFLICT DO NOTHING returning no row
  });
  await withStubbedDb(stub, async (svc) => {
    const result = await svc.processInboundMessage({
      type: 'InboundMessage', locationId: 'loc1', contactId: 'ghl_4',
      messageId: 'dup-msg', messageType: 'SMS', dateAdded: '2026-04-30T11:00:00.000Z',
    });
    assert.equal(result.reason, 'qualified');
    assert.equal(calls.updates.length, 1, 'duplicate event can still qualify contact once');
  });
});

test('processOutboundMessage sets first_outbound_at', async () => {
  const visitor = { client_id: 'c5', account_id: 11, ghl_contact_id: 'ghl_5', first_outbound_at: null };
  const { stub, calls } = makeStub({ accountByLocation: 11, visitor });
  await withStubbedDb(stub, async (svc) => {
    const result = await svc.processOutboundMessage({
      type: 'OutboundMessage', locationId: 'loc1', contactId: 'ghl_5',
      messageId: 'out-1', messageType: 'WhatsApp', dateAdded: '2026-04-30T09:30:00.000Z',
    });
    assert.equal(result.ok, true);
    const update = calls.updates.find((u) => /first_outbound_at = LEAST/.test(u.sql));
    assert.ok(update, 'first_outbound_at update issued');
  });
});

test('processInboundMessage rejects payload missing contact_id only', async () => {
  const { stub } = makeStub({});
  await withStubbedDb(stub, async (svc) => {
    const r1 = await svc.processInboundMessage({ messageId: 'x' }); // no contactId
    assert.equal(r1.ok, false);
    assert.equal(r1.reason, 'missing_contact_id');
  });
});

test('normalizeChannel maps GHL types to canonical tokens', () => {
  const svc = require('../services/ghlConversationService');
  assert.equal(svc.normalizeChannel('SMS'), 'sms');
  assert.equal(svc.normalizeChannel('Email'), 'email');
  assert.equal(svc.normalizeChannel('WhatsApp'), 'whatsapp');
  assert.equal(svc.normalizeChannel('FB'), 'facebook_messenger');
  assert.equal(svc.normalizeChannel('IG'), 'instagram');
  assert.equal(svc.normalizeChannel('Webchat'), 'live_chat');
  assert.equal(svc.normalizeChannel('Phone'), 'phone');
  assert.equal(svc.normalizeChannel('Voicemail'), 'voicemail');
  assert.equal(svc.normalizeChannel(undefined), 'other');
  assert.equal(svc.isQualifyingChannel('whatsapp'), true);
  assert.equal(svc.isQualifyingChannel('phone'), false);
  assert.equal(svc.isQualifyingChannel('voicemail'), false);
});
