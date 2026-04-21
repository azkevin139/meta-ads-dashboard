(function () {
  let healthCache = null;
  let healthCacheAt = 0;
  const HEALTH_TTL_MS = 60000;

  function statusClass(status) {
    const value = String(status || 'unavailable');
    if (value === 'success') return 'active';
    if (value === 'partial' || value === 'skipped') return 'warning';
    if (value === 'failed') return 'critical';
    return 'low';
  }

  function getAgeMinutes(value) {
    if (!value) return null;
    const t = new Date(value).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 60000));
  }

  function freshnessLabel(row) {
    if (!row) return { state: 'unavailable', label: 'unavailable' };
    if (row.status === 'failed') return { state: 'failed', label: 'failed' };
    if (row.status === 'partial' || row.status === 'skipped') return { state: 'partial', label: 'partial' };
    const age = getAgeMinutes(row.last_successful_at);
    if (age === null) return { state: 'unavailable', label: 'unavailable' };
    if (age > 24 * 60) return { state: 'stale', label: 'stale' };
    return { state: 'fresh', label: 'fresh' };
  }

  function findRun(health, source, dataset) {
    return (health?.data || []).find((row) => row.source === source && row.dataset === dataset) || null;
  }

  function summarizeHealth(health, datasets = []) {
    const rows = datasets
      .map(({ source, dataset }) => findRun(health, source, dataset))
      .filter(Boolean);
    const includesTrackingRecovery = datasets.some((row) => row.source === 'tracking' && row.dataset === 'recovery');
    const outageWarning = includesTrackingRecovery && health?.tracking_outage?.launch_readiness?.status === 'warning';
    if (!rows.length) return { state: 'unavailable', label: 'unavailable', rows };
    if (rows.some((row) => row.status === 'failed')) return { state: 'failed', label: 'failed', rows };
    if (rows.some((row) => row.status === 'partial' || row.status === 'skipped')) return { state: 'partial', label: 'partial', rows };
    if (outageWarning) return { state: 'partial', label: 'outage affected', rows, extra_reason: 'active_tracking_outage_window' };
    if (rows.some((row) => freshnessLabel(row).state === 'stale')) return { state: 'stale', label: 'stale', rows };
    return { state: 'fresh', label: 'fresh', rows };
  }

  function badge(summary, label = 'Data') {
    const state = summary?.state || 'unavailable';
    const cls = state === 'fresh' ? 'active'
      : state === 'stale' || state === 'partial' ? 'warning'
      : state === 'failed' ? 'critical'
      : 'low';
    const title = (summary?.rows || [])
      .map((row) => `${row.source}/${row.dataset}: ${row.status}${row.partial_reason ? ` (${row.partial_reason})` : ''}`)
      .join(' | ') || 'No sync health recorded';
    return `<span class="badge badge-${cls}" title="${escapeHtml(title)}">${escapeHtml(label)}: ${escapeHtml(state)}</span>`;
  }

  function panel(summary, title = 'Data Health') {
    const rows = summary?.rows || [];
    return `
      <div class="reco-card" style="padding:12px 14px;">
        <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
          <div style="font-weight:600; font-size:0.82rem;">${escapeHtml(title)}</div>
          ${badge(summary, 'Health')}
        </div>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:8px; margin-top:8px; font-size:0.78rem;">
          ${rows.length ? rows.map((row) => `
            <div>
              <div class="kpi-label">${escapeHtml(row.source)} / ${escapeHtml(row.dataset)}</div>
              <div>${escapeHtml(row.status)} · ${fmtDateTime(row.last_successful_at || row.last_attempted_at)}</div>
              ${row.partial_reason ? `<div class="text-orange mono" style="font-size:0.7rem;">${escapeHtml(row.partial_reason)}</div>` : ''}
            </div>
          `).join('') : '<div class="text-muted">No sync truth recorded yet.</div>'}
        </div>
        ${summary?.extra_reason ? `<div class="text-orange mono" style="font-size:0.7rem; margin-top:8px;">${escapeHtml(summary.extra_reason)}</div>` : ''}
      </div>
    `;
  }

  async function load({ force = false } = {}) {
    if (!force && healthCache && Date.now() - healthCacheAt < HEALTH_TTL_MS) return healthCache;
    healthCache = await apiGet('/intelligence/data-health');
    healthCacheAt = Date.now();
    return healthCache;
  }

  window.DataHealth = {
    load,
    findRun,
    summarizeHealth,
    freshnessLabel,
    badge,
    panel,
    statusClass,
  };
})();
