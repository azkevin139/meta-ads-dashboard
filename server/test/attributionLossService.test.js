const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

async function withService(rows, fn) {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/attributionLossService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  let calls = 0;
  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      queryAll: async () => rows[calls++] || [],
    },
  };

  try {
    const service = require('../services/attributionLossService');
    await fn(service);
  } finally {
    restoreCache(originals);
  }
}

test('attributionLossService classifies missing identifier rates for one account', async () => {
  await withService([[
    {
      account_id: 11,
      range: { since: '2026-04-01', until: '2026-04-30', preset: 'custom' },
      timezone: 'Asia/Dubai',
      total_leads: 10,
      missing_ad_id: 4,
      missing_campaign_id: 1,
      missing_source_event_type: 2,
      missing_fbclid: 9,
      missing_fbc: 3,
      missing_fbp: 3,
      missing_gclid: 10,
      missing_ghl_contact_id: 0,
      unmatched_replied_contacts: 1,
    },
  ]], async (service) => {
    const result = await service.getLoss(11, { since: '2026-04-01', until: '2026-04-30' });
    assert.equal(result.account_id, 11);
    assert.equal(result.total_leads, 10);
    assert.equal(result.missing.ad_id, 4);
    assert.equal(result.rates.ad_id, 40);
    assert.equal(result.missing.unmatched_replied_contacts, 1);
    assert.equal(result.status, 'attention');
  });
});

test('attributionLossService can rank all accounts with visitor rows', async () => {
  await withService([
    [{ account_id: 7 }, { account_id: 11 }],
    [{ account_id: 7, range: {}, timezone: 'Asia/Dubai', total_leads: 0 }],
    [{ account_id: 11, range: {}, timezone: 'Asia/Dubai', total_leads: 2, missing_ad_id: 0 }],
  ], async (service) => {
    const results = await service.getLossForAccounts({ preset: '7d' });
    assert.equal(results.length, 2);
    assert.equal(results[0].account_id, 7);
    assert.equal(results[0].status, 'no_leads');
    assert.equal(results[1].account_id, 11);
  });
});
