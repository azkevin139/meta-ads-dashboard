/* ═══════════════════════════════════════════════════════════
   Campaigns Page — responsive editor driven
   ═══════════════════════════════════════════════════════════ */

const campaignFilterState = window.PageFilterHelpers.createDateRangeState({
  initialPreset: 'yesterday',
  presets: ['today', 'yesterday', '7d', '30d', 'custom'],
  todayStr,
  daysAgoStr,
});
const campaignMetrics = window.DashboardMetrics;
const campaignEditorUtils = window.EditorUtils;
const rowActions = window.RowActionHelpers;
const campaignBulkSelection = window.BulkSelectionHelpers.createBulkSelection({
  checkboxSelector: '.camp-check',
  barId: 'bulk-bar',
  countId: 'bulk-count',
});
window.getCampaignDateRange = () => campaignFilterState.getState();
let campaignDrawerSection = 'identity';
let currentCampaignEditorEntity = null;
let campaignDrawerBound = false;
let createCampaignSubmitting = false;

async function loadCampaigns(container) {
  campaignBulkSelection.clear();
  const isMobile = window.innerWidth <= 768;
  const { from: campDateFrom, to: campDateTo, preset: campPreset } = campaignFilterState.getState();

  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap: wrap; gap: 10px;">
      <button class="btn btn-primary" data-campaign-action="create">+ New Campaign</button>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width:${isMobile ? '100%' : 'auto'};">
        <div class="date-selector" style="${isMobile ? 'width:100%; overflow:auto; white-space:nowrap;' : ''}">
          <button class="date-btn ${campPreset === 'today' ? 'active' : ''}" data-campaign-preset="today">Today</button>
          <button class="date-btn ${campPreset === 'yesterday' ? 'active' : ''}" data-campaign-preset="yesterday">Yesterday</button>
          <button class="date-btn ${campPreset === '7d' ? 'active' : ''}" data-campaign-preset="7d">7d</button>
          <button class="date-btn ${campPreset === '30d' ? 'active' : ''}" data-campaign-preset="30d">30d</button>
          <button class="date-btn ${campPreset === 'custom' ? 'active' : ''}" data-campaign-preset="custom">Custom</button>
        </div>
        <div id="camp-date-picker" style="display: ${campPreset === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 6px; flex-wrap:wrap; width:${isMobile ? '100%' : 'auto'};">
          <input type="date" id="camp-date-from" class="form-input" style="width: ${isMobile ? 'calc(50% - 20px)' : '140px'}; padding: 6px 10px; font-size: 0.78rem;" value="${campDateFrom}" />
          <span class="text-muted">→</span>
          <input type="date" id="camp-date-to" class="form-input" style="width: ${isMobile ? 'calc(50% - 20px)' : '140px'}; padding: 6px 10px; font-size: 0.78rem;" value="${campDateTo}" />
          <button class="btn btn-sm btn-primary" data-campaign-action="apply-date">Apply</button>
        </div>
      </div>
    </div>

    <div id="campaign-pulse-inline" class="mb-md"><div class="loading">Loading live request usage...</div></div>
    <div id="campaign-data-health" class="mb-md"></div>
    <div id="campaign-action-briefing" class="mb-md"><div class="loading">Finding campaigns that need attention</div></div>

    <div id="bulk-bar" style="display:none; padding: 10px 16px; background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--radius); margin-bottom: 14px; align-items: center; gap: 12px; flex-wrap:wrap;">
      <span id="bulk-count" style="font-weight: 600; font-size: 0.85rem;">0 selected</span>
      <button class="btn btn-sm btn-danger" data-campaign-bulk="pause">Pause Selected</button>
      <button class="btn btn-sm" data-campaign-bulk="resume">Resume Selected</button>
      <button class="btn btn-sm" data-campaign-bulk="clear">Clear</button>
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
  bindCampaignControls(container);

  try {
    const [liveRes, listRes, usageRes, healthRes] = await Promise.all([
      apiGet(`/meta/live?level=campaign&since=${campDateFrom}&until=${campDateTo}`),
      apiGet('/meta/campaigns'),
      apiGet('/meta/rate-limit-status'),
      window.DataHealth?.load({ force: true }).catch(() => null),
    ]);
    renderCampaignUsageInline(usageRes);
    renderCampaignDataHealth(healthRes);

    const insights = liveRes.data || [];
    const entities = listRes.data || [];
    const entityMap = Object.fromEntries(entities.map(c => [c.id, c]));
    for (const ins of insights) {
      const meta = entityMap[ins.campaign_id];
      if (meta && meta.desired_event) ins.desired_event = meta.desired_event;
    }

    if (insights.length === 0 && entities.length === 0) {
      document.getElementById('campaigns-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No campaigns found</div></div>';
      return;
    }

    const rows = (insights.length ? insights : entities.map(c => ({ campaign_id: c.id, campaign_name: c.name }))).map(c => ({ ...c, meta: entityMap[c.campaign_id] || null }));
    renderCampaignActionBriefing(rows);
    document.getElementById('campaigns-table').innerHTML = isMobile ? renderCampaignCards(rows) : renderCampaignDesktopTable(rows);
  } catch (err) {
    document.getElementById('campaigns-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function campaignIssueFor(row) {
  const result = parseResults(row.actions, row.desired_event);
  const spend = parseFloat(row.spend) || 0;
  const ctr = parseFloat(row.ctr) || 0;
  const status = row.meta?.effective_status || row.meta?.status || '';
  const cpr = parseCostPerResult(row.cost_per_action_type, result.type);
  const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);
  if (status && !['ACTIVE', 'PAUSED'].includes(status)) {
    return { severity: 'critical', title: 'Delivery status needs review', detail: `${status} may prevent stable delivery.`, rank: 1 };
  }
  if (spend >= 25 && result.count === 0) {
    return { severity: 'warning', title: 'Spend with no result', detail: `${fmt(spend, 'currency')} spent without tracked results.`, rank: 2 };
  }
  if (costPerResult >= 80 && result.count > 0) {
    return { severity: 'warning', title: 'High cost per result', detail: `${fmt(costPerResult, 'currency')} per ${result.type}.`, rank: 3 };
  }
  if (spend >= 10 && ctr > 0 && ctr < 0.5) {
    return { severity: 'low', title: 'Low click-through rate', detail: `${fmt(ctr, 'percent')} CTR after spend.`, rank: 4 };
  }
  return null;
}

function renderCampaignActionBriefing(rows) {
  const el = document.getElementById('campaign-action-briefing');
  if (!el) return;
  const issues = (rows || [])
    .map((row) => ({ row, issue: campaignIssueFor(row) }))
    .filter((item) => item.issue)
    .sort((a, b) => a.issue.rank - b.issue.rank || (parseFloat(b.row.spend) || 0) - (parseFloat(a.row.spend) || 0))
    .slice(0, 4);
  el.innerHTML = `
    <div class="operator-briefing">
      <div class="briefing-header">
        <div>
          <div class="intel-eyebrow">Campaign Triage</div>
          <div class="briefing-title">${issues.length ? `${issues.length} campaign${issues.length === 1 ? '' : 's'} need attention` : 'No urgent campaign issue detected'}</div>
          <div class="briefing-subtitle">Action-needed campaigns first. Full campaign table stays below.</div>
        </div>
        <span class="badge badge-${issues.length ? 'warning' : 'active'}">${fmt(issues.length, 'integer')} issues</span>
      </div>
      ${issues.length ? `<div class="campaign-issue-grid">
        ${issues.map(({ row, issue }) => `
          <div class="campaign-issue-card">
            <div class="campaign-issue-top">
              <span class="badge badge-${issue.severity}">${escapeHtml(issue.title)}</span>
              <span class="text-muted">${fmt(parseFloat(row.spend) || 0, 'currency')}</span>
            </div>
            <div class="campaign-issue-name">${escapeHtml(row.campaign_name || row.name || row.campaign_id)}</div>
            <div class="campaign-issue-detail">${escapeHtml(issue.detail)}</div>
            <div class="btn-group">
              <button class="btn btn-sm btn-primary" data-campaign-edit="${escapeHtml(row.campaign_id)}">Edit</button>
              <button class="btn btn-sm" data-campaign-open="${escapeHtml(row.campaign_id)}" data-campaign-name="${escapeHtml(row.campaign_name || '')}">Open</button>
            </div>
          </div>
        `).join('')}
      </div>` : `<div class="empty-state" style="padding:22px 12px;"><div class="empty-state-text">Campaigns are not showing obvious spend, delivery, or CTR issues in this range.</div></div>`}
    </div>
  `;
}

function renderCampaignDataHealth(health) {
  const el = document.getElementById('campaign-data-health');
  if (!el || !window.DataHealth) return;
  const summary = window.DataHealth.summarizeHealth(health, [
    { source: 'meta', dataset: 'entities' },
    { source: 'meta', dataset: 'warehouse_insights' },
  ]);
  el.innerHTML = window.DataHealth.panel(summary, 'Campaign Data Health');
}

function renderCampaignUsageInline(rateRes) {
  const el = document.getElementById('campaign-pulse-inline');
  if (!el) return;
  const summary = rateRes.summary || {};
  el.innerHTML = `
    <div class="reco-card" style="padding:12px 14px;">
      <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
        <div style="font-weight:600; font-size:0.82rem;">Live API usage</div>
        <div class="text-muted" style="font-size:0.72rem;">${rateRes.last_seen_at ? `Updated ${fmtDateTime(rateRes.last_seen_at)}` : 'Waiting for headers'}</div>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap:8px; margin-top:8px; font-size:0.78rem;">
        <div><div class="kpi-label">Ads Mgmt</div><div>${fmtPct(summary.ads_management?.call_count)}</div></div>
        <div><div class="kpi-label">Insights</div><div>${fmtPct(summary.ads_insights?.call_count)}</div></div>
        <div><div class="kpi-label">Account</div><div>${fmtPct(summary.ad_account_util_pct)}</div></div>
        <div><div class="kpi-label">Reset</div><div>${campaignMetrics.formatSeconds(rateRes.estimated_regain_seconds || 0)}</div></div>
      </div>
      ${!rateRes.safe_to_write ? `<div class="alert-banner alert-warning" style="margin-top:8px;">High pressure: better wait before more edits.</div>` : ''}
    </div>
  `;
}
function fmtPct(v) { return typeof v === 'number' ? `${v}%` : '—'; }

function renderCampaignDesktopTable(rows) {
  return `
    <div style="overflow-x: auto;">
      <table>
        <thead>
          <tr>
            <th style="width: 36px;"><input type="checkbox" data-campaign-toggle-all='${escapeHtml(JSON.stringify(rows.map(c => c.campaign_id)))}' /></th>
            <th>Campaign</th><th>Status</th><th class="right">Spend</th><th class="right">Results</th><th class="right">Cost/Result</th><th class="right">Budget</th><th class="right">Target</th><th class="right">CTR</th><th class="right">CPC</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows.map(renderCampaignRow).join('')}</tbody>
      </table>
    </div>`;
}

function renderCampaignRow(c) {
  const result = parseResults(c.actions, c.desired_event);
  const cpr = parseCostPerResult(c.cost_per_action_type, result.type);
  const spend = parseFloat(c.spend) || 0;
  const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);
  const status = c.meta?.effective_status || c.meta?.status || '—';
  const budget = c.meta?.daily_budget ? fmtBudget(c.meta.daily_budget) : c.meta?.lifetime_budget ? fmtBudget(c.meta.lifetime_budget) + ' LT' : '—';
  const target = c.desired_event?.event_label ? `<span class="badge badge-low" title="${c.desired_event.source}">${c.desired_event.event_label}</span>` : '—';
  return `<tr>
    <td><input type="checkbox" class="camp-check" value="${c.campaign_id}" /></td>
    <td class="name-cell"><a href="#" data-campaign-open="${c.campaign_id}" data-campaign-name="${escapeHtml(c.campaign_name || '')}">${c.campaign_name}</a></td>
    <td>${statusBadge(status)}</td>
    <td class="right">${spend > 0 ? fmt(spend,'currency') : '—'}</td>
    <td class="right" style="font-weight:600;">${result.count > 0 ? `${result.count}<div class="text-muted" style="font-size:0.66rem; font-weight:400;">${result.type}</div>` : '—'}</td>
    <td class="right">${costPerResult > 0 ? fmt(costPerResult,'currency') : '—'}</td>
    <td class="right">${budget}</td>
    <td class="right">${target}</td>
    <td class="right">${c.ctr ? fmt(c.ctr,'percent') : '—'}</td>
    <td class="right">${c.cpc ? fmt(c.cpc,'currency') : '—'}</td>
    <td><div class="btn-group"><button class="btn btn-sm btn-primary" data-campaign-edit="${c.campaign_id}">Edit</button><button class="btn btn-sm" data-campaign-status="${c.campaign_id}" data-campaign-next-status="${status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}">${status === 'ACTIVE' ? 'Pause' : 'Resume'}</button><button class="btn btn-sm" data-campaign-duplicate="${c.campaign_id}">Dup</button></div></td>
  </tr>`;
}

function renderCampaignCards(rows) {
  return `<div style="display:grid; gap:12px;">${rows.map(c => {
    const result = parseResults(c.actions);
    const cpr = parseCostPerResult(c.cost_per_action_type, result.type);
    const spend = parseFloat(c.spend) || 0;
    const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);
    const status = c.meta?.effective_status || c.meta?.status || '—';
    const budget = c.meta?.daily_budget ? fmtBudget(c.meta.daily_budget) : c.meta?.lifetime_budget ? fmtBudget(c.meta.lifetime_budget) + ' LT' : '—';
    return `<div class="reco-card">
      <div style="display:flex; gap:10px; align-items:flex-start; margin-bottom:10px;">
        <input type="checkbox" class="camp-check" value="${c.campaign_id}" style="margin-top:4px;" />
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:0.86rem; line-height:1.4; margin-bottom:6px;">${c.campaign_name}</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">${statusBadge(status)}${c.desired_event?.event_label ? `<span class="badge badge-low">Target: ${c.desired_event.event_label}</span>` : c.meta?.objective ? `<span class="badge badge-low">${c.meta.objective.replace(/_/g,' ')}</span>` : ''}</div>
        </div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; font-size:0.8rem; margin-bottom:12px;">
        <div><div class="kpi-label">Spend</div><div>${spend > 0 ? fmt(spend,'currency') : '—'}</div></div>
        <div><div class="kpi-label">Results</div><div>${result.count > 0 ? result.count : '—'}</div></div>
        <div><div class="kpi-label">Cost/Result</div><div>${costPerResult > 0 ? fmt(costPerResult,'currency') : '—'}</div></div>
        <div><div class="kpi-label">Budget</div><div>${budget}</div></div>
        <div><div class="kpi-label">CTR</div><div>${c.ctr ? fmt(c.ctr,'percent') : '—'}</div></div>
        <div><div class="kpi-label">CPC</div><div>${c.cpc ? fmt(c.cpc,'currency') : '—'}</div></div>
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <button class="btn btn-sm btn-primary" data-campaign-edit="${c.campaign_id}">Edit</button>
        <button class="btn btn-sm" data-campaign-status="${c.campaign_id}" data-campaign-next-status="${status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}">${status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
        <button class="btn btn-sm" data-campaign-duplicate="${c.campaign_id}">Duplicate</button>
        <button class="btn btn-sm" data-campaign-open="${c.campaign_id}" data-campaign-name="${escapeHtml(c.campaign_name || '')}">Open</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function toggleAllCampaigns(checkbox, ids) { campaignBulkSelection.toggleAll(ids, checkbox.checked); }
function updateCampSelection() { campaignBulkSelection.sync(); }
function clearSelection() { campaignBulkSelection.clear(); }
async function bulkAction(action) { if (!campaignBulkSelection.size()) return; const targetStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE'; if (!confirmAction(`${action === 'pause' ? 'Pause' : 'Resume'} ${campaignBulkSelection.size()} campaign(s)?`)) return; try { for (const id of campaignBulkSelection.getSelected()) await apiPost(`/meta/entity/campaign/${id}/status`, { accountId: ACCOUNT_ID, status: targetStatus }); toast(`Updated ${campaignBulkSelection.size()} campaign(s)`, 'success'); navigateTo('campaigns'); } catch (err) { toast(`Error: ${safeErrorMessage(err)}`, 'error'); } }
function openCreateCampaign() {
  openDrawer('Create Campaign', `
    <div class="form-group">
      <label class="form-label">Campaign Name</label>
      <input id="cc-name" class="form-input" type="text" placeholder="e.g. CA Sportsbook Checkout - CBO - V1" />
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Objective</label>
        <select id="cc-objective" class="form-select">
          ${['OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_TRAFFIC','OUTCOME_ENGAGEMENT','OUTCOME_AWARENESS','OUTCOME_APP_PROMOTION'].map(v => `<option value="${v}">${v.replace(/_/g,' ')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Status</label>
        <select id="cc-status" class="form-select">
          <option value="PAUSED">Paused</option>
          <option value="ACTIVE">Active</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Buying Type</label>
        <select id="cc-buying-type" class="form-select">
          <option value="AUCTION">Auction</option>
          <option value="RESERVED">Reserved</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Special Ad Categories</label>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-top:8px;">
          ${['CREDIT','EMPLOYMENT','HOUSING','SOCIAL_ISSUES_ELECTIONS_POLITICS'].map(v => `<label style="display:flex; align-items:center; gap:6px; font-size:0.82rem;"><input type="checkbox" class="cc-cat" value="${v}" /> ${v.replace(/_/g,' ')}</label>`).join('')}
        </div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Daily Budget</label>
        <input id="cc-daily-budget" class="form-input" type="number" step="0.01" placeholder="50.00" />
      </div>
      <div class="form-group">
        <label class="form-label">Lifetime Budget</label>
        <input id="cc-lifetime-budget" class="form-input" type="number" step="0.01" placeholder="1000.00" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Start Time</label>
        <input id="cc-start-time" class="form-input" type="datetime-local" />
      </div>
      <div class="form-group">
        <label class="form-label">Stop Time</label>
        <input id="cc-stop-time" class="form-input" type="datetime-local" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Internal Tags</label>
      <input id="cc-tags" class="form-input" type="text" placeholder="launch, cbo, canada" />
    </div>
    <div class="text-muted" style="font-size:0.78rem;">Use daily or lifetime budget for campaign budget optimization. Leave the other empty.</div>
    <div style="display:flex; gap:8px; margin-top:18px;">
      <button class="btn btn-primary" data-campaign-drawer-action="create-submit">Create Campaign</button>
      <button class="btn" data-campaign-drawer-action="close">Cancel</button>
    </div>
  `);
}
async function submitCreateCampaign() {
  if (createCampaignSubmitting) return;
  const name = document.getElementById('cc-name').value.trim();
  if (!name) { toast('Campaign name required', 'error'); return; }
  const dailyBudget = campaignEditorUtils.blankToUndefined(document.getElementById('cc-daily-budget').value);
  const lifetimeBudget = campaignEditorUtils.blankToUndefined(document.getElementById('cc-lifetime-budget').value);
  const startTime = campaignEditorUtils.localDateTimeToIso(document.getElementById('cc-start-time').value);
  const stopTime = campaignEditorUtils.localDateTimeToIso(document.getElementById('cc-stop-time').value);
  if (dailyBudget !== undefined && lifetimeBudget !== undefined) { toast('Use daily or lifetime budget, not both', 'error'); return; }
  if (dailyBudget !== undefined && dailyBudget <= 0) { toast('Daily budget must be greater than 0', 'error'); return; }
  if (lifetimeBudget !== undefined && lifetimeBudget <= 0) { toast('Lifetime budget must be greater than 0', 'error'); return; }
  if (startTime && stopTime && new Date(stopTime) <= new Date(startTime)) { toast('Stop time must be after start time', 'error'); return; }
  try {
    createCampaignSubmitting = true;
    const submitButton = document.querySelector('[data-campaign-drawer-action="create-submit"]');
    if (submitButton) submitButton.disabled = true;
    toast('Creating campaign...', 'info');
    const res = await apiPost('/create/campaign', {
      accountId: ACCOUNT_ID,
      name,
      objective: document.getElementById('cc-objective').value,
      status: document.getElementById('cc-status').value,
      buyingType: document.getElementById('cc-buying-type').value,
      specialAdCategories: Array.from(document.querySelectorAll('.cc-cat:checked')).map((c) => c.value),
      internalTags: campaignEditorUtils.tagsToArray(document.getElementById('cc-tags').value),
      dailyBudget,
      lifetimeBudget,
      startTime,
      stopTime,
    });
    toast('Campaign created', 'success');
    closeDrawer();
    navigateTo('adsets', { metaCampaignId: res.campaign_id, campaignName: name, launchCreateAdSet: true });
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
    const submitButton = document.querySelector('[data-campaign-drawer-action="create-submit"]');
    if (submitButton) submitButton.disabled = false;
  } finally {
    createCampaignSubmitting = false;
  }
}
async function openCampaignEditor(campaignId) { campaignDrawerSection = 'identity'; openDrawer('Edit Campaign', '<div class="loading">Loading campaign…</div>'); try { const res = await apiGet(`/meta/entity/campaign/${campaignId}`); renderCampaignEditor(res.data); } catch (err) { setDrawerBody(`<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`); } }
function renderCampaignEditor(entity) { currentCampaignEditorEntity = entity; const s = entity.special_ad_categories || []; setDrawerBody(`
  ${entitySectionNav('campaign', campaignDrawerSection, ['identity','budget','schedule'])}
  <div data-entity-section="identity" style="display:${campaignDrawerSection === 'identity' ? 'block' : 'none'};"><div class="form-group"><label class="form-label">Name</label><input id="ce-name" class="form-input" value="${escapeHtml(entity.name || '')}" /></div><div class="form-row"><div class="form-group"><label class="form-label">Status</label><select id="ce-status" class="form-select">${['ACTIVE','PAUSED','ARCHIVED'].map(v => `<option value="${v}" ${entity.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Buying Type</label><select id="ce-buying-type" class="form-select">${['AUCTION','RESERVED'].map(v => `<option value="${v}" ${entity.buying_type === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div><div class="form-group"><label class="form-label">Objective</label><select id="ce-objective" class="form-select">${['OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_TRAFFIC','OUTCOME_ENGAGEMENT','OUTCOME_AWARENESS','OUTCOME_APP_PROMOTION'].map(v => `<option value="${v}" ${entity.objective === v ? 'selected' : ''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Special Ad Categories</label><div style="display:flex; flex-wrap:wrap; gap:8px;">${['CREDIT','EMPLOYMENT','HOUSING','SOCIAL_ISSUES_ELECTIONS_POLITICS'].map(v => `<label style="display:flex; align-items:center; gap:6px; font-size:0.82rem;"><input type="checkbox" class="ce-cat" value="${v}" ${s.includes(v) ? 'checked' : ''}/> ${v.replace(/_/g,' ')}</label>`).join('')}</div></div><div class="form-group"><label class="form-label">Internal Tags</label><input id="ce-tags" class="form-input" placeholder="launch, cbo, test" /></div></div>
  <div data-entity-section="budget" style="display:${campaignDrawerSection === 'budget' ? 'block' : 'none'};"><div class="form-row"><div class="form-group"><label class="form-label">Daily Budget</label><input id="ce-daily-budget" class="form-input" type="number" step="0.01" value="${entity.daily_budget ? (entity.daily_budget / 100).toFixed(2) : ''}" /></div><div class="form-group"><label class="form-label">Lifetime Budget</label><input id="ce-lifetime-budget" class="form-input" type="number" step="0.01" value="${entity.lifetime_budget ? (entity.lifetime_budget / 100).toFixed(2) : ''}" /></div></div><div class="text-muted" style="font-size:0.78rem;">Use daily or lifetime budget based on campaign setup. Leave the other empty.</div></div>
  <div data-entity-section="schedule" style="display:${campaignDrawerSection === 'schedule' ? 'block' : 'none'};"><div class="form-row"><div class="form-group"><label class="form-label">Start Time</label><input id="ce-start-time" class="form-input" type="datetime-local" value="${campaignEditorUtils.toLocalDateTime(entity.start_time)}" /></div><div class="form-group"><label class="form-label">Stop Time</label><input id="ce-stop-time" class="form-input" type="datetime-local" value="${campaignEditorUtils.toLocalDateTime(entity.stop_time)}" /></div></div><pre style="background:var(--bg-elevated); padding:10px; border-radius:8px; font-size:0.72rem; white-space:pre-wrap;">${escapeHtml(JSON.stringify({ objective: entity.objective, smart_promotion_type: entity.smart_promotion_type }, null, 2))}</pre></div>
  <div style="display:flex; gap:8px; margin-top:18px; position:sticky; bottom:0; background:var(--bg-panel); padding-top:12px; flex-wrap:wrap;"><button class="btn btn-primary" data-campaign-drawer-action="publish" data-campaign-id="${entity.id}">Publish</button><button class="btn" data-campaign-drawer-action="duplicate" data-campaign-id="${entity.id}">Duplicate</button><button class="btn" data-campaign-drawer-action="revert">Revert</button><button class="btn" data-campaign-drawer-action="close">Close</button></div>`); }
function switchCampaignDrawerSection(section) { campaignDrawerSection = section; document.querySelectorAll('[data-entity-section]').forEach(el => { el.style.display = el.getAttribute('data-entity-section') === section ? 'block' : 'none'; }); document.querySelectorAll('.entity-section-tab').forEach(el => el.classList.toggle('active', el.dataset.section === section)); }
async function saveCampaignEditor(campaignId) { const payload = { accountId: ACCOUNT_ID, name: document.getElementById('ce-name').value, status: document.getElementById('ce-status').value, buying_type: document.getElementById('ce-buying-type').value, objective: document.getElementById('ce-objective').value, special_ad_categories: Array.from(document.querySelectorAll('.ce-cat:checked')).map(c => c.value), daily_budget: campaignEditorUtils.blankToUndefined(document.getElementById('ce-daily-budget').value), lifetime_budget: campaignEditorUtils.blankToUndefined(document.getElementById('ce-lifetime-budget').value), start_time: campaignEditorUtils.localDateTimeToIso(document.getElementById('ce-start-time').value), stop_time: campaignEditorUtils.localDateTimeToIso(document.getElementById('ce-stop-time').value), internal_tags: campaignEditorUtils.tagsToArray(document.getElementById('ce-tags').value) }; try { await apiPost(`/meta/entity/campaign/${campaignId}/update`, payload); toast('Campaign updated', 'success'); closeDrawer(); navigateTo('campaigns'); } catch (err) { toast(`Error: ${safeErrorMessage(err)}`, 'error'); } }
async function campaignStatusAction(campaignId, status) { try { await apiPost(`/meta/entity/campaign/${campaignId}/status`, { accountId: ACCOUNT_ID, status }); toast(`Campaign ${status === 'ACTIVE' ? 'resumed' : status.toLowerCase()}`, 'success'); navigateTo('campaigns'); } catch (err) { toast(`Error: ${safeErrorMessage(err)}`, 'error'); } }
async function campaignDuplicate(campaignId) { try { await apiPost(`/meta/entity/campaign/${campaignId}/duplicate`, { accountId: ACCOUNT_ID }); toast('Campaign duplicated', 'success'); closeDrawer(); navigateTo('campaigns'); } catch (err) { toast(`Error: ${safeErrorMessage(err)}`, 'error'); } }
function entitySectionNav(prefix, active, sections) { return `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">${sections.map(s => `<button class="btn btn-sm entity-section-tab ${active === s ? 'btn-primary' : ''}" data-section="${s}" data-entity-kind="${prefix}" data-entity-tab="${s}">${capitalizeFirst(s)}</button>`).join('')}</div>`; }
function capitalizeFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function bindCampaignDrawerActions() {
  if (campaignDrawerBound) return;
  campaignDrawerBound = true;
  document.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-entity-kind="campaign"][data-entity-tab]');
    if (tab) return switchCampaignDrawerSection(tab.dataset.entityTab);
    const action = event.target.closest('[data-campaign-drawer-action]');
    if (!action) return;
    if (action.dataset.campaignDrawerAction === 'create-submit') return submitCreateCampaign();
    if (action.dataset.campaignDrawerAction === 'publish') return saveCampaignEditor(action.dataset.campaignId);
    if (action.dataset.campaignDrawerAction === 'duplicate') return campaignDuplicate(action.dataset.campaignId);
    if (action.dataset.campaignDrawerAction === 'revert' && currentCampaignEditorEntity) return renderCampaignEditor(currentCampaignEditorEntity);
    if (action.dataset.campaignDrawerAction === 'close') return closeDrawer();
  });
}
function bindCampaignControls(container) {
  if (container.__campaignControlsBound) return;
  container.__campaignControlsBound = true;
  bindCampaignDrawerActions();
  rowActions.bind(container, {
    change: [
      { selector: '.camp-check', closest: false, handle: () => updateCampSelection() },
      { selector: '[data-campaign-toggle-all]', closest: false, handle: (event, match) => toggleAllCampaigns(match, JSON.parse(match.dataset.campaignToggleAll || '[]')) },
    ],
    click: [
      { selector: '[data-campaign-open]', handle: (event, match) => { event.preventDefault(); navigateTo('adsets', { metaCampaignId: match.dataset.campaignOpen, campaignName: match.dataset.campaignName || '' }); } },
      { selector: '[data-campaign-edit]', handle: (event, match) => openCampaignEditor(match.dataset.campaignEdit) },
      { selector: '[data-campaign-duplicate]', handle: (event, match) => campaignDuplicate(match.dataset.campaignDuplicate) },
      { selector: '[data-campaign-status]', handle: (event, match) => campaignStatusAction(match.dataset.campaignStatus, match.dataset.campaignNextStatus) },
    ],
  });
  container.querySelectorAll('[data-campaign-preset]').forEach((el) => {
    el.addEventListener('click', () => setCampPreset(el.dataset.campaignPreset));
  });
  container.querySelectorAll('[data-campaign-action]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.campaignAction === 'create') return openCreateCampaign();
      if (el.dataset.campaignAction === 'apply-date') return applyCampDate();
    });
  });
  container.querySelectorAll('[data-campaign-bulk]').forEach((el) => {
    el.addEventListener('click', () => {
      if (el.dataset.campaignBulk === 'clear') return clearSelection();
      return bulkAction(el.dataset.campaignBulk);
    });
  });
}

function setCampPreset(preset) {
  campaignFilterState.setPreset(preset);
  if (preset === 'custom') {
    const picker = document.getElementById('camp-date-picker');
    if (picker) picker.style.display = 'flex';
    return;
  }
  navigateTo('campaigns');
}
function applyCampDate() {
  const campDateFrom = document.getElementById('camp-date-from').value;
  const campDateTo = document.getElementById('camp-date-to').value;
  if (!campDateFrom || !campDateTo) { toast('Select both dates', 'error'); return; }
  campaignFilterState.setCustom(campDateFrom, campDateTo);
  navigateTo('campaigns');
}
