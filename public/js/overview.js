/* ═══════════════════════════════════════════════════════════
   Overview Page — date range picker + proper conversions
   ═══════════════════════════════════════════════════════════ */

let dateFrom = daysAgoStr(1);
let dateTo = todayStr();
let activePreset = 'yesterday';

async function loadOverview(container) {
  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap: wrap; gap: 10px;">
      <div></div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <div class="date-selector">
          <button class="date-btn ${activePreset === 'today' ? 'active' : ''}" onclick="setPreset('today')">Today</button>
          <button class="date-btn ${activePreset === 'yesterday' ? 'active' : ''}" onclick="setPreset('yesterday')">Yesterday</button>
          <button class="date-btn ${activePreset === '7d' ? 'active' : ''}" onclick="setPreset('7d')">7d</button>
          <button class="date-btn ${activePreset === '14d' ? 'active' : ''}" onclick="setPreset('14d')">14d</button>
          <button class="date-btn ${activePreset === '30d' ? 'active' : ''}" onclick="setPreset('30d')">30d</button>
          <button class="date-btn ${activePreset === 'custom' ? 'active' : ''}" onclick="toggleDatePicker()">Custom</button>
        </div>
        <div id="date-picker-area" style="display: ${activePreset === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 6px;">
          <input type="date" id="date-from" class="form-input" style="width: 140px; padding: 6px 10px; font-size: 0.78rem;" value="${dateFrom}" />
          <span class="text-muted">→</span>
          <input type="date" id="date-to" class="form-input" style="width: 140px; padding: 6px 10px; font-size: 0.78rem;" value="${dateTo}" />
          <button class="btn btn-sm btn-primary" onclick="applyCustomDate()">Apply</button>
        </div>
      </div>
    </div>
    <div id="date-label" class="text-muted mb-sm" style="font-size: 0.78rem; text-align: right;">${getDateLabel()}</div>
    <div id="alert-area"></div>
    <div id="kpi-area" class="kpi-grid"><div class="loading">Loading KPIs</div></div>
    <div id="campaigns-summary"></div>
  `;

  try {
    // Always fetch LIVE from Meta API for accuracy
    const [liveRes, recoRes] = await Promise.all([
      apiGet(`/meta/live?level=campaign&since=${dateFrom}&until=${dateTo}`),
      apiGet(`/ai/recommendations?accountId=${ACCOUNT_ID}&status=pending`),
    ]);

    const campaigns = liveRes.data || [];

    // Aggregate totals
    let totalSpend = 0, totalImpressions = 0, totalClicks = 0, totalReach = 0;
    let totalResults = 0, resultType = '—';
    let totalCostPerResult = 0, resultCampaigns = 0;

    for (const c of campaigns) {
      totalSpend += parseFloat(c.spend) || 0;
      totalImpressions += parseInt(c.impressions) || 0;
      totalClicks += parseInt(c.clicks) || 0;
      totalReach += parseInt(c.reach) || 0;

      const result = parseResults(c.actions);
      totalResults += result.count;
      if (result.type !== '—') resultType = result.type;

      const cpr = parseCostPerResult(c.cost_per_action_type, result.type);
      if (cpr > 0) { totalCostPerResult += cpr; resultCampaigns++; }
    }

    const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0;
    const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0;
    const avgCpc = totalClicks > 0 ? (totalSpend / totalClicks) : 0;
    const avgCpa = totalResults > 0 ? (totalSpend / totalResults) : 0;
    const avgCostPerResult = resultCampaigns > 0 ? (totalCostPerResult / resultCampaigns) : avgCpa;

    // Alerts
    renderAlerts(recoRes.data || []);

    // KPI cards
    document.getElementById('kpi-area').innerHTML = `
      ${kpiCard('Spend', fmt(totalSpend, 'currency'))}
      ${kpiCard('Impressions', fmt(totalImpressions, 'compact'))}
      ${kpiCard('CPM', '$' + fmt(avgCpm, 'decimal'))}
      ${kpiCard('CTR', fmt(avgCtr, 'percent'))}
      ${kpiCard('CPC', '$' + fmt(avgCpc, 'decimal'))}
      ${kpiCard('Results (' + resultType + ')', fmt(totalResults, 'integer'))}
      ${kpiCard('Cost per Result', fmt(avgCpa, 'currency'))}
      ${kpiCard('Reach', fmt(totalReach, 'compact'))}
    `;

    // Campaign table with live data
    document.getElementById('campaigns-summary').innerHTML = `
      <div class="table-container">
        <div class="table-header">
          <span class="table-title">${campaigns.length} Campaign${campaigns.length !== 1 ? 's' : ''}</span>
          <span class="badge badge-active" style="font-size: 0.7rem;">LIVE FROM META</span>
        </div>
        ${campaigns.length > 0 ? renderCampaignTable(campaigns) : '<div class="empty-state"><div class="empty-state-text">No campaign data for this date range</div></div>'}
      </div>
    `;

  } catch (err) {
    document.getElementById('kpi-area').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

function renderCampaignTable(campaigns) {
  return `
    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th>Campaign</th>
            <th class="right">Spend</th>
            <th class="right">Results</th>
            <th class="right">Cost/Result</th>
            <th class="right">Impr.</th>
            <th class="right">CPM</th>
            <th class="right">CTR</th>
            <th class="right">CPC</th>
            <th class="right">Reach</th>
            <th class="right">Freq.</th>
          </tr>
        </thead>
        <tbody>
          ${campaigns.map(c => {
            const result = parseResults(c.actions);
            const cpr = parseCostPerResult(c.cost_per_action_type, result.type);
            const spend = parseFloat(c.spend) || 0;
            const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);

            return `
              <tr>
                <td class="name-cell">${c.campaign_name}</td>
                <td class="right">${fmt(c.spend, 'currency')}</td>
                <td class="right" style="font-weight: 600;">${result.count > 0 ? result.count : '—'}</td>
                <td class="right ${metricColor(costPerResult, {good: 40, bad: 80}, true)}">${costPerResult > 0 ? fmt(costPerResult, 'currency') : '—'}</td>
                <td class="right">${fmt(c.impressions, 'compact')}</td>
                <td class="right">${fmt(c.cpm, 'currency')}</td>
                <td class="right ${metricColor(c.ctr, {good: 1.5, bad: 0.5})}">${fmt(c.ctr, 'percent')}</td>
                <td class="right">${fmt(c.cpc, 'currency')}</td>
                <td class="right">${fmt(c.reach, 'compact')}</td>
                <td class="right">${fmt(c.frequency, 'decimal')}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// ─── DATE PRESETS ─────────────────────────────────────────

function setPreset(preset) {
  activePreset = preset;
  const today = todayStr();

  switch (preset) {
    case 'today':
      dateFrom = today;
      dateTo = today;
      break;
    case 'yesterday':
      dateFrom = daysAgoStr(1);
      dateTo = daysAgoStr(1);
      break;
    case '7d':
      dateFrom = daysAgoStr(7);
      dateTo = daysAgoStr(1);
      break;
    case '14d':
      dateFrom = daysAgoStr(14);
      dateTo = daysAgoStr(1);
      break;
    case '30d':
      dateFrom = daysAgoStr(30);
      dateTo = daysAgoStr(1);
      break;
    case 'custom':
      toggleDatePicker();
      return;
  }
  navigateTo('overview');
}

function toggleDatePicker() {
  activePreset = 'custom';
  const picker = document.getElementById('date-picker-area');
  if (picker) picker.style.display = 'flex';
}

function applyCustomDate() {
  dateFrom = document.getElementById('date-from').value;
  dateTo = document.getElementById('date-to').value;
  if (!dateFrom || !dateTo) { toast('Select both dates', 'error'); return; }
  if (dateFrom > dateTo) { toast('Start date must be before end date', 'error'); return; }
  activePreset = 'custom';
  navigateTo('overview');
}

function getDateLabel() {
  if (activePreset === 'today') return 'Today — live from Meta';
  if (activePreset === 'yesterday') return `Yesterday (${dateFrom})`;
  if (dateFrom === dateTo) return dateFrom;
  return `${dateFrom} → ${dateTo}`;
}

// ─── HELPERS ──────────────────────────────────────────────

function renderAlerts(pendingRecos) {
  const alertArea = document.getElementById('alert-area');
  if (!alertArea) return;
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
        ${highCount} high-priority recommendation${highCount > 1 ? 's' : ''} pending
      </div>`;
  }
}

function kpiCard(label, value) {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${value}</div>
    </div>
  `;
}
