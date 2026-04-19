const test = require('node:test');
const assert = require('node:assert/strict');
const { invoke, makeJsonApp } = require('./helpers');

function restoreCache(entries) {
  for (const [key, value] of entries) {
    if (value) require.cache[key] = value;
    else delete require.cache[key];
  }
}

test('auth login sets session cookie and registration is disabled by default', async () => {
  const authServicePath = require.resolve('../services/authService');
  const configPath = require.resolve('../config');
  const routePath = require.resolve('../routes/auth');
  const originals = new Map([
    [authServicePath, require.cache[authServicePath]],
    [configPath, require.cache[configPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[authServicePath] = {
    exports: {
      login: async () => ({ token: 'signed-token', user: { id: 1, email: 'a@test.com', role: 'admin' } }),
      logout: async () => {},
      getUserFromToken: async () => ({ id: 1, email: 'a@test.com', role: 'admin' }),
      register: async () => ({ id: 2 }),
    },
  };
  require.cache[configPath] = {
    exports: {
      isProduction: false,
      allowSelfSignup: false,
    },
  };

  try {
    const router = require('../routes/auth');
    const app = makeJsonApp(router);
    const loginRes = await invoke(app, {
      method: 'POST',
      url: '/login',
      headers: { 'content-type': 'application/json' },
      body: { email: 'a@test.com', password: 'very-secure-password' },
    });
    assert.equal(loginRes.status, 200);
    assert.match(loginRes.headers['set-cookie'] || '', /session_token=/);
    assert.equal(loginRes.json.user.email, 'a@test.com');
    assert.equal(loginRes.json.token, undefined);

    const registerRes = await invoke(app, {
      method: 'POST',
      url: '/register',
      headers: { 'content-type': 'application/json' },
      body: { email: 'b@test.com', password: 'very-secure-password' },
    });
    assert.equal(registerRes.status, 403);
  } finally {
    restoreCache(originals);
  }
});

test('tracking routes reject missing required identifiers', async () => {
  const trackingServicePath = require.resolve('../services/trackingService');
  const routePath = require.resolve('../routes/tracking');
  const originals = new Map([
    [trackingServicePath, require.cache[trackingServicePath]],
    [routePath, require.cache[routePath]],
  ]);
  delete require.cache[routePath];
  require.cache[trackingServicePath] = {
    exports: {
      recordEvent: async () => ({ client_id: 'abc123' }),
    },
  };

  try {
    const router = require('../routes/tracking');
    const app = makeJsonApp(router);
    const res = await invoke(app, {
      method: 'POST',
      url: '/pageview',
      headers: { 'content-type': 'application/json' },
      body: { event_name: 'PageView' },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /meta_account_id required/);
  } finally {
    restoreCache(originals);
  }
});

test('meta webhook rejects unsigned requests in production when secret is missing', async () => {
  const configPath = require.resolve('../config');
  const trackingServicePath = require.resolve('../services/trackingService');
  const routePath = require.resolve('../routes/webhooks');
  const originals = new Map([
    [configPath, require.cache[configPath]],
    [trackingServicePath, require.cache[trackingServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[configPath] = { exports: { isProduction: true } };
  require.cache[trackingServicePath] = {
    exports: {
      handleMetaLead: async () => ({ client_id: 'meta' }),
      handleGhlWebhook: async () => ({ client_id: 'ghl' }),
    },
  };

  try {
    const router = require('../routes/webhooks');
    const app = makeJsonApp(router);
    const res = await invoke(app, {
      method: 'POST',
      url: '/meta-leads',
      headers: { 'content-type': 'application/json' },
      body: { entry: [] },
    });
    assert.equal(res.status, 503);
  } finally {
    restoreCache(originals);
  }
});

test('cache stats endpoint is admin only', async () => {
  const metaUsagePath = require.resolve('../services/metaUsageService');
  const metaCachePath = require.resolve('../services/metaCache');
  const routePath = require.resolve('../routes/metaRate');
  const originals = new Map([
    [metaUsagePath, require.cache[metaUsagePath]],
    [metaCachePath, require.cache[metaCachePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[metaUsagePath] = {
    exports: {
      fetchLiveStatus: async () => ({ safe_to_write: true }),
    },
  };
  require.cache[metaCachePath] = {
    exports: {
      budgetStatus: () => ({ used: 1, limit: 10, pct: 10, mode: 'normal' }),
      stats: () => ({ entries: 1 }),
    },
  };

  try {
    const router = require('../routes/metaRate');
    const viewerApp = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'viewer' };
      next();
    });
    const denied = await invoke(viewerApp, { url: '/cache-stats' });
    assert.equal(denied.status, 403);

    const adminApp = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin' };
      next();
    });
    const allowed = await invoke(adminApp, { url: '/cache-stats' });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.entries, 1);
  } finally {
    restoreCache(originals);
  }
});

test('admin users create supports role assignment and user updates ignore meta_token drift', async () => {
  const authServicePath = require.resolve('../services/authService');
  const routePath = require.resolve('../routes/admin');
  const originals = new Map([
    [authServicePath, require.cache[authServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  let createdPayload = null;
  let updatedPayload = null;
  delete require.cache[routePath];
  require.cache[authServicePath] = {
    exports: {
      getAllUsers: async () => [],
      getActiveSessions: async () => [],
      register: async (email, password, name, role) => {
        createdPayload = { email, password, name, role };
        return { id: 9, email, name, role };
      },
      updateUser: async (_userId, updates) => {
        updatedPayload = updates;
      },
      deleteUser: async () => {},
    },
  };

  try {
    const router = require('../routes/admin');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { id: 1, role: 'admin' };
      next();
    });

    const createRes = await invoke(app, {
      method: 'POST',
      url: '/users',
      headers: { 'content-type': 'application/json' },
      body: { email: 'new@test.com', password: 'long-enough-password', name: 'New User', role: 'operator' },
    });
    assert.equal(createRes.status, 200);
    assert.deepEqual(createdPayload, {
      email: 'new@test.com',
      password: 'long-enough-password',
      name: 'New User',
      role: 'operator',
    });

    const updateRes = await invoke(app, {
      method: 'POST',
      url: '/users/9',
      headers: { 'content-type': 'application/json' },
      body: { role: 'viewer', meta_token: 'should-be-ignored' },
    });
    assert.equal(updateRes.status, 200);
    assert.deepEqual(updatedPayload, {
      role: 'viewer',
      is_active: undefined,
      name: undefined,
      password: undefined,
    });
  } finally {
    restoreCache(originals);
  }
});

test('create bulk-action rejects invalid entity type before Meta calls', async () => {
  const metaApiPath = require.resolve('../services/metaApi');
  const metaUsagePath = require.resolve('../services/metaUsageService');
  const actionServicePath = require.resolve('../services/actionService');
  const routePath = require.resolve('../routes/create');
  const originals = new Map([
    [metaApiPath, require.cache[metaApiPath]],
    [metaUsagePath, require.cache[metaUsagePath]],
    [actionServicePath, require.cache[actionServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[metaApiPath] = { exports: { metaPost: async () => ({}) } };
  require.cache[metaUsagePath] = { exports: { fetchLiveStatus: async () => ({ safe_to_write: true }) } };
  require.cache[actionServicePath] = { exports: { logAction: async () => ({}) } };

  try {
    const router = require('../routes/create');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 1, meta_account_id: 'act_1' };
      next();
    });
    const res = await invoke(app, {
      method: 'POST',
      url: '/bulk-action',
      headers: { 'content-type': 'application/json' },
      body: { entityIds: ['123'], entityType: 'bad', action: 'pause' },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /entityType must be campaign, adset, or ad/);
  } finally {
    restoreCache(originals);
  }
});

test('create campaign validates enums, schedule, and logs against resolved account', async () => {
  const metaApiPath = require.resolve('../services/metaApi');
  const metaUsagePath = require.resolve('../services/metaUsageService');
  const actionServicePath = require.resolve('../services/actionService');
  const routePath = require.resolve('../routes/create');
  const originals = new Map([
    [metaApiPath, require.cache[metaApiPath]],
    [metaUsagePath, require.cache[metaUsagePath]],
    [actionServicePath, require.cache[actionServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  let loggedArgs = null;
  let metaPayload = null;
  delete require.cache[routePath];
  require.cache[metaApiPath] = {
    exports: {
      metaPost: async (_path, payload) => {
        metaPayload = payload;
        return { id: '12001' };
      },
      contextAccountId: () => 'act_1',
    },
  };
  require.cache[metaUsagePath] = { exports: { fetchLiveStatus: async () => ({ safe_to_write: true }) } };
  require.cache[actionServicePath] = {
    exports: {
      logAction: async (...args) => { loggedArgs = args; },
    },
  };

  try {
    const router = require('../routes/create');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 44, meta_account_id: 'act_1' };
      next();
    });

    const invalidBudgetRes = await invoke(app, {
      method: 'POST',
      url: '/campaign',
      headers: { 'content-type': 'application/json' },
      body: {
        name: 'Test Campaign',
        objective: 'OUTCOME_SALES',
        dailyBudget: 50,
        lifetimeBudget: 500,
      },
    });
    assert.equal(invalidBudgetRes.status, 400);
    assert.match(invalidBudgetRes.json.error, /dailyBudget or lifetimeBudget/);

    const invalidScheduleRes = await invoke(app, {
      method: 'POST',
      url: '/campaign',
      headers: { 'content-type': 'application/json' },
      body: {
        name: 'Test Campaign',
        objective: 'OUTCOME_SALES',
        startTime: '2026-04-18T10:00:00.000Z',
        stopTime: '2026-04-18T09:00:00.000Z',
      },
    });
    assert.equal(invalidScheduleRes.status, 400);
    assert.match(invalidScheduleRes.json.error, /stopTime must be after startTime/);

    const invalidEnumRes = await invoke(app, {
      method: 'POST',
      url: '/campaign',
      headers: { 'content-type': 'application/json' },
      body: {
        name: 'Test Campaign',
        objective: 'BAD_OBJECTIVE',
      },
    });
    assert.equal(invalidEnumRes.status, 400);
    assert.match(invalidEnumRes.json.error, /objective is invalid/);

    const validRes = await invoke(app, {
      method: 'POST',
      url: '/campaign',
      headers: { 'content-type': 'application/json' },
      body: {
        accountId: 999,
        name: 'Test Campaign',
        objective: 'OUTCOME_SALES',
        status: 'ACTIVE',
        buyingType: 'AUCTION',
        specialAdCategories: ['HOUSING'],
        internalTags: ['launch', 'cbo'],
        dailyBudget: 50,
        startTime: '2026-04-18T09:00:00.000Z',
        stopTime: '2026-04-18T10:00:00.000Z',
      },
    });
    assert.equal(validRes.status, 200);
    assert.equal(validRes.json.campaign_id, '12001');
    assert.equal(metaPayload.daily_budget, 5000);
    assert.equal(metaPayload.start_time, '2026-04-18T09:00:00.000Z');
    assert.equal(metaPayload.stop_time, '2026-04-18T10:00:00.000Z');
    assert.equal(loggedArgs[0], 44);
    assert.deepEqual(loggedArgs[5].internal_tags, ['launch', 'cbo']);
  } finally {
    restoreCache(originals);
  }
});

test('meta update-ad requires adId', async () => {
  const metaApiPath = require.resolve('../services/metaApi');
  const leadSyncPath = require.resolve('../services/metaLeadSyncService');
  const accountServicePath = require.resolve('../services/accountService');
  const routePath = require.resolve('../routes/meta');
  const originals = new Map([
    [metaApiPath, require.cache[metaApiPath]],
    [leadSyncPath, require.cache[leadSyncPath]],
    [accountServicePath, require.cache[accountServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[metaApiPath] = {
    exports: {
      metaGet: async () => ({}),
      metaPost: async () => ({}),
      contextAccountId: () => 'act_1',
      getAdAccounts: async () => [],
      getCampaigns: async () => [],
      getAdSets: async () => [],
      getAds: async () => [],
      getInsightsRange: async () => [],
      getInsights: async () => [],
    },
  };
  require.cache[leadSyncPath] = { exports: { syncAccountLeads: async () => ({}) } };
  require.cache[accountServicePath] = { exports: {} };

  try {
    const router = require('../routes/meta');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 1, meta_account_id: 'act_1' };
      next();
    });
    const res = await invoke(app, {
      method: 'POST',
      url: '/update-ad',
      headers: { 'content-type': 'application/json' },
      body: { headline: 'New headline' },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /adId required/);
  } finally {
    restoreCache(originals);
  }
});

test('metaEntity rejects invalid entity level', async () => {
  const metaUsagePath = require.resolve('../services/metaUsageService');
  const entityServicePath = require.resolve('../services/metaEntityService');
  const routePath = require.resolve('../routes/metaEntity');
  const originals = new Map([
    [metaUsagePath, require.cache[metaUsagePath]],
    [entityServicePath, require.cache[entityServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[metaUsagePath] = { exports: { fetchLiveStatus: async () => ({ safe_to_write: true }) } };
  require.cache[entityServicePath] = {
    exports: {
      getEntity: async () => ({}),
      updateEntity: async () => ({}),
      updateEntityStatus: async () => ({}),
      duplicateEntity: async () => ({}),
    },
  };

  try {
    const router = require('../routes/metaEntity');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 1, meta_account_id: 'act_1' };
      next();
    });
    const res = await invoke(app, {
      method: 'POST',
      url: '/entity/not-a-level/123/status',
      headers: { 'content-type': 'application/json' },
      body: { status: 'ACTIVE' },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Invalid entity level/);
  } finally {
    restoreCache(originals);
  }
});

test('accounts discover requires token', async () => {
  const accountServicePath = require.resolve('../services/accountService');
  const tokenHealthPath = require.resolve('../services/tokenHealthService');
  const ghlPath = require.resolve('../services/ghlService');
  const routePath = require.resolve('../routes/accounts');
  const originals = new Map([
    [accountServicePath, require.cache[accountServicePath]],
    [tokenHealthPath, require.cache[tokenHealthPath]],
    [ghlPath, require.cache[ghlPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[accountServicePath] = {
    exports: {
      discoverAccountsForToken: async () => ({ data: [] }),
      publicAccount: (account) => account,
      listAccounts: async () => [],
      updateSessionAccount: async () => ({}),
    },
  };
  require.cache[tokenHealthPath] = { exports: { getAccountsHealthSummary: async () => [], daysUntil: () => 0, warningLevel: () => 'ok' } };
  require.cache[ghlPath] = { exports: {} };

  try {
    const router = require('../routes/accounts');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', session_token_hash: 'hash' };
      next();
    });
    const res = await invoke(app, {
      method: 'POST',
      url: '/discover',
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /token required/);
  } finally {
    restoreCache(originals);
  }
});

test('intelligence auto-refresh requires boolean enabled', async () => {
  const intelligencePath = require.resolve('../services/intelligenceService');
  const trackingServicePath = require.resolve('../services/trackingService');
  const audiencePushPath = require.resolve('../services/audiencePushService');
  const routePath = require.resolve('../routes/intelligence');
  const originals = new Map([
    [intelligencePath, require.cache[intelligencePath]],
    [trackingServicePath, require.cache[trackingServicePath]],
    [audiencePushPath, require.cache[audiencePushPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[intelligencePath] = { exports: { readTargets: () => ({}), DEFAULT_TARGETS: {} } };
  require.cache[trackingServicePath] = { exports: { getHealth: async () => ({}) } };
  require.cache[audiencePushPath] = { exports: { setAutoRefresh: async () => ({}) } };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin' };
      req.metaAccount = { id: 1 };
      next();
    });
    const res = await invoke(app, {
      method: 'POST',
      url: '/audience-push/12/auto-refresh',
      headers: { 'content-type': 'application/json' },
      body: { enabled: 'yes' },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /enabled must be true or false/);
  } finally {
    restoreCache(originals);
  }
});

test('touch sequence save requires steps and monitor route returns data', async () => {
  const intelligencePath = require.resolve('../services/intelligenceService');
  const trackingServicePath = require.resolve('../services/trackingService');
  const audiencePushPath = require.resolve('../services/audiencePushService');
  const touchSequencePath = require.resolve('../services/touchSequenceService');
  const routePath = require.resolve('../routes/intelligence');
  const originals = new Map([
    [intelligencePath, require.cache[intelligencePath]],
    [trackingServicePath, require.cache[trackingServicePath]],
    [audiencePushPath, require.cache[audiencePushPath]],
    [touchSequencePath, require.cache[touchSequencePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[intelligencePath] = { exports: { readTargets: () => ({}), DEFAULT_TARGETS: {} } };
  require.cache[trackingServicePath] = { exports: { getHealth: async () => ({}) } };
  require.cache[audiencePushPath] = { exports: { setAutoRefresh: async () => ({}) } };
  require.cache[touchSequencePath] = {
    exports: {
      DEFAULT_SEVEN_TOUCH_TEMPLATE: [{ step_number: 1, name: 'Discovery Engagers', audience_source_type: 'meta_engagement' }],
      listSequences: async () => [],
      saveSequence: async () => ({ id: 7, name: 'Seven Touch', steps: [{ step_number: 1 }] }),
      deleteSequence: async () => ({ success: true }),
      runMonitorForAccount: async () => ([{ id: 7, steps: [{ status: 'waiting' }] }]),
      runMonitorForSequence: async () => ({ id: 7, steps: [{ status: 'triggered' }] }),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 1, meta_account_id: 'act_1' };
      next();
    });

    const invalidRes = await invoke(app, {
      method: 'POST',
      url: '/touch-sequences',
      headers: { 'content-type': 'application/json' },
      body: { name: 'Seven Touch' },
    });
    assert.equal(invalidRes.status, 400);
    assert.match(invalidRes.json.error, /steps required/);

    const runRes = await invoke(app, {
      method: 'POST',
      url: '/touch-sequences/run-monitor',
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    assert.equal(runRes.status, 200);
    assert.equal(runRes.json.data[0].id, 7);
  } finally {
    restoreCache(originals);
  }
});

test('tracking recovery routes save window and run backfill', async () => {
  const intelligencePath = require.resolve('../services/intelligenceService');
  const trackingServicePath = require.resolve('../services/trackingService');
  const audiencePushPath = require.resolve('../services/audiencePushService');
  const touchSequencePath = require.resolve('../services/touchSequenceService');
  const recoveryPath = require.resolve('../services/trackingRecoveryService');
  const routePath = require.resolve('../routes/intelligence');
  const originals = new Map([
    [intelligencePath, require.cache[intelligencePath]],
    [trackingServicePath, require.cache[trackingServicePath]],
    [audiencePushPath, require.cache[audiencePushPath]],
    [touchSequencePath, require.cache[touchSequencePath]],
    [recoveryPath, require.cache[recoveryPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[intelligencePath] = { exports: { readTargets: () => ({}), DEFAULT_TARGETS: {} } };
  require.cache[trackingServicePath] = { exports: { getHealth: async () => ({}) } };
  require.cache[audiencePushPath] = { exports: { setAutoRefresh: async () => ({}) } };
  require.cache[touchSequencePath] = {
    exports: {
      DEFAULT_SEVEN_TOUCH_TEMPLATE: [],
      listSequences: async () => [],
      saveSequence: async () => ({}),
      deleteSequence: async () => ({}),
      runMonitorForAccount: async () => ([]),
      runMonitorForSequence: async () => ({}),
    },
  };
  require.cache[recoveryPath] = {
    exports: {
      getSummary: async () => ({ outage_window: { outage_start: '2026-04-01', outage_end: '2026-04-10' }, buckets: [] }),
      saveWindow: async (_accountId, body) => body,
      runBackfill: async () => ({ meta_leads: { imported: 3 }, ghl_contacts: { imported: 2 } }),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const saveRes = await invoke(app, {
      method: 'POST',
      url: '/tracking-recovery',
      headers: { 'content-type': 'application/json' },
      body: { outage_start: '2026-04-01', outage_end: '2026-04-10' },
    });
    assert.equal(saveRes.status, 200);
    assert.equal(saveRes.json.success, true);

    const backfillRes = await invoke(app, {
      method: 'POST',
      url: '/tracking-recovery/backfill',
      headers: { 'content-type': 'application/json' },
      body: { outage_start: '2026-04-01', outage_end: '2026-04-10' },
    });
    assert.equal(backfillRes.status, 200);
    assert.equal(backfillRes.json.data.meta_leads.imported, 3);
  } finally {
    restoreCache(originals);
  }
});

test('admin update rejects invalid role', async () => {
  const authServicePath = require.resolve('../services/authService');
  const routePath = require.resolve('../routes/admin');
  const originals = new Map([
    [authServicePath, require.cache[authServicePath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[authServicePath] = {
    exports: {
      updateUser: async () => ({}),
      getAllUsers: async () => [],
      getActiveSessions: async () => [],
      deleteUser: async () => ({}),
    },
  };

  try {
    const router = require('../routes/admin');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', id: 1 };
      next();
    });
    const res = await invoke(app, {
      method: 'POST',
      url: '/users/5',
      headers: { 'content-type': 'application/json' },
      body: { role: 'superadmin' },
    });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /Invalid role/);
  } finally {
    restoreCache(originals);
  }
});
