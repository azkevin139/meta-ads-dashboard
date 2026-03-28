/* ═══════════════════════════════════════════════════════════
   Ad Sets Page — drawer for details + editing
   ═══════════════════════════════════════════════════════════ */

async function loadAdSets(container) {
  const campaignId = pageState.campaignId;
  const campaignName = pageState.campaignName || 'Campaign';

  if (!campaignId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <div class="empty-state-text">Select a campaign first</div>
        <button class="btn mt-md" onclick="navigateTo('campaigns')">← Go to Campaigns</button>
      </div>`;
    return;
  }

  document.getElementById('page-title').textContent = `Ad Sets — ${campaignName}`;

  container.innerHTML = `
    <div class="mb-md">
      <button class="btn btn-sm" onclick="navigateTo('campaigns')">← Back to Campaigns</button>
    </div>
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">Ad Sets</span>
      </div>
      <div id="adsets-table"><div class="loading">Loading ad sets</div></div>
    </div>
  `;

  try {
    const res = await apiGet(`/insights/adsets?campaignId=${campaignId}&days=7`);
    const adsets = res.data || [];

    if (adsets.length === 0) {
      document.getElementById('adsets-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No active ad sets found</div></div>';
      return;
    }

    document.getElementById('adsets-table').innerHTML = `
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Ad Set</th>
              <th>Status</th>
              <th class="right">Budget</th>
              <th class="right">Spend</th>
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
            ${adsets.map(a => `
              <tr>
                <td class="name-cell">
                  <a href="#" onclick="navigateTo('ads', {adsetId: ${a.id}, adsetName: '${a.name.replace(/'/g, "\\'")}', campaignId: ${campaignId}, campaignName: '${campaignName.replace(/'/g, "\\'")}'}); return false;">
                    ${a.name}
                  </a>
                </td>
                <td>${statusBadge(a.effective_status || a.status)}</td>
                <td class="right">${fmtBudget(a.daily_budget)}</td>
                <td class="right">${fmt(a.spend, 'currency')}</td>
                <td class="right ${metricColor(a.ctr, {good: 3, bad: 1.5})}">${fmt(a.ctr, 'percent')}</td>
                <td class="right">${fmt(a.cpm, 'currency')}</td>
                <td class="right">${fmt(a.conversions, 'integer')}</td>
                <td class="right ${metricColor(a.cpa, {good: 15, bad: 25}, true)}">${fmt(a.cpa, 'currency')}</td>
                <td class="right ${metricColor(a.roas, {good: 3, bad: 1.5})}">${fmt(a.roas, 'decimal')}x</td>
                <td class="right ${parseFloat(a.avg_frequency) > 2.5 ? 'text-red' : ''}">${fmt(a.avg_frequency, 'decimal')}</td>
                <td>
                  <div class="btn-group">
                    <button class="btn btn-sm btn-primary" onclick="openAdSetDrawer('${a.meta_adset_id}', '${a.name.replace(/'/g, "\\'")}')">Details</button>
                    ${a.status === 'ACTIVE'
                      ? `<button class="btn btn-sm btn-danger" onclick="pauseAdSet('${a.meta_adset_id}', '${a.name.replace(/'/g, "\\'")}')">Pause</button>`
                      : `<button class="btn btn-sm" onclick="resumeAdSet('${a.meta_adset_id}', '${a.name.replace(/'/g, "\\'")}')">Resume</button>`
                    }
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    document.getElementById('adsets-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

// ─── DRAWER: VIEW + EDIT AD SET ───────────────────────────

async function openAdSetDrawer(metaAdsetId, name) {
  openDrawer(`Ad Set Details`, '<div class="loading">Loading targeting & placement...</div>');

  try {
    const res = await apiGet(`/meta/adset-detail?adsetId=${metaAdsetId}`);

    // Format geo
    const geo = res.geo_locations || {};
    const countries = (geo.countries || []).join(', ');
    const regions = (geo.regions || []).map(r => r.name || r.key).join(', ');
    const cities = (geo.cities || []).map(c => c.name || c.key).join(', ');
    const geoStr = [countries, regions, cities].filter(Boolean).join(' · ') || 'Not set';

    // Format genders
    const genderMap = { 1: 'Male', 2: 'Female' };
    const genders = (res.genders || []).map(g => genderMap[g]).join(', ') || 'All';

    // Placements
    const platforms = res.publisher_platforms || [];
    const isAuto = platforms.length === 0;
    const fbPos = (res.facebook_positions || []).join(', ');
    const igPos = (res.instagram_positions || []).join(', ');

    // Interests
    const interests = res.interests || [];

    // Audiences
    const audiences = res.custom_audiences || [];
    const excluded = res.excluded_custom_audiences || [];

    setDrawerBody(`
      <div style="margin-bottom: 20px;">
        <div style="font-weight: 600; font-size: 0.95rem;">${name}</div>
        <div class="text-muted" style="font-size: 0.75rem; margin-top: 2px;">ID: ${metaAdsetId}</div>
      </div>

      <!-- VIEW MODE -->
      <div id="adset-view-mode">
        <div style="font-weight: 600; font-size: 0.82rem; color: var(--accent); margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.06em;">Targeting</div>

        <div class="form-group">
          <div class="form-label">Location</div>
          <div style="font-size: 0.85rem;">${geoStr}</div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <div class="form-label">Age</div>
            <div style="font-size: 0.85rem;">${res.age_min || '18'} — ${res.age_max || '65+'}</div>
          </div>
          <div class="form-group">
            <div class="form-label">Gender</div>
            <div style="font-size: 0.85rem;">${genders}</div>
          </div>
        </div>

        ${interests.length > 0 ? `
        <div class="form-group">
          <div class="form-label">Interests</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${interests.map(i => `<span class="badge badge-low">${i}</span>`).join('')}
          </div>
        </div>
        ` : ''}

        ${audiences.length > 0 ? `
        <div class="form-group">
          <div class="form-label">Custom Audiences</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${audiences.map(a => `<span class="badge badge-active">${a.name || a.id}</span>`).join('')}
          </div>
        </div>
        ` : ''}

        ${excluded.length > 0 ? `
        <div class="form-group">
          <div class="form-label">Excluded Audiences</div>
          <div style="display: flex; flex-wrap: wrap; gap: 4px;">
            ${excluded.map(a => `<span class="badge badge-paused">${a.name || a.id}</span>`).join('')}
          </div>
        </div>
        ` : ''}

        <div style="font-weight: 600; font-size: 0.82rem; color: var(--accent); margin: 20px 0 12px; text-transform: uppercase; letter-spacing: 0.06em;">Placements</div>

        <div class="form-group">
          ${isAuto
            ? '<span class="badge badge-active">Advantage+ Placements (Automatic)</span>'
            : `<div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
                ${platforms.map(p => `<span class="badge badge-low">${p}</span>`).join('')}
              </div>
              ${fbPos ? `<div style="font-size: 0.8rem;"><span class="text-muted">Facebook:</span> ${fbPos}</div>` : ''}
              ${igPos ? `<div style="font-size: 0.8rem;"><span class="text-muted">Instagram:</span> ${igPos}</div>` : ''}`
          }
        </div>

        <div style="font-weight: 600; font-size: 0.82rem; color: var(--accent); margin: 20px 0 12px; text-transform: uppercase; letter-spacing: 0.06em;">Settings</div>

        <div class="form-row">
          <div class="form-group">
            <div class="form-label">Bid Strategy</div>
            <div style="font-size: 0.85rem;">${fmtBidStrategy(res.bid_strategy)}</div>
          </div>
          <div class="form-group">
            <div class="form-label">Optimization</div>
            <div style="font-size: 0.85rem;">${(res.optimization_goal || '').replace(/_/g, ' ').toLowerCase()}</div>
          </div>
        </div>

        <div class="form-group">
          <div class="form-label">Daily Budget</div>
          <div style="font-size: 0.85rem;">${res.daily_budget ? '$' + (res.daily_budget / 100).toFixed(2) : 'Not set'}</div>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 20px;">
          <button class="btn btn-primary" onclick="switchToEditAdSet('${metaAdsetId}', ${JSON.stringify(res).replace(/'/g, "\\'").replace(/"/g, '&quot;')})">Edit Ad Set</button>
          <button class="btn" onclick="editBudget('${metaAdsetId}', '${name.replace(/'/g, "\\'")}', ${res.daily_budget || 0}); closeDrawer();">Change Budget</button>
        </div>
      </div>
    `);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
  }
}

function switchToEditAdSet(metaAdsetId, currentData) {
  const data = typeof currentData === 'string' ? JSON.parse(currentData.replace(/&quot;/g, '"')) : currentData;
  
  setDrawerBody(`
    <div style="margin-bottom: 16px;">
      <div style="font-weight: 600; font-size: 0.9rem; color: var(--accent);">Editing Ad Set</div>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Age Min</label>
        <input id="edit-age-min" class="form-input" type="number" min="18" max="65" value="${data.age_min || 18}" />
      </div>
      <div class="form-group">
        <label class="form-label">Age Max</label>
        <input id="edit-age-max" class="form-input" type="number" min="18" max="65" value="${data.age_max || 65}" />
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Gender</label>
      <select id="edit-gender" class="form-select">
        <option value="all" ${!data.genders || data.genders.length === 0 ? 'selected' : ''}>All</option>
        <option value="1" ${data.genders && data.genders.includes(1) && data.genders.length === 1 ? 'selected' : ''}>Male only</option>
        <option value="2" ${data.genders && data.genders.includes(2) && data.genders.length === 1 ? 'selected' : ''}>Female only</option>
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Daily Budget ($)</label>
      <input id="edit-adset-budget" class="form-input" type="number" step="0.01" value="${data.daily_budget ? (data.daily_budget / 100).toFixed(2) : ''}" />
    </div>

    <div class="form-group">
      <label class="form-label">Bid Strategy</label>
      <select id="edit-bid-strategy" class="form-select">
        ${['LOWEST_COST_WITHOUT_CAP', 'LOWEST_COST_WITH_BID_CAP', 'COST_CAP'].map(s =>
          `<option value="${s}" ${data.bid_strategy === s ? 'selected' : ''}>${s.replace(/_/g, ' ').toLowerCase()}</option>`
        ).join('')}
      </select>
    </div>

    <div class="form-group">
      <label class="form-label">Status</label>
      <select id="edit-adset-status" class="form-select">
        <option value="ACTIVE" ${data.status === 'ACTIVE' ? 'selected' : ''}>Active</option>
        <option value="PAUSED" ${data.status === 'PAUSED' ? 'selected' : ''}>Paused</option>
      </select>
    </div>

    <div style="display: flex; gap: 8px; margin-top: 20px;">
      <button class="btn btn-primary" onclick="saveAdSetEdit('${metaAdsetId}')">Save Changes</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>

    <div class="drawer-note" style="padding: 12px 0 0;">
      Note: Placement and interest targeting edits require Meta Ads Manager. Budget, age, gender, bid strategy, and status can be edited here.
    </div>
  `);
}

async function saveAdSetEdit(metaAdsetId) {
  const ageMin = parseInt(document.getElementById('edit-age-min').value) || 18;
  const ageMax = parseInt(document.getElementById('edit-age-max').value) || 65;
  const genderVal = document.getElementById('edit-gender').value;
  const budget = parseFloat(document.getElementById('edit-adset-budget').value);
  const bidStrategy = document.getElementById('edit-bid-strategy').value;
  const status = document.getElementById('edit-adset-status').value;

  if (!confirmAction('Save changes to this ad set?')) return;

  try {
    toast('Saving ad set changes...', 'info');
    await apiPost('/meta/update-adset', {
      adsetId: metaAdsetId,
      ageMin,
      ageMax,
      genders: genderVal === 'all' ? [] : [parseInt(genderVal)],
      dailyBudget: budget ? Math.round(budget * 100) : undefined,
      bidStrategy,
      status,
    });
    toast('Ad set updated', 'success');
    closeDrawer();
    navigateTo('adsets', pageState);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

// ─── HELPERS ──────────────────────────────────────────────

function fmtBidStrategy(s) {
  if (!s) return '—';
  return s.replace(/_/g, ' ').toLowerCase().replace('without cap', '');
}

async function pauseAdSet(metaId, name) {
  if (!confirmAction(`Pause ad set "${name}"?`)) return;
  try {
    await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'adset', metaEntityId: metaId });
    toast(`Paused: ${name}`, 'success');
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function resumeAdSet(metaId, name) {
  if (!confirmAction(`Resume ad set "${name}"?`)) return;
  try {
    await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'adset', metaEntityId: metaId });
    toast(`Resumed: ${name}`, 'success');
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function editBudget(metaId, name, currentBudget) {
  const currentDisplay = currentBudget ? (currentBudget / 100).toFixed(2) : '0';
  const newBudget = prompt(`New daily budget for "${name}" (in dollars):\n\nCurrent: $${currentDisplay}`, currentDisplay);
  if (!newBudget || isNaN(parseFloat(newBudget))) return;
  if (!confirmAction(`Set daily budget to $${parseFloat(newBudget).toFixed(2)} for "${name}"?`)) return;

  try {
    await apiPost('/actions/budget', { accountId: ACCOUNT_ID, metaAdSetId: metaId, newBudget: parseFloat(newBudget) });
    toast(`Budget updated: ${name} → $${parseFloat(newBudget).toFixed(2)}/day`, 'success');
    navigateTo('adsets', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
