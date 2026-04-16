const test = require('node:test');
const assert = require('node:assert/strict');

test('syncAccountLeads skips account when budget mode is cache_only', async () => {
  const metaApiPath = require.resolve('../services/metaApi');
  const metaCachePath = require.resolve('../services/metaCache');
  const trackingPath = require.resolve('../services/trackingService');
  const dbPath = require.resolve('../db');
  const accountServicePath = require.resolve('../services/accountService');
  const syncPath = require.resolve('../services/metaLeadSyncService');

  const originals = new Map([
    [metaApiPath, require.cache[metaApiPath]],
    [metaCachePath, require.cache[metaCachePath]],
    [trackingPath, require.cache[trackingPath]],
    [dbPath, require.cache[dbPath]],
    [accountServicePath, require.cache[accountServicePath]],
    [syncPath, require.cache[syncPath]],
  ]);

  delete require.cache[syncPath];
  require.cache[metaApiPath] = {
    exports: {
      contextAccountId: (account) => account.meta_account_id,
      metaGetAll: async () => [],
      isUserRateLimitError: () => false,
      getCooldownRemainingSeconds: () => 0,
    },
  };
  require.cache[metaCachePath] = {
    exports: {
      budgetStatus: () => ({ mode: 'cache_only' }),
    },
  };
  require.cache[trackingPath] = { exports: { recordEvent: async () => ({}) } };
  require.cache[accountServicePath] = { exports: { getAccountById: async () => null } };
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => ({ last_leads_sync_at: null }),
      queryAll: async () => [],
      query: async () => ({}),
    },
  };

  try {
    const svc = require('../services/metaLeadSyncService');
    const result = await svc.syncAccountLeads({ id: 1, meta_account_id: 'act_1' });
    assert.equal(result.imported, 0);
    assert.match(result.error, /cache_only/);
  } finally {
    delete require.cache[syncPath];
    for (const [key, value] of originals) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  }
});

test('listLeadAds rate-limit error aborts sync and is reported', async () => {
  const metaApiPath = require.resolve('../services/metaApi');
  const metaCachePath = require.resolve('../services/metaCache');
  const trackingPath = require.resolve('../services/trackingService');
  const dbPath = require.resolve('../db');
  const accountServicePath = require.resolve('../services/accountService');
  const syncPath = require.resolve('../services/metaLeadSyncService');

  const originals = new Map([
    [metaApiPath, require.cache[metaApiPath]],
    [metaCachePath, require.cache[metaCachePath]],
    [trackingPath, require.cache[trackingPath]],
    [dbPath, require.cache[dbPath]],
    [accountServicePath, require.cache[accountServicePath]],
    [syncPath, require.cache[syncPath]],
  ]);

  delete require.cache[syncPath];
  require.cache[metaApiPath] = {
    exports: {
      contextAccountId: (account) => account.meta_account_id,
      metaGetAll: async () => {
        const err = new Error('User request limit reached');
        err.httpStatus = 429;
        throw err;
      },
      isUserRateLimitError: (err) => /user request limit/i.test(err.message),
      getCooldownRemainingSeconds: () => 0,
    },
  };
  require.cache[metaCachePath] = {
    exports: {
      budgetStatus: () => ({ mode: 'normal' }),
    },
  };
  require.cache[trackingPath] = { exports: { recordEvent: async () => ({}) } };
  require.cache[accountServicePath] = { exports: { getAccountById: async () => null } };
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => ({ last_leads_sync_at: null }),
      queryAll: async () => [],
      query: async () => ({}),
    },
  };

  try {
    const svc = require('../services/metaLeadSyncService');
    const result = await svc.syncAccountLeads({ id: 1, meta_account_id: 'act_1' });
    assert.equal(result.imported, 0);
    assert.match(result.error, /User request limit reached/);
  } finally {
    delete require.cache[syncPath];
    for (const [key, value] of originals) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  }
});

test('syncAllAccounts limits each run to the stalest accounts first', async () => {
  const metaApiPath = require.resolve('../services/metaApi');
  const metaCachePath = require.resolve('../services/metaCache');
  const trackingPath = require.resolve('../services/trackingService');
  const dbPath = require.resolve('../db');
  const accountServicePath = require.resolve('../services/accountService');
  const syncPath = require.resolve('../services/metaLeadSyncService');

  const originals = new Map([
    [metaApiPath, require.cache[metaApiPath]],
    [metaCachePath, require.cache[metaCachePath]],
    [trackingPath, require.cache[trackingPath]],
    [dbPath, require.cache[dbPath]],
    [accountServicePath, require.cache[accountServicePath]],
    [syncPath, require.cache[syncPath]],
  ]);

  const touchedIds = [];
  const originalLimit = process.env.META_LEAD_SYNC_MAX_ACCOUNTS_PER_RUN;
  process.env.META_LEAD_SYNC_MAX_ACCOUNTS_PER_RUN = '2';

  delete require.cache[syncPath];
  require.cache[metaApiPath] = {
    exports: {
      contextAccountId: (account) => account.meta_account_id,
      metaGetAll: async (path) => {
        if (path.endsWith('/ads')) return [];
        return [];
      },
      isUserRateLimitError: () => false,
      getCooldownRemainingSeconds: () => 0,
    },
  };
  require.cache[metaCachePath] = {
    exports: {
      budgetStatus: () => ({ mode: 'normal' }),
    },
  };
  require.cache[trackingPath] = { exports: { recordEvent: async () => ({}) } };
  require.cache[accountServicePath] = {
    exports: {
      getAccountById: async (id) => {
        touchedIds.push(id);
        return { id, meta_account_id: `act_${id}`, access_token: 'token' };
      },
    },
  };
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => ({ last_leads_sync_at: null }),
      queryAll: async (text, params) => {
        assert.match(text, /LIMIT \$1/);
        assert.deepEqual(params, [2]);
        return [{ id: 11 }, { id: 3 }];
      },
      query: async () => ({}),
    },
  };

  try {
    const svc = require('../services/metaLeadSyncService');
    const results = await svc.syncAllAccounts();
    assert.deepEqual(touchedIds, [11, 3]);
    assert.equal(results.length, 2);
  } finally {
    delete require.cache[syncPath];
    if (originalLimit == null) delete process.env.META_LEAD_SYNC_MAX_ACCOUNTS_PER_RUN;
    else process.env.META_LEAD_SYNC_MAX_ACCOUNTS_PER_RUN = originalLimit;
    for (const [key, value] of originals) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  }
});
