/* ═══════════════════════════════════════════════════════════
   Ad Sets Page — bulk + create + targeting + placements
   ═══════════════════════════════════════════════════════════ */

let selectedAdSets = new Set();

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
    const adsets = (res.data || []).filter(a => ['ACTIVE', 'PAUSED', 'PENDING_REVIEW'].includes(a.effective_status));

    let insightsMap = {};
    try {
      const insRes = await apiGet(`/meta/live?level=adset&since=${campDateFrom || daysAgoStr(1)}&until=${campDateTo || daysAgoStr(1)}`);
      for (const row of (insRes.data || [])) { if (row.adset_id) insightsMap[row.adset_id] = row; }
    } catch (e) {}

    if (adsets.length === 0) {
      document.getElementById('adsets-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No ad sets found</div></div>';
      return;
    }

    document.getElementById('adsets-table').innerHTML = `
      <div style="overflow-x: auto;"><table><thead><tr>
        <th style="width:36px;"><input type="checkbox" onchange="toggleAllAdSets(this, ${JSON.stringify(adsets.map(a => a.id)).replace(/"/g, '&quot;')})" /></th>
        <th>Ad Set</th><th>Status</th><th class="right">Budget</th><th class="right">Spend</th>
        <th class="right">Results</th><th class="right">Cost/Result</th><th class="right">CPM</th>
        <th class="right">CTR</th><th class="right">Freq.</th><th>Actions</th>
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
            <td>${statusBadge(a.effective_status)}</td>
            <td class="right">${a.daily_budget ? '$'+(a.daily_budget/100).toFixed(2) : '—'}</td>
            <td class="right">${spend > 0 ? fmt(spend,'currency') : '—'}</td>
            <td class="right" style="font-weight:600;">${result.count > 0 ? result.count : '—'}</td>
            <td class="right">${costPerResult > 0 ? fmt(costPerResult,'currency') : '—'}</td>
            <td class="right">${ins.cpm ? fmt(ins.cpm,'currency') : '—'}</td>
            <td class="right">${ins.ctr ? fmt(ins.ctr,'percent') : '—'}</td>
            <td class="right">${ins.frequency ? fmt(ins.frequency,'decimal') : '—'}</td>
            <td><div class="btn-group">
              <button class="btn btn-sm btn-primary" onclick="openAdSetDrawer('${a.id}','${(a.name||'').replace(/'/g,"\\'")}')">Details</button>
              ${a.effective_status==='ACTIVE'
                ? `<button class="btn btn-sm btn-danger" onclick="pauseAdSet('${a.id}','${(a.name||'').replace(/'/g,"\\'")}')">Pause</button>`
                : `<button class="btn btn-sm" onclick="resumeAdSet('${a.id}','${(a.name||'').replace(/'/g,"\\'")}')">Resume</button>`}
            </div></td>
          </tr>`;
        }).join('')}
      </tbody></table></div>
    `;
  } catch (err) {
    document.getElementById('adsets-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

// ─── BULK SELECTION ───────────────────────────────────────

function toggleAllAdSets(cb, ids) {
  document.querySelectorAll('.adset-check').forEach(c => { c.checked = cb.checked; });
  selectedAdSets = cb.checked ? new Set(ids) : new Set();
  updateAdSetBulkBar();
}
function updateAdSetSelection() {
  selectedAdSets.clear();
  document.querySelectorAll('.adset-check:checked').forEach(c => selectedAdSets.add(c.value));
  updateAdSetBulkBar();
}
function clearAdSetSelection() {
  selectedAdSets.clear();
  document.querySelectorAll('.adset-check').forEach(c => { c.checked = false; });
  updateAdSetBulkBar();
}
function updateAdSetBulkBar() {
  const bar = document.getElementById('adset-bulk-bar');
  const count = document.getElementById('adset-bulk-count');
  if (selectedAdSets.size > 0) { bar.style.display = 'flex'; count.textContent = `${selectedAdSets.size} selected`; }
  else { bar.style.display = 'none'; }
}
async function bulkAdSetAction(action) {
  if (selectedAdSets.size === 0) return;
  if (!confirmAction(`${action === 'pause' ? 'Pause' : 'Resume'} ${selectedAdSets.size} ad set(s)?`)) return;
  try {
    toast(`Processing...`, 'info');
    const res = await apiPost('/create/bulk-action', { entityIds: Array.from(selectedAdSets), entityType: 'adset', action });
    toast(res.message, 'success');
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

// ─── CREATE AD SET DRAWER ─────────────────────────────────

async function openCreateAdSet(campaignId) {
  openDrawer('Create Ad Set', '<div class="loading">Loading pixels...</div>');

  // Fetch pixels
  let pixels = [];
  try {
    const pixRes = await apiGet('/create/pixels');
    pixels = pixRes.data || [];
  } catch (e) {}

  setDrawerBody(`
    <div class="form-group">
      <label class="form-label">Ad Set Name</label>
      <input id="cas-name" class="form-input" type="text" placeholder="e.g. Maritimes Sign up (ENG)" />
    </div>

    <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin: 16px 0 10px; text-transform:uppercase; letter-spacing:0.06em;">Conversion</div>

    <div class="form-group">
      <label class="form-label">Pixel / Dataset</label>
      <select id="cas-pixel" class="form-select">
        <option value="">Select pixel</option>
        ${pixels.map(p => `<option value="${p.id}">${p.name} (${p.id})</option>`).join('')}
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Conversion Event</label>
      <select id="cas-event" class="form-select">
        <option value="INITIATE_CHECKOUT">Initiate Checkout</option>
        <option value="PURCHASE">Purchase</option>
        <option value="LEAD">Lead</option>
        <option value="COMPLETE_REGISTRATION">Complete Registration</option>
        <option value="ADD_TO_CART">Add to Cart</option>
        <option value="SEARCH">Search</option>
        <option value="VIEW_CONTENT">View Content</option>
      </select>
    </div>

    <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin: 16px 0 10px; text-transform:uppercase; letter-spacing:0.06em;">Budget & Bidding</div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Daily Budget (CAD)</label>
        <input id="cas-budget" class="form-input" type="number" step="0.01" placeholder="e.g. 50.00" />
      </div>
      <div class="form-group">
        <label class="form-label">Bid Strategy</label>
        <select id="cas-bid" class="form-select">
          <option value="LOWEST_COST_WITHOUT_CAP">Lowest Cost</option>
          <option value="COST_CAP">Cost Cap</option>
          <option value="LOWEST_COST_WITH_BID_CAP">Bid Cap</option>
        </select>
      </div>
    </div>

    <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin: 16px 0 10px; text-transform:uppercase; letter-spacing:0.06em;">Targeting</div>

    <div class="form-group">
      <label class="form-label">Include Locations (country codes, comma-separated)</label>
      <input id="cas-geo" class="form-input" type="text" placeholder="e.g. CA" value="CA" />
      <div class="text-muted" style="font-size:0.7rem; margin-top:4px;">Use 2-letter country codes. For regions: CA:QC, CA:AB, CA:ON etc.</div>
    </div>

    <div class="form-group">
      <label class="form-label">Exclude Locations (optional)</label>
      <input id="cas-geo-exclude" class="form-input" type="text" placeholder="e.g. CA:ON" />
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Age Min</label>
        <input id="cas-age-min" class="form-input" type="number" min="18" max="65" value="21" />
      </div>
      <div class="form-group">
        <label class="form-label">Age Max</label>
        <input id="cas-age-max" class="form-input" type="number" min="18" max="65" value="65" />
      </div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Gender</label>
        <select id="cas-gender" class="form-select">
          <option value="all">All</option>
          <option value="1">Male</option>
          <option value="2">Female</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Languages</label>
        <input id="cas-locales" class="form-input" type="text" placeholder="e.g. 6 (English), 1001 (French)" />
        <div class="text-muted" style="font-size:0.7rem; margin-top:4px;">6=English, 1001=French. Comma-separated locale IDs.</div>
      </div>
    </div>

    <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin: 16px 0 10px; text-transform:uppercase; letter-spacing:0.06em;">Placements</div>

    <div class="form-group">
      <label class="form-label">Platforms</label>
      <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-platform" value="facebook" checked /> Facebook</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-platform" value="instagram" checked /> Instagram</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-platform" value="messenger" /> Messenger</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-platform" value="audience_network" /> Audience Network</label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Facebook Positions</label>
      <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-fb-pos" value="feed" checked /> Feed</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-fb-pos" value="story" checked /> Stories</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-fb-pos" value="reels" /> Reels</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-fb-pos" value="marketplace" /> Marketplace</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-fb-pos" value="right_hand_column" /> Right Column</label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Instagram Positions</label>
      <div style="display: flex; flex-wrap: wrap; gap: 10px;">
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-ig-pos" value="stream" checked /> Feed</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-ig-pos" value="story" checked /> Stories</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-ig-pos" value="reels" /> Reels</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-ig-pos" value="explore" /> Explore</label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Devices</label>
      <div style="display: flex; gap: 10px;">
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-device" value="mobile" checked /> Mobile</label>
        <label style="display:flex; align-items:center; gap:5px; font-size:0.82rem; cursor:pointer;"><input type="checkbox" class="cas-device" value="desktop" checked /> Desktop</label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Initial Status</label>
      <select id="cas-status" class="form-select">
        <option value="PAUSED">Paused</option>
        <option value="ACTIVE">Active</option>
      </select>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 20px;">
      <button class="btn btn-primary" onclick="submitCreateAdSet('${campaignId}')">Create Ad Set</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>
  `);
}

function parseGeoInput(input) {
  if (!input || !input.trim()) return null;
  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  const countries = [];
  const regions = [];
  for (const p of parts) {
    if (p.includes(':')) {
      const [country, region] = p.split(':');
      regions.push({ key: `${country}-${region}` });
    } else {
      countries.push(p.toUpperCase());
    }
  }
  const result = {};
  if (countries.length) result.countries = countries;
  if (regions.length) result.regions = regions;
  return Object.keys(result).length > 0 ? result : null;
}

async function submitCreateAdSet(campaignId) {
  const name = document.getElementById('cas-name').value;
  if (!name) { toast('Name required', 'error'); return; }

  const payload = {
    name,
    campaignId,
    status: document.getElementById('cas-status').value,
    dailyBudget: parseFloat(document.getElementById('cas-budget').value) || undefined,
    bidStrategy: document.getElementById('cas-bid').value,
    pixelId: document.getElementById('cas-pixel').value || undefined,
    customEventType: document.getElementById('cas-event').value,
    optimizationGoal: 'OFFSITE_CONVERSIONS',
    billingEvent: 'IMPRESSIONS',
    ageMin: parseInt(document.getElementById('cas-age-min').value) || 21,
    ageMax: parseInt(document.getElementById('cas-age-max').value) || 65,
    genders: document.getElementById('cas-gender').value === 'all' ? [] : [parseInt(document.getElementById('cas-gender').value)],
    geoLocations: parseGeoInput(document.getElementById('cas-geo').value),
    excludedGeoLocations: parseGeoInput(document.getElementById('cas-geo-exclude').value),
    locales: document.getElementById('cas-locales').value ? document.getElementById('cas-locales').value.split(',').map(s => parseInt(s.trim())).filter(Boolean) : [],
    publisherPlatforms: Array.from(document.querySelectorAll('.cas-platform:checked')).map(c => c.value),
    facebookPositions: Array.from(document.querySelectorAll('.cas-fb-pos:checked')).map(c => c.value),
    instagramPositions: Array.from(document.querySelectorAll('.cas-ig-pos:checked')).map(c => c.value),
    devicePlatforms: Array.from(document.querySelectorAll('.cas-device:checked')).map(c => c.value),
  };

  try {
    toast('Creating ad set...', 'info');
    await apiPost('/create/adset', payload);
    toast(`Ad set created: ${name}`, 'success');
    closeDrawer();
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

// ─── DETAILS DRAWER ───────────────────────────────────────

async function openAdSetDrawer(metaAdsetId, name) {
  openDrawer('Ad Set Details', '<div class="loading">Loading...</div>');
  try {
    const res = await apiGet(`/meta/adset-detail?adsetId=${metaAdsetId}`);
    const geo = res.geo_locations || {};
    const countries = (geo.countries || []).join(', ');
    const regions = (geo.regions || []).map(r => r.name || r.key).join(', ');
    const cities = (geo.cities || []).map(c => c.name || c.key).join(', ');
    const geoStr = [countries, regions, cities].filter(Boolean).join(' · ') || 'Not set';
    const genderMap = { 1: 'Male', 2: 'Female' };
    const genders = (res.genders || []).map(g => genderMap[g]).join(', ') || 'All';
    const platforms = res.publisher_platforms || [];
    const isAuto = platforms.length === 0;

    setDrawerBody(`
      <div style="margin-bottom:20px;">
        <div style="font-weight:600; font-size:0.95rem;">${name}</div>
        <div class="text-muted" style="font-size:0.75rem;">ID: ${metaAdsetId}</div>
      </div>

      <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin-bottom:12px; text-transform:uppercase; letter-spacing:0.06em;">Targeting</div>
      <div class="form-group"><div class="form-label">Location</div><div style="font-size:0.85rem;">${geoStr}</div></div>
      <div class="form-row">
        <div class="form-group"><div class="form-label">Age</div><div style="font-size:0.85rem;">${res.age_min || '18'} — ${res.age_max || '65+'}</div></div>
        <div class="form-group"><div class="form-label">Gender</div><div style="font-size:0.85rem;">${genders}</div></div>
      </div>
      ${(res.interests || []).length ? `<div class="form-group"><div class="form-label">Interests</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${res.interests.map(i => `<span class="badge badge-low">${i}</span>`).join('')}</div></div>` : ''}
      ${(res.custom_audiences || []).length ? `<div class="form-group"><div class="form-label">Custom Audiences</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${res.custom_audiences.map(a => `<span class="badge badge-active">${a.name || a.id}</span>`).join('')}</div></div>` : ''}

      <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin:20px 0 12px; text-transform:uppercase; letter-spacing:0.06em;">Placements</div>
      <div class="form-group">
        ${isAuto ? '<span class="badge badge-active">Advantage+ (Automatic)</span>'
          : `<div style="display:flex;flex-wrap:wrap;gap:4px;">${platforms.map(p => `<span class="badge badge-low">${p}</span>`).join('')}</div>
             ${(res.facebook_positions||[]).length ? `<div style="font-size:0.8rem; margin-top:6px;"><span class="text-muted">FB:</span> ${res.facebook_positions.join(', ')}</div>` : ''}
             ${(res.instagram_positions||[]).length ? `<div style="font-size:0.8rem;"><span class="text-muted">IG:</span> ${res.instagram_positions.join(', ')}</div>` : ''}`}
      </div>

      <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin:20px 0 12px; text-transform:uppercase; letter-spacing:0.06em;">Settings</div>
      <div class="form-row">
        <div class="form-group"><div class="form-label">Bid Strategy</div><div style="font-size:0.85rem;">${fmtBidStrategy(res.bid_strategy)}</div></div>
        <div class="form-group"><div class="form-label">Optimization</div><div style="font-size:0.85rem;">${(res.optimization_goal || '').replace(/_/g,' ').toLowerCase()}</div></div>
      </div>
      <div class="form-group"><div class="form-label">Daily Budget</div><div style="font-size:0.85rem;">${res.daily_budget ? '$'+(res.daily_budget/100).toFixed(2) : 'Not set'}</div></div>
    `);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
  }
}

function fmtBidStrategy(s) { return s ? s.replace(/_/g,' ').toLowerCase().replace('without cap','') : '—'; }

async function pauseAdSet(metaId, name) {
  if (!confirmAction(`Pause "${name}"?`)) return;
  try { await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'adset', metaEntityId: metaId }); toast(`Paused: ${name}`, 'success'); navigateTo('adsets', pageState); } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
async function resumeAdSet(metaId, name) {
  if (!confirmAction(`Resume "${name}"?`)) return;
  try { await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'adset', metaEntityId: metaId }); toast(`Resumed: ${name}`, 'success'); navigateTo('adsets', pageState); } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
