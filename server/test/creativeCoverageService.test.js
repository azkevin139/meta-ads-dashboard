const test = require('node:test');
const assert = require('node:assert/strict');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

async function withService(row, fn) {
  const dbPath = require.resolve('../db');
  const servicePath = require.resolve('../services/creativeCoverageService');
  const originals = new Map([
    [dbPath, require.cache[dbPath]],
    [servicePath, require.cache[servicePath]],
  ]);

  delete require.cache[servicePath];
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => row,
    },
  };

  try {
    const service = require('../services/creativeCoverageService');
    await fn(service);
  } finally {
    restoreCache(originals);
  }
}

test('creativeCoverageService returns unavailable when ad-level rows are missing', async () => {
  await withService({
    ads_total: 10,
    ad_level_ads: 0,
    ads_with_metadata: 0,
    total_leads: 5,
    attributed_leads: 0,
    qualified_leads: 2,
    attributed_qualified_leads: 0,
  }, async (service) => {
    const coverage = await service.getCoverage(11, '2026-04-01', '2026-04-30');
    assert.equal(coverage.status, 'unavailable');
    assert.equal(coverage.ready, false);
    assert.equal(coverage.reason_code, 'ad_level_insights_missing');
  });
});

test('creativeCoverageService returns partial when lead attribution is low', async () => {
  await withService({
    ads_total: 10,
    ad_level_ads: 10,
    ads_with_metadata: 10,
    total_leads: 20,
    attributed_leads: 2,
    qualified_leads: 5,
    attributed_qualified_leads: 1,
  }, async (service) => {
    const coverage = await service.getCoverage(11, '2026-04-01', '2026-04-30');
    assert.equal(coverage.status, 'partial');
    assert.equal(coverage.ready, true);
    assert.equal(coverage.reason_code, 'lead_ad_attribution_coverage_low');
    assert.equal(coverage.lead_ad_attribution_pct, 10);
  });
});

test('creativeCoverageService returns available when ad and lead coverage are sufficient', async () => {
  await withService({
    ads_total: 10,
    ad_level_ads: 10,
    ads_with_metadata: 10,
    total_leads: 20,
    attributed_leads: 12,
    qualified_leads: 5,
    attributed_qualified_leads: 4,
  }, async (service) => {
    const coverage = await service.getCoverage(11, '2026-04-01', '2026-04-30');
    assert.equal(coverage.status, 'available');
    assert.equal(coverage.ready, true);
    assert.equal(coverage.reason_code, null);
    assert.equal(coverage.qualified_lead_ad_attribution_pct, 80);
  });
});
