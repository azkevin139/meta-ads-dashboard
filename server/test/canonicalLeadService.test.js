const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

function makeHarness() {
  const leads = [];
  const links = [];
  let nextId = 1;

  function clone(row) {
    return row ? { ...row } : null;
  }

  function findBy(column, accountId, value) {
    return clone(leads.find((row) => Number(row.account_id) === Number(accountId) && row[column] === value));
  }

  const db = {
    queryOne: async (sql, params) => {
      if (sql.includes('SELECT * FROM canonical_leads WHERE account_id = $1')) {
        const column = sql.match(/AND (primary_[a-z_]+) = \$2/)?.[1];
        return findBy(column, params[0], params[1]);
      }

      if (sql.includes('INSERT INTO canonical_leads')) {
        const row = {
          id: nextId++,
          account_id: params[0],
          primary_ghl_contact_id: params[1],
          primary_phone_hash: params[2],
          primary_email_hash: params[3],
          primary_meta_lead_id: params[4],
          first_seen_at: params[5],
          last_seen_at: params[5],
          identity_confidence: params[6],
        };
        leads.push(row);
        return clone(row);
      }

      if (sql.includes('UPDATE canonical_leads')) {
        const row = leads.find((lead) => Number(lead.id) === Number(params[0]));
        row.primary_ghl_contact_id ||= params[1];
        row.primary_phone_hash ||= params[2];
        row.primary_email_hash ||= params[3];
        row.primary_meta_lead_id ||= params[4];
        row.last_seen_at = params[5];
        row.identity_confidence = params[6];
        return clone(row);
      }

      if (sql.includes('INSERT INTO canonical_lead_links')) {
        const existing = links.find((link) => (
          Number(link.account_id) === Number(params[1])
          && link.source_type === params[2]
          && link.source_id === params[3]
        ));
        if (existing) {
          existing.canonical_lead_id = params[0];
          existing.match_method = params[4];
          return clone(existing);
        }
        const link = {
          canonical_lead_id: params[0],
          account_id: params[1],
          source_type: params[2],
          source_id: params[3],
          match_method: params[4],
        };
        links.push(link);
        return clone(link);
      }

      return null;
    },
    queryAll: async () => [],
    query: async () => ({ rows: [] }),
  };

  return { db, leads, links };
}

test('canonicalLeadService resolves same GHL contact to one canonical lead', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/canonicalLeadService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);
  const harness = makeHarness();

  delete require.cache[servicePath];
  require.cache[dbPath] = { exports: harness.db };

  try {
    const service = require('../services/canonicalLeadService');
    const first = await service.resolveCanonicalLeadForVisitor({
      account_id: 11,
      client_id: 'visitor_1',
      ghl_contact_id: 'contact_1',
      first_seen_at: '2026-05-01T00:00:00.000Z',
    });
    const second = await service.resolveCanonicalLeadForVisitor({
      account_id: 11,
      client_id: 'visitor_2',
      ghl_contact_id: 'contact_1',
      phone_hash: 'phone_1',
      first_seen_at: '2026-05-02T00:00:00.000Z',
    });

    assert.equal(first.id, second.id);
    assert.equal(harness.leads.length, 1);
    assert.equal(harness.leads[0].primary_phone_hash, 'phone_1');
    assert.equal(harness.links.filter((link) => link.source_type === 'visitor').length, 2);
  } finally {
    restoreCache(originals);
  }
});

test('canonicalLeadService merges same phone across visitor sources', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/canonicalLeadService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);
  const harness = makeHarness();

  delete require.cache[servicePath];
  require.cache[dbPath] = { exports: harness.db };

  try {
    const service = require('../services/canonicalLeadService');
    const metaLead = await service.resolveCanonicalLeadForVisitor({
      account_id: 11,
      client_id: 'meta_lead_1',
      phone_hash: 'phone_1',
      meta_lead_id: 'meta_1',
    });
    const websiteLead = await service.resolveCanonicalLeadForVisitor({
      account_id: 11,
      client_id: 'web_1',
      phone_hash: 'phone_1',
      email_hash: 'email_1',
    });

    assert.equal(metaLead.id, websiteLead.id);
    assert.equal(harness.leads.length, 1);
    assert.equal(harness.leads[0].primary_meta_lead_id, 'meta_1');
    assert.equal(harness.leads[0].primary_email_hash, 'email_1');
  } finally {
    restoreCache(originals);
  }
});

test('canonicalLeadService keeps unrelated contacts separate', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/canonicalLeadService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);
  const harness = makeHarness();

  delete require.cache[servicePath];
  require.cache[dbPath] = { exports: harness.db };

  try {
    const service = require('../services/canonicalLeadService');
    const first = await service.resolveCanonicalLeadForVisitor({
      account_id: 11,
      client_id: 'visitor_1',
      ghl_contact_id: 'contact_1',
    });
    const second = await service.resolveCanonicalLeadForVisitor({
      account_id: 11,
      client_id: 'visitor_2',
      ghl_contact_id: 'contact_2',
    });

    assert.notEqual(first.id, second.id);
    assert.equal(harness.leads.length, 2);
  } finally {
    restoreCache(originals);
  }
});
