const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('tracking security validates account id, client id, and URL shape', () => {
  const trackingSecurity = require('../services/trackingSecurityService');
  assert.throws(() => trackingSecurity.normalizePayload({
    meta_account_id: 'bad',
    client_id: 'cid_1',
  }), /meta_account_id invalid/);
  assert.throws(() => trackingSecurity.normalizePayload({
    meta_account_id: 'act_123',
  }), /client_id required/);
  assert.throws(() => trackingSecurity.normalizePayload({
    meta_account_id: 'act_123',
    client_id: 'cid_1',
    page_url: 'javascript:alert(1)',
  }), /page_url must be http or https/);
});

test('webhook security rejects stale timestamps and dedupes event ids', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/webhookSecurityService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  const rows = [{ id: 1 }, null];
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => rows.shift() || null,
    },
  };

  try {
    const security = require('../services/webhookSecurityService');
    const freshReq = {
      rawBody: Buffer.from('{"ok":true}'),
      body: { ok: true },
      header: (name) => ({
        'x-adcommand-event-id': 'evt_1',
        'x-adcommand-sent-at': new Date().toISOString(),
      }[name.toLowerCase()]),
    };
    const first = await security.reserveRequest(freshReq, 'test', freshReq.body);
    const second = await security.reserveRequest(freshReq, 'test', freshReq.body);
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, false);

    const staleReq = {
      ...freshReq,
      header: (name) => ({
        'x-adcommand-event-id': 'evt_2',
        'x-adcommand-sent-at': new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      }[name.toLowerCase()]),
    };
    assert.throws(() => security.assertFreshIfPresent(staleReq), /Stale webhook event/);
  } finally {
    restoreCache(originals);
  }
});

test('security audit redacts credential-like fields recursively', () => {
  const audit = require('../services/securityAuditService');
  assert.deepEqual(audit.redact({
    email: 'ops@test.com',
    token: 'secret-token',
    nested: {
      apiKey: 'secret-key',
      safe: 'visible',
      list: [{ password: 'hidden', name: 'ok' }],
    },
  }), {
    email: 'ops@test.com',
    token: '[REDACTED]',
    nested: {
      apiKey: '[REDACTED]',
      safe: 'visible',
      list: [{ password: '[REDACTED]', name: 'ok' }],
    },
  });
});

test('csp service normalizes legacy and reporting-api payloads', () => {
  const csp = require('../services/cspService');
  assert.deepEqual(csp.normalizeReport({
    'csp-report': {
      'document-uri': 'https://track.lnxo.me/',
      'blocked-uri': 'inline',
    },
  }), {
    'document-uri': 'https://track.lnxo.me/',
    'blocked-uri': 'inline',
  });
  assert.deepEqual(csp.normalizeReport([{
    type: 'csp-violation',
    body: {
      documentURL: 'https://track.lnxo.me/',
      blockedURL: 'inline',
    },
  }]), {
    documentURL: 'https://track.lnxo.me/',
    blockedURL: 'inline',
  });
});
