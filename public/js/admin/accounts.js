(function () {
  const dashboardApp = window.DashboardApp;
  const asyncSection = window.AsyncSectionHelpers;

  async function loadAdminAccounts() {
    const section = asyncSection.createAsyncSection({
      targetId: 'admin-accounts',
      loadingText: 'Loading accounts',
      emptyHtml: '<div class="empty-state"><div class="empty-state-text">No saved Meta accounts yet</div></div>',
      render: ({ accounts, activeId, healthById }) => `<table>
            <thead><tr>
              <th>Account</th>
              <th>Meta ID</th>
              <th>Currency</th>
              <th>Mode</th>
              <th>MCP</th>
              <th>Token</th>
              <th>Expires</th>
              <th>Default</th>
              <th>Session</th>
              <th>Actions</th>
            </tr></thead>
            <tbody>
              ${accounts.map(a => {
                const h = healthById[a.id] || {};
                const tokenBadge = tokenHealthBadge(h);
                return `
                <tr>
                  <td>
                    <div style="font-weight: 500; font-size: 0.85rem;">${escapeHtml(a.label || a.name || 'Meta account')}</div>
                    <div class="text-muted" style="font-size: 0.72rem;">${escapeHtml(a.name || '')}</div>
                  </td>
                  <td class="mono" style="font-size: 0.75rem;">${escapeHtml(a.meta_account_id)}</td>
                  <td>${escapeHtml(a.currency || 'USD')}</td>
                  <td>${a.product_mode === 'lead_gen' ? '<span class="badge badge-active">Lead gen</span>' : '<span class="badge badge-low">General</span>'}${a.fast_sync_enabled ? '<div class="text-muted" style="font-size:0.68rem;">15m fast sync</div>' : ''}</td>
                  <td>${mcpBadge(a)}</td>
                  <td class="mono" style="font-size: 0.75rem;">${a.token_last4 ? `...${escapeHtml(a.token_last4)}` : 'stored'}</td>
                  <td>${tokenBadge}</td>
                  <td>${a.is_active ? '<span class="text-green">Default</span>' : '<span class="text-muted">—</span>'}</td>
                  <td>${String(a.id) === String(activeId) ? '<span class="text-green">Selected</span>' : '<span class="text-muted">—</span>'}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm" onclick="setSessionAccount(${a.id})">Use</button>
                      <button class="btn btn-sm" onclick="checkAccountToken(${a.id})">Check</button>
                      <button class="btn btn-sm" onclick="toggleAccountProductMode(${a.id}, '${escapeJs(a.product_mode || 'general')}')">${a.product_mode === 'lead_gen' ? 'General' : 'Lead Gen'}</button>
                      <button class="btn btn-sm" onclick="openGhlDrawer(${a.id}, '${escapeJs(a.label || a.name || '')}')">GHL</button>
                      <button class="btn btn-sm" onclick="openMcpDrawer(${a.id}, '${escapeJs(a.label || a.name || '')}')">MCP</button>
                      ${a.is_active ? '' : `<button class="btn btn-sm" onclick="setDefaultAccount(${a.id})">Default</button>`}
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`,
    });
    section?.setLoading();
    try {
      const [res, healthRes] = await Promise.all([
        apiGet('/accounts'),
        apiGet('/accounts/token-health').catch(() => ({ data: [] })),
      ]);
      const accounts = res.data || [];
      const activeId = res.active?.id;
      const healthById = Object.fromEntries((healthRes.data || []).map(h => [h.id, h]));
      if (!accounts.length) return section?.setEmpty();
      section?.setData({ accounts, activeId, healthById });
    } catch (err) {
      section?.setError(err);
    }
  }

  function openAddAccountDrawer() {
    openDrawer('Add Meta Account', `
      <div class="form-group">
        <label class="form-label">Label</label>
        <input id="new-account-label" class="form-input" type="text" placeholder="Sports Betting CA" />
      </div>
      <div class="form-group">
        <label class="form-label">Meta Ad Account ID</label>
        <input id="new-account-id" class="form-input" type="text" placeholder="act_123456789" />
      </div>
      <div class="form-group">
        <label class="form-label">Meta User Token</label>
        <textarea id="new-account-token" class="form-textarea" rows="4" placeholder="Paste token"></textarea>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Currency</label>
          <input id="new-account-currency" class="form-input" type="text" value="USD" />
        </div>
        <div class="form-group">
          <label class="form-label">Timezone</label>
          <input id="new-account-timezone" class="form-input" type="text" value="UTC" />
        </div>
      </div>
      <label style="display:flex; align-items:center; gap:8px; font-size:0.82rem; margin-top:6px;">
        <input id="new-account-default" type="checkbox" />
        Make default account
      </label>
      <div style="display: flex; gap: 8px; margin-top: 16px;">
        <button class="btn btn-primary" onclick="addMetaAccount()">Save Account</button>
        <button class="btn" onclick="closeDrawer()">Cancel</button>
      </div>
    `);
  }

  async function addMetaAccount() {
    const label = document.getElementById('new-account-label').value.trim();
    const meta_account_id = document.getElementById('new-account-id').value.trim();
    const token = document.getElementById('new-account-token').value.trim();
    const currency = document.getElementById('new-account-currency').value.trim() || 'USD';
    const timezone = document.getElementById('new-account-timezone').value.trim() || 'UTC';
    const is_active = document.getElementById('new-account-default').checked;

    if (!meta_account_id || !token) {
      toast('Meta account ID and token are required', 'error');
      return;
    }

    try {
      const res = await apiPost('/accounts', { label, name: label, meta_account_id, token, currency, timezone, is_active });
      toast('Meta account saved', 'success');
      closeDrawer();
      await dashboardApp.hydrateAccountContext();
      if (is_active && res.data?.id) await switchActiveAccount(res.data.id);
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  async function setSessionAccount(accountId) {
    await switchActiveAccount(accountId);
    loadAdminAccounts();
  }

  async function setDefaultAccount(accountId) {
    try {
      await apiPost(`/accounts/${accountId}/default`, {});
      toast('Default account updated', 'success');
      await dashboardApp.hydrateAccountContext();
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  async function checkAccountToken(accountId) {
    try {
      toast('Checking token…', 'info');
      await apiPost(`/accounts/${accountId}/token-check`, {});
      toast('Token checked', 'success');
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  async function toggleAccountProductMode(accountId, currentMode) {
    try {
      const nextMode = currentMode === 'lead_gen' ? 'general' : 'lead_gen';
      await apiPost(`/accounts/${accountId}/product-mode`, {
        product_mode: nextMode,
        fast_sync_enabled: nextMode === 'lead_gen',
      });
      toast(`Account mode set to ${nextMode.replace('_', ' ')}`, 'success');
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  function tokenHealthBadge(h) {
    if (!h || !h.status) return '<span class="text-muted" style="font-size:0.72rem;">—</span>';
    if (h.last_error) return `<span class="badge badge-critical" title="${escapeHtml(h.last_error)}">error</span>`;
    if (h.is_system_user) return '<span class="badge badge-active" title="System user token — never expires">system user</span>';
    if (!h.expires_at) return '<span class="badge badge-active" title="Long-lived token">long-lived</span>';
    const days = h.days_until_expiry;
    if (days <= 3) return `<span class="badge badge-critical">expires in ${days}d</span>`;
    if (days <= 14) return `<span class="badge badge-warning">expires in ${days}d</span>`;
    return `<span class="badge badge-low" title="${fmtDateTime(h.expires_at)}">${days}d</span>`;
  }

  function mcpBadge(account) {
    if (!account?.ghl_mcp_enabled) return '<span class="badge badge-low">disabled</span>';
    const status = String(account.ghl_mcp_last_status || 'unknown');
    if (status === 'ok') return `<span class="badge badge-active">connected</span>${account.ghl_mcp_last_test_at ? `<div class="text-muted" style="font-size:0.68rem;">${fmtDateTime(account.ghl_mcp_last_test_at)}</div>` : ''}`;
    if (status === 'partial') return `<span class="badge badge-warning">partial</span>`;
    if (status === 'failed') return `<span class="badge badge-critical">failed</span>`;
    if (status === 'disabled') return '<span class="badge badge-low">disabled</span>';
    return `<span class="badge badge-warning">${escapeHtml(status)}</span>`;
  }

  function escapeJs(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
  }

  async function openGhlDrawer(accountId, label) {
    openDrawer(`GHL Integration — ${label}`, '<div class="loading">Loading</div>');
    try {
      const status = await apiGet(`/accounts/${accountId}/ghl`);
      const lastSync = status.last_sync_at ? fmtDateTime(status.last_sync_at) : 'never';
      const configured = status.configured;
      setDrawerBody(`
        <div class="mb-md" style="font-size:0.82rem;">
          <div><span class="text-muted">Status:</span> ${configured ? '<span class="text-green">Configured</span>' : '<span class="text-muted">Not configured</span>'}</div>
          <div><span class="text-muted">Location ID:</span> ${escapeHtml(status.location_id || '—')}</div>
          <div><span class="text-muted">Last sync:</span> ${lastSync}</div>
          <div><span class="text-muted">Contacts last run:</span> ${status.last_sync_count || 0}</div>
          <div><span class="text-muted">Contacts scanned:</span> ${status.last_scan_count || 0} · <span class="text-muted">Matched:</span> ${status.last_match_count || 0}</div>
          <div><span class="text-muted">Mode:</span> ${escapeHtml(status.last_sync_mode || 'incremental')}${status.oldest_synced_at ? ` · oldest synced ${fmtDateTime(status.oldest_synced_at)}` : ''}</div>
          ${status.last_bootstrap_at ? `<div><span class="text-muted">Last bootstrap:</span> ${fmtDateTime(status.last_bootstrap_at)}</div>` : ''}
          ${status.last_sync_error ? `<div class="alert-banner alert-warning" style="margin-top:8px;">${escapeHtml(status.last_sync_error)}</div>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">GHL API Key (v1) or Private Integration Token (v2)</label>
          <textarea id="ghl-api-key" class="form-textarea mono" rows="4" placeholder="Paste API key or PIT"></textarea>
          <div class="text-muted" style="font-size:0.72rem; margin-top:4px;">Found under Settings → Business Profile → API Key (v1) or Settings → Private Integrations (v2).</div>
        </div>
        <div class="form-group">
          <label class="form-label">Location ID (optional for v1, required for v2)</label>
          <input id="ghl-location-id" class="form-input mono" placeholder="abc123LOCATIONid" value="${escapeHtml(status.location_id || '')}" />
        </div>
        <div style="display:flex; gap:8px; margin-top:16px; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="saveGhlCredentials(${accountId})">Save & Test</button>
          <button class="btn" onclick="triggerGhlSync(${accountId})" ${configured ? '' : 'disabled'}>Sync Now</button>
          ${configured ? `<button class="btn btn-danger" onclick="clearGhlCredentials(${accountId})">Remove</button>` : ''}
          <button class="btn" onclick="closeDrawer()">Close</button>
        </div>
        <div class="reco-card" style="padding:10px 12px; margin-top:14px;">
          <div class="reco-entity mb-sm" style="font-size:0.8rem;">Historical GHL sync</div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; align-items:end;">
            <div class="form-group" style="margin:0;">
              <label class="form-label">Mode</label>
              <select id="ghl-sync-mode" class="form-select">
                <option value="incremental">Incremental</option>
                <option value="range">Custom range</option>
                <option value="full">Full historical</option>
              </select>
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Since</label>
              <input id="ghl-sync-since" type="datetime-local" class="form-input" />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Until</label>
              <input id="ghl-sync-until" type="datetime-local" class="form-input" />
            </div>
            <div class="form-group" style="margin:0;">
              <label class="form-label">Max pages</label>
              <input id="ghl-sync-max-pages" type="number" min="1" max="1000" class="form-input" placeholder="500" />
            </div>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            <button class="btn btn-sm" onclick="presetGhlSyncRange(7)">Last 7d</button>
            <button class="btn btn-sm" onclick="presetGhlSyncRange(30)">Last 30d</button>
            <button class="btn btn-sm" onclick="presetGhlSyncFull()">All historical</button>
            <button class="btn btn-sm btn-primary" onclick="triggerGhlSync(${accountId}, true)">Run Historical Sync</button>
          </div>
        </div>
        <div class="text-muted" style="font-size:0.72rem; margin-top:14px; line-height:1.5;">
          Contacts are pulled every 6 hours. Each GHL contact gets matched back to a visitor by their custom <code>client_id</code> field first, then by hashed email or phone. Historical sync now supports incremental, range, and full bootstrap modes.
        </div>
      `);
    } catch (err) {
      setDrawerBody(`<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`);
    }
  }

  async function openMcpDrawer(accountId, label) {
    openDrawer(`HighLevel MCP — ${label}`, '<div class="loading">Loading</div>');
    try {
      const status = await apiGet(`/accounts/${accountId}/mcp-status`);
      const allowedTools = Array.isArray(status.allowed_tools) ? status.allowed_tools : [];
      const availableTools = Array.isArray(status.available_tools) ? status.available_tools : [];
      const missingTools = Array.isArray(status.missing_tools) ? status.missing_tools : [];
      const recentRuns = Array.isArray(status.recent_runs) ? status.recent_runs : [];
      setDrawerBody(`
        <div class="mb-md" style="font-size:0.82rem;">
          <div><span class="text-muted">Status:</span> ${status.status === 'ok' ? '<span class="text-green">Connected</span>' : status.status === 'partial' ? '<span class="text-orange">Partial</span>' : status.status === 'failed' ? '<span class="text-red">Failed</span>' : '<span class="text-muted">Disabled</span>'}</div>
          <div><span class="text-muted">Mode:</span> ${escapeHtml(status.mode || 'disabled')}</div>
          <div><span class="text-muted">Auth source:</span> ${escapeHtml(status.auth_source || 'ghl_connection')}</div>
          <div><span class="text-muted">Location ID:</span> <span class="mono">${escapeHtml(status.location_id || '—')}</span></div>
          <div><span class="text-muted">Last test:</span> ${status.last_test_at ? fmtDateTime(status.last_test_at) : 'never'}</div>
          ${status.last_error ? `<div class="alert-banner alert-warning" style="margin-top:8px;">${escapeHtml(status.last_error)}</div>` : ''}
        </div>
        <div class="form-group">
          <label class="form-label">MCP enabled</label>
          <label style="display:flex; align-items:center; gap:8px; font-size:0.82rem;">
            <input id="ghl-mcp-enabled" type="checkbox" ${status.enabled ? 'checked' : ''} />
            Enable account-scoped HighLevel MCP
          </label>
        </div>
        <div class="form-group">
          <label class="form-label">Mode</label>
          <select id="ghl-mcp-mode" class="form-select">
            <option value="disabled" ${status.mode === 'disabled' ? 'selected' : ''}>disabled</option>
            <option value="read_only" ${status.mode === 'read_only' ? 'selected' : ''}>read_only</option>
          </select>
        </div>
        <div class="reco-card" style="padding:10px 12px; margin-top:8px;">
          <div class="reco-entity mb-sm" style="font-size:0.8rem;">Connection source</div>
          <div class="text-muted" style="font-size:0.76rem; line-height:1.5;">
            MCP reuses the existing GHL connection for this account. Update the GHL token or location in the GHL drawer if this account is not mapped correctly.
          </div>
        </div>
        <div style="display:flex; gap:8px; margin-top:16px; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="saveMcpConfig(${accountId}, '${escapeJs(label || '')}')">Save MCP Config</button>
          <button class="btn" onclick="testMcpConfig(${accountId}, '${escapeJs(label || '')}')">Test Connection</button>
          <button class="btn" onclick="closeDrawer()">Close</button>
        </div>
        <div class="reco-card" style="padding:10px 12px; margin-top:14px;">
          <div class="reco-entity mb-sm" style="font-size:0.8rem;">Read-only tool coverage</div>
          <div><span class="text-muted">Allowed tools:</span> ${allowedTools.length ? allowedTools.map((tool) => `<span class="badge badge-low" style="margin:2px 4px 2px 0;">${escapeHtml(tool)}</span>`).join('') : '<span class="text-muted">—</span>'}</div>
          <div style="margin-top:8px;"><span class="text-muted">Available probes:</span> ${availableTools.length ? availableTools.map((tool) => `<span class="badge badge-active" style="margin:2px 4px 2px 0;">${escapeHtml(tool)}</span>`).join('') : '<span class="text-muted">none yet</span>'}</div>
          <div style="margin-top:8px;"><span class="text-muted">Missing probes:</span> ${missingTools.length ? missingTools.map((tool) => `<span class="badge badge-warning" style="margin:2px 4px 2px 0;">${escapeHtml(tool)}</span>`).join('') : '<span class="text-muted">none</span>'}</div>
        </div>
        <div class="table-container" style="margin-top:14px;">
          <div class="table-header"><span class="table-title">Recent MCP runs</span></div>
          ${recentRuns.length ? `<div style="overflow:auto;"><table>
            <thead><tr><th>When</th><th>Type</th><th>Tool</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>${recentRuns.map((run) => `<tr>
              <td>${fmtDateTime(run.created_at)}</td>
              <td>${escapeHtml(run.run_type || '—')}</td>
              <td class="mono">${escapeHtml(run.tool_name || '—')}</td>
              <td><span class="badge badge-${run.status === 'success' || run.status === 'ok' ? 'active' : run.status === 'partial' ? 'warning' : 'critical'}">${escapeHtml(run.status || 'unknown')}</span></td>
              <td>${escapeHtml(run.reason_code || '—')}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div class="text-muted" style="font-size:0.76rem; padding:12px;">No MCP runs yet.</div>'}
        </div>
      `);
    } catch (err) {
      setDrawerBody(`<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`);
    }
  }

  async function saveGhlCredentials(accountId) {
    const apiKey = document.getElementById('ghl-api-key').value.trim();
    const locationId = document.getElementById('ghl-location-id').value.trim();
    if (!apiKey) {
      toast('API key required', 'error');
      return;
    }
    try {
      toast('Validating with GHL…', 'info');
      await apiPost(`/accounts/${accountId}/ghl`, { apiKey, locationId });
      toast('GHL connected', 'success');
      openGhlDrawer(accountId, '');
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  function toLocalDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function presetGhlSyncRange(days) {
    const mode = document.getElementById('ghl-sync-mode');
    const since = document.getElementById('ghl-sync-since');
    const until = document.getElementById('ghl-sync-until');
    if (mode) mode.value = 'range';
    if (since) since.value = toLocalDateTime(new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString());
    if (until) until.value = toLocalDateTime(new Date().toISOString());
  }

  function presetGhlSyncFull() {
    const mode = document.getElementById('ghl-sync-mode');
    const since = document.getElementById('ghl-sync-since');
    const until = document.getElementById('ghl-sync-until');
    if (mode) mode.value = 'full';
    if (since) since.value = '';
    if (until) until.value = '';
  }

  async function triggerGhlSync(accountId, useManualOptions = false) {
    try {
      toast('Syncing GHL…', 'info');
      const payload = {};
      if (useManualOptions) {
        const mode = document.getElementById('ghl-sync-mode')?.value || 'incremental';
        const since = document.getElementById('ghl-sync-since')?.value;
        const until = document.getElementById('ghl-sync-until')?.value;
        const maxPages = document.getElementById('ghl-sync-max-pages')?.value;
        payload.mode = mode;
        if (since) payload.since = new Date(since).toISOString();
        if (until) payload.until = new Date(until).toISOString();
        if (maxPages) payload.maxPages = parseInt(maxPages, 10);
      }
      const result = await apiPost(`/accounts/${accountId}/ghl/sync`, payload);
      toast(`${result.imported || 0} contact(s) synced (${result.matched || 0} matched, ${result.scanned || 0} scanned)`, 'success');
      openGhlDrawer(accountId, '');
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  async function clearGhlCredentials(accountId) {
    if (!confirmAction('Remove GHL integration for this account?')) return;
    try {
      await apiDelete(`/accounts/${accountId}/ghl`);
      toast('GHL credentials removed', 'success');
      closeDrawer();
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  async function saveMcpConfig(accountId, label) {
    try {
      const payload = {
        enabled: document.getElementById('ghl-mcp-enabled').checked,
        mode: document.getElementById('ghl-mcp-mode').value,
      };
      await apiPatch(`/accounts/${accountId}/mcp-config`, payload);
      toast('MCP config saved', 'success');
      await openMcpDrawer(accountId, label);
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  async function testMcpConfig(accountId, label) {
    try {
      toast('Testing MCP connection…', 'info');
      await apiPost(`/accounts/${accountId}/mcp-test`, {});
      toast('MCP test completed', 'success');
      await openMcpDrawer(accountId, label);
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${safeErrorMessage(err)}`, 'error');
    }
  }

  Object.assign(window, {
    loadAdminAccounts,
    openAddAccountDrawer,
    addMetaAccount,
    setSessionAccount,
    setDefaultAccount,
    checkAccountToken,
    openGhlDrawer,
    openMcpDrawer,
    saveGhlCredentials,
    triggerGhlSync,
    presetGhlSyncRange,
    presetGhlSyncFull,
    clearGhlCredentials,
    toggleAccountProductMode,
    saveMcpConfig,
    testMcpConfig,
  });
})();
