const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('tracking recovery saves outage windows in Postgres', async () => {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/trackingRecoveryService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);
  const calls = [];

  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      queryAll: async () => [],
      queryOne: async (sql, params) => {
        calls.push({ sql, params });
        return {
          id: 7,
          outage_start: params[1],
          outage_end: params[2],
          notes: params[3],
          status: 'active',
          updated_at: '2026-04-21T00:00:00.000Z',
        };
      },
    },
  };

  try {
    const service = require('../services/trackingRecoveryService');
    const saved = await service.saveWindow(11, {
      outage_start: '2026-04-13',
      outage_end: '2026-04-19',
      notes: 'tracker outage',
    });
    assert.equal(saved.id, 7);
    assert.equal(saved.outage_start, '2026-04-13');
    assert.match(calls[0].sql, /tracking_outage_windows/);
    assert.deepEqual(calls[0].params, [11, '2026-04-13', '2026-04-19', 'tracker outage']);
  } finally {
    delete require.cache[servicePath];
    restoreCache(originals);
  }
});

test('tracking recovery rejects invalid outage date ranges', async () => {
  const service = require('../services/trackingRecoveryService');
  await assert.rejects(
    () => service.saveWindow(11, { outage_start: '2026-04-19', outage_end: '2026-04-13' }),
    /outage_end must be on or after outage_start/
  );
});
