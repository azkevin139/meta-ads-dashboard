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
        <div class="reco-entity mb-sm">Tracking Reconciliation</div>
        <div id="tracking-reconciliation-info"><div class="loading">Loading reconciliation</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Meta Lead Forms</div>
        <div id="meta-leads-info"><div class="loading">Loading lead sync status</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Known Contact Revisit Automation</div>
        <div id="revisit-automation-info"><div class="loading">Loading revisit automation</div></div>
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
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
  });
  const rateSection = settingsAsyncSection.createAsyncSection({
    targetId: 'rate-info',
    loadingText: 'Loading',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
  });
  const trackingSection = settingsAsyncSection.createAsyncSection({
    targetId: 'tracking-health-info',
    loadingText: 'Checking tracker',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
  });
  const leadSection = settingsAsyncSection.createAsyncSection({
    targetId: 'meta-leads-info',
    loadingText: 'Loading lead sync status',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
  });
  const revisitSection = settingsAsyncSection.createAsyncSection({
    targetId: 'revisit-automation-info',
    loadingText: 'Loading revisit automation',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
  });
  const recoverySection = settingsAsyncSection.createAsyncSection({
    targetId: 'tracking-recovery-info',
    loadingText: 'Loading recovery window',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
  });
  const reconciliationSection = settingsAsyncSection.createAsyncSection({
    targetId: 'tracking-reconciliation-info',
    loadingText: 'Loading reconciliation',
    render: (html) => html,
    onError: (err) => `<span class="text-red">Error: ${safeErrorMessage(err)}</span>`,
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
    const [health, trackingAlertRes] = await Promise.all([
      apiGet(`/intelligence/tracking-health?accountId=${ACCOUNT_ID}`),
      apiGet(`/intelligence/tracking-alerts?accountId=${ACCOUNT_ID}&hours=24`).catch(() => ({ alerts: [] })),
    ]);
    const v = health.visitors || {};
    const e = health.events || {};
    const d = health.diagnostics || {};
    const selectedDiag = d.selected || {};
    const latestDiag = d.latest || {};
    const trackingAlerts = trackingAlertRes.alerts || [];
    const badge = health.status === 'live'
      ? '<span class="badge badge-active">● Live</span>'
      : health.status === 'stale'
        ? '<span class="badge badge-warning">⚠ No traffic in 24h</span>'
        : '<span class="badge badge-critical">✕ No data captured</span>';
    const lastSeen = v.last_seen_at ? fmtDateTime(v.last_seen_at) : 'never';
    trackingSection?.setData(`
      <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">${badge}${sourceBadge('native_tracked')}${health.status !== 'live' ? sourceBadge('outage_affected') : ''}</div>
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
      ${trackingAlerts.map((alert) => `<div class="alert-banner ${alert.severity === 'critical' ? 'alert-critical' : 'alert-warning'}" style="margin-top:12px;">${escapeHtml(alert.title)} — ${escapeHtml(alert.message)}${alert.action ? ` <span class="text-muted">${escapeHtml(alert.action)}</span>` : ''}</div>`).join('')}
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
    const data = await apiGet(`/intelligence/revisit-automation?accountId=${ACCOUNT_ID}`);
    renderRevisitAutomationStatus(data, revisitSection);
  } catch (err) {
    revisitSection?.setError(err);
  }

  try {
    const recoveryData = await renderTrackingRecovery(recoverySection);
    reconciliationSection?.setData(renderTrackingReconciliation(recoveryData));
  } catch (err) {
    recoverySection?.setError(err);
    reconciliationSection?.setError(err);
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
        <div><span class="text-muted">30-day data:</span> ${overview.overview?.days_with_data || 0} days ${sourceBadge('warehouse_aggregate')}</div>
        <div><span class="text-muted">30-day spend:</span> ${fmt(overview.overview?.total_spend, 'currency')} ${sourceBadge('warehouse_aggregate')}</div>
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
    ${window.outage_start ? `<div class="text-muted" style="font-size:0.76rem; margin-bottom:12px;">Configured outage window: ${escapeHtml(window.outage_start)} to ${escapeHtml(window.outage_end)}${window.updated_at ? ` · updated ${fmtDateTime(window.updated_at)}` : ''}${window.last_backfill_at ? ` · last backfill ${fmtDateTime(window.last_backfill_at)}` : ''}</div>` : '<div class="text-muted" style="font-size:0.76rem; margin-bottom:12px;">Set the outage window first. Backfill stays source-labeled and does not fabricate native visitor rows.</div>'}
    ${buckets.length ? `<div style="display:grid; gap:10px;">
      ${buckets.map((bucket) => `
        <div class="reco-card" style="padding:10px 12px;">
          <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
            <div>
              <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center; font-weight:600; font-size:0.82rem;">${escapeHtml(bucket.label)}${sourceBadge(bucket.source)}${bucket.status === 'lost' ? sourceBadge('outage_affected') : ''}</div>
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
  return data;
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
    const data = await renderTrackingRecovery();
    const recon = document.getElementById('tracking-reconciliation-info');
    if (recon) recon.innerHTML = renderTrackingReconciliation(data);
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
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
    const data = await renderTrackingRecovery();
    const recon = document.getElementById('tracking-reconciliation-info');
    if (recon) recon.innerHTML = renderTrackingReconciliation(data);
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Run Partial Backfill';
    }
  }
}

function sourceBadge(source) {
  const map = {
    native_tracked: ['active', 'Native tracked', 'First-party events that reached the Ad Command tracking endpoint.'],
    imported_meta: ['warning', 'Imported from Meta', 'Known leads recovered from Meta native lead forms.'],
    imported_ghl: ['warning', 'Imported from GHL', 'Known contacts or lifecycle states synced from GHL.'],
    warehouse_aggregate: ['low', 'Warehouse aggregate', 'Account-level mirrored Meta reporting, not reconstructed visitor identity.'],
    unavailable: ['critical', 'Unavailable', 'Source not connected for this outage window.'],
    outage_affected: ['warning', 'Outage affected', 'Metric is impacted by the native tracking outage window.'],
  };
  const entry = map[source] || ['low', source || 'Source', 'Source label'];
  return `<span class="badge badge-${entry[0]}" title="${escapeHtml(entry[2])}">${escapeHtml(entry[1])}</span>`;
}

function formatReconValue(value, format, source) {
  if (value === null || value === undefined) return '<span class="text-muted">—</span>';
  const rendered = format === 'currency' ? fmt(value, 'currency') : fmt(value, 'integer');
  return `${rendered} ${sourceBadge(source)}`;
}

function renderTrackingReconciliation(data = {}) {
  const window = data.outage_window || {};
  const rows = data.reconciliation || [];
  const warnings = data.warnings || [];
  if (!window.outage_start) {
    return '<div class="text-muted" style="font-size:0.82rem;">Configure an outage window first to compare native, imported, and aggregate recovery sources.</div>';
  }
  return `
    <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
      <div style="font-size:0.82rem;">
        <div><span class="text-muted">Selected account:</span> #${ACCOUNT_ID}</div>
        <div><span class="text-muted">Outage window:</span> ${escapeHtml(window.outage_start)} to ${escapeHtml(window.outage_end)}</div>
        <div><span class="text-muted">Backfill last run:</span> ${window.last_backfill_at ? fmtDateTime(window.last_backfill_at) : 'never'}</div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:flex-start;">
        ${sourceBadge('native_tracked')}
        ${sourceBadge('imported_meta')}
        ${sourceBadge('imported_ghl')}
        ${sourceBadge('warehouse_aggregate')}
        ${sourceBadge('outage_affected')}
      </div>
    </div>
    <div style="overflow:auto;">
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th class="right">Native</th>
            <th class="right">Meta</th>
            <th class="right">GHL</th>
            <th class="right">Warehouse</th>
            <th class="right">Delta</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td class="name-cell">${escapeHtml(row.metric)}</td>
              <td class="right">${formatReconValue(row.native, row.format, 'native_tracked')}</td>
              <td class="right">${formatReconValue(row.meta, row.format, 'imported_meta')}</td>
              <td class="right">${formatReconValue(row.ghl, row.format, 'imported_ghl')}</td>
              <td class="right">${formatReconValue(row.warehouse, row.format, 'warehouse_aggregate')}</td>
              <td class="right">${row.delta === null || row.delta === undefined ? '—' : (row.format === 'currency' ? fmt(row.delta, 'currency') : fmt(row.delta, 'integer'))}</td>
              <td>${escapeHtml(row.notes || '')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:grid; gap:8px; margin-top:12px;">
      ${warnings.map((warning) => `<div class="alert-banner alert-warning">${escapeHtml(warning)}</div>`).join('')}
    </div>
  `;
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
  const registryTable = '<div id="meta-lead-form-registry" style="margin-top:12px;"><div class="loading">Loading form registry</div></div>';
  const html = `
    <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
      <div style="font-size:0.82rem;">
        <div><span class="text-muted">Last sync:</span> ${lastSync}</div>
        <div><span class="text-muted">Leads last run:</span> ${imported}</div>
        <div><span class="text-muted">Ads scanned:</span> ${fmt(status.last_ad_count || 0, 'integer')} · <span class="text-muted">Lead rows scanned:</span> ${fmt(status.last_scan_count || 0, 'integer')}</div>
        <div><span class="text-muted">Mode:</span> ${escapeHtml(status.last_sync_mode || 'incremental')}${status.last_sync_since ? ` · since ${fmtDateTime(status.last_sync_since)}` : ''}${status.last_sync_until ? ` → ${fmtDateTime(status.last_sync_until)}` : ''}</div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        ${sourceBadge('imported_meta')}
        <button class="btn btn-sm btn-primary" onclick="triggerLeadSync(this)">Sync Leads Now</button>
      </div>
    </div>
    <div class="reco-card" style="padding:10px 12px; margin-top:10px;">
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; align-items:end;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Mode</label>
          <select id="meta-lead-sync-mode" class="form-select">
            <option value="incremental">Incremental</option>
            <option value="range">Custom range</option>
            <option value="full">Full historical</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Since</label>
          <input id="meta-lead-sync-since" type="datetime-local" class="form-input" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Until</label>
          <input id="meta-lead-sync-until" type="datetime-local" class="form-input" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Max ads</label>
          <input id="meta-lead-sync-max-ads" type="number" min="1" max="1000" class="form-input" placeholder="250" />
        </div>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;">
        <button class="btn btn-sm" onclick="presetLeadSyncRange(7)">Last 7d</button>
        <button class="btn btn-sm" onclick="presetLeadSyncRange(30)">Last 30d</button>
        <button class="btn btn-sm" onclick="presetLeadSyncFull()">All historical</button>
        <button class="btn btn-sm btn-primary" onclick="triggerLeadSync(this, true)">Run Manual Backfill</button>
      </div>
    </div>
    ${err ? `<div class="alert-banner alert-warning" style="margin-top:10px;">Last sync error: ${escapeHtml(err)}</div>` : ''}
    <div class="text-muted" style="font-size:0.72rem; margin-top:8px;">Incremental lead sync runs every 15 minutes. Use manual range/full sync for historical recovery from older ads and archived delivery.</div>
    ${registryTable}
  `;
  section ? section.setData(html) : (el.innerHTML = html);
  loadMetaLeadFormRegistry();
}

function renderRevisitAutomationStatus(data, section = null) {
  const config = data?.config || {};
  const activity = data?.activity || [];
  const html = `
    <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
      <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
        <span class="badge badge-${config.enabled ? 'active' : 'warning'}">${config.enabled ? 'Enabled' : 'Disabled'}</span>
        ${config.webhook_configured ? '<span class="badge badge-active">Webhook configured</span>' : '<span class="badge badge-critical">Webhook missing</span>'}
        ${config.signing_secret_configured ? '<span class="badge badge-active">Signed</span>' : '<span class="badge badge-warning">Unsigned</span>'}
      </div>
      <div class="text-muted" style="font-size:0.72rem;">Worker poll: ${fmtWait((config.interval_ms || 0) / 1000)}</div>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:10px; font-size:0.82rem;">
      <div><div class="kpi-label">Delay</div><div style="font-weight:600;">${fmt(config.delay_seconds, 'integer')}s</div></div>
      <div><div class="kpi-label">Cooldown</div><div style="font-weight:600;">${fmt(config.cooldown_hours, 'integer')}h</div></div>
      <div><div class="kpi-label">Max attempts</div><div style="font-weight:600;">${fmt(config.max_attempts, 'integer')}</div></div>
      <div><div class="kpi-label">Key paths</div><div style="font-weight:600;">${(config.key_paths || []).length}</div></div>
    </div>
    <div class="text-muted" style="font-size:0.76rem; margin-top:10px;">
      ${config.key_paths?.length ? `Eligible paths: ${config.key_paths.map((path) => `<span class="mono">${escapeHtml(path)}</span>`).join(', ')}` : 'No key paths configured. Even if enabled, revisits will be suppressed until key paths are set in env.'}
    </div>
    ${!config.enabled ? '<div class="alert-banner alert-warning" style="margin-top:12px;">Feature code is live, but revisit automation is disabled in environment configuration.</div>' : ''}
    ${config.enabled && !config.webhook_configured ? '<div class="alert-banner alert-critical" style="margin-top:12px;">Webhook URL is missing. Eligible revisit jobs will not be deliverable.</div>' : ''}
    <div class="table-container" style="margin-top:12px;">
      <div class="table-header"><span class="table-title">Recent Revisit Jobs</span><span class="badge badge-low">READ ONLY</span></div>
      ${activity.length ? `
        <table>
          <thead><tr><th>Contact</th><th>Path</th><th>Status</th><th class="right">Attempts</th><th>Scheduled</th><th>Sent</th><th>Notes</th></tr></thead>
          <tbody>
            ${activity.map((row) => `<tr>
              <td class="name-cell"><span class="mono">${escapeHtml(row.ghl_contact_id || '—')}</span></td>
              <td><span class="mono">${escapeHtml(row.page_path || '—')}</span></td>
              <td><span class="badge badge-${row.status === 'sent' ? 'active' : row.status === 'failed' ? 'critical' : row.status === 'suppressed' ? 'warning' : 'low'}">${escapeHtml(row.status)}</span></td>
              <td class="right">${fmt(row.attempt_count, 'integer')}</td>
              <td>${row.scheduled_for ? fmtDateTime(row.scheduled_for) : '—'}</td>
              <td>${row.delivery_sent_at ? fmtDateTime(row.delivery_sent_at) : (row.sent_at ? fmtDateTime(row.sent_at) : '—')}</td>
              <td>${escapeHtml(row.last_error || row.delivery_status || '—')}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="text-muted" style="font-size:0.76rem; padding:12px;">No revisit jobs recorded for the selected account yet.</div>'}
    </div>
    <div class="text-muted" style="font-size:0.72rem; margin-top:8px;">Configuration is currently environment-driven. This screen shows live status and recent activity, but does not edit secrets in-browser.</div>
  `;
  section ? section.setData(html) : (document.getElementById('revisit-automation-info').innerHTML = html);
}

function toLocalInputValue(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function presetLeadSyncRange(days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const until = new Date();
  const mode = document.getElementById('meta-lead-sync-mode');
  const sinceEl = document.getElementById('meta-lead-sync-since');
  const untilEl = document.getElementById('meta-lead-sync-until');
  if (mode) mode.value = 'range';
  if (sinceEl) sinceEl.value = toLocalInputValue(since.toISOString());
  if (untilEl) untilEl.value = toLocalInputValue(until.toISOString());
}

function presetLeadSyncFull() {
  const mode = document.getElementById('meta-lead-sync-mode');
  const sinceEl = document.getElementById('meta-lead-sync-since');
  const untilEl = document.getElementById('meta-lead-sync-until');
  if (mode) mode.value = 'full';
  if (sinceEl) sinceEl.value = '';
  if (untilEl) untilEl.value = '';
}

async function triggerLeadSync(btn, useManualOptions = false) {
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const payload = {};
    if (useManualOptions) {
      const mode = document.getElementById('meta-lead-sync-mode')?.value || 'incremental';
      const since = document.getElementById('meta-lead-sync-since')?.value;
      const until = document.getElementById('meta-lead-sync-until')?.value;
      const maxAds = document.getElementById('meta-lead-sync-max-ads')?.value;
      payload.mode = mode;
      if (since) payload.since = new Date(since).toISOString();
      if (until) payload.until = new Date(until).toISOString();
      if (maxAds) payload.maxAds = parseInt(maxAds, 10);
      payload.includeArchived = mode !== 'incremental';
    }
    const result = await apiPost('/meta/leads-sync', payload);
    toast(`${result.imported || 0} lead(s) imported${result.skipped ? `, ${result.skipped} skipped` : ''}${result.scanned ? `, ${result.scanned} scanned` : ''}`, 'success');
    const status = await apiGet('/meta/leads-sync-status');
    renderLeadSyncStatus(status);
    loadMetaLeadFormRegistry();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
    if (btn) { btn.disabled = false; btn.textContent = 'Sync Leads Now'; }
  }
}

async function loadMetaLeadFormRegistry() {
  const el = document.getElementById('meta-lead-form-registry');
  if (!el) return;
  try {
    const res = await apiGet('/meta/lead-form-registry');
    const forms = res.forms || [];
    if (!forms.length) {
      el.innerHTML = '<div class="text-muted" style="font-size:0.76rem;">No imported Meta lead form history for this account yet.</div>';
      return;
    }
    el.innerHTML = `<div class="table-container" style="margin-top:12px;">
      <div class="table-header"><span class="table-title">Imported Lead Form Registry</span><span class="badge badge-active">LOCAL COVERAGE</span></div>
      <table>
        <thead><tr><th>Form ID</th><th class="right">Leads</th><th class="right">Ads</th><th>Coverage</th><th>Last Seen</th></tr></thead>
        <tbody>
          ${forms.map((row) => `<tr>
            <td class="name-cell"><span class="mono">${escapeHtml(row.form_id)}</span></td>
            <td class="right">${fmt(row.lead_count, 'integer')}</td>
            <td class="right">${fmt(row.ad_count, 'integer')}</td>
            <td><span class="badge badge-${row.coverage === 'partial' ? 'warning' : 'active'}">${escapeHtml(row.coverage.replace(/_/g, ' '))}</span></td>
            <td>${row.last_seen_at ? fmtDateTime(row.last_seen_at) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
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
    resultsEl.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
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
    if (el) el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
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
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
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
