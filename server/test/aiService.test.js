const test = require('node:test');
const assert = require('node:assert/strict');

test('getRecommendations parameterizes status filter', async () => {
  const dbPath = require.resolve('../db');
  const intelligencePath = require.resolve('../services/intelligenceService');
  const aiPath = require.resolve('../services/aiService');

  const originalDb = require.cache[dbPath];
  const originalIntelligence = require.cache[intelligencePath];
  delete require.cache[aiPath];

  let captured = null;
  require.cache[dbPath] = {
    exports: {
      queryAll: async (text, params) => {
        captured = { text, params };
        return [];
      },
      queryOne: async () => null,
      query: async () => ({}),
    },
  };
  require.cache[intelligencePath] = {
    exports: {
      getDecisionRules: async () => ({ queues: {}, data: [] }),
      readTargets: () => ({}),
    },
  };

  try {
    const aiService = require('../services/aiService');
    await aiService.getRecommendations(7, "pending' OR 1=1 --");
    assert.ok(captured);
    assert.match(captured.text, /status = \$2/);
    assert.deepEqual(captured.params, [7, "pending' OR 1=1 --"]);
  } finally {
    delete require.cache[aiPath];
    if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
    if (originalIntelligence) require.cache[intelligencePath] = originalIntelligence; else delete require.cache[intelligencePath];
  }
});
