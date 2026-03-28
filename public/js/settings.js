/* ═══════════════════════════════════════════════════════════
   Settings Page
   ═══════════════════════════════════════════════════════════ */

async function loadSettings(container) {
  container.innerHTML = `
    <div style="max-width: 680px;">
      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">System Health</div>
        <div id="health-info"><div class="loading">Checking</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Connected Account</div>
        <div id="account-info"><div class="loading">Loading</div></div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Sync Schedule</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
          <div>• <strong>Metrics sync:</strong> Every 6 hours via n8n</div>
          <div>• <strong>AI analysis:</strong> Daily at 07:00 EST via n8n</div>
          <div>• <strong>Alerts:</strong> Every 2 hours via n8n</div>
        </div>
        <div class="mt-md text-muted" style="font-size: 0.78rem;">
          Configure n8n workflows at <a href="https://n8n.emma42.com" target="_blank">n8n.emma42.com</a>
        </div>
      </div>

      <div class="reco-card mb-md">
        <div class="reco-entity mb-sm">Database Stats</div>
        <div id="db-stats"><div class="loading">Loading</div></div>
      </div>
    </div>
  `;

  // Health check
  try {
    const health = await apiGet('/health');
    document.getElementById('health-info').innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem;">
        <div><span class="text-muted">Status:</span> <span class="text-green">● Online</span></div>
        <div><span class="text-muted">Uptime:</span> ${Math.round(health.uptime / 60)} min</div>
        <div><span class="text-muted">Meta API:</span> ${health.meta_configured ? '<span class="text-green">Configured</span>' : '<span class="text-red">Not configured</span>'}</div>
        <div><span class="text-muted">OpenAI:</span> ${health.openai_configured ? '<span class="text-green">Configured</span>' : '<span class="text-red">Not configured</span>'}</div>
        <div><span class="text-muted">Server time:</span> ${new Date(health.time).toLocaleString()}</div>
        <div><span class="text-muted">Environment:</span> ${health.env}</div>
      </div>
    `;
  } catch (err) {
    document.getElementById('health-info').innerHTML = `<span class="text-red">Error: ${err.message}</span>`;
  }

  // Account info (from DB)
  try {
    const overview = await apiGet(`/insights/overview?accountId=${ACCOUNT_ID}&days=30`);
    document.getElementById('account-info').innerHTML = `
      <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
        <div><span class="text-muted">Account ID:</span> Internal #${ACCOUNT_ID}</div>
        <div><span class="text-muted">30-day data:</span> ${overview.overview?.days_with_data || 0} days</div>
        <div><span class="text-muted">30-day spend:</span> ${fmt(overview.overview?.total_spend, 'currency')}</div>
      </div>
    `;
  } catch (err) {
    document.getElementById('account-info').innerHTML = `<span class="text-muted">Could not load account info</span>`;
  }

  // DB stats placeholder
  document.getElementById('db-stats').innerHTML = `
    <div style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.8;">
      <div>Database is live and connected via Postgres pool.</div>
      <div class="mt-sm text-muted" style="font-size: 0.78rem;">Run <code style="background: var(--bg-elevated); padding: 2px 6px; border-radius: 3px;">psql -U meta_dash -d meta_dashboard</code> to inspect directly.</div>
    </div>
  `;
}
