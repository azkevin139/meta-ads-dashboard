/* ═══════════════════════════════════════════════════════════
   Overview Page — live pulse aware
   ═══════════════════════════════════════════════════════════ */

const overviewAsyncSection = window.AsyncSectionHelpers;
const overviewMetrics = window.DashboardMetrics;
const overviewFilterState = window.PageFilterHelpers.createDateRangeState({
  initialPreset: 'yesterday',
  presets: ['today', 'yesterday', '7d', '14d', '30d', 'custom'],
  todayStr,
  daysAgoStr,
});
let metaPulseTimer = null;

async function loadOverview(container) {
  stopMetaPulseAutoRefresh();
  const { from: dateFrom, to: dateTo, preset: activePreset } = overviewFilterState.getState();
  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap: wrap; gap: 10px;">
      <div></div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <div class="date-selector">
          <button class="date-btn ${activePreset === 'today' ? 'active' : ''}" data-overview-preset="today">Today</button>
          <button class="date-btn ${activePreset === 'yesterday' ? 'active' : ''}" data-overview-preset="yesterday">Yesterday</button>
          <button class="date-btn ${activePreset === '7d' ? 'active' : ''}" data-overview-preset="7d">7d</button>
          <button class="date-btn ${activePreset === '14d' ? 'active' : ''}" data-overview-preset="14d">14d</button>
          <button class="date-btn ${activePreset === '30d' ? 'active' : ''}" data-overview-preset="30d">30d</button>
          <button class="date-btn ${activePreset === 'custom' ? 'active' : ''}" data-overview-preset="custom">Custom</button>
        </div>
        <div id="date-picker-area" style="display: ${activePreset === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 6px;">
          <input type="date" id="date-from" class="form-input" style="width: 140px; padding: 6px 10px; font-size: 0.78rem;" value="${dateFrom}" />
          <span class="text-muted">→</span>
          <input type="date" id="date-to" class="form-input" style="width: 140px; padding: 6px 10px; font-size: 0.78rem;" value="${dateTo}" />
          <button class="btn btn-sm btn-primary" data-overview-action="apply-date">Apply</button>
        </div>
      </div>
    </div>
    <div id="date-label" class="text-muted mb-sm" style="font-size: 0.78rem; text-align: right;">${getDateLabel()}</div>
    <div id="meta-pulse-card" class="reco-card mb-md"><div class="loading">Loading Meta pulse</div></div>
    <div id="alert-area"></div>
    <div id="kpi-area" class="kpi-grid"><div class="loading">Loading KPIs</div></div>
    <div id="campaigns-summary"></div>
  `;
  bindOverviewControls(container);

  const kpiSection = overviewAsyncSection.createAsyncSection({
    targetId: 'kpi-area',
    loadingText: 'Loading KPIs',
    onError: (err) => `<div class="alert-banner alert-critical">Error: ${err.message}</div>`,
    render: (metrics) => metrics,
  });
  const campaignsSection = overviewAsyncSection.createAsyncSection({
    targetId: 'campaigns-summary',
    loadingText: 'Loading campaigns',
    emptyHtml: '<div class="table-container"><div class="empty-state"><div class="empty-state-text">No campaign data for this date range</div></div></div>',
    render: (html) => html,
  });

  try {
    const [liveRes, listRes, recoRes, rateRes] = await Promise.all([
      apiGet(`/meta/live?level=campaign&since=${dateFrom}&until=${dateTo}`),
      apiGet('/meta/campaigns'),
      apiGet(`/ai/recommendations?accountId=${ACCOUNT_ID}&status=pending`),
      apiGet('/meta/rate-limit-status'),
    ]);
    renderMetaPulse(rateRes);
    startMetaPulseAutoRefresh();

    const desiredByCampaign = {};
    for (const c of (listRes.data || [])) {
      if (c.desired_event) desiredByCampaign[c.id] = c.desired_event;
    }

    const campaigns = (liveRes.data || []).map(row => ({
      ...row,
      desired_event: desiredByCampaign[row.campaign_id] || null,
    }));
    let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalReach = 0;
    let totalResults = 0, resultType = '—';
    const resultCountsByType = {};

    for (const c of campaigns) {
      totalSpend += parseFloat(c.spend) || 0;
      totalImpressions += parseInt(c.impressions) || 0;
      totalClicks += parseInt(c.clicks) || 0;
      totalReach += parseInt(c.reach) || 0;
      const result = parseResults(c.actions, c.desired_event);
      totalResults += result.count;
      if (result.type !== '—') {
        resultCountsByType[result.type] = (resultCountsByType[result.type] || 0) + result.count;
        resultType = result.type;
      }
    }
    const dominantType = Object.keys(resultCountsByType).sort((a, b) => resultCountsByType[b] - resultCountsByType[a])[0];
    if (dominantType) resultType = dominantType;

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0;
    const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
    const avgCpa = totalResults > 0 ? (totalSpend / totalResults) : 0;

    renderAlerts(recoRes.data || []);
    kpiSection?.setData(`
      ${overviewMetrics.kpiCard('Spend', fmt(totalSpend, 'currency'))}
      ${overviewMetrics.kpiCard('Impressions', fmt(totalImpressions, 'compact'))}
      ${overviewMetrics.kpiCard('CPM', '$' + fmt(avgCpm, 'decimal'))}
      ${overviewMetrics.kpiCard('CTR', fmt(avgCtr, 'percent'))}
      ${overviewMetrics.kpiCard('CPC', '$' + fmt(avgCpc, 'decimal'))}
      ${overviewMetrics.kpiCard('Results (' + resultType + ')', fmt(totalResults, 'integer'))}
      ${overviewMetrics.kpiCard('Cost per Result', fmt(avgCpa, 'currency'))}
      ${overviewMetrics.kpiCard('Reach', fmt(totalReach, 'compact'))}
    `);
    if (!campaigns.length) return campaignsSection?.setEmpty();
    campaignsSection?.setData(`
      <div class="table-container">
        <div class="table-header">
          <span class="table-title">${campaigns.length} Campaign${campaigns.length !== 1 ? 's' : ''}</span>
          <span class="badge badge-active" style="font-size: 0.7rem;">LIVE FROM META</span>
        </div>
        ${renderCampaignTable(campaigns)}
      </div>
    `);
  } catch (err) {
    kpiSection?.setError(err);
  }
}

function startMetaPulseAutoRefresh() {
  stopMetaPulseAutoRefresh();
  metaPulseTimer = setInterval(async () => {
    if (currentPage !== 'overview') return stopMetaPulseAutoRefresh();
    try {
      const rateRes = await apiGet('/meta/rate-limit-status');
      renderMetaPulse(rateRes);
    } catch (e) {}
  }, 10000);
}
function stopMetaPulseAutoRefresh() {
  if (metaPulseTimer) clearInterval(metaPulseTimer);
  metaPulseTimer = null;
}

function renderMetaPulse(rateRes) {
  const el = document.getElementById('meta-pulse-card');
  if (!el) return;
  const summary = rateRes.summary || {};
  const adsMgmt = summary.ads_management || {};
  const adsInsights = summary.ads_insights || {};
  const warning = rateRes.warning_level || 'unknown';
  el.innerHTML = `
    <div class="flex-between mb-sm" style="gap:10px; flex-wrap:wrap;">
      <div class="reco-entity">Meta Pulse</div>
      <div class="text-muted" style="font-size:0.72rem;">${rateRes.last_seen_at ? `Last header: ${fmtDateTime(rateRes.last_seen_at)}` : 'No live header yet'}</div>
    </div>
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap:10px; font-size:0.82rem;">
      ${pulseMetric('Ads Mgmt', adsMgmt.call_count)}
      ${pulseMetric('Ads Insights', adsInsights.call_count)}
      ${pulseMetric('Account Util', summary.ad_account_util_pct)}
      ${pulseMetric('App CPU', summary.app_cpu)}
      ${pulseMetric('App Time', summary.app_time)}
      <div><div class="kpi-label">Reset</div><div style="font-weight:600;">${overviewMetrics.formatSeconds(rateRes.estimated_regain_seconds || summary.reset_time_duration || 0)}</div></div>
      <div><div class="kpi-label">Tier</div><div style="font-weight:600;">${summary.ads_api_access_tier || '—'}</div></div>
      <div><div class="kpi-label">State</div><div style="font-weight:600; text-transform:capitalize;">${warning}</div></div>
      ${rateRes.cache_budget ? `<div><div class="kpi-label">Calls /h</div><div style="font-weight:600; color:${rateRes.cache_budget.mode === 'blocked' ? 'var(--red)' : rateRes.cache_budget.mode === 'cache_only' ? 'var(--yellow)' : 'var(--green)'};">${rateRes.cache_budget.used} / ${rateRes.cache_budget.limit}</div></div>` : ''}
    </div>
    ${!rateRes.safe_to_write ? `<div class="alert-banner alert-warning" style="margin-top:12px;">Write actions should wait ${overviewMetrics.formatSeconds(rateRes.estimated_regain_seconds || 0)} to reduce the risk of throttling.</div>` : ''}
    ${rateRes.cache_budget?.mode === 'cache_only' ? `<div class="alert-banner alert-warning" style="margin-top:8px;">This account has used ${Math.round(rateRes.cache_budget.pct * 100)}% of its hourly Meta budget. Serving cached data for the next hour.</div>` : ''}
    ${rateRes.cache_budget?.mode === 'blocked' ? `<div class="alert-banner alert-critical" style="margin-top:8px;">Hourly Meta budget exhausted. All reads are cache-only until the window resets.</div>` : ''}
  `;
}

function pulseMetric(label, value) {
  const n = typeof value === 'number' ? value : null;
  let color = 'var(--text-primary)';
  if (n !== null && n >= 85) color = 'var(--red)';
  else if (n !== null && n >= 70) color = 'var(--yellow)';
  else if (n !== null) color = 'var(--green)';
  return `<div><div class="kpi-label">${label}</div><div style="font-weight:600; color:${color};">${n === null ? '—' : n + '%'}</div></div>`;
}

function renderCampaignTable(campaigns) { /* unchanged */ return `
  <div style="overflow-x: auto;">
    <table>
      <thead><tr><th>Campaign</th><th class="right">Spend</th><th class="right">Results</th><th class="right">Cost/Result</th><th class="right">Impr.</th><th class="right">CPM</th><th class="right">CTR</th><th class="right">CPC</th><th class="right">Reach</th><th class="right">Freq.</th></tr></thead>
      <tbody>
        ${campaigns.map(c => { const result = parseResults(c.actions, c.desired_event); const cpr = parseCostPerResult(c.cost_per_action_type, result.type); const spend = parseFloat(c.spend) || 0; const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0); return `<tr><td class="name-cell">${c.campaign_name}</td><td class="right">${fmt(c.spend, 'currency')}</td><td class="right" style="font-weight: 600;">${result.count > 0 ? result.count : '—'}</td><td class="right ${metricColor(costPerResult, {good: 40, bad: 80}, true)}">${costPerResult > 0 ? fmt(costPerResult, 'currency') : '—'}</td><td class="right">${fmt(c.impressions, 'compact')}</td><td class="right">${fmt(c.cpm, 'currency')}</td><td class="right ${metricColor(c.ctr, {good: 1.5, bad: 0.5})}">${fmt(c.ctr, 'percent')}</td><td class="right">${fmt(c.cpc, 'currency')}</td><td class="right">${fmt(c.reach, 'compact')}</td><td class="right">${fmt(c.frequency, 'decimal')}</td></tr>`; }).join('')}
      </tbody>
    </table>
  </div>`; }
function bindOverviewControls(container) {
  container.querySelectorAll('[data-overview-preset]').forEach((el) => {
    el.addEventListener('click', () => setPreset(el.dataset.overviewPreset));
  });
  container.querySelectorAll('[data-overview-action]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.overviewAction === 'apply-date') applyCustomDate();
    });
  });
}
function setPreset(preset) {
  overviewFilterState.setPreset(preset);
  if (preset === 'custom') {
    const picker = document.getElementById('date-picker-area');
    if (picker) picker.style.display = 'flex';
    return;
  }
  navigateTo('overview');
}
function applyCustomDate() {
  const dateFrom = document.getElementById('date-from').value;
  const dateTo = document.getElementById('date-to').value;
  if (!dateFrom || !dateTo) { toast('Select both dates', 'error'); return; }
  if (dateFrom > dateTo) { toast('Start date must be before end date', 'error'); return; }
  overviewFilterState.setCustom(dateFrom, dateTo);
  navigateTo('overview');
}
function getDateLabel() {
  return overviewFilterState.getLabel({
    liveTodayLabel: 'Today — live from Meta',
    yesterdayLabel: (dateFrom) => `Yesterday (${dateFrom})`,
  });
}
function renderAlerts(pendingRecos) { const alertArea = document.getElementById('alert-area'); if (!alertArea) return; const criticalCount = pendingRecos.filter(r => r.urgency === 'critical').length; const highCount = pendingRecos.filter(r => r.urgency === 'high').length; if (criticalCount > 0) { alertArea.innerHTML = `<div class="alert-banner alert-critical" onclick="navigateTo('ai')" style="cursor:pointer">⚠ ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} ${highCount > 0 ? `and ${highCount} high-priority` : ''} — click to review</div>`; } else if (highCount > 0) { alertArea.innerHTML = `<div class="alert-banner alert-warning" onclick="navigateTo('ai')" style="cursor:pointer">${highCount} high-priority recommendation${highCount > 1 ? 's' : ''} pending</div>`; } else { alertArea.innerHTML = ''; } }
