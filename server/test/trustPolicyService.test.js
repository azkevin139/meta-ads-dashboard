const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('trust policy blocks revisit automation for medium identity', async () => {
  const dbPath = require.resolve('../db');
  const syncTruthPath = require.resolve('../services/syncTruthService');
  const policyPath = require.resolve('../services/trustPolicyService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [syncTruthPath, require.cache[syncTruthPath]],
    [policyPath, require.cache[policyPath]],
  ]);

  delete require.cache[policyPath];
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => null,
      queryAll: async () => [],
    },
  };
  require.cache[syncTruthPath] = {
    exports: {
      getHealth: async () => [],
    },
  };

  try {
    const policy = require('../services/trustPolicyService');
    const decision = await policy.assertRevisitAllowed({
      account_id: 11,
      client_id: 'ghl_contact_1',
      ghl_contact_id: 'contact_1',
      email_hash: 'hash',
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.identity.confidence, 'medium');
  } finally {
    delete require.cache[policyPath];
    restoreCache(originals);
  }
});

test('trust policy blocks audience push on failed upstream data', async () => {
  const dbPath = require.resolve('../db');
  const syncTruthPath = require.resolve('../services/syncTruthService');
  const policyPath = require.resolve('../services/trustPolicyService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [syncTruthPath, require.cache[syncTruthPath]],
    [policyPath, require.cache[policyPath]],
  ]);

  delete require.cache[policyPath];
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => null,
      queryAll: async () => [],
    },
  };
  require.cache[syncTruthPath] = {
    exports: {
      getHealth: async () => [
        { source: 'meta', dataset: 'leads', status: 'failed', partial_reason: 'meta_rate_limited' },
        { source: 'ghl', dataset: 'contacts', status: 'success', last_successful_at: new Date().toISOString() },
      ],
    },
  };

  try {
    const policy = require('../services/trustPolicyService');
    const decision = await policy.assertAudiencePushAllowed(11);
    assert.equal(decision.allowed, false);
    assert.deepEqual(decision.reasons, ['meta_rate_limited']);
  } finally {
    delete require.cache[policyPath];
    restoreCache(originals);
  }
});
