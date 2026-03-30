/* ═══════════════════════════════════════════════════════════
   Campaigns Page — live data + date range + proper conversions
   ═══════════════════════════════════════════════════════════ */

let campDateFrom = daysAgoStr(1);
let campDateTo = daysAgoStr(1);
let campPreset = 'yesterday';

async function loadCampaigns(container) {
  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap: wrap; gap: 10px;">
      <div></div>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <div class="date-selector">
          <button class="date-btn ${campPreset === 'today' ? 'active' : ''}" onclick="setCampPreset('today')">Today</button>
          <button class="date-btn ${campPreset === 'yesterday' ? 'active' : ''}" onclick="setCampPreset('yesterday')">Yesterday</button>
          <button class="date-btn ${campPreset === '7d' ? 'active' : ''}" onclick="setCampPreset('7d')">7d</button>
          <button class="date-btn ${campPreset === '30d' ? 'active' : ''}" onclick="setCampPreset('30d')">30d</button>
          <button class="date-btn ${campPreset === 'custom' ? 'active' : ''}" onclick="toggleCampDatePicker()">Custom</button>
        </div>
        <div id="camp-date-picker" style="display: ${campPreset === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 6px;">
          <input type="date" id="camp-date-from" class="form-input" style="width: 140px; padding: 6px 10px; font-size: 0.78rem;" value="${campDateFrom}" />
          <span class="text-muted">→</span>
          <input type="date" id="camp-date-to" class="form-input" style="width: 140px; padding: 6px 10px; font-size: 0.78rem;" value="${campDateTo}" />
          <button class="btn btn-sm btn-primary" onclick="applyCampDate()">Apply</button>
        </div>
      </div>
    </div>
    <div class="text-muted mb-sm" style="font-size: 0.78rem; text-align: right;">${campDateFrom === campDateTo ? campDateFrom : campDateFrom + ' → ' + campDateTo} — live from Meta</div>
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">All Campaigns</span>
        <span class="badge badge-active" style="font-size: 0.7rem;">LIVE</span>
      </div>
      <div id="campaigns-table"><div class="loading">Loading campaigns from Meta</div></div>
    </div>
  `;

  try {
    const res = await apiGet(`/meta/live?level=campaign&since=${campDateFrom}&until=${campDateTo}`);
    const campaigns = res.data || [];

    if (campaigns.length === 0) {
      document.getElementById('campaigns-table').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No campaign data for this date range</div></div>';
      return;
    }

    document.getElementById('campaigns-table').innerHTML = `
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
              <th class="right">Clicks</th>
              <th class="right">CTR</th>
              <th class="right">CPC</th>
              <th class="right">Reach</th>
              <th class="right">Freq.</th>
              <th>Actions</th>
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
                  <td class="name-cell">
                    <a href="#" onclick="navigateTo('adsets', {campaignId: '${c.campaign_id}', campaignName: '${(c.campaign_name || '').replace(/'/g, "\\'")}', metaCampaignId: '${c.campaign_id}'}); return false;">
                      ${c.campaign_name}
                    </a>
                  </td>
                  <td class="right">${fmt(c.spend, 'currency')}</td>
                  <td class="right" style="font-weight: 600;">${result.count > 0 ? result.count : '—'}</td>
                  <td class="right ${metricColor(costPerResult, {good: 40, bad: 80}, true)}">${costPerResult > 0 ? fmt(costPerResult, 'currency') : '—'}</td>
                  <td class="right">${fmt(c.impressions, 'compact')}</td>
                  <td class="right">${fmt(c.cpm, 'currency')}</td>
                  <td class="right">${fmt(c.clicks, 'compact')}</td>
                  <td class="right ${metricColor(c.ctr, {good: 1.5, bad: 0.5})}">${fmt(c.ctr, 'percent')}</td>
                  <td class="right">${fmt(c.cpc, 'currency')}</td>
                  <td class="right">${fmt(c.reach, 'compact')}</td>
                  <td class="right">${fmt(c.frequency, 'decimal')}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-danger" onclick="pauseCampaign('${c.campaign_id}', '${(c.campaign_name || '').replace(/'/g, "\\'")}')">Pause</button>
                      <button class="btn btn-sm" onclick="dupCampaign('${c.campaign_id}', '${(c.campaign_name || '').replace(/'/g, "\\'")}')">Dup</button>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    document.getElementById('campaigns-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

// ─── DATE PRESETS ─────────────────────────────────────────

function setCampPreset(preset) {
  campPreset = preset;
  switch (preset) {
    case 'today':
      campDateFrom = todayStr(); campDateTo = todayStr(); break;
    case 'yesterday':
      campDateFrom = daysAgoStr(1); campDateTo = daysAgoStr(1); break;
    case '7d':
      campDateFrom = daysAgoStr(7); campDateTo = daysAgoStr(1); break;
    case '30d':
      campDateFrom = daysAgoStr(30); campDateTo = daysAgoStr(1); break;
    case 'custom':
      toggleCampDatePicker(); return;
  }
  navigateTo('campaigns');
}

function toggleCampDatePicker() {
  campPreset = 'custom';
  const picker = document.getElementById('camp-date-picker');
  if (picker) picker.style.display = 'flex';
}

function applyCampDate() {
  campDateFrom = document.getElementById('camp-date-from').value;
  campDateTo = document.getElementById('camp-date-to').value;
  if (!campDateFrom || !campDateTo) { toast('Select both dates', 'error'); return; }
  campPreset = 'custom';
  navigateTo('campaigns');
}

// ─── ACTIONS ──────────────────────────────────────────────

async function pauseCampaign(metaId, name) {
  if (!confirmAction(`Pause campaign "${name}"?`)) return;
  try {
    await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Paused: ${name}`, 'success');
    navigateTo('campaigns');
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function resumeCampaign(metaId, name) {
  if (!confirmAction(`Resume campaign "${name}"?`)) return;
  try {
    await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Resumed: ${name}`, 'success');
    navigateTo('campaigns');
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function dupCampaign(metaId, name) {
  if (!confirmAction(`Duplicate campaign "${name}"?`)) return;
  try {
    await apiPost('/actions/duplicate', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Duplicated: ${name}`, 'success');
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
