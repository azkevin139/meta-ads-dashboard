/* ═══════════════════════════════════════════════════════════
   Ads Page — live from Meta API
   ═══════════════════════════════════════════════════════════ */

async function loadAds(container) {
  const metaAdsetId = pageState.metaAdsetId || pageState.adsetId;
  const adsetName = pageState.adsetName || 'Ad Set';
  const metaCampaignId = pageState.metaCampaignId;
  const campaignName = pageState.campaignName || 'Campaign';

  if (!metaAdsetId) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎨</div>
        <div class="empty-state-text">Select an ad set first</div>
        <button class="btn mt-md" onclick="navigateTo('campaigns')">← Go to Campaigns</button>
      </div>`;
    return;
  }

  document.getElementById('page-title').textContent = `Ads — ${adsetName}`;

  container.innerHTML = `
    <div class="mb-md" style="display: flex; gap: 8px;">
      <button class="btn btn-sm" onclick="navigateTo('adsets', {metaCampaignId: '${metaCampaignId}', campaignName: '${(campaignName || '').replace(/'/g, "\\'")}'})">← Back to Ad Sets</button>
    </div>
    <div id="ads-grid"><div class="loading">Loading ads from Meta</div></div>
  `;

  try {
    // Fetch ads live from Meta API
    const res = await apiGet(`/meta/ads?adSetId=${metaAdsetId}`);
    const ads = (res.data || []).filter(a => a.effective_status === 'ACTIVE' || a.effective_status === 'PAUSED' || a.effective_status === 'PENDING_REVIEW');

    if (ads.length === 0) {
      document.getElementById('ads-grid').innerHTML = '<div class="empty-state"><div class="empty-state-text">No ads found in this ad set</div></div>';
      return;
    }

    // Fetch insights at ad level
    let insightsMap = {};
    try {
      const insRes = await apiGet(`/meta/live?level=ad&since=${campDateFrom || daysAgoStr(1)}&until=${campDateTo || daysAgoStr(1)}`);
      for (const row of (insRes.data || [])) {
        if (row.ad_id) insightsMap[row.ad_id] = row;
      }
    } catch (e) { /* insights optional */ }

    document.getElementById('ads-grid').innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px;">
        ${ads.map(ad => adCard(ad, insightsMap[ad.id])).join('')}
      </div>
    `;

    // Load creative details async
    for (const ad of ads) {
      loadAdCreative(ad.id);
    }

  } catch (err) {
    document.getElementById('ads-grid').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

async function loadAdCreative(metaAdId) {
  const imgEl = document.getElementById(`creative-${metaAdId}`);
  const detailEl = document.getElementById(`details-${metaAdId}`);

  try {
    const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);

    // Image
    if (imgEl) {
      const imgUrl = res.image_url || res.thumbnail_url;
      if (imgUrl) {
        imgEl.innerHTML = `<img src="${imgUrl}" alt="Creative" style="width: 100%; max-height: 350px; object-fit: contain; border-radius: 6px; background: var(--bg-base);" onerror="this.parentElement.innerHTML='<div style=\\'padding:30px; text-align:center; color:var(--text-muted);\\'>Preview not available</div>'" />`;
      } else {
        imgEl.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
      }
    }

    // Details
    if (detailEl) {
      detailEl.innerHTML = `
        <div style="font-size: 0.8rem; line-height: 1.7;">
          ${res.headline ? `<div><span class="kpi-label" style="display:inline;">Headline:</span> ${res.headline}</div>` : ''}
          ${res.primary_text ? `<div><span class="kpi-label" style="display:inline;">Primary Text:</span> <span class="text-secondary">${truncate(res.primary_text, 150)}</span></div>` : ''}
          ${res.cta ? `<div><span class="kpi-label" style="display:inline;">CTA:</span> ${res.cta.replace(/_/g, ' ')}</div>` : ''}
          ${res.link_url ? `<div><span class="kpi-label" style="display:inline;">Link:</span> <a href="${res.link_url}" target="_blank" style="font-size:0.75rem;">${truncate(res.link_url, 50)}</a></div>` : ''}
        </div>
      `;
    }
  } catch (e) {
    if (imgEl) imgEl.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
    if (detailEl) detailEl.innerHTML = '';
  }
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function adCard(ad, ins) {
  ins = ins || {};
  const result = parseResults(ins.actions);
  const cpr = parseCostPerResult(ins.cost_per_action_type, result.type);
  const spend = parseFloat(ins.spend) || 0;
  const costPerResult = cpr > 0 ? cpr : (result.count > 0 ? spend / result.count : 0);

  return `
    <div class="reco-card" style="border-left: 3px solid ${ad.effective_status === 'ACTIVE' ? 'var(--green)' : 'var(--yellow)'};">
      <div class="reco-header" style="margin-bottom: 14px;">
        <div class="reco-entity" style="font-size: 0.85rem;">${ad.name}</div>
        ${statusBadge(ad.effective_status || ad.status)}
      </div>

      <div id="creative-${ad.id}" style="background: var(--bg-elevated); border-radius: 8px; margin-bottom: 14px; min-height: 80px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <div class="text-muted" style="padding: 24px; font-size: 0.75rem;">Loading creative...</div>
      </div>

      <div id="details-${ad.id}" style="background: var(--bg-elevated); border-radius: 6px; padding: 14px; margin-bottom: 14px; min-height: 40px;">
        <div class="text-muted" style="font-size: 0.75rem;">Loading ad copy...</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px;">
        <div><div class="kpi-label">Spend</div><div class="mono" style="font-size:0.85rem;">${spend > 0 ? fmt(spend, 'currency') : '—'}</div></div>
        <div><div class="kpi-label">Results</div><div class="mono" style="font-size:0.85rem; font-weight: 600;">${result.count > 0 ? result.count : '—'}</div></div>
        <div><div class="kpi-label">Cost/Result</div><div class="mono" style="font-size:0.85rem;">${costPerResult > 0 ? fmt(costPerResult, 'currency') : '—'}</div></div>
        <div><div class="kpi-label">CTR</div><div class="mono" style="font-size:0.85rem;">${ins.ctr ? fmt(ins.ctr, 'percent') : '—'}</div></div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px;">
        <div><div class="kpi-label">CPM</div><div class="mono" style="font-size:0.85rem;">${ins.cpm ? fmt(ins.cpm, 'currency') : '—'}</div></div>
        <div><div class="kpi-label">CPC</div><div class="mono" style="font-size:0.85rem;">${ins.cpc ? fmt(ins.cpc, 'currency') : '—'}</div></div>
        <div><div class="kpi-label">Impr.</div><div class="mono" style="font-size:0.85rem;">${ins.impressions ? fmt(ins.impressions, 'compact') : '—'}</div></div>
        <div><div class="kpi-label">Clicks</div><div class="mono" style="font-size:0.85rem;">${ins.clicks ? fmt(ins.clicks, 'compact') : '—'}</div></div>
      </div>

      <div style="display: flex; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border-light);">
        <button class="btn btn-sm btn-primary" onclick="openEditAd('${ad.id}', '${(ad.name || '').replace(/'/g, "\\'")}')">Edit</button>
        ${ad.effective_status === 'ACTIVE'
          ? `<button class="btn btn-sm btn-danger" onclick="pauseAd('${ad.id}', '${(ad.name || '').replace(/'/g, "\\'")}')">Pause</button>`
          : `<button class="btn btn-sm" onclick="resumeAd('${ad.id}', '${(ad.name || '').replace(/'/g, "\\'")}')">Resume</button>`}
        <button class="btn btn-sm" onclick="dupAd('${ad.id}', '${(ad.name || '').replace(/'/g, "\\'")}')">Duplicate</button>
      </div>
    </div>
  `;
}

// ─── EDIT AD DRAWER ───────────────────────────────────────

async function openEditAd(metaAdId, name) {
  openDrawer('Edit Ad', '<div class="loading">Loading ad details...</div>');
  try {
    const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);
    const ctaOptions = ['SIGN_UP', 'LEARN_MORE', 'SHOP_NOW', 'BOOK_NOW', 'DOWNLOAD', 'GET_OFFER', 'BET_NOW', 'PLAY_GAME', 'APPLY_NOW', 'CONTACT_US', 'SUBSCRIBE', 'GET_QUOTE', 'NO_BUTTON'];

    setDrawerBody(`
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 600; font-size: 0.9rem;">${name}</div>
        <div class="text-muted" style="font-size: 0.75rem;">ID: ${metaAdId}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Primary Text</label>
        <textarea id="edit-primary-text" class="form-textarea" rows="5">${escapeHtml(res.primary_text || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Headline</label>
        <input id="edit-headline" class="form-input" type="text" value="${escapeHtml(res.headline || '')}" />
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <input id="edit-description" class="form-input" type="text" value="${escapeHtml(res.description || '')}" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">CTA Button</label>
          <select id="edit-cta" class="form-select">
            ${ctaOptions.map(c => `<option value="${c}" ${res.cta === c ? 'selected' : ''}>${c.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Display Link</label>
          <input id="edit-display-link" class="form-input" type="text" value="${escapeHtml(res.display_link || '')}" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Destination URL</label>
        <input id="edit-link" class="form-input" type="url" value="${escapeHtml(res.link_url || '')}" />
      </div>
      <div style="display: flex; gap: 8px; margin-top: 20px;">
        <button class="btn btn-primary" onclick="saveAdEdit('${metaAdId}', '${res.creative_id || ''}')">Save Changes</button>
        <button class="btn" onclick="closeDrawer()">Cancel</button>
      </div>
      <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 12px;">Editing creates a new creative. The ad may re-enter Meta review.</div>
    `);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
  }
}

async function saveAdEdit(metaAdId, creativeId) {
  const headline = document.getElementById('edit-headline').value;
  const primaryText = document.getElementById('edit-primary-text').value;
  const description = document.getElementById('edit-description').value;
  const cta = document.getElementById('edit-cta').value;
  const linkUrl = document.getElementById('edit-link').value;

  if (!confirmAction('Save changes? The ad may re-enter Meta review.')) return;
  try {
    toast('Saving...', 'info');
    await apiPost('/meta/update-ad', { adId: metaAdId, creativeId, headline, primaryText, description, cta, linkUrl });
    toast('Ad updated', 'success');
    closeDrawer();
    loadAdCreative(metaAdId);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

// ─── AD ACTIONS ──────────────────────────────────────────

async function pauseAd(metaId, name) {
  if (!confirmAction(`Pause ad "${name}"?`)) return;
  try {
    await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId });
    toast(`Paused: ${name}`, 'success');
    navigateTo('ads', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function resumeAd(metaId, name) {
  if (!confirmAction(`Resume ad "${name}"?`)) return;
  try {
    await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId });
    toast(`Resumed: ${name}`, 'success');
    navigateTo('ads', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function dupAd(metaId, name) {
  if (!confirmAction(`Duplicate ad "${name}"?`)) return;
  try {
    await apiPost('/actions/duplicate', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId });
    toast(`Duplicated: ${name}`, 'success');
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}
