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
    <div class="command-toolbar mb-md">
      <div>
        <div class="command-kicker">Meta Ads Command Center</div>
        <div class="command-subtitle">What happened, what matters, and what to do next.</div>
      </div>
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
    <div id="overview-briefing" class="mb-md">${window.UXPatterns?.loadingState ? window.UXPatterns.loadingState('Loading command briefing') : '<div class="loading">Loading command briefing</div>'}</div>
    <div id="alert-area"></div>
    <div id="kpi-area" class="kpi-grid"><div class="loading">Loading KPIs</div></div>
    <div class="overview-command-grid mb-md">
      <div id="overview-performance-card">${window.UXPatterns?.loadingState ? window.UXPatterns.loadingState('Loading performance trend') : '<div class="loading">Loading performance trend</div>'}</div>
      <div id="overview-action-card">${window.UXPatterns?.loadingState ? window.UXPatterns.loadingState('Loading urgent actions') : '<div class="loading">Loading urgent actions</div>'}</div>
    </div>
    <div id="campaigns-summary"></div>
    <div class="overview-lower-grid">
      <div id="overview-data-health"></div>
      <div id="overview-recent-changes"></div>
    </div>
    <div id="meta-pulse-card" class="quiet-card mb-md">${window.UXPatterns?.loadingState ? window.UXPatterns.loadingState('Loading Meta pulse') : '<div class="loading">Loading Meta pulse</div>'}</div>
  `;
  bindOverviewControls(container);

  const kpiSection = overviewAsyncSection.createAsyncSection({
    targetId: 'kpi-area',
    loadingText: 'Loading KPIs',
    onError: (err) => window.UXPatterns?.errorState
      ? window.UXPatterns.errorState({
          title: 'Overview metrics did not load',
          message: safeErrorMessage(err),
          nextStep: 'Campaign metrics may be stale until this request succeeds.',
          ctaLabel: 'Retry overview',
          target: 'overview',
        })
      : `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`,
    render: (metrics) => metrics,
  });
  const campaignsSection = overviewAsyncSection.createAsyncSection({
    targetId: 'campaigns-summary',
    loadingText: 'Loading campaigns',
    emptyHtml: `<div class="table-container">${window.UXPatterns?.emptyState ? window.UXPatterns.emptyState({
      title: 'No campaign data for this date range',
      nextStep: 'Try a wider date range or confirm Meta sync health before making decisions.',
      ctaLabel: 'Open campaign health',
      target: 'campaigns',
    }) : '<div class="empty-state"><div class="empty-state-text">No campaign data for this date range</div></div>'}</div>`,
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
      campaigns,
    });
    renderOverviewActionCard(recoRes.data || [], trackingAlertRes.alerts || [], healthRes);
    renderOverviewPerformanceCard(campaigns, prevCampaigns);
    renderOverviewRecentChanges(campaigns, prevCampaigns, trackingAlertRes.alerts || []);

    renderAlerts(recoRes.data || [], trackingAlertRes.alerts || []);
    kpiSection?.setData(`
      ${overviewMetrics.kpiCard('Spend', fmt(totalSpend, 'currency'))}
      ${overviewMetrics.kpiCard(resultType === '—' ? 'Leads / Results' : resultType, fmt(totalResults, 'integer'))}
      ${overviewMetrics.kpiCard('CPA', fmt(avgCpa, 'currency'))}
      ${overviewMetrics.kpiCard('Conversion Rate', totalClicks > 0 ? fmt(totalResults / totalClicks * 100, 'percent') : '—')}
    `);
    if (!campaigns.length) return campaignsSection?.setEmpty();
    const previewRows = campaigns
      .slice()
      .sort((a, b) => (parseFloat(b.spend) || 0) - (parseFloat(a.spend) || 0))
      .slice(0, 6);
    campaignsSection?.setData(`
      <div class="table-container">
        <div class="table-header">
          <span class="table-title">Campaign preview</span>
          <button class="btn btn-sm" data-nav-target="campaigns">Open all campaigns</button>
        </div>
        ${renderCampaignTable(previewRows)}
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

function renderOverviewBriefing({ current, previous, recommendations, trackingAlerts, health, campaigns }) {
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
  const campaignDrivers = (campaigns || [])
    .map((row) => {
      const result = parseResults(row.actions, row.desired_event);
      const spend = parseFloat(row.spend) || 0;
      const cost = result.count > 0 ? spend / result.count : spend > 0 ? spend : 0;
      return { row, result, spend, cost };
    })
    .sort((a, b) => b.cost - a.cost);
  const topDriver = campaignDrivers[0];
  const spendDelta = overviewDelta(current.spend, previous.spend);
  const resultDelta = overviewDelta(current.results, previous.results);
  const cpaCurrent = current.results > 0 ? current.spend / current.results : 0;
  const cpaPrevious = previous.results > 0 ? previous.spend / previous.results : 0;
  const cpaDelta = overviewDelta(cpaCurrent, cpaPrevious);
  const topIssue = urgentRecs[0]?.recommendation || urgentRecs[0]?.root_cause || alerts[0]?.message
    || (Math.abs(cpaDelta) >= 10 ? `CPA ${cpaDelta > 0 ? 'increased' : 'improved'} ${Math.abs(cpaDelta).toFixed(0)}% in this period` : '')
    || (healthState !== 'fresh' ? `Data health is ${healthState}` : 'No urgent issue detected');
  const recommendedAction = urgentRecs[0]?.action || urgentRecs[0]?.recommendation
    || (cpaDelta > 10 && topDriver ? `Review ${topDriver.row.campaign_name || topDriver.row.campaign_id} and reduce waste before scaling.` : '')
    || (resultDelta > 0 ? 'Keep the current campaign mix running and watch CPA movement.' : 'Review campaign triage before making budget changes.');
  const impact = urgentRecs[0]?.impact || urgentRecs[0]?.expected_impact
    || (topDriver ? `${fmt(topDriver.spend, 'currency')} spend driver · ${topDriver.result.count || 0} tracked results` : 'Low risk: no single campaign driver detected.');
  const confidence = healthState === 'fresh' ? 'High' : healthState === 'partial' || healthState === 'stale' ? 'Medium' : 'Low';
  const risk = urgentRecs[0]?.urgency === 'critical' || healthState === 'failed' ? 'High'
    : Math.abs(cpaDelta) >= 15 || urgentRecs.length ? 'Medium'
      : 'Low';
  el.innerHTML = `
    <div class="command-hero-card">
      <div class="command-hero-main">
        <div>
          <div class="intel-eyebrow">Today's Priority</div>
          <div class="command-hero-title">${escapeHtml(topIssue)}</div>
          <div class="command-hero-copy">${escapeHtml(impact)}</div>
        </div>
        <div class="command-recommendation">
          <div class="kpi-label">Recommended action</div>
          <div>${escapeHtml(recommendedAction)}</div>
        </div>
        <div class="command-hero-actions">
          <button class="btn btn-primary" data-nav-target="${urgentRecs.length ? 'ai' : 'campaigns'}" data-ux-track="overview_primary_cta">${urgentRecs.length ? 'Review recommendation' : 'Review campaigns'}</button>
          <button class="btn" data-nav-target="intelligence">View evidence</button>
        </div>
      </div>
      <div class="command-hero-side">
        <div class="command-side-stat"><span>Confidence</span><strong>${escapeHtml(confidence)}</strong></div>
        <div class="command-side-stat"><span>Risk</span><strong>${escapeHtml(risk)}</strong></div>
        <div class="command-side-stat"><span>Health</span><strong>${escapeHtml(healthState)}</strong></div>
        <div class="command-side-stat"><span>Urgent</span><strong>${fmt(urgentRecs.length, 'integer')}</strong></div>
      </div>
      ${window.UXPatterns?.trustRow ? window.UXPatterns.trustRow([
        `Last synced ${lastSyncLabel || 'not recorded'}`,
        'Connected to Meta',
        'Data source: Live + warehouse',
        `AI confidence: ${confidence}`,
      ]) : ''}
    </div>
  `;
}

function renderOverviewActionCard(recommendations, trackingAlerts, health) {
  const el = document.getElementById('overview-action-card');
  if (!el) return;
  const healthSummary = window.DataHealth?.summarizeHealth(health, [
    { source: 'meta', dataset: 'warehouse_insights' },
    { source: 'meta', dataset: 'entities' },
    { source: 'meta', dataset: 'leads' },
  ]);
  const actions = [];
  (recommendations || []).filter((row) => ['critical', 'high'].includes(row.urgency || row.priority)).slice(0, 3).forEach((row) => {
    actions.push({
      title: row.recommendation || row.title || 'Review recommendation',
      meta: row.impact || row.root_cause || 'Needs operator review',
      badge: row.urgency === 'critical' || row.priority === 'critical' ? 'critical' : 'warning',
    });
  });
  (trackingAlerts || []).slice(0, 2).forEach((alert) => {
    actions.push({ title: alert.message || 'Tracking alert', meta: 'Data quality may affect decisions', badge: 'critical' });
  });
  if (healthSummary && healthSummary.state !== 'fresh') {
    actions.push({ title: `Data health is ${healthSummary.state}`, meta: healthSummary.extra_reason || 'Check sync truth before scaling actions.', badge: 'warning' });
  }
  el.innerHTML = `
    <div class="standard-card chart-insight-card">
      <div class="table-header">
        <div>
          <div class="table-title">AI recommendations / urgent actions</div>
          <div class="intel-section-subtitle">The highest-priority items from recommendations, alerts, and data health.</div>
        </div>
        <button class="btn btn-sm" data-nav-target="intelligence">Open Decision Center</button>
      </div>
      <div class="insight-list">
        ${actions.length ? actions.map((item) => `
          <div class="insight-row">
            <span class="badge badge-${item.badge}">${item.badge}</span>
            <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.meta)}</span></div>
          </div>
        `).join('') : (window.UXPatterns?.emptyState ? window.UXPatterns.emptyState({
          title: 'No active recommendations',
          nextStep: 'Campaigns are currently within visible target ranges. Budget, CPA, and fatigue issues will appear here when action is needed.',
          ctaLabel: 'Review campaign health',
          target: 'campaigns',
        }) : '<div class="empty-state"><div class="empty-state-text">No urgent action detected for this range.</div></div>')}
      </div>
    </div>
  `;
}

function renderOverviewPerformanceCard(campaigns, prevCampaigns) {
  const el = document.getElementById('overview-performance-card');
  if (!el) return;
  const current = summarizeOverviewCampaigns(campaigns || []);
  const previous = summarizeOverviewCampaigns(prevCampaigns || []);
  const currentCpa = current.results > 0 ? current.spend / current.results : 0;
  const previousCpa = previous.results > 0 ? previous.spend / previous.results : 0;
  const cpaDelta = overviewDelta(currentCpa, previousCpa);
  const topRows = (campaigns || [])
    .slice()
    .sort((a, b) => (parseFloat(b.spend) || 0) - (parseFloat(a.spend) || 0))
    .slice(0, 5);
  const maxSpend = Math.max(...topRows.map((row) => parseFloat(row.spend) || 0), 1);
  el.innerHTML = `
    <div class="standard-card chart-insight-card">
      <div class="table-header">
        <div>
          <div class="table-title">CPA ${cpaDelta > 0 ? 'is up' : cpaDelta < 0 ? 'is down' : 'is flat'} ${Math.abs(cpaDelta).toFixed(0)}%</div>
          <div class="intel-section-subtitle">${getDateLabel()} · spend efficiency by campaign.</div>
        </div>
        <span class="badge badge-${cpaDelta > 10 ? 'warning' : cpaDelta < -10 ? 'active' : 'low'}">${currentCpa ? fmt(currentCpa, 'currency') : '—'} CPA</span>
      </div>
      <div class="spend-efficiency-bars">
        ${topRows.map((row) => {
          const spend = parseFloat(row.spend) || 0;
          const result = parseResults(row.actions, row.desired_event);
          const cpa = result.count > 0 ? spend / result.count : 0;
          return `
            <div class="efficiency-row">
              <div class="efficiency-label">${escapeHtml(row.campaign_name || row.campaign_id)}</div>
              <div class="efficiency-track"><span style="width:${Math.max(8, spend / maxSpend * 100)}%"></span></div>
              <div class="efficiency-value">${cpa ? fmt(cpa, 'currency') : '—'}</div>
            </div>
          `;
        }).join('')}
      </div>
      ${window.UXPatterns?.trustRow ? window.UXPatterns.trustRow([
        'Data source: Meta live insights',
        'Attribution follows campaign configured result',
        getDateLabel(),
      ]) : ''}
    </div>
  `;
}

function renderOverviewRecentChanges(campaigns, prevCampaigns, alerts) {
  const el = document.getElementById('overview-recent-changes');
  if (!el) return;
  const current = summarizeOverviewCampaigns(campaigns || []);
  const previous = summarizeOverviewCampaigns(prevCampaigns || []);
  const changes = [
    ['Spend', overviewDelta(current.spend, previous.spend), current.spend, 'currency'],
    ['Results', overviewDelta(current.results, previous.results), current.results, 'integer'],
    ['Clicks', overviewDelta(current.clicks, previous.clicks), current.clicks, 'compact'],
  ];
  el.innerHTML = `
    <div class="quiet-card recent-changes-card">
      <div class="table-header">
        <span class="table-title">Recent changes</span>
        <span class="badge badge-low">${fmt(alerts.length || 0, 'integer')} alerts</span>
      </div>
      <div class="recent-change-list">
        ${changes.map(([label, delta, value, formatter]) => `
          <div class="recent-change-row">
            <span>${label}</span>
            <strong>${fmt(value, formatter)}</strong>
            <em class="${delta > 0 ? 'text-green' : delta < 0 ? 'text-red' : 'text-muted'}">${delta > 0 ? '+' : ''}${delta.toFixed(1)}%</em>
          </div>
        `).join('')}
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
