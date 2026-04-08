/* ═══════════════════════════════════════════════════════════
   Campaigns Page — responsive editor driven
   ═══════════════════════════════════════════════════════════ */

let campDateFrom = daysAgoStr(1);
let campDateTo = daysAgoStr(1);
let campPreset = 'yesterday';
let selectedCampaigns = new Set();
let campaignDrawerSection = 'identity';

async function loadCampaigns(container) {
  selectedCampaigns.clear();
  const isMobile = window.innerWidth <= 768;

  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap: wrap; gap: 10px;">
      <button class="btn btn-primary" onclick="openCreateCampaign()">+ New Campaign</button>
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width:${isMobile ? '100%' : 'auto'};">
        <div class="date-selector" style="${isMobile ? 'width:100%; overflow:auto; white-space:nowrap;' : ''}">
          <button class="date-btn ${campPreset === 'today' ? 'active' : ''}" onclick="setCampPreset('today')">Today</button>
          <button class="date-btn ${campPreset === 'yesterday' ? 'active' : ''}" onclick="setCampPreset('yesterday')">Yesterday</button>
          <button class="date-btn ${campPreset === '7d' ? 'active' : ''}" onclick="setCampPreset('7d')">7d</button>
          <button class="date-btn ${campPreset === '30d' ? 'active' : ''}" onclick="setCampPreset('30d')">30d</button>
          <button class="date-btn ${campPreset === 'custom' ? 'active' : ''}" onclick="toggleCampDatePicker()">Custom</button>
        </div>
        <div id="camp-date-picker" style="display: ${campPreset === 'custom' ? 'flex' : 'none'}; align-items: center; gap: 6px; flex-wrap:wrap; width:${isMobile ? '100%' : 'auto'};">
          <input type="date" id="camp-date-from" class="form-input" style="width: ${isMobile ? 'calc(50% - 20px)' : '140px'}; padding: 6px 10px; font-size: 0.78rem;" value="${campDateFrom}" />
          <span class="text-muted">→</span>
          <input type="date" id="camp-date-to" class="form-input" style="width: ${isMobile ? 'calc(50% - 20px)' : '140px'}; padding: 6px 10px; font-size: 0.78rem;" value="${campDateTo}" />
          <button class="btn btn-sm btn-primary" onclick="applyCampDate()">Apply</button>
        </div>
      </div>
    </div>

    <div id="campaign-pulse-inline" class="mb-md"><div class="loading">Loading live request usage...</div></div>

    <div id="bulk-bar" style="display:none; padding: 10px 16px; background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--radius); margin-bottom: 14px; align-items: center; gap: 12px; flex-wrap:wrap;">
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
    const [liveRes, listRes, usageRes] = await Promise.all([
      apiGet(`/meta/live?level=campaign&since=${campDateFrom}&until=${campDateTo}`),
      apiGet('/meta/campaigns'),
      apiGet('/meta/rate-limit-status'),
    ]);
    renderCampaignUsageInline(usageRes);

    const insights = liveRes.data || [];
    const entities = listRes.data || [];
    const entityMap = Object.fromEntries(entities.map(c => [c.id, c]));

    if (insights.length === 0 && entities.length === 0) {
      document.getElementById('campaigns-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No campaigns found</div></div>';
      return;
    }

    const rows = (insights.length ? insights : entities.map(c => ({ campaign_id: c.id, campaign_name: c.name }))).map(c => ({ ...c, meta: entityMap[c.campaign_id] || null }));
    document.getElementById('campaigns-table').innerHTML = isMobile ? renderCampaignCards(rows) : renderCampaignDesktopTable(rows);
  } catch (err) {
    document.getElementById('campaigns-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
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
        <div><div class="kpi-label">Reset</div><div>${formatSeconds(rateRes.estimated_regain_seconds || 0)}</div></div>
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
            <th style="width: 36px;"><input type="checkbox" onchange="toggleAllCampaigns(this, ${JSON.stringify(rows.map(c => c.campaign_id)).replace(/"/g, '&quot;')})" /></th>
            <th>Campaign</th><th>Status</th><th class="right">Spend</th><th class="right">Results</th><th class="right">Cost/Result</th><th class="right">Budget</th><th class="right">Objective</th><th class="right">CTR</th><th class="right">CPC</th><th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows.map(renderCampaignRow).join('')}</tbody>
      </table>
    </div>`;
}

function renderCampaignRow(c) {
  const result = parseResults(c.actions);
  const cpr = parseCostPerResult(c.cost_per_action_type, result.type);
  const spend = parseFloat(c.spend) || 0;
  const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);
  const status = c.meta?.effective_status || c.meta?.status || '—';
  const budget = c.meta?.daily_budget ? fmtBudget(c.meta.daily_budget) : c.meta?.lifetime_budget ? fmtBudget(c.meta.lifetime_budget) + ' LT' : '—';
  return `<tr>
    <td><input type="checkbox" class="camp-check" value="${c.campaign_id}" onchange="updateCampSelection()" /></td>
    <td class="name-cell"><a href="#" onclick="navigateTo('adsets', {metaCampaignId: '${c.campaign_id}', campaignName: '${(c.campaign_name || '').replace(/'/g, "\\'")}'}); return false;">${c.campaign_name}</a></td>
    <td>${statusBadge(status)}</td>
    <td class="right">${spend > 0 ? fmt(spend,'currency') : '—'}</td>
    <td class="right" style="font-weight:600;">${result.count > 0 ? result.count : '—'}</td>
    <td class="right">${costPerResult > 0 ? fmt(costPerResult,'currency') : '—'}</td>
    <td class="right">${budget}</td>
    <td class="right">${c.meta?.objective ? c.meta.objective.replace(/_/g,' ') : '—'}</td>
    <td class="right">${c.ctr ? fmt(c.ctr,'percent') : '—'}</td>
    <td class="right">${c.cpc ? fmt(c.cpc,'currency') : '—'}</td>
    <td><div class="btn-group"><button class="btn btn-sm btn-primary" onclick="openCampaignEditor('${c.campaign_id}')">Edit</button><button class="btn btn-sm" onclick="campaignStatusAction('${c.campaign_id}','${status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}')">${status === 'ACTIVE' ? 'Pause' : 'Resume'}</button><button class="btn btn-sm" onclick="campaignDuplicate('${c.campaign_id}')">Dup</button></div></td>
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
        <input type="checkbox" class="camp-check" value="${c.campaign_id}" onchange="updateCampSelection()" style="margin-top:4px;" />
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:0.86rem; line-height:1.4; margin-bottom:6px;">${c.campaign_name}</div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">${statusBadge(status)}${c.meta?.objective ? `<span class="badge badge-low">${c.meta.objective.replace(/_/g,' ')}</span>` : ''}</div>
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
        <button class="btn btn-sm btn-primary" onclick="openCampaignEditor('${c.campaign_id}')">Edit</button>
        <button class="btn btn-sm" onclick="campaignStatusAction('${c.campaign_id}','${status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}')">${status === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
        <button class="btn btn-sm" onclick="campaignDuplicate('${c.campaign_id}')">Duplicate</button>
        <button class="btn btn-sm" onclick="navigateTo('adsets', {metaCampaignId: '${c.campaign_id}', campaignName: '${(c.campaign_name || '').replace(/'/g, "\\'")}'});">Open</button>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function toggleAllCampaigns(checkbox, ids) { document.querySelectorAll('.camp-check').forEach(c => { c.checked = checkbox.checked; }); selectedCampaigns = checkbox.checked ? new Set(ids) : new Set(); updateBulkBar(); }
function updateCampSelection() { selectedCampaigns.clear(); document.querySelectorAll('.camp-check:checked').forEach(c => selectedCampaigns.add(c.value)); updateBulkBar(); }
function updateBulkBar() { const bar = document.getElementById('bulk-bar'); const count = document.getElementById('bulk-count'); if (selectedCampaigns.size > 0) { bar.style.display = 'flex'; count.textContent = `${selectedCampaigns.size} selected`; } else { bar.style.display = 'none'; } }
function clearSelection() { selectedCampaigns.clear(); document.querySelectorAll('.camp-check').forEach(c => { c.checked = false; }); updateBulkBar(); }
async function bulkAction(action) { if (!selectedCampaigns.size) return; const targetStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE'; if (!confirmAction(`${action === 'pause' ? 'Pause' : 'Resume'} ${selectedCampaigns.size} campaign(s)?`)) return; try { for (const id of selectedCampaigns) await apiPost(`/meta/entity/campaign/${id}/status`, { accountId: ACCOUNT_ID, status: targetStatus }); toast(`Updated ${selectedCampaigns.size} campaign(s)`, 'success'); navigateTo('campaigns'); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
async function openCampaignEditor(campaignId) { campaignDrawerSection = 'identity'; openDrawer('Edit Campaign', '<div class="loading">Loading campaign…</div>'); try { const res = await apiGet(`/meta/entity/campaign/${campaignId}`); renderCampaignEditor(res.data); } catch (err) { setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`); } }
function renderCampaignEditor(entity) { const s = entity.special_ad_categories || []; setDrawerBody(`
  ${entitySectionNav('campaign', campaignDrawerSection, ['identity','budget','schedule'])}
  <div data-entity-section="identity" style="display:${campaignDrawerSection === 'identity' ? 'block' : 'none'};"><div class="form-group"><label class="form-label">Name</label><input id="ce-name" class="form-input" value="${escapeHtml(entity.name || '')}" /></div><div class="form-row"><div class="form-group"><label class="form-label">Status</label><select id="ce-status" class="form-select">${['ACTIVE','PAUSED','ARCHIVED'].map(v => `<option value="${v}" ${entity.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Buying Type</label><select id="ce-buying-type" class="form-select">${['AUCTION','RESERVED'].map(v => `<option value="${v}" ${entity.buying_type === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></div><div class="form-group"><label class="form-label">Objective</label><select id="ce-objective" class="form-select">${['OUTCOME_SALES','OUTCOME_LEADS','OUTCOME_TRAFFIC','OUTCOME_ENGAGEMENT','OUTCOME_AWARENESS','OUTCOME_APP_PROMOTION'].map(v => `<option value="${v}" ${entity.objective === v ? 'selected' : ''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Special Ad Categories</label><div style="display:flex; flex-wrap:wrap; gap:8px;">${['CREDIT','EMPLOYMENT','HOUSING','SOCIAL_ISSUES_ELECTIONS_POLITICS'].map(v => `<label style="display:flex; align-items:center; gap:6px; font-size:0.82rem;"><input type="checkbox" class="ce-cat" value="${v}" ${s.includes(v) ? 'checked' : ''}/> ${v.replace(/_/g,' ')}</label>`).join('')}</div></div><div class="form-group"><label class="form-label">Internal Tags</label><input id="ce-tags" class="form-input" placeholder="launch, cbo, test" /></div></div>
  <div data-entity-section="budget" style="display:${campaignDrawerSection === 'budget' ? 'block' : 'none'};"><div class="form-row"><div class="form-group"><label class="form-label">Daily Budget</label><input id="ce-daily-budget" class="form-input" type="number" step="0.01" value="${entity.daily_budget ? (entity.daily_budget / 100).toFixed(2) : ''}" /></div><div class="form-group"><label class="form-label">Lifetime Budget</label><input id="ce-lifetime-budget" class="form-input" type="number" step="0.01" value="${entity.lifetime_budget ? (entity.lifetime_budget / 100).toFixed(2) : ''}" /></div></div><div class="text-muted" style="font-size:0.78rem;">Use daily or lifetime budget based on campaign setup. Leave the other empty.</div></div>
  <div data-entity-section="schedule" style="display:${campaignDrawerSection === 'schedule' ? 'block' : 'none'};"><div class="form-row"><div class="form-group"><label class="form-label">Start Time</label><input id="ce-start-time" class="form-input" type="datetime-local" value="${toLocalDateTime(entity.start_time)}" /></div><div class="form-group"><label class="form-label">Stop Time</label><input id="ce-stop-time" class="form-input" type="datetime-local" value="${toLocalDateTime(entity.stop_time)}" /></div></div><pre style="background:var(--bg-elevated); padding:10px; border-radius:8px; font-size:0.72rem; white-space:pre-wrap;">${escapeHtml(JSON.stringify({ objective: entity.objective, smart_promotion_type: entity.smart_promotion_type }, null, 2))}</pre></div>
  <div style="display:flex; gap:8px; margin-top:18px; position:sticky; bottom:0; background:var(--bg-panel); padding-top:12px; flex-wrap:wrap;"><button class="btn btn-primary" onclick="saveCampaignEditor('${entity.id}')">Publish</button><button class="btn" onclick="campaignDuplicate('${entity.id}')">Duplicate</button><button class="btn" onclick="renderCampaignEditor(${safeJson(entity)})">Revert</button><button class="btn" onclick="closeDrawer()">Close</button></div>`); }
function switchCampaignDrawerSection(section) { campaignDrawerSection = section; document.querySelectorAll('[data-entity-section]').forEach(el => { el.style.display = el.getAttribute('data-entity-section') === section ? 'block' : 'none'; }); document.querySelectorAll('.entity-section-tab').forEach(el => el.classList.toggle('active', el.dataset.section === section)); }
async function saveCampaignEditor(campaignId) { const payload = { accountId: ACCOUNT_ID, name: document.getElementById('ce-name').value, status: document.getElementById('ce-status').value, buying_type: document.getElementById('ce-buying-type').value, objective: document.getElementById('ce-objective').value, special_ad_categories: Array.from(document.querySelectorAll('.ce-cat:checked')).map(c => c.value), daily_budget: blankToUndefined(document.getElementById('ce-daily-budget').value), lifetime_budget: blankToUndefined(document.getElementById('ce-lifetime-budget').value), start_time: localDateTimeToIso(document.getElementById('ce-start-time').value), stop_time: localDateTimeToIso(document.getElementById('ce-stop-time').value), internal_tags: tagsToArray(document.getElementById('ce-tags').value) }; try { await apiPost(`/meta/entity/campaign/${campaignId}/update`, payload); toast('Campaign updated', 'success'); closeDrawer(); navigateTo('campaigns'); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
async function campaignStatusAction(campaignId, status) { try { await apiPost(`/meta/entity/campaign/${campaignId}/status`, { accountId: ACCOUNT_ID, status }); toast(`Campaign ${status === 'ACTIVE' ? 'resumed' : status.toLowerCase()}`, 'success'); navigateTo('campaigns'); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
async function campaignDuplicate(campaignId) { try { await apiPost(`/meta/entity/campaign/${campaignId}/duplicate`, { accountId: ACCOUNT_ID }); toast('Campaign duplicated', 'success'); closeDrawer(); navigateTo('campaigns'); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
function entitySectionNav(prefix, active, sections) { return `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">${sections.map(s => `<button class="btn btn-sm entity-section-tab ${active === s ? 'btn-primary' : ''}" data-section="${s}" onclick="switch${prefix === 'campaign' ? 'Campaign' : 'Adset'}DrawerSection('${s}')">${capitalizeFirst(s)}</button>`).join('')}</div>`; }
function capitalizeFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function safeJson(obj) { return JSON.stringify(obj).replace(/</g, '\\u003c'); }
function blankToUndefined(v) { return v === '' ? undefined : parseFloat(v); }
function tagsToArray(v) { return (v || '').split(',').map(s => s.trim()).filter(Boolean); }
function toLocalDateTime(iso) { if (!iso) return ''; const d = new Date(iso); const pad = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function localDateTimeToIso(v) { return v ? new Date(v).toISOString() : null; }
function setCampPreset(preset) { campPreset = preset; switch (preset) { case 'today': campDateFrom = todayStr(); campDateTo = todayStr(); break; case 'yesterday': campDateFrom = daysAgoStr(1); campDateTo = daysAgoStr(1); break; case '7d': campDateFrom = daysAgoStr(7); campDateTo = daysAgoStr(1); break; case '30d': campDateFrom = daysAgoStr(30); campDateTo = daysAgoStr(1); break; case 'custom': toggleCampDatePicker(); return; } navigateTo('campaigns'); }
function toggleCampDatePicker() { campPreset = 'custom'; const picker = document.getElementById('camp-date-picker'); if (picker) picker.style.display = 'flex'; }
function applyCampDate() { campDateFrom = document.getElementById('camp-date-from').value; campDateTo = document.getElementById('camp-date-to').value; if (!campDateFrom || !campDateTo) { toast('Select both dates', 'error'); return; } campPreset = 'custom'; navigateTo('campaigns'); }
