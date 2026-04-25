const fetch = require('node-fetch');
const { query, queryAll, queryOne } = require('../db');
const accountService = require('./accountService');
const ghl = require('./ghlService');

const MCP_URL = 'https://services.leadconnectorhq.com/mcp/';
const MCP_MODES = ['disabled', 'read_only', 'assistive_write', 'automated_write'];
const MCP_MODE_POLICY = {
  disabled: [],
  read_only: [
    'contacts_get-contact',
    'contacts_get-contacts',
    'contacts_get-all-tasks',
    'conversations_search-conversation',
    'conversations_get-messages',
    'opportunities_search-opportunity',
    'opportunities_get-pipelines',
    'opportunities_get-opportunity',
    'calendars_get-calendar-events',
    'calendars_get-appointment-notes',
    'payments_list-transactions',
    'payments_get-order-by-id',
  ],
  assistive_write: [],
  automated_write: [],
};

const TEST_PROBES = [
  { tool: 'contacts_get-contacts', input: { limit: 1 } },
  { tool: 'conversations_search-conversation', input: { limit: 1 } },
  { tool: 'opportunities_get-pipelines', input: {} },
  { tool: 'calendars_get-calendar-events', input: { limit: 1 } },
  { tool: 'payments_list-transactions', input: { limit: 1 } },
];

function cleanText(value, max = 1000) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).trim().slice(0, max) || null;
}

function badRequest(message) {
  const err = new Error(message);
  err.httpStatus = 400;
  return err;
}

function redact(value) {
  if (!value) return null;
  const text = String(value);
  if (text.length <= 8) return '***';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function normalizeMode(mode) {
  return MCP_MODES.includes(mode) ? mode : 'disabled';
}

function allowedToolsForMode(mode) {
  return MCP_MODE_POLICY[normalizeMode(mode)] || [];
}

function normalizeMcpError(err) {
  const status = err?.status || err?.httpStatus || null;
  const message = cleanText(err?.message, 2000) || 'Unknown MCP error';
  let reasonCode = 'mcp_transport_failed';
  if (err?.reasonCode) reasonCode = err.reasonCode;
  else if (status === 401 || /unauthorized|invalid token|forbidden/i.test(message)) reasonCode = 'mcp_token_invalid';
  else if (status === 404 || /location/i.test(message)) reasonCode = 'mcp_location_invalid';
  else if (status === 408 || /timeout/i.test(message)) reasonCode = 'mcp_timeout';
  else if (/not allowed/i.test(message)) reasonCode = 'mcp_tool_not_allowed';
  return {
    status,
    message,
    reason_code: reasonCode,
  };
}

async function insertRun(accountId, runType, status, {
  toolName = null,
  reasonCode = null,
  requestPayload = {},
  responseSummary = {},
  durationMs = null,
  requestId = null,
} = {}) {
  return queryOne(`
    INSERT INTO ghl_mcp_runs (
      account_id, run_type, tool_name, status, reason_code, request_payload, response_summary, duration_ms, request_id
    ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)
    RETURNING *
  `, [
    accountId,
    runType,
    toolName,
    status,
    reasonCode,
    JSON.stringify(requestPayload || {}),
    JSON.stringify(responseSummary || {}),
    durationMs,
    requestId,
  ]);
}

async function saveConnectionState(accountId, {
  enabled,
  mode,
  scopes,
  tools,
  status,
  error,
} = {}) {
  await query(`
    UPDATE accounts
    SET ghl_mcp_enabled = COALESCE($2, ghl_mcp_enabled),
        ghl_mcp_mode = COALESCE($3, ghl_mcp_mode),
        ghl_mcp_scopes_json = COALESCE($4::jsonb, ghl_mcp_scopes_json),
        ghl_mcp_tools_json = COALESCE($5::jsonb, ghl_mcp_tools_json),
        ghl_mcp_last_test_at = NOW(),
        ghl_mcp_last_status = $6,
        ghl_mcp_last_error = $7,
        updated_at = NOW()
    WHERE id = $1
  `, [
    accountId,
    enabled === undefined ? null : Boolean(enabled),
    mode === undefined ? null : normalizeMode(mode),
    scopes === undefined ? null : JSON.stringify(scopes || []),
    tools === undefined ? null : JSON.stringify(tools || []),
    status || null,
    error || null,
  ]);
}

function getResolvedAuth(account = {}) {
  return {
    source: 'ghl_connection',
    token: ghl.decrypt(account.ghl_api_key_encrypted),
    locationId: cleanText(account.ghl_location_id, 255),
  };
}

function publicStatusRow(account = {}, extra = {}) {
  const auth = getResolvedAuth(account);
  return {
    account_id: account.id,
    enabled: account.ghl_mcp_enabled === true,
    mode: normalizeMode(account.ghl_mcp_mode),
    location_id: auth.locationId || null,
    auth_source: auth.source,
    last_test_at: account.ghl_mcp_last_test_at || null,
    last_status: account.ghl_mcp_last_status || (account.ghl_mcp_enabled ? 'unknown' : 'disabled'),
    last_error: account.ghl_mcp_last_error || null,
    allowed_tools: allowedToolsForMode(account.ghl_mcp_mode),
    available_tools: Array.isArray(account.ghl_mcp_tools_json) ? account.ghl_mcp_tools_json : [],
    scopes: Array.isArray(account.ghl_mcp_scopes_json) ? account.ghl_mcp_scopes_json : [],
    token_configured: Boolean(auth.token),
    ...extra,
  };
}

function buildReadiness(account = {}, probeResults = []) {
  const enabled = account.ghl_mcp_enabled === true;
  const auth = getResolvedAuth(account);
  const tokenPresent = Boolean(auth.token);
  const locationPresent = Boolean(auth.locationId);
  const mode = normalizeMode(account.ghl_mcp_mode);
  if (!enabled) {
    return {
      status: 'disabled',
      mode,
      checks: {
        enabled: false,
        token_present: tokenPresent,
        location_present: locationPresent,
        token_valid: false,
        mapping_valid: locationPresent,
        last_test_successful: false,
        required_tools_available: false,
      },
      allowed_tools: allowedToolsForMode(mode),
      available_tools: [],
      missing_tools: allowedToolsForMode(mode),
      probe_results: [],
      last_error: null,
      reason_code: 'mcp_disabled',
    };
  }

  if (!tokenPresent || !locationPresent) {
    return {
      status: 'failed',
      mode,
      checks: {
        enabled: true,
        token_present: tokenPresent,
        location_present: locationPresent,
        token_valid: false,
        mapping_valid: locationPresent,
        last_test_successful: false,
        required_tools_available: false,
      },
      allowed_tools: allowedToolsForMode(mode),
      available_tools: [],
      missing_tools: allowedToolsForMode(mode),
      probe_results: probeResults,
      last_error: !tokenPresent ? 'MCP token missing for this account' : 'MCP locationId missing for this account',
      reason_code: !tokenPresent ? 'mcp_token_missing' : 'mcp_location_missing',
    };
  }

  if (!probeResults.length) {
    return {
      status: account.ghl_mcp_last_status || 'partial',
      mode,
      checks: {
        enabled: true,
        token_present: tokenPresent,
        location_present: locationPresent,
        token_valid: false,
        mapping_valid: locationPresent,
        last_test_successful: false,
        required_tools_available: false,
      },
      allowed_tools: allowedToolsForMode(mode),
      available_tools: Array.isArray(account.ghl_mcp_tools_json) ? account.ghl_mcp_tools_json : [],
      missing_tools: allowedToolsForMode(mode).filter((tool) => !(Array.isArray(account.ghl_mcp_tools_json) ? account.ghl_mcp_tools_json : []).includes(tool)),
      probe_results: [],
      last_error: cleanText(account.ghl_mcp_last_error, 1000),
      reason_code: cleanText(account.ghl_mcp_last_error ? 'mcp_partial_capability' : null, 120),
    };
  }

  const availableTools = probeResults.filter((p) => p.status === 'success').map((p) => p.tool);
  const missingTools = probeResults.filter((p) => p.status !== 'success').map((p) => p.tool);
  const tokenValid = probeResults.some((p) => p.status === 'success') && !probeResults.some((p) => p.reason_code === 'mcp_token_invalid');
  const status = missingTools.length ? (availableTools.length ? 'partial' : 'failed') : 'ok';
  const reasonCode = probeResults.find((p) => p.status !== 'success')?.reason_code || null;
  return {
    status,
    mode,
    checks: {
      enabled: true,
      token_present: tokenPresent,
      location_present: locationPresent,
      token_valid: tokenValid,
      mapping_valid: locationPresent,
      last_test_successful: status === 'ok',
      required_tools_available: missingTools.length === 0,
    },
    allowed_tools: allowedToolsForMode(mode),
    available_tools: availableTools,
    missing_tools: missingTools,
    probe_results: probeResults,
    last_error: status === 'ok' ? null : (probeResults.find((p) => p.status !== 'success')?.message || cleanText(account.ghl_mcp_last_error, 1000)),
    reason_code: reasonCode,
  };
}

async function getAccount(accountId) {
  const account = await accountService.getAccountById(accountId);
  if (!account) throw badRequest('Account not found');
  return account;
}

async function saveConfig(accountId, {
  enabled,
  mode,
} = {}) {
  const nextMode = normalizeMode(mode || 'disabled');
  if (!['disabled', 'read_only'].includes(nextMode)) throw badRequest('Phase 1 supports disabled or read_only mode only');
  const updates = [];
  const params = [accountId];
  let index = 2;
  if (enabled !== undefined) {
    updates.push(`ghl_mcp_enabled = $${index++}`);
    params.push(Boolean(enabled));
  }
  if (mode !== undefined) {
    updates.push(`ghl_mcp_mode = $${index++}`);
    params.push(nextMode);
  }
  updates.push(`updated_at = NOW()`);
  const row = await queryOne(`
    UPDATE accounts
    SET ${updates.join(', ')}
    WHERE id = $1
    RETURNING *
  `, params);
  if (!row) throw badRequest('Account not found');
  return publicStatusRow(row);
}

async function callTool(accountId, toolName, input = {}, { requestId = null } = {}) {
  const account = await getAccount(accountId);
  const mode = normalizeMode(account.ghl_mcp_mode);
  const auth = getResolvedAuth(account);
  if (!account.ghl_mcp_enabled) {
    const err = badRequest('MCP is disabled for this account');
    err.reasonCode = 'mcp_disabled';
    throw err;
  }
  if (!auth.token) {
    const err = badRequest('GHL connection token missing for this account');
    err.reasonCode = 'mcp_token_missing';
    throw err;
  }
  if (!auth.locationId) {
    const err = badRequest('GHL locationId missing for this account');
    err.reasonCode = 'mcp_location_missing';
    throw err;
  }
  const allowedTools = allowedToolsForMode(mode);
  if (!allowedTools.includes(toolName)) {
    const err = badRequest(`Tool not allowed in ${mode} mode: ${toolName}`);
    err.reasonCode = 'mcp_tool_not_allowed';
    throw err;
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        locationId: auth.locationId,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ tool: toolName, input }),
      signal: controller.signal,
    });
    const data = await response.json().catch(async () => ({ text: cleanText(await response.text(), 1000) }));
    if (!response.ok || data?.error) {
      const err = new Error(cleanText(data?.error?.message || data?.message || data?.text || `MCP HTTP ${response.status}`, 2000));
      err.status = response.status;
      err.reasonCode = response.status === 401 ? 'mcp_token_invalid' : response.status === 404 ? 'mcp_location_invalid' : 'mcp_transport_failed';
      throw err;
    }
    await insertRun(account.id, 'tool_call', 'success', {
      toolName,
      requestPayload: { tool: toolName, input: Object.keys(input || {}) },
      responseSummary: { keys: Object.keys(data || {}).slice(0, 20) },
      durationMs: Date.now() - started,
      requestId,
    });
    return data;
  } catch (err) {
    const normalized = normalizeMcpError(err);
    await insertRun(account.id, 'tool_call', 'failed', {
      toolName,
      reasonCode: normalized.reason_code,
      requestPayload: { tool: toolName, input: Object.keys(input || {}) },
      responseSummary: { message: normalized.message, status: normalized.status },
      durationMs: Date.now() - started,
      requestId,
    });
    if (err.name === 'AbortError') {
      const timeoutErr = new Error('MCP request timed out');
      timeoutErr.reasonCode = 'mcp_timeout';
      timeoutErr.httpStatus = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function testConnection(accountId, { requestId = null } = {}) {
  const account = await getAccount(accountId);
  const started = Date.now();
  const probeResults = [];
  let lastError = null;
  let status = 'failed';
  if (!account.ghl_mcp_enabled) {
    await saveConnectionState(account.id, { status: 'disabled', error: null });
    const readiness = buildReadiness(account, []);
    await insertRun(account.id, 'test_connection', 'failed', {
      reasonCode: 'mcp_disabled',
      responseSummary: readiness,
      durationMs: Date.now() - started,
      requestId,
    });
    return readiness;
  }
  for (const probe of TEST_PROBES) {
    try {
      await callTool(account.id, probe.tool, probe.input, { requestId });
      probeResults.push({ tool: probe.tool, status: 'success', reason_code: null, message: null });
    } catch (err) {
      const normalized = normalizeMcpError(err);
      probeResults.push({
        tool: probe.tool,
        status: 'failed',
        reason_code: normalized.reason_code,
        message: normalized.message,
      });
      lastError = normalized.message;
    }
  }
  const readiness = buildReadiness(account, probeResults);
  status = readiness.status;
  await saveConnectionState(account.id, {
    status,
    error: cleanText(readiness.last_error, 1000),
    tools: readiness.available_tools,
    scopes: readiness.allowed_tools,
  });
  await insertRun(account.id, 'test_connection', status === 'ok' ? 'success' : status, {
    reasonCode: readiness.reason_code,
    responseSummary: readiness,
    durationMs: Date.now() - started,
    requestId,
  });
  const refreshed = await getAccount(account.id);
  return {
    ...publicStatusRow(refreshed),
    ...readiness,
  };
}

async function getConnectionStatus(accountId) {
  const account = await getAccount(accountId);
  const recentProbes = await queryAll(`
    SELECT tool_name, status, reason_code, response_summary, created_at
    FROM ghl_mcp_runs
    WHERE account_id = $1
      AND run_type IN ('tool_call', 'test_connection')
    ORDER BY created_at DESC
    LIMIT 20
  `, [accountId]);
  const latestByTool = new Map();
  for (const row of recentProbes) {
    if (row.tool_name && !latestByTool.has(row.tool_name)) latestByTool.set(row.tool_name, row);
  }
  const probeResults = TEST_PROBES.map((probe) => {
    const row = latestByTool.get(probe.tool);
    if (!row) return { tool: probe.tool, status: 'unknown', reason_code: null, message: null };
    return {
      tool: probe.tool,
      status: row.status === 'success' ? 'success' : 'failed',
      reason_code: row.reason_code || null,
      message: cleanText(row.response_summary?.message || row.response_summary?.last_error, 1000),
      checked_at: row.created_at,
    };
  });
  const readiness = buildReadiness(account, probeResults.filter((row) => row.status !== 'unknown'));
  return {
    ...publicStatusRow(account),
    ...readiness,
    recent_runs: await queryAll(`
      SELECT id, run_type, tool_name, status, reason_code, response_summary, duration_ms, created_at
      FROM ghl_mcp_runs
      WHERE account_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [accountId]),
    probe_results: probeResults,
  };
}

async function listRuns(accountId, { limit = 20 } = {}) {
  const capped = Math.max(1, Math.min(parseInt(limit, 10) || 20, 100));
  return queryAll(`
    SELECT id, run_type, tool_name, status, reason_code, response_summary, duration_ms, created_at
    FROM ghl_mcp_runs
    WHERE account_id = $1
    ORDER BY created_at DESC
    LIMIT $2
  `, [accountId, capped]);
}

module.exports = {
  MCP_MODES,
  MCP_MODE_POLICY,
  saveConfig,
  callTool,
  testConnection,
  getConnectionStatus,
  listRuns,
};
