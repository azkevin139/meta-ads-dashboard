const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
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
  const csrfServicePath = require.resolve('../services/csrfService');
  const securityAuditPath = require.resolve('../services/securityAuditService');
  const routePath = require.resolve('../routes/auth');
  const originals = new Map([
    [authServicePath, require.cache[authServicePath]],
    [configPath, require.cache[configPath]],
    [csrfServicePath, require.cache[csrfServicePath]],
    [securityAuditPath, require.cache[securityAuditPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  delete require.cache[csrfServicePath];
  require.cache[authServicePath] = {
    exports: {
      login: async () => ({ token: 'signed-token', user: { id: 1, email: 'a@test.com', role: 'admin' } }),
      hashSessionToken: () => 'hashed-signed-token',
      logout: async () => {},
      getUserFromToken: async () => ({ id: 1, email: 'a@test.com', role: 'admin' }),
      register: async () => ({ id: 2 }),
    },
  };
  require.cache[configPath] = {
    exports: {
      isProduction: false,
      allowSelfSignup: false,
      sessionSecret: 'test-session-secret',
    },
  };
  require.cache[securityAuditPath] = {
    exports: {
      write: async () => {},
      fromRequest: async () => {},
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
    assert.equal(typeof loginRes.json.csrf_token, 'string');

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

test('csrf middleware requires token for authenticated writes', async () => {
  const configPath = require.resolve('../config');
  const csrfServicePath = require.resolve('../services/csrfService');
  const middlewarePath = require.resolve('../middleware/csrf');
  const originals = new Map([
    [configPath, require.cache[configPath]],
    [csrfServicePath, require.cache[csrfServicePath]],
    [middlewarePath, require.cache[middlewarePath]],
  ]);

  delete require.cache[csrfServicePath];
  delete require.cache[middlewarePath];
  require.cache[configPath] = {
    exports: {
      sessionSecret: 'test-session-secret',
    },
  };

  try {
    const csrf = require('../services/csrfService');
    const csrfMiddleware = require('../middleware/csrf');
    const app = express();
    app.use((req, _res, next) => {
      req.user = { session_token_hash: 'session-hash' };
      next();
    });
    app.post('/protected', csrfMiddleware, (_req, res) => res.json({ ok: true }));

    const denied = await invoke(app, { method: 'POST', url: '/protected' });
    assert.equal(denied.status, 403);
    assert.match(denied.json.error, /Invalid CSRF token/);

    const allowed = await invoke(app, {
      method: 'POST',
      url: '/protected',
      headers: { 'x-csrf-token': csrf.createToken('session-hash') },
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.json.ok, true);
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
        accountId: 44,
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

test('meta leads sync route validates mode and forwards manual options', async () => {
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

  let syncArgs = null;
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
  require.cache[leadSyncPath] = {
    exports: {
      syncAccountLeads: async (account, options) => {
        syncArgs = { account, options };
        return { imported: 10, scanned: 50, ad_count: 12 };
      },
    },
  };
  require.cache[accountServicePath] = { exports: {} };

  try {
    const router = require('../routes/meta');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 1, meta_account_id: 'act_1' };
      next();
    });

    const invalidRes = await invoke(app, {
      method: 'POST',
      url: '/leads-sync',
      headers: { 'content-type': 'application/json' },
      body: { mode: 'bad' },
    });
    assert.equal(invalidRes.status, 400);
    assert.match(invalidRes.json.error, /mode must be incremental, full, or range/);

    const validRes = await invoke(app, {
      method: 'POST',
      url: '/leads-sync',
      headers: { 'content-type': 'application/json' },
      body: {
        mode: 'range',
        since: '2026-04-01T00:00:00.000Z',
        until: '2026-04-10T00:00:00.000Z',
        includeArchived: true,
        maxAds: 200,
      },
    });
    assert.equal(validRes.status, 200);
    assert.deepEqual(syncArgs.options, {
      mode: 'range',
      sinceOverride: '2026-04-01T00:00:00.000Z',
      untilOverride: '2026-04-10T00:00:00.000Z',
      includeArchived: true,
      maxAds: 200,
    });
  } finally {
    restoreCache(originals);
  }
});

test('meta lead form registry route returns imported form data', async () => {
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
  require.cache[leadSyncPath] = {
    exports: {
      syncAccountLeads: async () => ({}),
      getLeadFormRegistry: async () => ({ forms: [{ form_id: '123', lead_count: 4 }] }),
    },
  };
  require.cache[accountServicePath] = { exports: {} };

  try {
    const router = require('../routes/meta');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 1, meta_account_id: 'act_1' };
      next();
    });

    const res = await invoke(app, { method: 'GET', url: '/lead-form-registry' });
    assert.equal(res.status, 200);
    assert.equal(res.json.forms[0].form_id, '123');
  } finally {
    restoreCache(originals);
  }
});

test('revisit automation route returns config summary and activity', async () => {
  const revisitPath = require.resolve('../services/revisitAutomationService');
  const routePath = require.resolve('../routes/intelligence');
  const originals = new Map([
    [revisitPath, require.cache[revisitPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[revisitPath] = {
    exports: {
      getConfigSummary: () => ({
        enabled: false,
        webhook_configured: false,
        signing_secret_configured: false,
        cooldown_hours: 24,
        delay_seconds: 60,
        interval_ms: 30000,
        max_attempts: 3,
        key_paths: ['/pricing'],
      }),
      listRecentActivity: async () => ([{ id: 1, ghl_contact_id: 'ghl_1', status: 'pending' }]),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin' };
      req.metaAccount = { id: 7 };
      next();
    });
    const res = await invoke(app, { url: '/revisit-automation' });
    assert.equal(res.status, 200);
    assert.equal(res.json.config.delay_seconds, 60);
    assert.equal(res.json.activity[0].ghl_contact_id, 'ghl_1');
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

test('audience automation routes validate and return rule data', async () => {
  const intelligencePath = require.resolve('../services/intelligenceService');
  const trackingServicePath = require.resolve('../services/trackingService');
  const audiencePushPath = require.resolve('../services/audiencePushService');
  const audienceAutomationPath = require.resolve('../services/audienceAutomationService');
  const touchSequencePath = require.resolve('../services/touchSequenceService');
  const recoveryPath = require.resolve('../services/trackingRecoveryService');
  const routePath = require.resolve('../routes/intelligence');
  const originals = new Map([
    [intelligencePath, require.cache[intelligencePath]],
    [trackingServicePath, require.cache[trackingServicePath]],
    [audiencePushPath, require.cache[audiencePushPath]],
    [audienceAutomationPath, require.cache[audienceAutomationPath]],
    [touchSequencePath, require.cache[touchSequencePath]],
    [recoveryPath, require.cache[recoveryPath]],
    [routePath, require.cache[routePath]],
  ]);

  let savedRule = null;
  delete require.cache[routePath];
  require.cache[intelligencePath] = { exports: { readTargets: () => ({}), DEFAULT_TARGETS: {} } };
  require.cache[trackingServicePath] = { exports: { getHealth: async () => ({}) } };
  require.cache[audiencePushPath] = { exports: { setAutoRefresh: async () => ({}) } };
  require.cache[audienceAutomationPath] = {
    exports: {
      THRESHOLD_TYPES: ['eligible_count', 'matchable_count'],
      ACTION_TYPES: ['create_audience', 'refresh_audience', 'notify_n8n'],
      listRules: async () => ([{ id: 9, segment_key: 'landing_page_leads', threshold_type: 'matchable_count', threshold_value: 100, action_type: 'create_audience', enabled: true, stats: { eligible_count: 130, matchable_count: 112 } }]),
      buildAudienceReadiness: () => ({ status: 'ready', reason_code: null }),
      listAvailableSegments: async () => ([{ key: 'landing_page_leads' }]),
      listRuns: async () => ([{ id: 1, segment_key: 'landing_page_leads', status: 'triggered' }]),
      saveRule: async (_accountId, input) => {
        savedRule = input;
        return { id: 12, ...input };
      },
      deleteRule: async () => ({ success: true }),
      evaluateRulesForAccount: async () => ({ evaluated: 1, triggered: 1, blocked: 0, failed: 0 }),
    },
  };
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
      getSummary: async () => ({ outage_window: null, buckets: [] }),
      saveWindow: async () => ({}),
      runBackfill: async () => ({}),
      getAlerts: async () => ({ alerts: [] }),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const listRes = await invoke(app, { method: 'GET', url: '/audience-automation/rules' });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.json.data[0].segment_key, 'landing_page_leads');
    assert.equal(listRes.json.readiness.status, 'ready');

    const saveRes = await invoke(app, {
      method: 'POST',
      url: '/audience-automation/rules',
      headers: { 'content-type': 'application/json' },
      body: {
        segment_key: 'landing_page_leads',
        threshold_type: 'matchable_count',
        threshold_value: 100,
        action_type: 'create_audience',
        cooldown_minutes: 60,
        enabled: true,
        config: {},
      },
    });
    assert.equal(saveRes.status, 200);
    assert.equal(savedRule.segment_key, 'landing_page_leads');

    const runRes = await invoke(app, {
      method: 'POST',
      url: '/audience-automation/evaluate-now',
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    assert.equal(runRes.status, 200);
    assert.equal(runRes.json.data.triggered, 1);
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

test('tracking alerts route returns alert payload', async () => {
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
      getSummary: async () => ({ outage_window: null, buckets: [] }),
      saveWindow: async (_accountId, body) => body,
      runBackfill: async () => ({}),
      getAlerts: async (_accountId, opts) => ({
        window_hours: opts.hours,
        alerts: [{ code: 'tracking_outage', severity: 'critical', title: 'Tracker down', message: 'No native pageviews' }],
      }),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const res = await invoke(app, {
      method: 'GET',
      url: '/tracking-alerts?hours=12',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.window_hours, 12);
    assert.equal(res.json.alerts[0].severity, 'critical');
  } finally {
    restoreCache(originals);
  }
});

test('intelligence lifecycle summary route returns data payload', async () => {
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
  require.cache[intelligencePath] = {
    exports: {
      readTargets: () => ({}),
      DEFAULT_TARGETS: {},
      getLifecycleSummary: async () => ({ stages: [{ stage: 'qualified', count: 5 }], events: [{ event_name: 'GHLStageChanged', count: 9 }] }),
    },
  };
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
      getSummary: async () => ({ outage_window: null, buckets: [] }),
      saveWindow: async () => ({}),
      runBackfill: async () => ({}),
      getAlerts: async () => ({ alerts: [] }),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const res = await invoke(app, { method: 'GET', url: '/lifecycle-summary' });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.stages[0].stage, 'qualified');
  } finally {
    restoreCache(originals);
  }
});

test('revenue copilot route returns account-scoped diagnostics payload', async () => {
  const intelligencePath = require.resolve('../services/intelligenceService');
  const trackingServicePath = require.resolve('../services/trackingService');
  const audiencePushPath = require.resolve('../services/audiencePushService');
  const touchSequencePath = require.resolve('../services/touchSequenceService');
  const recoveryPath = require.resolve('../services/trackingRecoveryService');
  const revenueCopilotPath = require.resolve('../services/revenueCopilotService');
  const accountAccessPath = require.resolve('../services/accountAccessService');
  const routePath = require.resolve('../routes/intelligence');
  const originals = new Map([
    [intelligencePath, require.cache[intelligencePath]],
    [trackingServicePath, require.cache[trackingServicePath]],
    [audiencePushPath, require.cache[audiencePushPath]],
    [touchSequencePath, require.cache[touchSequencePath]],
    [recoveryPath, require.cache[recoveryPath]],
    [revenueCopilotPath, require.cache[revenueCopilotPath]],
    [accountAccessPath, require.cache[accountAccessPath]],
    [routePath, require.cache[routePath]],
  ]);

  delete require.cache[routePath];
  require.cache[intelligencePath] = {
    exports: {
      readTargets: () => ({}),
      DEFAULT_TARGETS: {},
    },
  };
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
      getSummary: async () => ({ outage_window: null, buckets: [] }),
      saveWindow: async () => ({}),
      runBackfill: async () => ({}),
      getAlerts: async () => ({ alerts: [] }),
    },
  };
  require.cache[accountAccessPath] = {
    exports: {
      resolveAuthorizedAccount: async () => ({ id: 11 }),
    },
  };
  require.cache[revenueCopilotPath] = {
    exports: {
      getDashboardSnapshot: async (accountId, opts) => ({
        account_id: accountId,
        refreshed_at: '2026-04-25T12:00:00.000Z',
        forced: !!opts.forceRefresh,
        mcp_status: { status: 'ok', mode: 'read_only' },
        lead_response_audit: { status: 'ok', metrics: { new_leads_24h: 5 } },
      }),
    },
  };

  try {
    const router = require('../routes/intelligence');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { role: 'admin', email: 'ops@test.com' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const res = await invoke(app, { method: 'GET', url: '/revenue-copilot?accountId=11&refresh=1' });
    assert.equal(res.status, 200);
    assert.equal(res.json.data.account_id, 11);
    assert.equal(res.json.data.forced, true);
    assert.equal(res.json.data.mcp_status.status, 'ok');
    assert.equal(res.json.data.lead_response_audit.metrics.new_leads_24h, 5);
  } finally {
    restoreCache(originals);
  }
});

test('account GHL sync route validates mode and forwards sync options', async () => {
  const accountServicePath = require.resolve('../services/accountService');
  const tokenHealthPath = require.resolve('../services/tokenHealthService');
  const ghlPath = require.resolve('../services/ghlService');
  const ghlMcpPath = require.resolve('../services/ghlMcpService');
  const routePath = require.resolve('../routes/accounts');
  const originals = new Map([
    [accountServicePath, require.cache[accountServicePath]],
    [tokenHealthPath, require.cache[tokenHealthPath]],
    [ghlPath, require.cache[ghlPath]],
    [ghlMcpPath, require.cache[ghlMcpPath]],
    [routePath, require.cache[routePath]],
  ]);

  let syncArgs = null;
  delete require.cache[routePath];
  require.cache[accountServicePath] = {
    exports: {
      listAccounts: async () => [],
      publicAccount: (row) => row,
      updateSessionAccount: async () => ({}),
      createAccount: async () => ({}),
      discoverAccountsForToken: async () => ([]),
      importAccountsFromToken: async () => ([]),
      refreshAccountMetadata: async () => ({}),
      setDefaultAccount: async () => ({}),
    },
  };
  require.cache[tokenHealthPath] = { exports: { getAccountsHealthSummary: async () => [] } };
  require.cache[ghlMcpPath] = {
    exports: {
      getConnectionStatus: async () => ({ status: 'disabled' }),
      saveConfig: async () => ({ enabled: false, mode: 'disabled' }),
      testConnection: async () => ({ status: 'disabled' }),
    },
  };
  require.cache[ghlPath] = {
    exports: {
      getStatus: async () => ({ configured: true }),
      saveGhlCredentials: async () => ({ success: true }),
      clearGhlCredentials: async () => ({ success: true }),
      syncAccountById: async (accountId, options) => {
        syncArgs = { accountId, options };
        return { account_id: accountId, imported: 12, mode: options.mode };
      },
    },
  };

  try {
    const router = require('../routes/accounts');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { id: 1, role: 'admin', session_token_hash: 'hash' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const invalidRes = await invoke(app, {
      method: 'POST',
      url: '/55/ghl/sync',
      headers: { 'content-type': 'application/json' },
      body: { mode: 'bad' },
    });
    assert.equal(invalidRes.status, 400);
    assert.match(invalidRes.json.error, /mode must be incremental, full, or range/);

    const validRes = await invoke(app, {
      method: 'POST',
      url: '/55/ghl/sync',
      headers: { 'content-type': 'application/json' },
      body: { mode: 'range', since: '2026-04-01T00:00:00.000Z', until: '2026-04-10T00:00:00.000Z', maxPages: 20 },
    });
    assert.equal(validRes.status, 200);
    assert.deepEqual(syncArgs, {
      accountId: 55,
      options: {
        mode: 'range',
        sinceOverride: '2026-04-01T00:00:00.000Z',
        untilOverride: '2026-04-10T00:00:00.000Z',
        maxPages: 20,
      },
    });
  } finally {
    restoreCache(originals);
  }
});

test('account product mode route updates lead gen fast sync settings', async () => {
  const accountServicePath = require.resolve('../services/accountService');
  const tokenHealthPath = require.resolve('../services/tokenHealthService');
  const ghlPath = require.resolve('../services/ghlService');
  const ghlMcpPath = require.resolve('../services/ghlMcpService');
  const securityAuditPath = require.resolve('../services/securityAuditService');
  const routePath = require.resolve('../routes/accounts');
  const originals = new Map([
    [accountServicePath, require.cache[accountServicePath]],
    [tokenHealthPath, require.cache[tokenHealthPath]],
    [ghlPath, require.cache[ghlPath]],
    [ghlMcpPath, require.cache[ghlMcpPath]],
    [securityAuditPath, require.cache[securityAuditPath]],
    [routePath, require.cache[routePath]],
  ]);

  let modeArgs = null;
  delete require.cache[routePath];
  require.cache[accountServicePath] = {
    exports: {
      listAccounts: async () => [],
      publicAccount: (row) => row,
      updateSessionAccount: async () => ({}),
      createAccount: async () => ({}),
      discoverAccountsForToken: async () => ([]),
      importAccountsFromToken: async () => ([]),
      refreshAccountMetadata: async () => ({}),
      setDefaultAccount: async () => ({}),
      updateProductMode: async (accountId, payload) => {
        modeArgs = { accountId, payload };
        return { id: accountId, product_mode: payload.productMode, fast_sync_enabled: payload.fastSyncEnabled };
      },
    },
  };
  require.cache[tokenHealthPath] = { exports: { getAccountsHealthSummary: async () => [] } };
  require.cache[ghlMcpPath] = {
    exports: {
      getConnectionStatus: async () => ({ status: 'disabled' }),
      saveConfig: async () => ({ enabled: false, mode: 'disabled' }),
      testConnection: async () => ({ status: 'disabled' }),
    },
  };
  require.cache[securityAuditPath] = { exports: { fromRequest: async () => {} } };
  require.cache[ghlPath] = {
    exports: {
      getStatus: async () => ({ configured: true }),
      saveGhlCredentials: async () => ({ success: true }),
      clearGhlCredentials: async () => ({ success: true }),
      syncAccountById: async () => ({ account_id: 1 }),
    },
  };

  try {
    const router = require('../routes/accounts');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { id: 1, role: 'admin', session_token_hash: 'hash' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const res = await invoke(app, {
      method: 'POST',
      url: '/44/product-mode',
      headers: { 'content-type': 'application/json' },
      body: { product_mode: 'lead_gen', fast_sync_enabled: true },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(modeArgs, {
      accountId: 44,
      payload: {
        productMode: 'lead_gen',
        fastSyncEnabled: true,
      },
    });
  } finally {
    restoreCache(originals);
  }
});

test('account MCP routes save config and run readiness test', async () => {
  const accountServicePath = require.resolve('../services/accountService');
  const tokenHealthPath = require.resolve('../services/tokenHealthService');
  const ghlPath = require.resolve('../services/ghlService');
  const ghlMcpPath = require.resolve('../services/ghlMcpService');
  const securityAuditPath = require.resolve('../services/securityAuditService');
  const routePath = require.resolve('../routes/accounts');
  const originals = new Map([
    [accountServicePath, require.cache[accountServicePath]],
    [tokenHealthPath, require.cache[tokenHealthPath]],
    [ghlPath, require.cache[ghlPath]],
    [ghlMcpPath, require.cache[ghlMcpPath]],
    [securityAuditPath, require.cache[securityAuditPath]],
    [routePath, require.cache[routePath]],
  ]);

  let savedArgs = null;
  let testedId = null;
  delete require.cache[routePath];
  require.cache[accountServicePath] = {
    exports: {
      listAccounts: async () => [],
      publicAccount: (row) => row,
      updateSessionAccount: async () => ({}),
      createAccount: async () => ({}),
      discoverAccountsForToken: async () => ([]),
      importAccountsFromToken: async () => ([]),
      refreshAccountMetadata: async () => ({}),
      setDefaultAccount: async () => ({}),
      updateProductMode: async () => ({}),
    },
  };
  require.cache[tokenHealthPath] = { exports: { getAccountsHealthSummary: async () => [] } };
  require.cache[ghlPath] = {
    exports: {
      getStatus: async () => ({ configured: true }),
      saveGhlCredentials: async () => ({ success: true }),
      clearGhlCredentials: async () => ({ success: true }),
      syncAccountById: async () => ({ account_id: 1 }),
    },
  };
  require.cache[ghlMcpPath] = {
    exports: {
      getConnectionStatus: async (accountId) => ({ account_id: accountId, status: 'partial', mode: 'read_only' }),
      saveConfig: async (accountId, payload) => {
        savedArgs = { accountId, payload };
        return { account_id: accountId, enabled: payload.enabled, location_id: 'loc_123', mode: payload.mode, auth_source: 'ghl_connection' };
      },
      testConnection: async (accountId) => {
        testedId = accountId;
        return { account_id: accountId, status: 'ok', available_tools: ['contacts_get-contacts'], missing_tools: [] };
      },
    },
  };
  require.cache[securityAuditPath] = { exports: { fromRequest: async () => {} } };

  try {
    const router = require('../routes/accounts');
    const app = makeJsonApp(router, (req, _res, next) => {
      req.user = { id: 1, role: 'admin', session_token_hash: 'hash' };
      req.metaAccount = { id: 11, meta_account_id: 'act_11' };
      next();
    });

    const statusRes = await invoke(app, { method: 'GET', url: '/55/mcp-status' });
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.json.status, 'partial');

    const saveRes = await invoke(app, {
      method: 'PATCH',
      url: '/55/mcp-config',
      headers: { 'content-type': 'application/json' },
      body: { enabled: true, mode: 'read_only' },
    });
    assert.equal(saveRes.status, 200);
    assert.deepEqual(savedArgs, {
      accountId: 55,
      payload: {
        enabled: true,
        mode: 'read_only',
      },
    });

    const testRes = await invoke(app, {
      method: 'POST',
      url: '/55/mcp-test',
      headers: { 'content-type': 'application/json' },
      body: {},
    });
    assert.equal(testRes.status, 200);
    assert.equal(testedId, 55);
    assert.equal(testRes.json.data.status, 'ok');
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
