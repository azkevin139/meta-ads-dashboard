const test = require('node:test');
const assert = require('node:assert/strict');

test('resolveCollisionGroup requires rationale for final decisions', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/identityCollisionService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      query: async () => ({}),
      queryAll: async () => [],
      queryOne: async () => ({ id: 1, account_id: 11, status: 'open' }),
    },
  };

  try {
    const service = require('../services/identityCollisionService');
    await assert.rejects(
      () => service.resolveCollisionGroup(11, 1, { decision: 'confirmed_same_person', rationale: 'no' }),
      /Rationale is required/
    );
  } finally {
    delete require.cache[servicePath];
    for (const [key, value] of originals) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  }
});

test('getResolvedHashSets returns only confirmed same-person hashes', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/identityCollisionService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      query: async () => ({}),
      queryOne: async () => null,
      queryAll: async () => [
        { identity_type: 'email_hash', identity_hash: 'email_1', decision: 'confirmed_same_person' },
        { identity_type: 'phone_hash', identity_hash: 'phone_1', decision: 'confirmed_same_person' },
      ],
    },
  };

  try {
    const service = require('../services/identityCollisionService');
    const sets = await service.getResolvedHashSets(11);
    assert.equal(sets.email.has('email_1'), true);
    assert.equal(sets.phone.has('phone_1'), true);
  } finally {
    delete require.cache[servicePath];
    for (const [key, value] of originals) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  }
});
