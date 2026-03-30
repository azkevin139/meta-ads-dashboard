/* ═══════════════════════════════════════════════════════════
   Ad Sets Page — live from Meta API
   ═══════════════════════════════════════════════════════════ */

async function loadAdSets(container) {
  const metaCampaignId = pageState.metaCampaignId || pageState.campaignId;
  const campaignName = pageState.campaignName || 'Campaign';

  if (!metaCampaignId) {
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
        <span class="badge badge-active" style="font-size: 0.7rem;">LIVE</span>
      </div>
      <div id="adsets-table"><div class="loading">Loading ad sets from Meta</div></div>
    </div>
  `;

  try {
    // Fetch ad sets live from Meta API
    const res = await apiGet(`/meta/adsets?campaignId=${metaCampaignId}`);
    const adsets = (res.data || []).filter(a => a.effective_status === 'ACTIVE' || a.effective_status === 'PAUSED');

    if (adsets.length === 0) {
      document.getElementById('adsets-table').innerHTML = '<div class="empty-state"><div class="empty-state-text">No ad sets found</div></div>';
      return;
    }

    // Fetch insights for this campaign at adset level
    let insightsMap = {};
    try {
      const insRes = await apiGet(`/meta/live?level=adset&since=${campDateFrom || daysAgoStr(1)}&until=${campDateTo || daysAgoStr(1)}`);
      for (const row of (insRes.data || [])) {
        if (row.adset_id) insightsMap[row.adset_id] = row;
      }
    } catch (e) { /* insights optional */ }

    document.getElementById('adsets-table').innerHTML = `
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Ad Set</th>
              <th>Status</th>
              <th class="right">Budget</th>
              <th class="right">Spend</th>
              <th class="right">Results</th>
              <th class="right">Cost/Result</th>
              <th class="right">CPM</th>
              <th class="right">CTR</th>
              <th class="right">CPC</th>
              <th class="right">Freq.</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${adsets.map(a => {
              const ins = insightsMap[a.id] || {};
              const result = parseResults(ins.actions);
              const cpr = parseCostPerResult(ins.cost_per_action_type, result.type);
              const spend = parseFloat(ins.spend) || 0;
              const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);

              return `
                <tr>
                  <td class="name-cell">
                    <a href="#" onclick="navigateTo('ads', {metaAdsetId: '${a.id}', adsetName: '${(a.name || '').replace(/'/g, "\\'")}', metaCampaignId: '${metaCampaignId}', campaignName: '${campaignName.replace(/'/g, "\\'")}'}); return false;">
                      ${a.name}
                    </a>
                  </td>
                  <td>${statusBadge(a.effective_status || a.status)}</td>
                  <td class="right">${a.daily_budget ? '$' + (a.daily_budget / 100).toFixed(2) : a.lifetime_budget ? '$' + (a.lifetime_budget / 100).toFixed(2) + ' LT' : '—'}</td>
                  <td class="right">${spend > 0 ? fmt(spend, 'currency') : '—'}</td>
                  <td class="right" style="font-weight: 600;">${result.count > 0 ? result.count : '—'}</td>
                  <td class="right ${metricColor(costPerResult, {good: 40, bad: 80}, true)}">${costPerResult > 0 ? fmt(costPerResult, 'currency') : '—'}</td>
                  <td class="right">${ins.cpm ? fmt(ins.cpm, 'currency') : '—'}</td>
                  <td class="right">${ins.ctr ? fmt(ins.ctr, 'percent') : '—'}</td>
                  <td class="right">${ins.cpc ? fmt(ins.cpc, 'currency') : '—'}</td>
                  <td class="right">${ins.frequency ? fmt(ins.frequency, 'decimal') : '—'}</td>
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm btn-primary" onclick="openAdSetDrawer('${a.id}', '${(a.name || '').replace(/'/g, "\\'")}')">Details</button>
                      ${a.effective_status === 'ACTIVE'
                        ? `<button class="btn btn-sm btn-danger" onclick="pauseAdSet('${a.id}', '${(a.name || '').replace(/'/g, "\\'")}')">Pause</button>`
                        : `<button class="btn btn-sm" onclick="resumeAdSet('${a.id}', '${(a.name || '').replace(/'/g, "\\'")}')">Resume</button>`
                      }
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
    document.getElementById('adsets-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

// ─── DRAWER: AD SET DETAILS ───────────────────────────────

async function openAdSetDrawer(metaAdsetId, name) {
  openDrawer('Ad Set Details', '<div class="loading">Loading targeting & placement...</div>');

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
    const fbPos = (res.facebook_positions || []).join(', ');
    const igPos = (res.instagram_positions || []).join(', ');

    const interests = res.interests || [];
    const audiences = res.custom_audiences || [];
    const excluded = res.excluded_custom_audiences || [];

    setDrawerBody(`
      <div style="margin-bottom: 20px;">
        <div style="font-weight: 600; font-size: 0.95rem;">${name}</div>
        <div class="text-muted" style="font-size: 0.75rem; margin-top: 2px;">ID: ${metaAdsetId}</div>
      </div>

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
      </div>` : ''}

      ${audiences.length > 0 ? `
      <div class="form-group">
        <div class="form-label">Custom Audiences</div>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${audiences.map(a => `<span class="badge badge-active">${a.name || a.id}</span>`).join('')}
        </div>
      </div>` : ''}

      ${excluded.length > 0 ? `
      <div class="form-group">
        <div class="form-label">Excluded Audiences</div>
        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
          ${excluded.map(a => `<span class="badge badge-paused">${a.name || a.id}</span>`).join('')}
        </div>
      </div>` : ''}

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
    `);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
  }
}

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
