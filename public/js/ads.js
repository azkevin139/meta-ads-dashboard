/* ═══════════════════════════════════════════════════════════
   Ads Page — drawer edit + proper conversions
   ═══════════════════════════════════════════════════════════ */

async function loadAds(container) {
  const adsetId = pageState.adsetId;
  const adsetName = pageState.adsetName || 'Ad Set';
  const campaignId = pageState.campaignId;
  const campaignName = pageState.campaignName || 'Campaign';

  if (!adsetId) {
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
      <button class="btn btn-sm" onclick="navigateTo('adsets', {campaignId: ${campaignId}, campaignName: '${campaignName.replace(/'/g, "\\'")}'})">← Back to Ad Sets</button>
    </div>
    <div id="ads-grid"><div class="loading">Loading ads</div></div>
  `;

  try {
    const res = await apiGet(`/insights/ads?adsetId=${adsetId}&days=7`);
    const ads = res.data || [];

    if (ads.length === 0) {
      document.getElementById('ads-grid').innerHTML = '<div class="empty-state"><div class="empty-state-text">No active ads found in this ad set</div></div>';
      return;
    }

    document.getElementById('ads-grid').innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px;">
        ${ads.map(ad => adCard(ad)).join('')}
      </div>
    `;

    for (const ad of ads) {
      loadCreativeImage(ad.meta_ad_id, ad.creative_meta);
      loadAdDetails(ad.meta_ad_id);
    }
  } catch (err) {
    document.getElementById('ads-grid').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

async function loadCreativeImage(metaAdId, creativeMeta) {
  const el = document.getElementById(`creative-${metaAdId}`);
  if (!el) return;
  const meta = creativeMeta || {};
  if (meta.image_url) {
    el.innerHTML = `<img src="${meta.image_url}" alt="Ad Creative" style="width: 100%; max-height: 350px; object-fit: contain; border-radius: 6px; background: var(--bg-base);" onerror="fetchCreativeFromApi('${metaAdId}')" />`;
    return;
  }
  fetchCreativeFromApi(metaAdId);
}

async function fetchCreativeFromApi(metaAdId) {
  const el = document.getElementById(`creative-${metaAdId}`);
  if (!el) return;
  try {
    const res = await apiGet(`/meta/creative-thumbnail?adId=${metaAdId}`);
    const imgUrl = res.image_url || res.thumbnail_url;
    if (imgUrl) {
      el.innerHTML = `<img src="${imgUrl}" alt="Ad Creative" style="width: 100%; max-height: 350px; object-fit: contain; border-radius: 6px; background: var(--bg-base);" />`;
    } else {
      el.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
    }
  } catch (e) {
    el.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
  }
}

async function loadAdDetails(metaAdId) {
  const el = document.getElementById(`details-${metaAdId}`);
  if (!el) return;
  try {
    const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);
    el.innerHTML = `
      <div style="font-size: 0.8rem; line-height: 1.7;">
        ${res.headline ? `<div><span class="kpi-label" style="display:inline;">Headline:</span> ${res.headline}</div>` : ''}
        ${res.primary_text ? `<div><span class="kpi-label" style="display:inline;">Primary Text:</span> <span class="text-secondary">${truncate(res.primary_text, 120)}</span></div>` : ''}
        ${res.description ? `<div><span class="kpi-label" style="display:inline;">Description:</span> <span class="text-secondary">${res.description}</span></div>` : ''}
        ${res.cta ? `<div><span class="kpi-label" style="display:inline;">CTA:</span> ${res.cta.replace(/_/g, ' ')}</div>` : ''}
        ${res.link_url ? `<div><span class="kpi-label" style="display:inline;">Link:</span> <a href="${res.link_url}" target="_blank" style="font-size:0.75rem;">${truncate(res.link_url, 50)}</a></div>` : ''}
      </div>
    `;
  } catch (e) {
    el.innerHTML = '<div class="text-muted" style="font-size:0.78rem;">Could not load details</div>';
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

function adCard(ad) {
  return `
    <div class="reco-card" style="border-left: 3px solid ${ad.status === 'ACTIVE' ? 'var(--green)' : 'var(--yellow)'};">
      <div class="reco-header" style="margin-bottom: 14px;">
        <div class="reco-entity" style="font-size: 0.85rem;">${ad.name}</div>
        ${statusBadge(ad.effective_status || ad.status)}
      </div>

      <div id="creative-${ad.meta_ad_id}" style="background: var(--bg-elevated); border-radius: 8px; margin-bottom: 14px; min-height: 80px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <div class="text-muted" style="padding: 24px; font-size: 0.75rem;">Loading creative...</div>
      </div>

      <div id="details-${ad.meta_ad_id}" style="background: var(--bg-elevated); border-radius: 6px; padding: 14px; margin-bottom: 14px; min-height: 40px;">
        <div class="text-muted" style="font-size: 0.75rem;">Loading ad copy...</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px;">
        <div><div class="kpi-label">CTR</div><div class="mono" style="font-size:0.88rem; ${parseFloat(ad.ctr) >= 3 ? 'color:var(--green)' : parseFloat(ad.ctr) < 1.5 ? 'color:var(--red)' : ''}">${fmt(ad.ctr, 'percent')}</div></div>
        <div><div class="kpi-label">CPM</div><div class="mono" style="font-size:0.88rem;">${fmt(ad.cpm, 'currency')}</div></div>
        <div><div class="kpi-label">CPC</div><div class="mono" style="font-size:0.88rem;">${fmt(ad.cpc, 'currency')}</div></div>
        <div><div class="kpi-label">CPA</div><div class="mono" style="font-size:0.88rem; ${parseFloat(ad.cpa) <= 15 ? 'color:var(--green)' : parseFloat(ad.cpa) > 25 ? 'color:var(--red)' : ''}">${fmt(ad.cpa, 'currency')}</div></div>
        <div><div class="kpi-label">ROAS</div><div class="mono" style="font-size:0.88rem; ${parseFloat(ad.roas) >= 3 ? 'color:var(--green)' : parseFloat(ad.roas) < 1.5 ? 'color:var(--red)' : ''}">${fmt(ad.roas, 'decimal')}x</div></div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px;">
        <div><div class="kpi-label">Spend</div><div class="mono" style="font-size:0.85rem;">${fmt(ad.spend, 'currency')}</div></div>
        <div><div class="kpi-label">Impr.</div><div class="mono" style="font-size:0.85rem;">${fmt(ad.impressions, 'compact')}</div></div>
        <div><div class="kpi-label">Clicks</div><div class="mono" style="font-size:0.85rem;">${fmt(ad.clicks, 'compact')}</div></div>
        <div><div class="kpi-label">Conv.</div><div class="mono" style="font-size:0.85rem;">${fmt(ad.conversions, 'integer')}</div></div>
      </div>

      <div style="display: flex; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border-light);">
        <button class="btn btn-sm btn-primary" onclick="openEditAd('${ad.meta_ad_id}', '${ad.name.replace(/'/g, "\\'")}')">Edit</button>
        ${ad.status === 'ACTIVE'
          ? `<button class="btn btn-sm btn-danger" onclick="pauseAd('${ad.meta_ad_id}', '${ad.name.replace(/'/g, "\\'")}')">Pause</button>`
          : `<button class="btn btn-sm" onclick="resumeAd('${ad.meta_ad_id}', '${ad.name.replace(/'/g, "\\'")}')">Resume</button>`}
        <button class="btn btn-sm" onclick="dupAd('${ad.meta_ad_id}', '${ad.name.replace(/'/g, "\\'")}')">Duplicate</button>
      </div>
    </div>
  `;
}

// ─── DRAWER-BASED AD EDITING ──────────────────────────────

async function openEditAd(metaAdId, name) {
  openDrawer(`Edit Ad`, '<div class="loading">Loading ad details...</div>');

  try {
    const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);

    const ctaOptions = ['SIGN_UP', 'LEARN_MORE', 'SHOP_NOW', 'BOOK_NOW', 'DOWNLOAD', 'GET_OFFER', 'BET_NOW', 'PLAY_GAME', 'APPLY_NOW', 'CONTACT_US', 'SUBSCRIBE', 'GET_QUOTE', 'NO_BUTTON'];

    setDrawerBody(`
      <div style="margin-bottom: 16px;">
        <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 4px;">${name}</div>
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

      <div class="drawer-note" style="padding: 12px 0 0;">
        Editing creates a new creative. The ad may re-enter Meta review.
      </div>
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
    toast('Ad updated successfully', 'success');
    closeDrawer();
    loadAdDetails(metaAdId);
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
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
