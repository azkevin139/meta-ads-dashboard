/* ═══════════════════════════════════════════════════════════
   Campaigns Page
   ═══════════════════════════════════════════════════════════ */

let campaignDays = 7;

async function loadCampaigns(container) {
  container.innerHTML = `
    <div class="flex-between mb-md">
      <div></div>
      <div class="date-selector">
        <button class="date-btn ${campaignDays === 1 ? 'active' : ''}" onclick="setCampaignRange(1)">1d</button>
        <button class="date-btn ${campaignDays === 7 ? 'active' : ''}" onclick="setCampaignRange(7)">7d</button>
        <button class="date-btn ${campaignDays === 14 ? 'active' : ''}" onclick="setCampaignRange(14)">14d</button>
        <button class="date-btn ${campaignDays === 30 ? 'active' : ''}" onclick="setCampaignRange(30)">30d</button>
      </div>
    </div>
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">All Campaigns</span>
      </div>
      <div id="campaigns-table"><div class="loading">Loading campaigns</div></div>
    </div>
  `;

  try {
    const res = await apiGet(`/insights/campaigns?accountId=${ACCOUNT_ID}&days=${campaignDays}`);
    const campaigns = res.data || [];

    if (campaigns.length === 0) {
      document.getElementById('campaigns-table').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-text">No campaigns found</div></div>';
      return;
    }

    document.getElementById('campaigns-table').innerHTML = `
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Objective</th>
              <th>Status</th>
              <th class="right">Budget</th>
              <th class="right">Spend</th>
              <th class="right">Impr.</th>
              <th class="right">Clicks</th>
              <th class="right">CTR</th>
              <th class="right">CPM</th>
              <th class="right">Conv.</th>
              <th class="right">CPA</th>
              <th class="right">ROAS</th>
              <th class="right">Freq.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${campaigns.map(c => `
              <tr>
                <td class="name-cell">
                  <a href="#" onclick="navigateTo('adsets', {campaignId: ${c.id}, campaignName: '${c.name.replace(/'/g, "\\'")}'}); return false;">
                    ${c.name}
                  </a>
                </td>
                <td><span class="text-muted" style="font-size: 0.75rem;">${fmtObjective(c.objective)}</span></td>
                <td>${statusBadge(c.effective_status || c.status)}</td>
                <td class="right">${fmtBudget(c.daily_budget)}</td>
                <td class="right">${fmt(c.spend, 'currency')}</td>
                <td class="right">${fmt(c.impressions, 'compact')}</td>
                <td class="right">${fmt(c.clicks, 'compact')}</td>
                <td class="right ${metricColor(c.ctr, {good: 3, bad: 1.5})}">${fmt(c.ctr, 'percent')}</td>
                <td class="right">${fmt(c.cpm, 'currency')}</td>
                <td class="right">${fmt(c.conversions, 'integer')}</td>
                <td class="right ${metricColor(c.cpa, {good: 15, bad: 25}, true)}">${fmt(c.cpa, 'currency')}</td>
                <td class="right ${metricColor(c.roas, {good: 3, bad: 1.5})}">${fmt(c.roas, 'decimal')}x</td>
                <td class="right">${fmt(c.avg_frequency, 'decimal')}</td>
                <td>
                  <div class="btn-group">
                    ${c.status === 'ACTIVE'
                      ? `<button class="btn btn-sm btn-danger" onclick="pauseCampaign('${c.meta_campaign_id}', '${c.name.replace(/'/g, "\\'")}')">Pause</button>`
                      : `<button class="btn btn-sm" onclick="resumeCampaign('${c.meta_campaign_id}', '${c.name.replace(/'/g, "\\'")}')">Resume</button>`
                    }
                    <button class="btn btn-sm" onclick="dupCampaign('${c.meta_campaign_id}', '${c.name.replace(/'/g, "\\'")}')">Dup</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    document.getElementById('campaigns-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

function fmtObjective(obj) {
  if (!obj) return '—';
  return obj.replace('OUTCOME_', '').replace(/_/g, ' ').toLowerCase();
}

function setCampaignRange(days) {
  campaignDays = days;
  navigateTo('campaigns');
}

async function pauseCampaign(metaId, name) {
  if (!confirmAction(`Pause campaign "${name}"?`)) return;
  try {
    await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Paused: ${name}`, 'success');
    navigateTo('campaigns');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function resumeCampaign(metaId, name) {
  if (!confirmAction(`Resume campaign "${name}"?`)) return;
  try {
    await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Resumed: ${name}`, 'success');
    navigateTo('campaigns');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function dupCampaign(metaId, name) {
  if (!confirmAction(`Duplicate campaign "${name}"? It will be created as PAUSED.`)) return;
  try {
    await apiPost('/actions/duplicate', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Duplicated: ${name}`, 'success');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}
