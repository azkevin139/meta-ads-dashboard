/* ═══════════════════════════════════════════════════════════
   Settings Page
   ═══════════════════════════════════════════════════════════ */

const settingsAsyncSection = window.AsyncSectionHelpers;

async function loadSettings(container) {
  container.innerHTML = `
    <div style="max-width: 680px;">
      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">System Health</div>
        <div id="health-info"><div class="loading">Checking</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Meta Rate Limits</div>
        <div id="rate-info"><div class="loading">Loading</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Tracking Health</div>
        <div id="tracking-health-info"><div class="loading">Checking tracker</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Tracking Outage Recovery</div>
        <div id="tracking-recovery-info"><div class="loading">Loading recovery window</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Meta Lead Forms</div>
        <div id="meta-leads-info"><div class="loading">Loading lead sync status</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Connected Account</div>
        <div id="account-info"><div class="loading">Loading</div></div>
      </div>

      <div class="reco-card mb-md" id="token-import-card" style="display:none;">
        <div class="reco-entity mb-sm">Meta User Token Import</div>
        <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6; margin-bottom: 12px;">
          Paste a Meta user token to fetch every ad account that token can access, then import the accounts you want available in the dashboard.
        </div>
        <div class="form-group">
          <label class="form-label">Meta User Token</label>
          <textarea id="meta-discovery-token" class="form-textarea" rows="4" placeholder="Paste token"></textarea>
        </div>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="discoverMetaAccounts()">Fetch Ad Accounts</button>
          <label style="display:flex; align-items:center; gap:8px; font-size:0.82rem;">
            <input id="meta-import-default" type="checkbox" />
            Make first imported account default
          </label>
        </div>
        <div id="meta-discovery-results" class="mt-md"></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Sync Schedule</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
          <div>• <strong>Metrics sync:</strong> Every 6 hours via the Ad Command worker</div>
          <div>• <strong>Meta lead sync:</strong> Every 15 minutes via the Ad Command worker</div>
          <div>• <strong>GHL sync:</strong> Every 6 hours via the Ad Command worker</div>
          <div>• <strong>Audience refresh:</strong> Hourly via the Ad Command worker</div>
          <div>• <strong>Touch sequence monitor:</strong> Every 30 minutes via the Ad Command worker</div>
          <div>• <strong>n8n role:</strong> External webhooks, notifications, and optional Meta CAPI</div>
        </div>
        <div class="mt-md text-muted" style="font-size: 0.78rem;">
          Configure the n8n side at <a href="https://n8n.emma42.com" target="_blank">n8n.emma42.com</a> after importing the workflow files from the repo's <code>n8n/</code> folder.
        </div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Database Stats</div>
        <div id="db-stats"><div class="loading">Loading</div></div>
      </div>
    </div>
  `;

  const healthSection = settingsAsyncSection.createAsyncSection({
    targetId: 'health-info',
    loadingText: 'Checking',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${err.message}</span>`,
  });
  const rateSection = settingsAsyncSection.createAsyncSection({
    targetId: 'rate-info',
    loadingText: 'Loading',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${err.message}</span>`,
  });
  const trackingSection = settingsAsyncSection.createAsyncSection({
    targetId: 'tracking-health-info',
    loadingText: 'Checking tracker',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${err.message}</span>`,
  });
  const leadSection = settingsAsyncSection.createAsyncSection({
    targetId: 'meta-leads-info',
    loadingText: 'Loading lead sync status',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${err.message}</span>`,
  });
  const recoverySection = settingsAsyncSection.createAsyncSection({
    targetId: 'tracking-recovery-info',
    loadingText: 'Loading recovery window',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${err.message}</span>`,
  });
  const accountSection = settingsAsyncSection.createAsyncSection({
    targetId: 'account-info',
    loadingText: 'Loading',
    render: (html) => html,
    onError: () => '<span class="text-muted">Could not load account info</span>',
  });

  try {
    const health = await apiGet('/health');
    healthSection?.setData(`
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem;">
        <div><span class="text-muted">Status:</span> <span class="${health.status === 'ok' ? 'text-green' : 'text-red'}">● ${health.status === 'ok' ? 'Online' : 'Error'}</span></div>
        <div><span class="text-muted">Uptime:</span> ${Math.round((health.uptime || 0) / 60)} min</div>
        <div><span class="text-muted">Meta API:</span> ${health.meta_configured ? '<span class="text-green">Configured</span>' : '<span class="text-red">Not configured</span>'}</div>
        <div><span class="text-muted">OpenAI:</span> ${health.openai_configured ? '<span class="text-green">Configured</span>' : '<span class="text-red">Not configured</span>'}</div>
        <div><span class="text-muted">Server time:</span> ${new Date(health.time).toLocaleString()}</div>
        <div><span class="text-muted">Environment:</span> ${health.env}</div>
      </div>
    `);
  } catch (err) {
    healthSection?.setError(err);
  }

  try {
    const rate = await apiGet('/meta/rate-limit-status');
    const summary = rate.summary || {};
    rateSection?.setData(`
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; font-size:0.85rem;">
        <div><span class="text-muted">Ads Mgmt:</span> ${fmtPct(summary.ads_management?.call_count)}</div>
        <div><span class="text-muted">Ads Insights:</span> ${fmtPct(summary.ads_insights?.call_count)}</div>
        <div><span class="text-muted">Ad Account Util:</span> ${fmtPct(summary.ad_account_util_pct)}</div>
        <div><span class="text-muted">App CPU:</span> ${fmtPct(summary.app_cpu)}</div>
        <div><span class="text-muted">App Time:</span> ${fmtPct(summary.app_time)}</div>
        <div><span class="text-muted">Tier:</span> ${summary.ads_api_access_tier || '—'}</div>
        <div><span class="text-muted">Safe to write:</span> ${rate.safe_to_write ? '<span class="text-green">Yes</span>' : '<span class="text-red">Wait</span>'}</div>
        <div><span class="text-muted">Regain access:</span> ${fmtWait(rate.estimated_regain_seconds)}</div>
      </div>
      ${rate.last_seen_at ? `<div class="mt-sm text-muted" style="font-size:0.78rem;">Last Meta header seen: ${fmtDateTime(rate.last_seen_at)}</div>` : '<div class="mt-sm text-muted" style="font-size:0.78rem;">No Meta usage headers captured yet. Load live Meta data first.</div>'}
    `);
  } catch (err) {
    rateSection?.setError(err);
  }

  try {
    const health = await apiGet(`/intelligence/tracking-health?accountId=${ACCOUNT_ID}`);
    const v = health.visitors || {};
    const e = health.events || {};
    const d = health.diagnostics || {};
    const selectedDiag = d.selected || {};
    const latestDiag = d.latest || {};
    const badge = health.status === 'live'
      ? '<span class="badge badge-active">● Live</span>'
      : health.status === 'stale'
        ? '<span class="badge badge-warning">⚠ No traffic in 24h</span>'
        : '<span class="badge badge-critical">✕ No data captured</span>';
    const lastSeen = v.last_seen_at ? fmtDateTime(v.last_seen_at) : 'never';
    trackingSection?.setData(`
      <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
        <div>${badge}</div>
        <div class="text-muted" style="font-size:0.72rem;">Last visitor: ${lastSeen}</div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:10px; font-size:0.82rem;">
        <div><div class="kpi-label">Visitors 24h</div><div style="font-weight:600;">${fmt(v.last_24h, 'integer')}</div></div>
        <div><div class="kpi-label">Visitors 1h</div><div style="font-weight:600;">${fmt(v.last_1h, 'integer')}</div></div>
        <div><div class="kpi-label">Events 24h</div><div style="font-weight:600;">${fmt(e.last_24h, 'integer')}</div></div>
        <div><div class="kpi-label">Ad clicks</div><div style="font-weight:600;">${fmt(v.with_fbclid, 'integer')} <span class="text-muted" style="font-weight:400;">(${v.fbclid_rate || 0}%)</span></div></div>
        <div><div class="kpi-label">Resolved contacts</div><div style="font-weight:600;">${fmt(v.resolved, 'integer')}</div></div>
        <div><div class="kpi-label">Total visitors</div><div style="font-weight:600;">${fmt(v.total, 'integer')}</div></div>
        <div><div class="kpi-label">Requests</div><div style="font-weight:600;">${fmt(selectedDiag.request_count, 'integer')}</div></div>
        <div><div class="kpi-label">Success</div><div style="font-weight:600;">${fmt(selectedDiag.success_count, 'integer')}</div></div>
        <div><div class="kpi-label">Failures</div><div style="font-weight:600;">${fmt(selectedDiag.failure_count, 'integer')}</div></div>
        <div><div class="kpi-label">Last payload</div><div style="font-weight:600;">${selectedDiag.last_payload_at ? fmtDateTime(selectedDiag.last_payload_at) : '—'}</div></div>
      </div>
      ${health.status !== 'live' ? `<div class="alert-banner alert-warning" style="margin-top:12px;">No pageviews recorded in the last 24 hours for this account. Confirm the snippet is on your landing page and the page is served over HTTPS to the same origin as this dashboard.</div>` : ''}
      ${selectedDiag.last_error ? `<div class="alert-banner alert-warning" style="margin-top:12px;">Last ingest error: ${escapeHtml(selectedDiag.last_error)}</div>` : ''}
      ${d.account_mismatch && latestDiag.meta_account_id ? `<div class="alert-banner alert-warning" style="margin-top:12px;">Selected account is <span class="mono">${escapeHtml(health.meta_account_id || '')}</span>, but the latest tracker payload hit <span class="mono">${escapeHtml(latestDiag.meta_account_id)}</span>. Switch the dashboard account or fix the snippet account ID.</div>` : ''}
    `);
  } catch (err) {
    trackingSection?.setError(err);
  }

  try {
    const status = await apiGet('/meta/leads-sync-status');
    renderLeadSyncStatus(status, leadSection);
  } catch (err) {
    leadSection?.setError(err);
  }

  try {
    await renderTrackingRecovery(recoverySection);
  } catch (err) {
    recoverySection?.setError(err);
  }

  try {
    const [overview, context] = await Promise.all([
      apiGet(`/insights/overview?accountId=${ACCOUNT_ID}&days=30`),
      apiGet('/intelligence/account-context').catch(() => null),
    ]);
    const account = context?.internal_account || {};
    const metaAccountId = account.meta_account_id || context?.configured_meta_account_id || '';
    const trackerSnippet = buildTrackerSnippet(metaAccountId);
    accountSection?.setData(`
      <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
        <div><span class="text-muted">Account ID:</span> Internal #${ACCOUNT_ID}</div>
        <div><span class="text-muted">Meta Account:</span> ${metaAccountId || '—'}</div>
        <div><span class="text-muted">Name:</span> ${account.name || '—'}</div>
        <div><span class="text-muted">30-day data:</span> ${overview.overview?.days_with_data || 0} days</div>
        <div><span class="text-muted">30-day spend:</span> ${fmt(overview.overview?.total_spend, 'currency')}</div>
      </div>
      <div class="mt-md">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:8px;">
          <div class="reco-entity" style="font-size:0.82rem;">Website Tracking Code</div>
          <button class="btn btn-sm" onclick="copyTrackerSnippet()">Copy Code</button>
        </div>
        <div class="text-muted" style="font-size:0.78rem; line-height:1.6; margin-bottom:8px;">
          Insert this snippet before the closing body tag on your website. The active Meta ad account is already prefilled. Add <span class="mono">data-debug="true"</span> temporarily when you need browser console logs for failed sends.
        </div>
        <textarea id="tracker-snippet" class="form-textarea mono" rows="6" readonly>${escapeHtml(trackerSnippet)}</textarea>
      </div>
    `);
  } catch (err) {
    accountSection?.setError(err);
  }

  if (currentUser && currentUser.role === 'admin') {
    document.getElementById('token-import-card').style.display = '';
    renderSavedMetaAccounts();
  }

  document.getElementById('db-stats').innerHTML = `
    <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
      <div>Database is live and connected via Postgres pool.</div>
      <div class="mt-sm text-muted" style="font-size: 0.78rem;">Run <code style="background: var(--bg-elevated); padding: 2px 6px; border-radius: 3px;">psql -U meta_dash -d meta_dashboard</code> to inspect directly.</div>
    </div>
  `;
}

async function renderTrackingRecovery(section = null) {
  const data = await apiGet(`/intelligence/tracking-recovery?accountId=${ACCOUNT_ID}`);
  const window = data.outage_window || {};
  const buckets = data.buckets || [];
  const html = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
      <div class="form-group" style="margin:0;">
        <label class="form-label">Outage start</label>
        <input id="tracking-outage-start" class="form-input" type="date" value="${escapeHtml(window.outage_start || '')}">
      </div>
      <div class="form-group" style="margin:0;">
        <label class="form-label">Outage end</label>
        <input id="tracking-outage-end" class="form-input" type="date" value="${escapeHtml(window.outage_end || '')}">
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Notes</label>
      <textarea id="tracking-outage-notes" class="form-textarea" rows="2" placeholder="Optional outage note">${escapeHtml(window.notes || '')}</textarea>
    </div>
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
      <button class="btn btn-sm" onclick="saveTrackingRecoveryWindow()">Save Window</button>
      <button class="btn btn-sm btn-primary" onclick="runTrackingRecoveryBackfill(this)">Run Partial Backfill</button>
    </div>
    ${window.outage_start ? `<div class="text-muted" style="font-size:0.76rem; margin-bottom:12px;">Configured outage window: ${escapeHtml(window.outage_start)} to ${escapeHtml(window.outage_end)}${window.updated_at ? ` · updated ${fmtDateTime(window.updated_at)}` : ''}</div>` : '<div class="text-muted" style="font-size:0.76rem; margin-bottom:12px;">Set the outage window first. Backfill stays source-labeled and does not fabricate native visitor rows.</div>'}
    ${buckets.length ? `<div style="display:grid; gap:10px;">
      ${buckets.map((bucket) => `
        <div class="reco-card" style="padding:10px 12px;">
          <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:600; font-size:0.82rem;">${escapeHtml(bucket.label)}</div>
              <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(bucket.detail || '')}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-weight:700;">${fmt(bucket.count, 'integer')}</div>
              <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(bucket.status || '')} · ${escapeHtml(bucket.confidence || '')}</div>
            </div>
          </div>
          ${bucket.clicks !== undefined || bucket.spend !== undefined ? `<div class="text-muted" style="font-size:0.72rem; margin-top:8px;">Clicks: ${fmt(bucket.clicks, 'integer')} · Spend: ${fmt(bucket.spend, 'currency')}</div>` : ''}
        </div>
      `).join('')}
    </div>` : `<div class="text-muted" style="font-size:0.82rem;">${escapeHtml(data.note || 'No recovery data yet')}</div>`}
  `;
  section ? section.setData(html) : (document.getElementById('tracking-recovery-info').innerHTML = html);
}

async function saveTrackingRecoveryWindow() {
  try {
    await apiPost('/intelligence/tracking-recovery', {
      accountId: ACCOUNT_ID,
      outage_start: document.getElementById('tracking-outage-start').value,
      outage_end: document.getElementById('tracking-outage-end').value,
      notes: document.getElementById('tracking-outage-notes').value,
    });
    toast('Outage window saved', 'success');
    await renderTrackingRecovery();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function runTrackingRecoveryBackfill(btn) {
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Backfilling…';
  }
  try {
    const result = await apiPost('/intelligence/tracking-recovery/backfill', {
      accountId: ACCOUNT_ID,
      outage_start: document.getElementById('tracking-outage-start').value,
      outage_end: document.getElementById('tracking-outage-end').value,
      notes: document.getElementById('tracking-outage-notes').value,
    });
    const metaImported = result.data?.meta_leads?.imported || 0;
    const ghlImported = result.data?.ghl_contacts?.imported || 0;
    toast(`Backfill finished: ${metaImported} Meta leads, ${ghlImported} GHL contacts`, 'success');
    await renderTrackingRecovery();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Run Partial Backfill';
    }
  }
}

function renderLeadSyncStatus(status, section = null) {
  const el = document.getElementById('meta-leads-info');
  if (!el && !section) return;
  if (!status || !status.configured) {
    section ? section.setData('<div class="text-muted" style="font-size:0.82rem;">Select an active Meta account to enable lead sync.</div>') : (el.innerHTML = '<div class="text-muted" style="font-size:0.82rem;">Select an active Meta account to enable lead sync.</div>');
    return;
  }
  const lastSync = status.last_sync_at ? fmtDateTime(status.last_sync_at) : 'never';
  const imported = status.last_sync_count || 0;
  const err = status.last_sync_error;
  const html = `
    <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
      <div style="font-size:0.82rem;">
        <div><span class="text-muted">Last sync:</span> ${lastSync}</div>
        <div><span class="text-muted">Leads last run:</span> ${imported}</div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="triggerLeadSync(this)">Sync Leads Now</button>
    </div>
    ${err ? `<div class="alert-banner alert-warning" style="margin-top:10px;">Last sync error: ${escapeHtml(err)}</div>` : ''}
    <div class="text-muted" style="font-size:0.72rem; margin-top:8px;">Native Meta Lead Form submissions are automatically pulled every 15 minutes.</div>
  `;
  section ? section.setData(html) : (el.innerHTML = html);
}

async function triggerLeadSync(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const result = await apiPost('/meta/leads-sync', {});
    toast(`${result.imported || 0} lead(s) imported${result.skipped ? `, ${result.skipped} skipped` : ''}`, 'success');
    const status = await apiGet('/meta/leads-sync-status');
    renderLeadSyncStatus(status);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Leads Now'; }
  }
}

function buildTrackerSnippet(metaAccountId) {
  const origin = window.location.origin;
  return `<script
  src="${origin}/js/meta-tracker.js"
  data-endpoint="${origin}/api/track/pageview"
  data-meta-account-id="${metaAccountId || 'act_YOUR_META_AD_ACCOUNT_ID'}">
</script>`;
}

async function copyTrackerSnippet() {
  const el = document.getElementById('tracker-snippet');
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.value);
    toast('Tracking code copied', 'success');
  } catch (err) {
    el.select();
    document.execCommand('copy');
    toast('Tracking code copied', 'success');
  }
}

async function renderSavedMetaAccounts() {
  const el = document.getElementById('meta-discovery-results');
  if (!el) return;
  try {
    const res = await apiGet('/accounts');
    const accounts = res.data || [];
    if (!accounts.length) {
      el.innerHTML = '<div class="text-muted" style="font-size:0.82rem;">No saved token-backed ad accounts yet.</div>';
      return;
    }
    el.innerHTML = `
      <div class="table-container" style="margin-top: 12px;">
        <div class="table-header">
          <span class="table-title">Saved Meta Accounts</span>
          <button class="btn btn-sm" onclick="syncMetaAccountMetadata()">Refresh Currencies</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Meta ID</th>
              <th>Token</th>
              <th>Default</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            ${accounts.map(account => `
              <tr>
                <td>
                  <div style="font-weight:500; font-size:0.85rem;">${escapeHtml(account.label || account.name || 'Meta account')}</div>
                  <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(account.currency || '—')} · ${escapeHtml(account.timezone || '—')}</div>
                </td>
                <td class="mono" style="font-size:0.75rem;">${escapeHtml(account.meta_account_id)}</td>
                <td class="mono" style="font-size:0.75rem;">${account.token_last4 ? `...${escapeHtml(account.token_last4)}` : 'stored'}</td>
                <td>${account.is_active ? '<span class="text-green">Default</span>' : '<span class="text-muted">—</span>'}</td>
                <td>${String(account.id) === String(res.active?.id) ? '<span class="text-green">Selected</span>' : `<button class="btn btn-sm" onclick="switchActiveAccount(${account.id})">Use</button>`}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

async function discoverMetaAccounts() {
  const tokenEl = document.getElementById('meta-discovery-token');
  const resultsEl = document.getElementById('meta-discovery-results');
  const token = tokenEl.value.trim();
  if (!token) {
    toast('Meta user token is required', 'error');
    return;
  }

  resultsEl.innerHTML = '<div class="loading">Fetching ad accounts</div>';
  try {
    const res = await apiPost('/accounts/discover', { token });
    const accounts = res.data || [];
    window.metaDiscoveredAccounts = accounts;

    if (!accounts.length) {
      resultsEl.innerHTML = `
        <div class="alert-banner alert-warning">
          Token is valid${res.user?.name ? ` for ${escapeHtml(res.user.name)}` : ''}, but no ad accounts were returned.
        </div>
      `;
      return;
    }

    resultsEl.innerHTML = `
      <div class="alert-banner alert-info">
        Found ${accounts.length} ad account${accounts.length === 1 ? '' : 's'}${res.user?.name ? ` for ${escapeHtml(res.user.name)}` : ''}.
      </div>
      <div class="table-container" style="margin-top: 12px;">
        <table>
          <thead>
            <tr>
              <th style="width:42px;"><input type="checkbox" id="meta-select-all" checked onchange="toggleDiscoveredMetaAccounts(this.checked)" /></th>
              <th>Account</th>
              <th>Meta ID</th>
              <th>Currency</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${accounts.map((account, index) => `
              <tr>
                <td><input class="meta-discovered-check" type="checkbox" value="${index}" checked /></td>
                <td>
                  <div style="font-weight:500; font-size:0.85rem;">${escapeHtml(account.name || 'Meta account')}</div>
                  <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(account.timezone || 'UTC')}</div>
                </td>
                <td class="mono" style="font-size:0.75rem;">${escapeHtml(account.meta_account_id || account.id || '')}</td>
                <td>${escapeHtml(account.currency || '—')}</td>
                <td>${formatMetaAccountStatus(account.account_status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex; gap:8px; margin-top:12px; flex-wrap:wrap;">
        <button class="btn btn-primary" onclick="saveDiscoveredMetaAccounts()">Import Selected</button>
        <button class="btn" onclick="renderSavedMetaAccounts()">Cancel</button>
      </div>
    `;
  } catch (err) {
    resultsEl.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

function toggleDiscoveredMetaAccounts(checked) {
  document.querySelectorAll('.meta-discovered-check').forEach(el => {
    el.checked = checked;
  });
}

async function syncMetaAccountMetadata() {
  const el = document.getElementById('meta-discovery-results');
  if (el) el.innerHTML = '<div class="loading">Refreshing account currency and timezone from Meta</div>';
  try {
    const res = await apiPost('/accounts/sync-metadata', {});
    const failed = res.failed || [];
    toast(`Refreshed ${res.refreshed?.length || 0} account(s) from Meta`, failed.length ? 'warning' : 'success');
    await hydrateAccountContext();
    await renderSavedMetaAccounts();
    if (failed.length && el) {
      el.insertAdjacentHTML('afterbegin', `
        <div class="alert-banner alert-warning" style="margin-bottom:12px;">
          ${failed.length} account${failed.length === 1 ? '' : 's'} could not be refreshed. Check token access for those accounts.
        </div>
      `);
    }
  } catch (err) {
    if (el) el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
    toast(`Error: ${err.message}`, 'error');
  }
}

async function saveDiscoveredMetaAccounts() {
  const token = document.getElementById('meta-discovery-token').value.trim();
  const make_first_default = document.getElementById('meta-import-default').checked;
  const selected = Array.from(document.querySelectorAll('.meta-discovered-check:checked'))
    .map(el => window.metaDiscoveredAccounts[parseInt(el.value, 10)])
    .filter(Boolean);

  if (!token || !selected.length) {
    toast('Select at least one ad account to import', 'error');
    return;
  }

  try {
    const res = await apiPost('/accounts/import', { token, accounts: selected, make_first_default });
    toast(`Imported ${res.data?.length || selected.length} Meta account(s)`, 'success');
    document.getElementById('meta-discovery-token').value = '';
    window.metaDiscoveredAccounts = [];
    await hydrateAccountContext();
    await renderSavedMetaAccounts();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

function formatMetaAccountStatus(status) {
  const code = String(status || '');
  if (code === '1') return '<span class="text-green">Active</span>';
  if (!code) return '<span class="text-muted">—</span>';
  return `<span class="text-muted">${escapeHtml(code)}</span>`;
}

function fmtPct(value) {
  return typeof value === 'number' ? `${value}%` : '—';
}

function fmtWait(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  if (!s) return '0s';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}
