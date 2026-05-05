const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

async function withService({ entityRow = null } = {}, fn) {
  const dbPath = require.resolve('../db');
  const metaApiPath = require.resolve('../services/metaApi');
  const servicePath = require.resolve('../services/actionService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [metaApiPath, require.cache[metaApiPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  const calls = [];
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      queryOne: async (sql, params) => {
        calls.push({ kind: 'queryOne', sql, params });
        if (/WHERE/.test(sql)) return entityRow;
        return null;
      },
      query: async (sql, params) => {
        calls.push({ kind: 'query', sql, params });
        return { rows: [] };
      },
      queryAll: async () => [],
    },
  };
  require.cache[metaApiPath] = {
    exports: {
      updateStatus: async (id, status) => {
        calls.push({ kind: 'updateStatus', id, status });
        return { success: true };
      },
      updateBudget: async (id, budget) => {
        calls.push({ kind: 'updateBudget', id, budget });
        return { success: true };
      },
      duplicateEntity: async (id, type) => {
        calls.push({ kind: 'duplicateEntity', id, type });
        return { copied_campaign_id: 'copy_1' };
      },
    },
  };

  try {
    const service = require('../services/actionService');
    await fn(service, calls);
  } finally {
    restoreCache(originals);
  }
}

test('actionService refuses pause when entity is not owned by requested account', async () => {
  await withService({ entityRow: null }, async (service, calls) => {
    await assert.rejects(
      service.pauseEntity(7, 'campaign', 'cmp_other'),
      /campaign not found for account 7/
    );
    assert.equal(calls.some((call) => call.kind === 'updateStatus'), false);
  });
});

test('actionService scopes status updates by account_id inside the service', async () => {
  await withService({
    entityRow: { id: 1, account_id: 11, name: 'Campaign A', status: 'ACTIVE' },
  }, async (service, calls) => {
    const result = await service.pauseEntity(11, 'campaign', 'cmp_1');
    assert.equal(result.success, true);
    const select = calls.find((call) => call.kind === 'queryOne');
    assert.match(select.sql, /account_id = \$2/);
    assert.deepEqual(select.params, ['cmp_1', 11]);
    const update = calls.find((call) => call.kind === 'query' && /UPDATE campaigns/.test(call.sql));
    assert.match(update.sql, /account_id = \$2/);
    assert.deepEqual(update.params, ['cmp_1', 11]);
  });
});

test('actionService scopes budget updates by account_id inside the service', async () => {
  await withService({
    entityRow: { id: 2, account_id: 11, name: 'Ad Set A', daily_budget: 2500 },
  }, async (service, calls) => {
    const result = await service.updateBudget(11, 'as_1', 42.5);
    assert.equal(result.new, 4250);
    const select = calls.find((call) => call.kind === 'queryOne');
    assert.match(select.sql, /account_id = \$2/);
    assert.deepEqual(select.params, ['as_1', 11]);
    const update = calls.find((call) => call.kind === 'query' && /UPDATE adsets/.test(call.sql));
    assert.match(update.sql, /account_id = \$3/);
    assert.deepEqual(update.params, [4250, 'as_1', 11]);
  });
});
