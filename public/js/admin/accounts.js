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
                  <td class="mono" style="font-size: 0.75rem;">${a.token_last4 ? `...${escapeHtml(a.token_last4)}` : 'stored'}</td>
                  <td>${tokenBadge}</td>
                  <td>${a.is_active ? '<span class="text-green">Default</span>' : '<span class="text-muted">—</span>'}</td>
                  <td>${String(a.id) === String(activeId) ? '<span class="text-green">Selected</span>' : '<span class="text-muted">—</span>'}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm" onclick="setSessionAccount(${a.id})">Use</button>
                      <button class="btn btn-sm" onclick="checkAccountToken(${a.id})">Check</button>
                      <button class="btn btn-sm" onclick="openGhlDrawer(${a.id}, '${escapeJs(a.label || a.name || '')}')">GHL</button>
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
      toast(`Error: ${err.message}`, 'error');
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
      toast(`Error: ${err.message}`, 'error');
    }
  }

  async function checkAccountToken(accountId) {
    try {
      toast('Checking token…', 'info');
      await apiPost(`/accounts/${accountId}/token-check`, {});
      toast('Token checked', 'success');
      loadAdminAccounts();
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
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
        <div class="text-muted" style="font-size:0.72rem; margin-top:14px; line-height:1.5;">
          Contacts are pulled every 6 hours. Each GHL contact gets matched back to a visitor by their custom <code>client_id</code> field first, then by hashed email or phone.
        </div>
      `);
    } catch (err) {
      setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
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
      toast(`Error: ${err.message}`, 'error');
    }
  }

  async function triggerGhlSync(accountId) {
    try {
      toast('Syncing GHL…', 'info');
      const result = await apiPost(`/accounts/${accountId}/ghl/sync`, {});
      toast(`${result.imported || 0} contact(s) synced (${result.matched || 0} matched to visitors)`, 'success');
      openGhlDrawer(accountId, '');
    } catch (err) {
      toast(`Error: ${err.message}`, 'error');
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
      toast(`Error: ${err.message}`, 'error');
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
    saveGhlCredentials,
    triggerGhlSync,
    clearGhlCredentials,
  });
})();
