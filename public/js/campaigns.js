/* ═══════════════════════════════════════════════════════════
   Campaigns Page — bulk actions + creation wizard
   ═══════════════════════════════════════════════════════════ */

let campDateFrom = daysAgoStr(1);
let campDateTo = daysAgoStr(1);
let campPreset = 'yesterday';
let selectedCampaigns = new Set();

async function loadCampaigns(container) {
  selectedCampaigns.clear();

  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap: wrap; gap: 10px;">
      <button class="btn btn-primary" onclick="openCreateCampaign()">+ New Campaign</button>
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

    <!-- Bulk action bar -->
    <div id="bulk-bar" style="display:none; padding: 10px 16px; background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--radius); margin-bottom: 14px; align-items: center; gap: 12px;">
      <span id="bulk-count" style="font-weight: 600; font-size: 0.85rem;">0 selected</span>
      <button class="btn btn-sm btn-danger" onclick="bulkAction('pause')">Pause Selected</button>
      <button class="btn btn-sm" onclick="bulkAction('resume')">Resume Selected</button>
      <button class="btn btn-sm" onclick="clearSelection()">Clear</button>
    </div>

    <div class="text-muted mb-sm" style="font-size: 0.78rem; text-align: right;">${campDateFrom === campDateTo ? campDateFrom : campDateFrom + ' → ' + campDateTo}</div>
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">Campaigns</span>
        <span class="badge badge-active" style="font-size: 0.7rem;">LIVE</span>
      </div>
      <div id="campaigns-table"><div class="loading">Loading campaigns from Meta</div></div>
    </div>
  `;

  try {
    const res = await apiGet(`/meta/live?level=campaign&since=${campDateFrom}&until=${campDateTo}`);
    const campaigns = res.data || [];

    if (campaigns.length === 0) {
      document.getElementById('campaigns-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No campaign data for this date range</div></div>';
      return;
    }

    document.getElementById('campaigns-table').innerHTML = `
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th style="width: 36px;"><input type="checkbox" onchange="toggleAllCampaigns(this, ${JSON.stringify(campaigns.map(c => c.campaign_id)).replace(/"/g, '&quot;')})" /></th>
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
                  <td><input type="checkbox" class="camp-check" value="${c.campaign_id}" onchange="updateCampSelection()" /></td>
                  <td class="name-cell">
                    <a href="#" onclick="navigateTo('adsets', {metaCampaignId: '${c.campaign_id}', campaignName: '${(c.campaign_name || '').replace(/'/g, "\\'")}'}); return false;">
                      ${c.campaign_name}
                    </a>
                  </td>
                  <td class="right">${fmt(c.spend, 'currency')}</td>
                  <td class="right" style="font-weight: 600;">${result.count > 0 ? result.count : '—'}</td>
                  <td class="right ${metricColor(costPerResult, {good: 40, bad: 80}, true)}">${costPerResult > 0 ? fmt(costPerResult, 'currency') : '—'}</td>
                  <td class="right">${fmt(c.impressions, 'compact')}</td>
                  <td class="right">${fmt(c.cpm, 'currency')}</td>
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

// ─── BULK SELECTION ───────────────────────────────────────

function toggleAllCampaigns(checkbox, ids) {
  const checks = document.querySelectorAll('.camp-check');
  checks.forEach(c => { c.checked = checkbox.checked; });
  selectedCampaigns = checkbox.checked ? new Set(ids) : new Set();
  updateBulkBar();
}

function updateCampSelection() {
  selectedCampaigns.clear();
  document.querySelectorAll('.camp-check:checked').forEach(c => selectedCampaigns.add(c.value));
  updateBulkBar();
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const count = document.getElementById('bulk-count');
  if (selectedCampaigns.size > 0) {
    bar.style.display = 'flex';
    count.textContent = `${selectedCampaigns.size} selected`;
  } else {
    bar.style.display = 'none';
  }
}

function clearSelection() {
  selectedCampaigns.clear();
  document.querySelectorAll('.camp-check').forEach(c => { c.checked = false; });
  updateBulkBar();
}

async function bulkAction(action) {
  if (selectedCampaigns.size === 0) return;
  if (!confirmAction(`${action === 'pause' ? 'Pause' : 'Resume'} ${selectedCampaigns.size} campaign(s)?`)) return;

  try {
    toast(`${action === 'pause' ? 'Pausing' : 'Resuming'} ${selectedCampaigns.size} campaigns...`, 'info');
    const res = await apiPost('/create/bulk-action', {
      entityIds: Array.from(selectedCampaigns),
      entityType: 'campaign',
      action,
    });
    toast(res.message, 'success');
    navigateTo('campaigns');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

// ─── CREATE CAMPAIGN DRAWER ───────────────────────────────

function openCreateCampaign() {
  openDrawer('Create Campaign', `
    <div class="form-group">
      <label class="form-label">Campaign Name</label>
      <input id="cc-name" class="form-input" type="text" placeholder="e.g. CA — Casino — Slots — Prospecting" />
    </div>

    <div class="form-group">
      <label class="form-label">Objective</label>
      <select id="cc-objective" class="form-select">
        <option value="OUTCOME_SALES">Sales (Conversions)</option>
        <option value="OUTCOME_LEADS">Leads</option>
        <option value="OUTCOME_TRAFFIC">Traffic</option>
        <option value="OUTCOME_ENGAGEMENT">Engagement</option>
        <option value="OUTCOME_AWARENESS">Awareness</option>
        <option value="OUTCOME_APP_PROMOTION">App Promotion</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Special Ad Categories</label>
      <div style="display: flex; flex-wrap: wrap; gap: 8px;">
        <label style="display: flex; align-items: center; gap: 5px; font-size: 0.82rem; cursor: pointer;">
          <input type="checkbox" class="cc-category" value="CREDIT" /> Credit
        </label>
        <label style="display: flex; align-items: center; gap: 5px; font-size: 0.82rem; cursor: pointer;">
          <input type="checkbox" class="cc-category" value="EMPLOYMENT" /> Employment
        </label>
        <label style="display: flex; align-items: center; gap: 5px; font-size: 0.82rem; cursor: pointer;">
          <input type="checkbox" class="cc-category" value="HOUSING" /> Housing
        </label>
        <label style="display: flex; align-items: center; gap: 5px; font-size: 0.82rem; cursor: pointer;">
          <input type="checkbox" class="cc-category" value="SOCIAL_ISSUES_ELECTIONS_POLITICS" /> Social/Political
        </label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Campaign Budget Optimization (CBO)</label>
      <select id="cc-budget-type" class="form-select" onchange="toggleCCBudget()">
        <option value="none">No CBO — set budget at ad set level</option>
        <option value="daily">Daily Budget</option>
        <option value="lifetime">Lifetime Budget</option>
      </select>
    </div>

    <div id="cc-budget-field" class="form-group" style="display: none;">
      <label class="form-label">Budget Amount (CAD)</label>
      <input id="cc-budget" class="form-input" type="number" step="0.01" placeholder="e.g. 100.00" />
    </div>

    <div class="form-group">
      <label class="form-label">Initial Status</label>
      <select id="cc-status" class="form-select">
        <option value="PAUSED">Paused (review before launch)</option>
        <option value="ACTIVE">Active (launch immediately)</option>
      </select>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 20px;">
      <button class="btn btn-primary" onclick="submitCreateCampaign()">Create Campaign</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>
  `);
}

function toggleCCBudget() {
  const type = document.getElementById('cc-budget-type').value;
  document.getElementById('cc-budget-field').style.display = type === 'none' ? 'none' : 'block';
}

async function submitCreateCampaign() {
  const name = document.getElementById('cc-name').value;
  const objective = document.getElementById('cc-objective').value;
  const budgetType = document.getElementById('cc-budget-type').value;
  const budget = parseFloat(document.getElementById('cc-budget')?.value) || 0;
  const status = document.getElementById('cc-status').value;
  const categories = Array.from(document.querySelectorAll('.cc-category:checked')).map(c => c.value);

  if (!name) { toast('Campaign name required', 'error'); return; }

  const payload = { name, objective, status, specialAdCategories: categories };
  if (budgetType === 'daily' && budget > 0) payload.dailyBudget = budget;
  if (budgetType === 'lifetime' && budget > 0) payload.lifetimeBudget = budget;

  try {
    toast('Creating campaign...', 'info');
    const res = await apiPost('/create/campaign', payload);
    toast(`Campaign created: ${name}`, 'success');
    closeDrawer();
    navigateTo('campaigns');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

// ─── DATE PRESETS ─────────────────────────────────────────

function setCampPreset(preset) {
  campPreset = preset;
  switch (preset) {
    case 'today': campDateFrom = todayStr(); campDateTo = todayStr(); break;
    case 'yesterday': campDateFrom = daysAgoStr(1); campDateTo = daysAgoStr(1); break;
    case '7d': campDateFrom = daysAgoStr(7); campDateTo = daysAgoStr(1); break;
    case '30d': campDateFrom = daysAgoStr(30); campDateTo = daysAgoStr(1); break;
    case 'custom': toggleCampDatePicker(); return;
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

async function dupCampaign(metaId, name) {
  if (!confirmAction(`Duplicate campaign "${name}"?`)) return;
  try {
    await apiPost('/actions/duplicate', { accountId: ACCOUNT_ID, entityType: 'campaign', metaEntityId: metaId });
    toast(`Duplicated: ${name}`, 'success');
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
