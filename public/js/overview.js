/* ═══════════════════════════════════════════════════════════
   Overview Page — with live today data
   ═══════════════════════════════════════════════════════════ */

let overviewDays = 7;

async function loadOverview(container) {
  container.innerHTML = `
    <div class="flex-between mb-md">
      <div></div>
      <div class="date-selector">
        <button class="date-btn ${overviewDays === 0 ? 'active' : ''}" onclick="setOverviewRange(0)">Today (Live)</button>
        <button class="date-btn ${overviewDays === 1 ? 'active' : ''}" onclick="setOverviewRange(1)">Yesterday</button>
        <button class="date-btn ${overviewDays === 7 ? 'active' : ''}" onclick="setOverviewRange(7)">7d</button>
        <button class="date-btn ${overviewDays === 14 ? 'active' : ''}" onclick="setOverviewRange(14)">14d</button>
        <button class="date-btn ${overviewDays === 30 ? 'active' : ''}" onclick="setOverviewRange(30)">30d</button>
      </div>
    </div>
    <div id="alert-area"></div>
    <div id="kpi-area" class="kpi-grid"><div class="loading">Loading KPIs</div></div>
    <div id="campaigns-summary"></div>
  `;

  try {
    if (overviewDays === 0) {
      // LIVE TODAY — fetch directly from Meta API
      await loadTodayLive(container);
    } else {
      // HISTORICAL — fetch from DB
      await loadHistorical(container);
    }
  } catch (err) {
    container.innerHTML = `<div class="alert-banner alert-critical">Error loading overview: ${err.message}</div>`;
  }
}

async function loadTodayLive(container) {
  const [todayRes, recoRes] = await Promise.all([
    apiGet(`/meta/today?level=campaign`),
    apiGet(`/ai/recommendations?accountId=${ACCOUNT_ID}&status=pending`),
  ]);

  const campaigns = todayRes.data || [];

  // Aggregate totals
  let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalReach = 0, totalConversions = 0, totalConvValue = 0;

  for (const c of campaigns) {
    totalSpend += parseFloat(c.spend) || 0;
    totalImpressions += parseInt(c.impressions) || 0;
    totalClicks += parseInt(c.clicks) || 0;
    totalReach += parseInt(c.reach) || 0;
    // Parse conversions from actions
    const actions = c.actions || [];
    for (const a of actions) {
      if (a.action_type.includes('lead') || a.action_type.includes('purchase') || a.action_type.includes('complete_registration') || a.action_type.includes('offsite_conversion')) {
        totalConversions += parseInt(a.value) || 0;
      }
    }
    const actionValues = c.action_values || [];
    for (const a of actionValues) {
      totalConvValue += parseFloat(a.value) || 0;
    }
  }

  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0;
  const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
  const avgCpa = totalConversions > 0 ? (totalSpend / totalConversions) : 0;
  const avgRoas = totalSpend > 0 ? (totalConvValue / totalSpend) : 0;

  // Show alerts
  renderAlerts(recoRes.data || []);

  // KPI cards (no deltas for live data)
  document.getElementById('kpi-area').innerHTML = `
    ${kpiCard('Spend (Today)', fmt(totalSpend, 'currency'))}
    ${kpiCard('Impressions', fmt(totalImpressions, 'compact'))}
    ${kpiCard('CPM', '$' + fmt(avgCpm, 'decimal'))}
    ${kpiCard('CTR', fmt(avgCtr, 'percent'))}
    ${kpiCard('CPC', '$' + fmt(avgCpc, 'decimal'))}
    ${kpiCard('Conversions', fmt(totalConversions, 'integer'))}
    ${kpiCard('CPA', fmt(avgCpa, 'currency'), null, null, true)}
    ${kpiCard('ROAS', fmt(avgRoas, 'decimal') + 'x')}
  `;

  // Campaign table with live data
  document.getElementById('campaigns-summary').innerHTML = `
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">Live Today — ${campaigns.length} Campaign${campaigns.length !== 1 ? 's' : ''} Delivering</span>
        <span class="badge badge-active" style="font-size: 0.7rem;">LIVE</span>
      </div>
      ${campaigns.length > 0 ? `
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th class="right">Spend</th>
                <th class="right">Impr.</th>
                <th class="right">Clicks</th>
                <th class="right">CTR</th>
                <th class="right">CPM</th>
                <th class="right">CPC</th>
              </tr>
            </thead>
            <tbody>
              ${campaigns.map(c => `
                <tr>
                  <td class="name-cell">${c.campaign_name}</td>
                  <td class="right">${fmt(c.spend, 'currency')}</td>
                  <td class="right">${fmt(c.impressions, 'compact')}</td>
                  <td class="right">${fmt(c.clicks, 'compact')}</td>
                  <td class="right">${fmt(c.ctr, 'percent')}</td>
                  <td class="right">${fmt(c.cpm, 'currency')}</td>
                  <td class="right">${fmt(c.cpc, 'currency')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty-state"><div class="empty-state-text">No campaigns delivering yet today</div></div>'}
    </div>
  `;
}

async function loadHistorical(container) {
  const [overviewRes, recoRes, trendRes] = await Promise.all([
    apiGet(`/insights/overview?accountId=${ACCOUNT_ID}&days=${overviewDays}`),
    apiGet(`/ai/recommendations?accountId=${ACCOUNT_ID}&status=pending`),
    apiGet(`/insights/trend?entityId=${ACCOUNT_ID}&level=account&days=30`),
  ]);

  const { overview, deltas, activeCampaigns } = overviewRes;
  const pendingRecos = recoRes.data || [];
  const trendData = trendRes.data || [];

  // Alerts
  renderAlerts(pendingRecos);

  // Build sparkline data
  const spendTrend = trendData.map(d => parseFloat(d.spend));
  const ctrTrend = trendData.map(d => parseFloat(d.ctr));
  const cpmTrend = trendData.map(d => parseFloat(d.cpm));
  const cpaTrend = trendData.map(d => parseFloat(d.cost_per_result));
  const roasTrend = trendData.map(d => parseFloat(d.roas));
  const convTrend = trendData.map(d => parseInt(d.conversions));

  const d = deltas.deltas || {};
  const rangeLabel = overviewDays === 1 ? 'vs prior day' : `vs prior ${overviewDays}d`;

  document.getElementById('kpi-area').innerHTML = `
    ${kpiCard('Spend', fmt(overview.total_spend, 'currency'), d.spend, spendTrend)}
    ${kpiCard('Impressions', fmt(overview.total_impressions, 'compact'), d.impressions)}
    ${kpiCard('CPM', '$' + fmt(overview.avg_cpm, 'decimal'), d.cpm, cpmTrend, true)}
    ${kpiCard('CTR', fmt(overview.avg_ctr, 'percent'), d.ctr, ctrTrend)}
    ${kpiCard('CPC', '$' + fmt(overview.avg_cpc, 'decimal'), d.cpc)}
    ${kpiCard('Conversions', fmt(overview.total_conversions, 'integer'), d.conversions, convTrend)}
    ${kpiCard('CPA', fmt(overview.avg_cpa, 'currency'), d.cost_per_result, cpaTrend, true)}
    ${kpiCard('ROAS', fmt(overview.avg_roas, 'decimal') + 'x', d.roas, roasTrend)}
  `;

  // Campaign mini table
  const campRes = await apiGet(`/insights/campaigns?accountId=${ACCOUNT_ID}&days=${overviewDays}`);
  const camps = (campRes.data || []).filter(c => c.status === 'ACTIVE').slice(0, 8);

  document.getElementById('campaigns-summary').innerHTML = `
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">${activeCampaigns} Active Campaign${activeCampaigns !== 1 ? 's' : ''} — Last ${overviewDays} days</span>
        <button class="btn btn-sm" onclick="navigateTo('campaigns')">View All →</button>
      </div>
      ${camps.length > 0 ? `
        <div style="overflow-x: auto;">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th class="right">Spend</th>
                <th class="right">Conv.</th>
                <th class="right">CPA</th>
                <th class="right">CPM</th>
                <th class="right">CTR</th>
                <th class="right">ROAS</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${camps.map(c => `
                <tr>
                  <td class="name-cell"><a href="#" onclick="navigateTo('adsets', {campaignId: ${c.id}, campaignName: '${c.name.replace(/'/g, "\\'")}'}); return false;">${c.name}</a></td>
                  <td class="right">${fmt(c.spend, 'currency')}</td>
                  <td class="right">${fmt(c.conversions, 'integer')}</td>
                  <td class="right ${metricColor(c.cpa, {good: 15, bad: 25}, true)}">${fmt(c.cpa, 'currency')}</td>
                  <td class="right">${fmt(c.cpm, 'currency')}</td>
                  <td class="right ${metricColor(c.ctr, {good: 3, bad: 1.5})}">${fmt(c.ctr, 'percent')}</td>
                  <td class="right ${metricColor(c.roas, {good: 3, bad: 1.5})}">${fmt(c.roas, 'decimal')}x</td>
                  <td>${statusBadge(c.status)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<div class="empty-state"><div class="empty-state-text">No campaign data for this range</div></div>'}
    </div>
  `;
}

function renderAlerts(pendingRecos) {
  const alertArea = document.getElementById('alert-area');
  const criticalCount = pendingRecos.filter(r => r.urgency === 'critical').length;
  const highCount = pendingRecos.filter(r => r.urgency === 'high').length;

  if (criticalCount > 0) {
    alertArea.innerHTML = `
      <div class="alert-banner alert-critical" onclick="navigateTo('ai')" style="cursor:pointer">
        ⚠ ${criticalCount} critical issue${criticalCount > 1 ? 's' : ''} ${highCount > 0 ? `and ${highCount} high-priority` : ''} — click to review
      </div>`;
  } else if (highCount > 0) {
    alertArea.innerHTML = `
      <div class="alert-banner alert-warning" onclick="navigateTo('ai')" style="cursor:pointer">
        ${highCount} high-priority recommendation${highCount > 1 ? 's' : ''} pending — click to review
      </div>`;
  }
}

function kpiCard(label, value, delta, trendData, invertDelta = false) {
  let deltaHtml = '';
  if (delta !== undefined && delta !== null) {
    const d = fmtDelta(invertDelta ? -delta : delta);
    const rangeLabel = overviewDays === 1 ? 'vs prior day' : `vs prior ${overviewDays}d`;
    deltaHtml = `<div class="kpi-delta ${d.cls}">${d.text} ${rangeLabel}</div>`;
  }

  let sparkHtml = '';
  if (trendData && trendData.length > 2) {
    sparkHtml = `<div class="mt-sm">${sparkline(trendData)}</div>`;
  }

  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
      ${deltaHtml}
      ${sparkHtml}
    </div>
  `;
}

function setOverviewRange(days) {
  overviewDays = days;
  navigateTo('overview');
}
