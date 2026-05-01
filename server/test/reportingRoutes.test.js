const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, makeJsonApp } = require('./helpers');

const VALID_TOKEN = 'a'.repeat(43);

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('reporting previous period uses the same number of days', () => {
  const reporting = require('../services/reportingService');
  const range = reporting.resolveRange({ since: '2026-04-10', until: '2026-04-16' });
  const previous = reporting.previousRange(range);
  assert.deepEqual(previous, {
    since: '2026-04-03',
    until: '2026-04-09',
    preset: 'previous_period',
  });
});

test('reporting supports 60 day preset in Dubai timezone', () => {
  const reporting = require('../services/reportingService');
  const range = reporting.resolveRange({ preset: '60d' });
  assert.equal(range.preset, '60d');
  assert.equal(typeof range.since, 'string');
  assert.equal(typeof range.until, 'string');
});

test('authenticated report route denies cross-account client access', async () => {
  const accountServicePath = require.resolve('../services/accountService');
  const dbPath = require.resolve('../db');
  const reportingPath = require.resolve('../services/reportingService');
  const routePath = require.resolve('../routes/reports');
  const originals = new Map([
    [accountServicePath, require.cache[accountServicePath]],
    [dbPath, require.cache[dbPath]],
    [reportingPath, require.cache[reportingPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[accountServicePath] = {
    exports: {
      getAccountById: async () => ({ id: 12, label: 'Other account' }),
    },
  };
  require.cache[dbPath] = {
    exports: {
      queryOne: async () => null,
      query: async () => ({}),
      queryAll: async () => [],
    },
  };
  require.cache[reportingPath] = {
    exports: {
      getLeadReport: async () => ({ summary: {} }),
    },
  };

  try {
    const router = require('../routes/reports');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { id: 7, role: 'viewer' };
      req.metaAccount = { id: 11 };
      next();
    });
    const res = await invoke(app, { url: '/lead-summary?accountId=12' });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /Report access denied/);
  } finally {
    restoreCache(originals);
  }
});

test('public report route resolves token and returns read-only report payload', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  let recorded = false;
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: () => true,
      resolveToken: async () => ({
        id: 3,
        account_id: 11,
        account_label: 'Client A',
        meta_account_id: 'act_123',
        currency: 'USD',
        preset_restrictions: ['7d'],
      }),
      enforcePresetRestriction: () => {},
      recordView: async () => { recorded = true; },
    },
  };
  require.cache[reportingPath] = {
    exports: {
      getLeadReport: async () => ({
        contract_version: 'lead-report.v1',
        range: { since: '2026-04-23', until: '2026-04-29', preset: '7d' },
        summary: { total_leads: 2 },
      }),
    },
  };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, { url: `/${VALID_TOKEN}/lead-summary?preset=7d` });
    assert.equal(res.status, 200);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.json.account.id, 11);
    assert.equal(res.json.data.contract_version, 'lead-report.v1');
    assert.equal(recorded, true);
  } finally {
    restoreCache(originals);
  }
});

test('public report route rejects revoked tokens before report generation', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  let generated = false;
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: () => true,
      resolveToken: async () => {
        const err = new Error('Report link revoked');
        err.httpStatus = 403;
        throw err;
      },
      enforcePresetRestriction: () => {},
      recordView: async () => {},
    },
  };
  require.cache[reportingPath] = {
    exports: {
      getLeadReport: async () => {
        generated = true;
        return {};
      },
    },
  };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, { url: `/${VALID_TOKEN}/lead-summary?preset=7d` });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /revoked/);
    assert.equal(generated, false);
  } finally {
    restoreCache(originals);
  }
});

test('public report route rejects expired tokens before report generation', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  let generated = false;
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: () => true,
      resolveToken: async () => {
        const err = new Error('Report link expired');
        err.httpStatus = 403;
        throw err;
      },
      enforcePresetRestriction: () => {},
      recordView: async () => {},
    },
  };
  require.cache[reportingPath] = {
    exports: {
      getLeadReport: async () => {
        generated = true;
        return {};
      },
    },
  };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, { url: `/${VALID_TOKEN}/lead-summary?preset=7d` });
    assert.equal(res.status, 403);
    assert.match(res.json.error, /expired/);
    assert.equal(generated, false);
  } finally {
    restoreCache(originals);
  }
});

test('public report route uses account from token, not request query', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  let generatedAccountId = null;
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: () => true,
      resolveToken: async () => ({
        id: 4,
        account_id: 11,
        account_label: 'Client A',
        meta_account_id: 'act_123',
        preset_restrictions: [],
      }),
      enforcePresetRestriction: () => {},
      recordView: async () => {},
    },
  };
  require.cache[reportingPath] = {
    exports: {
      getLeadReport: async (accountId) => {
        generatedAccountId = accountId;
        return { contract_version: 'lead-report.v1', range: { preset: '7d' }, summary: {} };
      },
    },
  };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, { url: `/${VALID_TOKEN}/lead-summary?preset=7d&accountId=999` });
    assert.equal(res.status, 200);
    assert.equal(generatedAccountId, 11);
  } finally {
    restoreCache(originals);
  }
});

test('public report viewer timezone endpoint returns proxy timezone when available', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: () => true,
      resolveToken: async () => ({ id: 4, account_id: 11 }),
      enforcePresetRestriction: () => {},
      recordView: async () => {},
    },
  };
  require.cache[reportingPath] = { exports: { getLeadReport: async () => ({}) } };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, {
      url: `/${VALID_TOKEN}/viewer-timezone`,
      headers: { 'cf-timezone': 'Asia/Bangkok' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.timezone, 'Asia/Bangkok');
    assert.equal(res.json.source, 'ip');
  } finally {
    restoreCache(originals);
  }
});

test('public report route fast-rejects malformed tokens before DB lookup', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const throttlePath = require.resolve('../services/reportLinkThrottle');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [throttlePath, require.cache[throttlePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  let resolveCalled = false;
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: (token) => /^[A-Za-z0-9_-]{43}$/.test(String(token || '')),
      resolveToken: async () => { resolveCalled = true; return {}; },
      enforcePresetRestriction: () => {},
      recordView: async () => {},
    },
  };
  require.cache[reportingPath] = { exports: { getLeadReport: async () => ({}) } };
  require.cache[throttlePath] = {
    exports: { isBlocked: () => false, noteFailure: () => 1, reset: () => {} },
  };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, { url: '/garbage/lead-summary?preset=7d' });
    assert.equal(res.status, 401);
    assert.match(res.json.error, /Invalid report link/);
    assert.equal(resolveCalled, false);
  } finally {
    restoreCache(originals);
  }
});

test('public report route 429s once invalid-token throttle is tripped', async () => {
  const reportLinksPath = require.resolve('../services/reportLinkService');
  const reportingPath = require.resolve('../services/reportingService');
  const throttlePath = require.resolve('../services/reportLinkThrottle');
  const routePath = require.resolve('../routes/publicReports');
  const originals = new Map([
    [reportLinksPath, require.cache[reportLinksPath]],
    [reportingPath, require.cache[reportingPath]],
    [throttlePath, require.cache[throttlePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  let resolveCalled = false;
  require.cache[reportLinksPath] = {
    exports: {
      isValidTokenFormat: () => true,
      resolveToken: async () => { resolveCalled = true; return {}; },
      enforcePresetRestriction: () => {},
      recordView: async () => {},
    },
  };
  require.cache[reportingPath] = { exports: { getLeadReport: async () => ({}) } };
  require.cache[throttlePath] = {
    exports: { isBlocked: () => true, noteFailure: () => 11, reset: () => {} },
  };

  try {
    const router = require('../routes/publicReports');
    const app = makeJsonApp(router);
    const res = await invoke(app, { url: `/${VALID_TOKEN}/lead-summary?preset=7d` });
    assert.equal(res.status, 429);
    assert.match(res.json.error, /Too many invalid report attempts/);
    assert.equal(resolveCalled, false);
  } finally {
    restoreCache(originals);
  }
});
