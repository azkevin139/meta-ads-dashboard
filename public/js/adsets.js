/* ═══════════════════════════════════════════════════════════
   Ad Sets Page — editor driven
   ═══════════════════════════════════════════════════════════ */

let selectedAdSets = new Set();
let adsetDrawerSection = 'identity';

async function loadAdSets(container) {
  const metaCampaignId = pageState.metaCampaignId || pageState.campaignId;
  const campaignName = pageState.campaignName || 'Campaign';
  selectedAdSets.clear();

  if (!metaCampaignId) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📂</div><div class="empty-state-text">Select a campaign first</div><button class="btn mt-md" onclick="navigateTo(\'campaigns\')">← Go to Campaigns</button></div>';
    return;
  }

  document.getElementById('page-title').textContent = `Ad Sets — ${campaignName}`;

  container.innerHTML = `
    <div class="flex-between mb-md">
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-sm" onclick="navigateTo('campaigns')">← Back</button>
        <button class="btn btn-primary btn-sm" onclick="openCreateAdSet('${metaCampaignId}')">+ New Ad Set</button>
      </div>
    </div>
    <div id="adset-bulk-bar" style="display:none; padding: 10px 16px; background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--radius); margin-bottom: 14px; align-items: center; gap: 12px;">
      <span id="adset-bulk-count" style="font-weight: 600; font-size: 0.85rem;">0 selected</span>
      <button class="btn btn-sm btn-danger" onclick="bulkAdSetAction('pause')">Pause</button>
      <button class="btn btn-sm" onclick="bulkAdSetAction('resume')">Resume</button>
      <button class="btn btn-sm" onclick="clearAdSetSelection()">Clear</button>
    </div>
    <div class="table-container">
      <div class="table-header"><span class="table-title">Ad Sets</span><span class="badge badge-active" style="font-size: 0.7rem;">LIVE</span></div>
      <div id="adsets-table"><div class="loading">Loading ad sets</div></div>
    </div>
  `;

  try {
    const res = await apiGet(`/meta/adsets?campaignId=${metaCampaignId}`);
    const adsets = res.data || [];

    let insightsMap = {};
    try {
      const insRes = await apiGet(`/meta/live?level=adset&since=${campDateFrom || daysAgoStr(1)}&until=${campDateTo || daysAgoStr(1)}`);
      for (const row of (insRes.data || [])) if (row.adset_id) insightsMap[row.adset_id] = row;
    } catch (e) {}

    if (!adsets.length) {
      document.getElementById('adsets-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No ad sets found</div></div>';
      return;
    }

    document.getElementById('adsets-table').innerHTML = `
      <div style="overflow-x: auto;"><table><thead><tr>
        <th style="width:36px;"><input type="checkbox" onchange="toggleAllAdSets(this, ${JSON.stringify(adsets.map(a => a.id)).replace(/"/g, '&quot;')})" /></th>
        <th>Ad Set</th><th>Status</th><th class="right">Budget</th><th class="right">Spend</th>
        <th class="right">Results</th><th class="right">Cost/Result</th><th class="right">Bid</th>
        <th class="right">Optimization</th><th>Actions</th>
      </tr></thead><tbody>
        ${adsets.map(a => {
          const ins = insightsMap[a.id] || {};
          const result = parseResults(ins.actions);
          const cpr = parseCostPerResult(ins.cost_per_action_type, result.type);
          const spend = parseFloat(ins.spend) || 0;
          const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);
          return `<tr>
            <td><input type="checkbox" class="adset-check" value="${a.id}" onchange="updateAdSetSelection()" /></td>
            <td class="name-cell"><a href="#" onclick="navigateTo('ads', {metaAdsetId:'${a.id}', adsetName:'${(a.name||'').replace(/'/g,"\\'")}', metaCampaignId:'${metaCampaignId}', campaignName:'${campaignName.replace(/'/g,"\\'")}'}); return false;">${a.name}</a></td>
            <td>${statusBadge(a.effective_status || a.status)}</td>
            <td class="right">${a.daily_budget ? fmtBudget(a.daily_budget) : a.lifetime_budget ? fmtBudget(a.lifetime_budget) + ' LT' : '—'}</td>
            <td class="right">${spend > 0 ? fmt(spend,'currency') : '—'}</td>
            <td class="right" style="font-weight:600;">${result.count > 0 ? result.count : '—'}</td>
            <td class="right">${costPerResult > 0 ? fmt(costPerResult,'currency') : '—'}</td>
            <td class="right">${a.bid_strategy ? a.bid_strategy.replace(/_/g,' ') : '—'}</td>
            <td class="right">${a.optimization_goal ? a.optimization_goal.replace(/_/g,' ') : '—'}</td>
            <td><div class="btn-group">
              <button class="btn btn-sm btn-primary" onclick="openAdSetEditor('${a.id}')">Edit</button>
              <button class="btn btn-sm" onclick="adsetStatusAction('${a.id}','${(a.effective_status || a.status) === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'}')">${(a.effective_status || a.status) === 'ACTIVE' ? 'Pause' : 'Resume'}</button>
              <button class="btn btn-sm" onclick="adsetDuplicate('${a.id}')">Dup</button>
            </div></td>
          </tr>`;
        }).join('')}
      </tbody></table></div>
    `;
  } catch (err) {
    document.getElementById('adsets-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

function toggleAllAdSets(cb, ids) { document.querySelectorAll('.adset-check').forEach(c => { c.checked = cb.checked; }); selectedAdSets = cb.checked ? new Set(ids) : new Set(); updateAdSetBulkBar(); }
function updateAdSetSelection() { selectedAdSets.clear(); document.querySelectorAll('.adset-check:checked').forEach(c => selectedAdSets.add(c.value)); updateAdSetBulkBar(); }
function clearAdSetSelection() { selectedAdSets.clear(); document.querySelectorAll('.adset-check').forEach(c => { c.checked = false; }); updateAdSetBulkBar(); }
function updateAdSetBulkBar() { const bar = document.getElementById('adset-bulk-bar'); const count = document.getElementById('adset-bulk-count'); if (selectedAdSets.size > 0) { bar.style.display = 'flex'; count.textContent = `${selectedAdSets.size} selected`; } else { bar.style.display = 'none'; } }
async function bulkAdSetAction(action) {
  if (!selectedAdSets.size) return;
  const targetStatus = action === 'pause' ? 'PAUSED' : 'ACTIVE';
  try {
    for (const id of selectedAdSets) await apiPost(`/meta/entity/adset/${id}/status`, { accountId: ACCOUNT_ID, status: targetStatus });
    toast(`Updated ${selectedAdSets.size} ad set(s)`, 'success');
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function openAdSetEditor(adsetId) {
  adsetDrawerSection = 'identity';
  openDrawer('Edit Ad Set', '<div class="loading">Loading ad set…</div>');
  try {
    const [res, pixelsRes] = await Promise.all([
      apiGet(`/meta/entity/adset/${adsetId}`),
      apiGet('/create/pixels').catch(() => ({ data: [] })),
    ]);
    renderAdSetEditor(res.data, pixelsRes.data || []);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
  }
}

function renderAdSetEditor(entity, pixels) {
  const t = entity.targeting || {};
  const po = entity.promoted_object || {};
  setDrawerBody(`
    ${entitySectionNav('adset', adsetDrawerSection, ['identity','budget','schedule','targeting','placements','conversion'])}

    <div data-entity-section="identity" style="display:${adsetDrawerSection === 'identity' ? 'block' : 'none'};">
      <div class="form-group"><label class="form-label">Name</label><input id="ae-name" class="form-input" value="${escapeHtml(entity.name || '')}" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Status</label><select id="ae-status" class="form-select">${['ACTIVE','PAUSED','ARCHIVED'].map(v => `<option value="${v}" ${entity.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Billing Event</label><select id="ae-billing-event" class="form-select">${['IMPRESSIONS','LINK_CLICKS','THRUPLAY'].map(v => `<option value="${v}" ${entity.billing_event === v ? 'selected' : ''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Internal Tags</label><input id="ae-tags" class="form-input" placeholder="retargeting, french, mobile" /></div>
    </div>

    <div data-entity-section="budget" style="display:${adsetDrawerSection === 'budget' ? 'block' : 'none'};">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Daily Budget</label><input id="ae-daily-budget" class="form-input" type="number" step="0.01" value="${entity.daily_budget ? (entity.daily_budget / 100).toFixed(2) : ''}" /></div>
        <div class="form-group"><label class="form-label">Lifetime Budget</label><input id="ae-lifetime-budget" class="form-input" type="number" step="0.01" value="${entity.lifetime_budget ? (entity.lifetime_budget / 100).toFixed(2) : ''}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Bid Strategy</label><select id="ae-bid-strategy" class="form-select">${['LOWEST_COST_WITHOUT_CAP','COST_CAP','LOWEST_COST_WITH_BID_CAP'].map(v => `<option value="${v}" ${entity.bid_strategy === v ? 'selected' : ''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div>
        <div class="form-group"><label class="form-label">Bid / Cost Cap</label><input id="ae-bid-amount" class="form-input" type="number" step="0.01" value="${entity.bid_amount ? (entity.bid_amount / 100).toFixed(2) : ''}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Optimization Goal</label><select id="ae-optimization-goal" class="form-select">${['OFFSITE_CONVERSIONS','LANDING_PAGE_VIEWS','LINK_CLICKS','REACH','IMPRESSIONS'].map(v => `<option value="${v}" ${entity.optimization_goal === v ? 'selected' : ''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div>
    </div>

    <div data-entity-section="schedule" style="display:${adsetDrawerSection === 'schedule' ? 'block' : 'none'};">
      <div class="form-row">
        <div class="form-group"><label class="form-label">Start Time</label><input id="ae-start-time" class="form-input" type="datetime-local" value="${toLocalDateTime(entity.start_time)}" /></div>
        <div class="form-group"><label class="form-label">End Time</label><input id="ae-end-time" class="form-input" type="datetime-local" value="${toLocalDateTime(entity.end_time)}" /></div>
      </div>
      <div class="form-group"><label class="form-label">Attribution (days)</label><select id="ae-attribution" class="form-select">${[1,7].map(v => `<option value="${v}" ${(entity.attribution_spec && entity.attribution_spec[0] && String(entity.attribution_spec[0].event_type || '').includes(`${v}d`)) ? 'selected' : ''}>${v} day click</option>`).join('')}</select></div>
    </div>

    <div data-entity-section="targeting" style="display:${adsetDrawerSection === 'targeting' ? 'block' : 'none'};">
      <div class="form-group"><label class="form-label">Include Countries</label><input id="ae-geo-countries" class="form-input" value="${escapeHtml((t.geo_locations?.countries || []).join(', '))}" placeholder="CA, US" /></div>
      <div class="form-group"><label class="form-label">Exclude Countries</label><input id="ae-geo-excluded" class="form-input" value="${escapeHtml((t.excluded_geo_locations?.countries || []).join(', '))}" placeholder="US" /></div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Age Min</label><input id="ae-age-min" class="form-input" type="number" value="${t.age_min || 18}" /></div>
        <div class="form-group"><label class="form-label">Age Max</label><input id="ae-age-max" class="form-input" type="number" value="${t.age_max || 65}" /></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Gender</label><select id="ae-gender" class="form-select"><option value="all" ${(t.genders || []).length === 0 ? 'selected' : ''}>All</option><option value="1" ${String((t.genders || [])[0]) === '1' ? 'selected' : ''}>Male</option><option value="2" ${String((t.genders || [])[0]) === '2' ? 'selected' : ''}>Female</option></select></div>
        <div class="form-group"><label class="form-label">Locales</label><input id="ae-locales" class="form-input" value="${escapeHtml((t.locales || []).join(', '))}" placeholder="6, 1001" /></div>
      </div>
      <div class="form-group"><label class="form-label">Interests</label><textarea id="ae-interests" class="form-textarea" rows="3" placeholder='[{"id":"6003139266461","name":"Sports betting"}]'>${escapeHtml(JSON.stringify(t.interests || []))}</textarea></div>
      <div class="form-group"><label class="form-label">Custom Audiences IDs</label><input id="ae-custom-audiences" class="form-input" value="${escapeHtml((t.custom_audiences || []).map(a => a.id).join(', '))}" placeholder="123, 456" /></div>
      <div class="form-group"><label class="form-label">Excluded Audience IDs</label><input id="ae-excluded-audiences" class="form-input" value="${escapeHtml((t.excluded_custom_audiences || []).map(a => a.id).join(', '))}" placeholder="789" /></div>
    </div>

    <div data-entity-section="placements" style="display:${adsetDrawerSection === 'placements' ? 'block' : 'none'};">
      <div class="form-group"><label class="form-label">Platforms</label><input id="ae-platforms" class="form-input" value="${escapeHtml((t.publisher_platforms || []).join(', '))}" placeholder="facebook, instagram" /></div>
      <div class="form-group"><label class="form-label">Facebook Positions</label><input id="ae-fb-pos" class="form-input" value="${escapeHtml((t.facebook_positions || []).join(', '))}" placeholder="feed, story" /></div>
      <div class="form-group"><label class="form-label">Instagram Positions</label><input id="ae-ig-pos" class="form-input" value="${escapeHtml((t.instagram_positions || []).join(', '))}" placeholder="stream, story, reels" /></div>
      <div class="form-group"><label class="form-label">Device Platforms</label><input id="ae-device-platforms" class="form-input" value="${escapeHtml((t.device_platforms || []).join(', '))}" placeholder="mobile, desktop" /></div>
      <div class="text-muted" style="font-size:0.78rem;">Leave platforms empty to let Meta use automatic placements / Advantage+ where supported.</div>
    </div>

    <div data-entity-section="conversion" style="display:${adsetDrawerSection === 'conversion' ? 'block' : 'none'};">
      <div class="form-group"><label class="form-label">Pixel / Dataset</label><select id="ae-pixel" class="form-select"><option value="">Select pixel</option>${pixels.map(p => `<option value="${p.id}" ${String(po.pixel_id || '') === String(p.id) ? 'selected' : ''}>${p.name} (${p.id})</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Custom Event Type</label><select id="ae-event" class="form-select">${['INITIATE_CHECKOUT','PURCHASE','LEAD','COMPLETE_REGISTRATION','ADD_TO_CART','SEARCH','VIEW_CONTENT'].map(v => `<option value="${v}" ${po.custom_event_type === v ? 'selected' : ''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div>
    </div>

    <div style="display:flex; gap:8px; margin-top:18px; position:sticky; bottom:0; background:var(--bg-panel); padding-top:12px;">
      <button class="btn btn-primary" onclick="saveAdSetEditor('${entity.id}')">Publish</button>
      <button class="btn" onclick="adsetDuplicate('${entity.id}')">Duplicate</button>
      <button class="btn" onclick="renderAdSetEditor(${safeJson(entity)}, ${safeJson(pixels)})">Revert</button>
      <button class="btn" onclick="closeDrawer()">Close</button>
    </div>
  `);
}

function switchAdsetDrawerSection(section) {
  adsetDrawerSection = section;
  document.querySelectorAll('[data-entity-section]').forEach(el => { el.style.display = el.getAttribute('data-entity-section') === section ? 'block' : 'none'; });
  document.querySelectorAll('.entity-section-tab').forEach(el => el.classList.toggle('active', el.dataset.section === section));
}

async function saveAdSetEditor(adsetId) {
  const genderValue = document.getElementById('ae-gender').value;
  const payload = {
    accountId: ACCOUNT_ID,
    name: document.getElementById('ae-name').value,
    status: document.getElementById('ae-status').value,
    daily_budget: blankToUndefined(document.getElementById('ae-daily-budget').value),
    lifetime_budget: blankToUndefined(document.getElementById('ae-lifetime-budget').value),
    bid_strategy: document.getElementById('ae-bid-strategy').value,
    bid_amount: blankToUndefined(document.getElementById('ae-bid-amount').value),
    optimization_goal: document.getElementById('ae-optimization-goal').value,
    billing_event: document.getElementById('ae-billing-event').value,
    start_time: localDateTimeToIso(document.getElementById('ae-start-time').value),
    end_time: localDateTimeToIso(document.getElementById('ae-end-time').value),
    attribution_spec: [{ event_type: `${document.getElementById('ae-attribution').value}d_click` }],
    promoted_object: {
      pixel_id: document.getElementById('ae-pixel').value || undefined,
      custom_event_type: document.getElementById('ae-event').value,
    },
    targeting: {
      age_min: parseInt(document.getElementById('ae-age-min').value) || 18,
      age_max: parseInt(document.getElementById('ae-age-max').value) || 65,
      genders: genderValue === 'all' ? [] : [parseInt(genderValue)],
      locales: csvNumbers(document.getElementById('ae-locales').value),
      geo_locations: { countries: csvStrings(document.getElementById('ae-geo-countries').value) },
      excluded_geo_locations: { countries: csvStrings(document.getElementById('ae-geo-excluded').value) },
      interests: parseJsonArray(document.getElementById('ae-interests').value),
      custom_audiences: csvStrings(document.getElementById('ae-custom-audiences').value),
      excluded_custom_audiences: csvStrings(document.getElementById('ae-excluded-audiences').value),
      publisher_platforms: csvStrings(document.getElementById('ae-platforms').value),
      facebook_positions: csvStrings(document.getElementById('ae-fb-pos').value),
      instagram_positions: csvStrings(document.getElementById('ae-ig-pos').value),
      device_platforms: csvStrings(document.getElementById('ae-device-platforms').value),
    },
    internal_tags: tagsToArray(document.getElementById('ae-tags').value),
  };
  if (!payload.promoted_object.pixel_id) delete payload.promoted_object.pixel_id;
  try {
    await apiPost(`/meta/entity/adset/${adsetId}/update`, payload);
    toast('Ad set updated', 'success');
    closeDrawer();
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function adsetStatusAction(adsetId, status) {
  try { await apiPost(`/meta/entity/adset/${adsetId}/status`, { accountId: ACCOUNT_ID, status }); toast('Ad set status updated', 'success'); navigateTo('adsets', pageState); } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
async function adsetDuplicate(adsetId) {
  try { await apiPost(`/meta/entity/adset/${adsetId}/duplicate`, { accountId: ACCOUNT_ID }); toast('Ad set duplicated', 'success'); closeDrawer(); navigateTo('adsets', pageState); } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function openCreateAdSet(campaignId) {
  openDrawer('Create Ad Set', '<div class="loading">Loading conversion assets…</div>');
  let pixels = [];
  try {
    const pixelsRes = await apiGet('/create/pixels');
    pixels = pixelsRes.data || [];
  } catch (e) {}

  setDrawerBody(`
    <div class="form-group"><label class="form-label">Name</label><input id="cas-name" class="form-input" placeholder="e.g. CA Sportsbook Checkout - Broad - V1" /></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Daily Budget</label><input id="cas-daily-budget" class="form-input" type="number" step="0.01" placeholder="50.00" /></div>
      <div class="form-group"><label class="form-label">Status</label><select id="cas-status" class="form-select"><option value="PAUSED">Paused</option><option value="ACTIVE">Active</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Optimization Goal</label><select id="cas-optimization" class="form-select">${['OFFSITE_CONVERSIONS','LANDING_PAGE_VIEWS','LINK_CLICKS','REACH','IMPRESSIONS'].map(v => `<option value="${v}">${v.replace(/_/g,' ')}</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Billing Event</label><select id="cas-billing" class="form-select"><option value="IMPRESSIONS">IMPRESSIONS</option><option value="LINK_CLICKS">LINK CLICKS</option></select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Pixel / Dataset</label><select id="cas-pixel" class="form-select"><option value="">No pixel selected</option>${pixels.map(p => `<option value="${p.id}">${escapeHtml(p.name)} (${p.id})</option>`).join('')}</select></div>
      <div class="form-group"><label class="form-label">Conversion Event</label><select id="cas-event" class="form-select">${['INITIATE_CHECKOUT','PURCHASE','LEAD','COMPLETE_REGISTRATION','ADD_TO_CART','VIEW_CONTENT'].map(v => `<option value="${v}">${v.replace(/_/g,' ')}</option>`).join('')}</select></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Countries</label><input id="cas-countries" class="form-input" value="CA" placeholder="CA, US" /></div>
      <div class="form-group"><label class="form-label">Age</label><div style="display:flex; gap:8px;"><input id="cas-age-min" class="form-input" type="number" value="18" /><input id="cas-age-max" class="form-input" type="number" value="65" /></div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">Gender</label><select id="cas-gender" class="form-select"><option value="all">All</option><option value="1">Male</option><option value="2">Female</option></select></div>
      <div class="form-group"><label class="form-label">Placements</label><select id="cas-placement-mode" class="form-select"><option value="auto">Automatic</option><option value="manual">Facebook + Instagram Feeds/Reels/Stories</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">Custom Audience IDs</label><input id="cas-custom-audiences" class="form-input" placeholder="123, 456" /></div>
    <div class="form-group"><label class="form-label">Excluded Audience IDs</label><input id="cas-excluded-audiences" class="form-input" placeholder="789" /></div>
    <div style="display:flex; gap:8px; margin-top:18px;"><button class="btn btn-primary" onclick="submitCreateAdSet('${campaignId}')">Create Ad Set</button><button class="btn" onclick="closeDrawer()">Cancel</button></div>
  `);
}

async function submitCreateAdSet(campaignId) {
  const name = document.getElementById('cas-name').value.trim();
  if (!name) { toast('Ad set name required', 'error'); return; }
  const gender = document.getElementById('cas-gender').value;
  const placementMode = document.getElementById('cas-placement-mode').value;
  const payload = {
    accountId: ACCOUNT_ID,
    campaignId,
    name,
    status: document.getElementById('cas-status').value,
    dailyBudget: blankToUndefined(document.getElementById('cas-daily-budget').value),
    optimizationGoal: document.getElementById('cas-optimization').value,
    billingEvent: document.getElementById('cas-billing').value,
    pixelId: document.getElementById('cas-pixel').value || undefined,
    customEventType: document.getElementById('cas-event').value,
    ageMin: parseInt(document.getElementById('cas-age-min').value, 10) || 18,
    ageMax: parseInt(document.getElementById('cas-age-max').value, 10) || 65,
    genders: gender === 'all' ? [] : [parseInt(gender, 10)],
    geoLocations: { countries: csvStrings(document.getElementById('cas-countries').value) },
    customAudiences: csvStrings(document.getElementById('cas-custom-audiences').value),
    excludedCustomAudiences: csvStrings(document.getElementById('cas-excluded-audiences').value),
  };
  if (placementMode === 'manual') {
    payload.publisherPlatforms = ['facebook', 'instagram'];
    payload.facebookPositions = ['feed', 'facebook_reels', 'story'];
    payload.instagramPositions = ['stream', 'reels', 'story'];
    payload.devicePlatforms = ['mobile'];
  }
  try {
    toast('Creating ad set...', 'info');
    await apiPost('/create/adset', payload);
    toast('Ad set created', 'success');
    closeDrawer();
    navigateTo('adsets', pageState);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

function csvStrings(value) { return (value || '').split(',').map(s => s.trim()).filter(Boolean); }
function csvNumbers(value) { return csvStrings(value).map(v => parseInt(v, 10)).filter(Boolean); }
function parseJsonArray(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch (e) { return []; } }
function blankToUndefined(v) { return v === '' ? undefined : parseFloat(v); }
function tagsToArray(v) { return (v || '').split(',').map(s => s.trim()).filter(Boolean); }
