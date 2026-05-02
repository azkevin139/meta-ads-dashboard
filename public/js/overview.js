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
  const prevRange = previousOverviewRange(dateFrom, dateTo);
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
    <div id="overview-briefing" class="mb-md"><div class="loading">Loading operator briefing</div></div>
    <div id="overview-data-health" class="mb-md"></div>
    <div id="alert-area"></div>
    <div id="kpi-area" class="kpi-grid"><div class="loading">Loading KPIs</div></div>
    <div id="campaigns-summary"></div>
    <div id="meta-pulse-card" class="reco-card mb-md"><div class="loading">Loading Meta pulse</div></div>
  `;
  bindOverviewControls(container);

  const kpiSection = overviewAsyncSection.createAsyncSection({
    targetId: 'kpi-area',
    loadingText: 'Loading KPIs',
    onError: (err) => `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`,
    render: (metrics) => metrics,
  });
  const campaignsSection = overviewAsyncSection.createAsyncSection({
    targetId: 'campaigns-summary',
    loadingText: 'Loading campaigns',
    emptyHtml: '<div class="table-container"><div class="empty-state"><div class="empty-state-text">No campaign data for this date range</div></div></div>',
    render: (html) => html,
  });

  try {
    const [liveRes, prevLiveRes, listRes, recoRes, rateRes, trackingAlertRes, healthRes] = await Promise.all([
      apiGet(`/meta/live?level=campaign&since=${dateFrom}&until=${dateTo}`),
      apiGet(`/meta/live?level=campaign&since=${prevRange.from}&until=${prevRange.to}`).catch(() => ({ data: [] })),
      apiGet('/meta/campaigns'),
      apiGet(`/ai/recommendations?accountId=${ACCOUNT_ID}&status=pending`),
      apiGet('/meta/rate-limit-status'),
      apiGet(`/intelligence/tracking-alerts?accountId=${ACCOUNT_ID}&hours=24`).catch(() => ({ alerts: [] })),
      window.DataHealth?.load({ force: true }).catch(() => null),
    ]);
    renderMetaPulse(rateRes);
    renderOverviewDataHealth(healthRes);
    startMetaPulseAutoRefresh();

    const desiredByCampaign = {};
    for (const c of (listRes.data || [])) {
      if (c.desired_event) desiredByCampaign[c.id] = c.desired_event;
    }

    const campaigns = (liveRes.data || []).map(row => ({
      ...row,
      desired_event: desiredByCampaign[row.campaign_id] || null,
    }));
    const prevCampaigns = (prevLiveRes.data || []).map(row => ({
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
    renderOverviewBriefing({
      current: summarizeOverviewCampaigns(campaigns),
      previous: summarizeOverviewCampaigns(prevCampaigns),
      recommendations: recoRes.data || [],
      trackingAlerts: trackingAlertRes.alerts || [],
      health: healthRes,
    });

    renderAlerts(recoRes.data || [], trackingAlertRes.alerts || []);
    kpiSection?.setData(`
      ${overviewMetrics.kpiCard('Spend', fmt(totalSpend, 'currency'))}
      ${overviewMetrics.kpiCard('Impressions', fmt(totalImpressions, 'compact'))}
      ${overviewMetrics.kpiCard('CTR', fmt(avgCtr, 'percent'))}
      ${overviewMetrics.kpiCard('CPC', '$' + fmt(avgCpc, 'decimal'))}
      ${overviewMetrics.kpiCard('Results (' + resultType + ')', fmt(totalResults, 'integer'))}
      ${overviewMetrics.kpiCard('Cost per Result', fmt(avgCpa, 'currency'))}
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

function previousOverviewRange(from, to) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
  const prevEnd = new Date(start);
  prevEnd.setUTCDate(prevEnd.getUTCDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setUTCDate(prevStart.getUTCDate() - (days - 1));
  return { from: prevStart.toISOString().slice(0, 10), to: prevEnd.toISOString().slice(0, 10) };
}

function summarizeOverviewCampaigns(campaigns) {
  return (campaigns || []).reduce((acc, c) => {
    const spend = parseFloat(c.spend) || 0;
    const impressions = parseInt(c.impressions, 10) || 0;
    const clicks = parseInt(c.clicks, 10) || 0;
    const result = parseResults(c.actions, c.desired_event);
    acc.spend += spend;
    acc.impressions += impressions;
    acc.clicks += clicks;
    acc.results += result.count || 0;
    acc.reach += parseInt(c.reach, 10) || 0;
    acc.campaigns += 1;
    return acc;
  }, { spend: 0, impressions: 0, clicks: 0, results: 0, reach: 0, campaigns: 0 });
}

function overviewDelta(current, previous) {
  const a = Number(current) || 0;
  const b = Number(previous) || 0;
  if (!a && !b) return 0;
  if (!b) return 100;
  return ((a - b) / b) * 100;
}

function briefingDeltaCard(label, current, previous, formatter = 'integer', inverse = false) {
  const delta = overviewDelta(current, previous);
  const good = inverse ? delta < 0 : delta > 0;
  const cls = Math.abs(delta) < 1 ? 'flat' : good ? 'up' : 'down';
  const icon = delta > 0 ? '↑' : delta < 0 ? '↓' : '—';
  return `
    <div class="briefing-card">
      <div class="briefing-label">${label}</div>
      <div class="briefing-value">${fmt(current, formatter)}</div>
      <div class="kpi-delta ${cls}">${icon} ${Math.abs(delta).toFixed(1)}% vs previous period</div>
    </div>
  `;
}

function renderOverviewBriefing({ current, previous, recommendations, trackingAlerts, health }) {
  const el = document.getElementById('overview-briefing');
  if (!el) return;
  const urgentRecs = (recommendations || []).filter((row) => ['critical', 'high'].includes(row.urgency || row.priority));
  const alerts = trackingAlerts || [];
  const healthSummary = window.DataHealth?.summarizeHealth(health, [
    { source: 'meta', dataset: 'warehouse_insights' },
    { source: 'meta', dataset: 'entities' },
    { source: 'meta', dataset: 'leads' },
    { source: 'ghl', dataset: 'contacts' },
  ]);
  const healthState = healthSummary?.state || 'unavailable';
  const healthBadge = healthState === 'fresh' ? 'active' : healthState === 'failed' ? 'critical' : healthState === 'partial' || healthState === 'stale' ? 'warning' : 'low';
  const topIssue = urgentRecs[0]?.recommendation || urgentRecs[0]?.root_cause || alerts[0]?.message || (healthState !== 'fresh' ? `Data health is ${healthState}` : 'No urgent issue detected');
  el.innerHTML = `
    <div class="operator-briefing">
      <div class="briefing-header">
        <div>
          <div class="intel-eyebrow">Operator Briefing</div>
          <div class="briefing-title">${escapeHtml(topIssue)}</div>
          <div class="briefing-subtitle">What changed, what matters, and where to go next.</div>
        </div>
        <div class="briefing-badges">
          <span class="badge badge-${healthBadge}">Health ${escapeHtml(healthState)}</span>
          <span class="badge badge-${urgentRecs.length ? 'warning' : 'active'}">${fmt(urgentRecs.length, 'integer')} urgent</span>
          <span class="badge badge-${alerts.length ? 'critical' : 'low'}">${fmt(alerts.length, 'integer')} alerts</span>
        </div>
      </div>
      <div class="briefing-grid">
        ${briefingDeltaCard('Spend', current.spend, previous.spend, 'currency')}
        ${briefingDeltaCard('Results', current.results, previous.results, 'integer')}
        ${briefingDeltaCard('Clicks', current.clicks, previous.clicks, 'compact')}
        ${briefingDeltaCard('Reach', current.reach, previous.reach, 'compact')}
      </div>
      <div class="briefing-actions">
        <button class="btn btn-sm btn-primary" data-nav-target="${urgentRecs.length ? 'ai' : 'intelligence'}">${urgentRecs.length ? 'Review urgent actions' : 'Open Decision Center'}</button>
        <button class="btn btn-sm" data-nav-target="campaigns">Open campaigns</button>
        <button class="btn btn-sm" data-nav-target="settings">Check settings</button>
      </div>
    </div>
  `;
}

function renderOverviewDataHealth(health) {
  const el = document.getElementById('overview-data-health');
  if (!el || !window.DataHealth) return;
  const summary = window.DataHealth.summarizeHealth(health, [
    { source: 'meta', dataset: 'warehouse_insights' },
    { source: 'meta', dataset: 'entities' },
    { source: 'meta', dataset: 'leads' },
    { source: 'ghl', dataset: 'contacts' },
  ]);
  el.innerHTML = window.DataHealth.panel(summary, 'Data Health');
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
  if (!container.dataset.overviewNavBound) {
    container.dataset.overviewNavBound = 'true';
    container.addEventListener('click', (event) => {
      const target = event.target.closest('[data-nav-target]');
      if (target?.dataset.navTarget) navigateTo(target.dataset.navTarget);
    });
  }
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
function renderAlerts(pendingRecos, trackingAlerts) {
  const alertArea = document.getElementById('alert-area');
  if (!alertArea) return;
  const parts = [];
  const criticalTracking = (trackingAlerts || []).filter(a => a.severity === 'critical');
  const warningTracking = (trackingAlerts || []).filter(a => a.severity === 'warning');
  if (criticalTracking.length) {
    parts.push(...criticalTracking.map((alert) => `
      <div class="alert-banner alert-critical" data-nav-target="settings" style="cursor:pointer; margin-bottom:8px;">
        Tracking alert: ${escapeHtml(alert.title)} — ${escapeHtml(alert.message)}
      </div>
    `));
  }
  if (warningTracking.length) {
    parts.push(...warningTracking.map((alert) => `
      <div class="alert-banner alert-warning" data-nav-target="settings" style="cursor:pointer; margin-bottom:8px;">
        Tracking alert: ${escapeHtml(alert.title)} — ${escapeHtml(alert.message)}
      </div>
    `));
  }
  const criticalCount = pendingRecos.filter(r => r.urgency === 'critical').length;
  const highCount = pendingRecos.filter(r => r.urgency === 'high').length;
  if (criticalCount > 0) {
    parts.push(`<div class="alert-banner alert-critical" data-nav-target="ai" style="cursor:pointer">⚠ ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} ${highCount > 0 ? `and ${highCount} high-priority` : ''} — click to review</div>`);
  } else if (highCount > 0) {
    parts.push(`<div class="alert-banner alert-warning" data-nav-target="ai" style="cursor:pointer">${highCount} high-priority recommendation${highCount > 1 ? 's' : ''} pending</div>`);
  }
  alertArea.innerHTML = parts.join('');
}
