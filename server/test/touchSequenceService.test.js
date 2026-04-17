const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('touch sequence monitor activates the next step ad set when a threshold is crossed', async () => {
  const dbPath = require.resolve('../db');
  const configPath = require.resolve('../config');
  const metaApiPath = require.resolve('../services/metaApi');
  const audiencePushPath = require.resolve('../services/audiencePushService');
  const actionServicePath = require.resolve('../services/actionService');
  const servicePath = require.resolve('../services/touchSequenceService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [configPath, require.cache[configPath]],
    [metaApiPath, require.cache[metaApiPath]],
    [audiencePushPath, require.cache[audiencePushPath]],
    [actionServicePath, require.cache[actionServicePath]],
    [servicePath, require.cache[servicePath]],
  ]);

  const queryCalls = [];
  const statusCalls = [];
  const actionCalls = [];

  delete require.cache[servicePath];
  require.cache[configPath] = {
    exports: {
      touchSequences: {
        monitorIntervalMs: 60_000,
        webhookSigningSecret: '',
      },
    },
  };
  require.cache[dbPath] = {
    exports: {
      query: async (sql, params) => {
        queryCalls.push({ sql, params });
        return { rows: [] };
      },
      queryAll: async (sql) => {
        if (sql.includes('FROM touch_sequences')) {
          return [{
            id: 11,
            account_id: 5,
            name: '7-touch',
            description: null,
            threshold_default: 3000,
            n8n_webhook_url: null,
            enabled: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }];
        }
        if (sql.includes('FROM touch_sequence_steps')) {
          return [
            {
              id: 21,
              sequence_id: 11,
              step_number: 1,
              name: 'Discovery',
              audience_source_type: 'meta_engagement',
              source_audience_id: 'aud_1',
              segment_key: null,
              target_adset_id: 'adset_1',
              pause_previous_adset: false,
              reduce_previous_budget_to: null,
              threshold_count: 3000,
              enabled: true,
              status: 'waiting',
              last_size: 2900,
              last_checked_at: null,
              last_triggered_at: null,
              last_triggered_count: null,
              last_error: null,
            },
            {
              id: 22,
              sequence_id: 11,
              step_number: 2,
              name: 'Understanding',
              audience_source_type: 'meta_engagement',
              source_audience_id: 'aud_2',
              segment_key: null,
              target_adset_id: 'adset_2',
              pause_previous_adset: true,
              reduce_previous_budget_to: null,
              threshold_count: 3000,
              enabled: true,
              status: 'waiting',
              last_size: 0,
              last_checked_at: null,
              last_triggered_at: null,
              last_triggered_count: null,
              last_error: null,
            },
          ];
        }
        if (sql.includes('FROM touch_sequence_events')) return [];
        throw new Error(`Unexpected queryAll SQL: ${sql}`);
      },
      queryOne: async () => null,
    },
  };
  require.cache[metaApiPath] = {
    exports: {
      metaGet: async (path) => {
        if (path === '/aud_1') {
          return {
            id: 'aud_1',
            name: 'Audience 1',
            approximate_count_lower_bound: 3012,
            approximate_count_upper_bound: 3020,
          };
        }
        if (path === '/aud_2') {
          return {
            id: 'aud_2',
            name: 'Audience 2',
            approximate_count_lower_bound: 1200,
            approximate_count_upper_bound: 1300,
          };
        }
        throw new Error(`Unexpected metaGet path: ${path}`);
      },
      updateStatus: async (entityId, status) => {
        statusCalls.push({ entityId, status });
      },
      updateBudget: async () => {
        throw new Error('updateBudget should not be called in this scenario');
      },
    },
  };
  require.cache[audiencePushPath] = {
    exports: {
      listPushes: async () => [],
      buildSegmentData: async () => ({ emails: [], phones: [], totalRows: 0 }),
    },
  };
  require.cache[actionServicePath] = {
    exports: {
      logAction: async (...args) => {
        actionCalls.push(args);
      },
    },
  };

  try {
    const service = require('../services/touchSequenceService');
    const result = await service.runMonitorForSequence({ id: 5, meta_account_id: 'act_5' }, 11);
    assert.equal(result.steps[0].status, 'triggered');
    assert.deepEqual(statusCalls, [
      { entityId: 'adset_2', status: 'ACTIVE' },
      { entityId: 'adset_1', status: 'PAUSED' },
    ]);
    assert.equal(actionCalls.length, 2);
    assert.match(queryCalls.find((call) => call.sql.includes('INSERT INTO touch_sequence_events')).params[3], /threshold_crossed/);
  } finally {
    restoreCache(originals);
  }
});
