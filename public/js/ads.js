/* ═══════════════════════════════════════════════════════════
   Ads Page — studio editor
   ═══════════════════════════════════════════════════════════ */

let selectedAds = new Set();
let adStudioState = null;
let adStudioSection = 'identity';

async function loadAds(container) {
  const metaAdsetId = pageState.metaAdsetId || pageState.adsetId;
  const adsetName = pageState.adsetName || 'Ad Set';
  const metaCampaignId = pageState.metaCampaignId;
  const campaignName = pageState.campaignName || 'Campaign';
  selectedAds.clear();

  if (!metaAdsetId) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎨</div><div class="empty-state-text">Select an ad set first</div><button class="btn mt-md" onclick="navigateTo(\'campaigns\')">← Go to Campaigns</button></div>';
    return;
  }

  document.getElementById('page-title').textContent = `Ads — ${adsetName}`;

  container.innerHTML = `
    <div class="flex-between mb-md">
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-sm" onclick="navigateTo('adsets', {metaCampaignId:'${metaCampaignId}', campaignName:'${(campaignName||'').replace(/'/g,"\\'")}'})">← Back</button>
        <button class="btn btn-primary btn-sm" onclick="openCreateAd('${metaAdsetId}')">+ New Ad</button>
      </div>
    </div>
    <div id="ad-bulk-bar" style="display:none; padding: 10px 16px; background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--radius); margin-bottom: 14px; align-items: center; gap: 12px;">
      <span id="ad-bulk-count" style="font-weight: 600; font-size: 0.85rem;">0 selected</span>
      <button class="btn btn-sm btn-danger" onclick="bulkAdAction('pause')">Pause</button>
      <button class="btn btn-sm" onclick="bulkAdAction('resume')">Resume</button>
      <button class="btn btn-sm" onclick="clearAdSelection()">Clear</button>
    </div>
    <div id="ads-grid"><div class="loading">Loading ads</div></div>
  `;

  try {
    const res = await apiGet(`/meta/ads?adSetId=${metaAdsetId}`);
    const ads = (res.data || []).filter(a => ['ACTIVE','PAUSED','PENDING_REVIEW','DISAPPROVED'].includes(a.effective_status || a.status));

    let insightsMap = {};
    try {
      const insRes = await apiGet(`/meta/live?level=ad&since=${campDateFrom || daysAgoStr(1)}&until=${campDateTo || daysAgoStr(1)}`);
      for (const row of (insRes.data || [])) if (row.ad_id) insightsMap[row.ad_id] = row;
    } catch (e) {}

    if (!ads.length) {
      document.getElementById('ads-grid').innerHTML = '<div class="empty-state"><div class="empty-state-text">No ads found</div></div>';
      return;
    }

    document.getElementById('ads-grid').innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px;">
        ${ads.map(ad => adCard(ad, insightsMap[ad.id])).join('')}
      </div>
    `;

    for (const ad of ads) loadAdCreative(ad.id);
  } catch (err) {
    document.getElementById('ads-grid').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

function updateAdSelection() {
  selectedAds.clear();
  document.querySelectorAll('.ad-check:checked').forEach(c => selectedAds.add(c.value));
  const bar = document.getElementById('ad-bulk-bar');
  const count = document.getElementById('ad-bulk-count');
  if (selectedAds.size > 0) { bar.style.display = 'flex'; count.textContent = `${selectedAds.size} selected`; }
  else { bar.style.display = 'none'; }
}
function clearAdSelection() {
  selectedAds.clear();
  document.querySelectorAll('.ad-check').forEach(c => { c.checked = false; });
  document.getElementById('ad-bulk-bar').style.display = 'none';
}
async function bulkAdAction(action) {
  if (selectedAds.size === 0) return;
  if (!confirmAction(`${action === 'pause' ? 'Pause' : 'Resume'} ${selectedAds.size} ad(s)?`)) return;
  try {
    toast('Processing...', 'info');
    const res = await apiPost('/create/bulk-action', { entityIds: Array.from(selectedAds), entityType: 'ad', action });
    toast(res.message, 'success');
    navigateTo('ads', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
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
        <div style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" class="ad-check" value="${ad.id}" onchange="updateAdSelection()" />
          <div class="reco-entity" style="font-size: 0.85rem;">${ad.name}</div>
        </div>
        ${statusBadge(ad.effective_status || ad.status)}
      </div>

      <div id="creative-${ad.id}" style="background: var(--bg-elevated); border-radius: 8px; margin-bottom: 14px; min-height: 80px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
        <div class="text-muted" style="padding: 24px; font-size: 0.75rem;">Loading creative...</div>
      </div>

      <div id="details-${ad.id}" style="background: var(--bg-elevated); border-radius: 6px; padding: 14px; margin-bottom: 14px; min-height: 40px;">
        <div class="text-muted" style="font-size: 0.75rem;">Loading ad copy...</div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px;">
        <div><div class="kpi-label">Spend</div><div class="mono" style="font-size:0.85rem;">${spend > 0 ? fmt(spend,'currency') : '—'}</div></div>
        <div><div class="kpi-label">Results</div><div class="mono" style="font-size:0.85rem; font-weight:600;">${result.count > 0 ? result.count : '—'}</div></div>
        <div><div class="kpi-label">Cost/Result</div><div class="mono" style="font-size:0.85rem;">${costPerResult > 0 ? fmt(costPerResult,'currency') : '—'}</div></div>
        <div><div class="kpi-label">CTR</div><div class="mono" style="font-size:0.85rem;">${ins.ctr ? fmt(ins.ctr,'percent') : '—'}</div></div>
      </div>

      <div style="display:flex; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border-light);">
        <button class="btn btn-sm btn-primary" onclick="openAdStudio('${ad.id}','${escapeJs(ad.name || '')}')">Edit</button>
        ${ad.effective_status === 'ACTIVE'
          ? `<button class="btn btn-sm btn-danger" onclick="pauseAd('${ad.id}','${escapeJs(ad.name || '')}')">Pause</button>`
          : `<button class="btn btn-sm" onclick="resumeAd('${ad.id}','${escapeJs(ad.name || '')}')">Resume</button>`}
        <button class="btn btn-sm" onclick="dupAd('${ad.id}','${escapeJs(ad.name || '')}')">Duplicate</button>
      </div>
    </div>
  `;
}

async function loadAdCreative(metaAdId) {
  const imgEl = document.getElementById(`creative-${metaAdId}`);
  const detailEl = document.getElementById(`details-${metaAdId}`);
  try {
    const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);
    const preview = res.preview || {};
    if (imgEl) {
      const imgUrl = preview.image_url || preview.thumbnail_url;
      imgEl.innerHTML = preview.video_id
        ? `<div style="padding:20px; text-align:left; width:100%;"><div class="badge badge-active" style="margin-bottom:8px;">VIDEO</div><div class="text-muted" style="font-size:0.78rem;">Video ID: ${preview.video_id}</div>${imgUrl ? `<img src="${imgUrl}" style="width:100%; max-height:240px; object-fit:contain; margin-top:10px; border-radius:6px;" />` : ''}</div>`
        : imgUrl
          ? `<img src="${imgUrl}" alt="Creative" style="width:100%; max-height:350px; object-fit:contain; border-radius:6px; background:var(--bg-base);" onerror="this.parentElement.innerHTML='<div style=\\'padding:30px; text-align:center; color:var(--text-muted);\\'>Preview not available</div>'" />`
          : '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
    }
    if (detailEl) {
      detailEl.innerHTML = `<div style="font-size:0.8rem; line-height:1.7;">
        ${preview.headline ? `<div><span class="kpi-label" style="display:inline;">Headline:</span> ${preview.headline}</div>` : ''}
        ${preview.primary_text ? `<div><span class="kpi-label" style="display:inline;">Primary Text:</span> <span class="text-secondary">${truncate(preview.primary_text,150)}</span></div>` : ''}
        ${preview.cta ? `<div><span class="kpi-label" style="display:inline;">CTA:</span> ${preview.cta.replace(/_/g,' ')}</div>` : ''}
        ${preview.link_url ? `<div><span class="kpi-label" style="display:inline;">Link:</span> <a href="${preview.link_url}" target="_blank" style="font-size:0.75rem;">${truncate(preview.link_url,50)}</a></div>` : ''}
        ${res.review_feedback ? `<div class="alert-banner alert-warning" style="margin-top:8px;">Review feedback present</div>` : ''}
      </div>`;
    }
  } catch (e) {
    if (imgEl) imgEl.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
    if (detailEl) detailEl.innerHTML = '';
  }
}

function truncate(str, len) { return str && str.length > len ? str.substring(0, len) + '...' : str || ''; }
function escapeHtml(str) { return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeJs(str) { return (str || '').replace(/'/g, "\\'"); }

async function openCreateAd(adsetId) {
  openDrawer('Create Ad', '<div class="loading">Loading pages...</div>');
  let pages = [];
  try { const pgRes = await apiGet('/create/pages'); pages = pgRes.data || []; } catch (e) {}
  const ctaOptions = ['SIGN_UP','LEARN_MORE','SHOP_NOW','BOOK_NOW','DOWNLOAD','GET_OFFER','BET_NOW','PLAY_GAME','APPLY_NOW','CONTACT_US','SUBSCRIBE'];
  setDrawerBody(`
    <div class="form-group"><label class="form-label">Ad Name</label><input id="ca-name" class="form-input" type="text" placeholder="e.g. Slots — Jackpot Visual — V1" /></div>
    <div class="form-group"><label class="form-label">Facebook Page</label><select id="ca-page" class="form-select"><option value="">Select page</option>${pages.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Image URL</label><input id="ca-image" class="form-input" type="url" placeholder="https://example.com/ad-image.jpg" /></div>
    <div class="form-group"><label class="form-label">Primary Text</label><textarea id="ca-primary" class="form-textarea" rows="4"></textarea></div>
    <div class="form-group"><label class="form-label">Headline</label><input id="ca-headline" class="form-input" type="text" /></div>
    <div class="form-group"><label class="form-label">Description</label><input id="ca-description" class="form-input" type="text" /></div>
    <div class="form-row"><div class="form-group"><label class="form-label">CTA Button</label><select id="ca-cta" class="form-select">${ctaOptions.map(c => `<option value="${c}" ${c === 'SIGN_UP' ? 'selected' : ''}>${c.replace(/_/g,' ')}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Destination URL</label><input id="ca-link" class="form-input" type="url" placeholder="https://yoursite.com/landing" /></div></div>
    <div class="form-group"><label class="form-label">Initial Status</label><select id="ca-status" class="form-select"><option value="PAUSED">Paused</option><option value="ACTIVE">Active</option></select></div>
    <div style="display: flex; gap: 8px; margin-top: 20px;"><button class="btn btn-primary" onclick="submitCreateAd('${adsetId}')">Create Ad</button><button class="btn" onclick="closeDrawer()">Cancel</button></div>
  `);
}
async function submitCreateAd(adsetId) {
  const name = document.getElementById('ca-name').value;
  const pageId = document.getElementById('ca-page').value;
  const imageUrl = document.getElementById('ca-image').value;
  const primaryText = document.getElementById('ca-primary').value;
  const headline = document.getElementById('ca-headline').value;
  const description = document.getElementById('ca-description').value;
  const cta = document.getElementById('ca-cta').value;
  const linkUrl = document.getElementById('ca-link').value;
  const status = document.getElementById('ca-status').value;
  if (!name) { toast('Ad name required', 'error'); return; }
  if (!pageId) { toast('Select a Facebook page', 'error'); return; }
  if (!linkUrl) { toast('Destination URL required', 'error'); return; }
  try {
    toast('Creating ad...', 'info');
    await apiPost('/create/ad', { name, adsetId, status, pageId, imageUrl, primaryText, headline, description, cta, linkUrl });
    toast(`Ad created: ${name}`, 'success');
    closeDrawer();
    navigateTo('ads', pageState);
  } catch (err) { toast(`Error: ${err.message}`, 'error'); }
}

async function openAdStudio(metaAdId, name) {
  adStudioSection = 'identity';
  openDrawer(`Ad Studio — ${name}`, '<div class="loading">Loading studio…</div>');
  try {
    const [studioRes, creativesRes, pagesRes, logsRes] = await Promise.all([
      apiGet(`/meta/ad-detail?adId=${metaAdId}`),
      apiGet('/meta/ad-creatives?limit=20'),
      apiGet('/meta/page-identities'),
      apiGet('/logs?accountId=1&limit=100'),
    ]);
    adStudioState = {
      adId: metaAdId,
      original: studioRes,
      draft: buildDraftFromStudio(studioRes),
      creatives: creativesRes.data || [],
      pages: pagesRes.data || [],
      logs: (logsRes.data || []).filter(l => String(l.entity_id) === String(metaAdId) && String(l.entity_type) === 'ad').slice(0, 10),
      validation: null,
    };
    renderAdStudio();
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
  }
}

function buildDraftFromStudio(studio) {
  const preview = studio.preview || {};
  return {
    mode: 'clone_transform',
    name: studio.name || '',
    status: studio.status || 'PAUSED',
    selectedCreativeId: studio.creative_id || '',
    pageId: preview.page_id || '',
    instagramActorId: preview.instagram_actor_id || '',
    headline: preview.headline || '',
    primaryText: preview.primary_text || '',
    description: preview.description || '',
    cta: preview.cta || 'LEARN_MORE',
    linkUrl: preview.link_url || '',
    displayLink: preview.display_link || '',
    imageUrl: preview.image_url || '',
    imageHash: preview.image_hash || '',
    videoId: preview.video_id || '',
    versionNote: '',
  };
}

function renderAdStudio() {
  const s = adStudioState;
  const current = s.original.preview || {};
  const draft = s.draft;
  setDrawerBody(`
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">${['identity','creative','copy','preview','history'].map(sec => `<button class="btn btn-sm entity-section-tab ${adStudioSection===sec?'btn-primary':''}" onclick="switchAdStudioSection('${sec}')">${capitalizeFirst(sec)}</button>`).join('')}</div>
    ${studioWarningBanner(s.original, s.validation)}
    <div data-studio-section="identity" style="display:${adStudioSection==='identity'?'block':'none'};">
      <div class="form-row"><div class="form-group"><label class="form-label">Ad Name</label><input id="as-name" class="form-input" value="${escapeHtml(draft.name)}" oninput="updateStudioDraft('name', this.value)" /></div><div class="form-group"><label class="form-label">Status</label><select id="as-status" class="form-select" onchange="updateStudioDraft('status', this.value)">${['ACTIVE','PAUSED'].map(v => `<option value="${v}" ${draft.status===v?'selected':''}>${v}</option>`).join('')}</select></div></div>
      <div class="form-group"><label class="form-label">Mode</label><select id="as-mode" class="form-select" onchange="updateStudioDraft('mode', this.value); renderAdStudio();"><option value="clone_transform" ${draft.mode==='clone_transform'?'selected':''}>Clone and transform current creative</option><option value="existing_creative" ${draft.mode==='existing_creative'?'selected':''}>Use existing creative</option></select></div>
      <div class="form-row"><div class="form-group"><label class="form-label">Facebook Page</label><select id="as-page" class="form-select" onchange="updateStudioDraft('pageId', this.value)"><option value="">Select page</option>${s.pages.map(p => `<option value="${p.id}" ${String(draft.pageId)===String(p.id)?'selected':''}>${p.name}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Instagram Identity</label><select id="as-ig" class="form-select" onchange="updateStudioDraft('instagramActorId', this.value)"><option value="">None</option>${s.pages.filter(p => p.instagram_business_account).map(p => `<option value="${p.instagram_business_account.id}" ${String(draft.instagramActorId)===String(p.instagram_business_account.id)?'selected':''}>${p.instagram_business_account.username || p.instagram_business_account.id}</option>`).join('')}</select></div></div>
      <div class="form-group"><label class="form-label">Version Note</label><input id="as-version-note" class="form-input" value="${escapeHtml(draft.versionNote || '')}" placeholder="v2 CTA test" oninput="updateStudioDraft('versionNote', this.value)" /></div>
    </div>
    <div data-studio-section="creative" style="display:${adStudioSection==='creative'?'block':'none'};">
      <div class="form-row"><div class="form-group"><label class="form-label">Image URL</label><input id="as-image-url" class="form-input" value="${escapeHtml(draft.imageUrl || '')}" placeholder="https://..." oninput="updateStudioDraft('imageUrl', this.value)" /></div><div class="form-group"><label class="form-label">Video ID</label><input id="as-video-id" class="form-input" value="${escapeHtml(draft.videoId || '')}" placeholder="1234567890" oninput="updateStudioDraft('videoId', this.value)" /></div></div>
      <div class="form-group"><label class="form-label">Existing Creative Browser</label><div style="max-height:220px; overflow:auto; border:1px solid var(--border); border-radius:8px; padding:10px; display:grid; gap:8px;">${s.creatives.map(c => `<button class="btn" style="text-align:left; justify-content:flex-start; ${String(draft.selectedCreativeId)===String(c.id)?'border-color:var(--accent);':''}" onclick="selectExistingCreative('${c.id}')"><div><div style="font-weight:600; font-size:0.8rem;">${escapeHtml(c.name || c.id)}</div><div class="text-muted" style="font-size:0.72rem;">${escapeHtml(c.preview.headline || c.id)}</div></div></button>`).join('')}</div></div>
      <div class="text-muted" style="font-size:0.78rem;">When mode is “Use existing creative”, the selected creative will be rebound directly to the ad.</div>
    </div>
    <div data-studio-section="copy" style="display:${adStudioSection==='copy'?'block':'none'};">
      <div class="form-group"><label class="form-label">Headline</label><input id="as-headline" class="form-input" value="${escapeHtml(draft.headline)}" oninput="updateStudioDraft('headline', this.value)" /></div>
      <div class="form-group"><label class="form-label">Primary Text</label><textarea id="as-primary" class="form-textarea" rows="5" oninput="updateStudioDraft('primaryText', this.value)">${escapeHtml(draft.primaryText)}</textarea></div>
      <div class="form-group"><label class="form-label">Description</label><input id="as-description" class="form-input" value="${escapeHtml(draft.description)}" oninput="updateStudioDraft('description', this.value)" /></div>
      <div class="form-row"><div class="form-group"><label class="form-label">CTA</label><select id="as-cta" class="form-select" onchange="updateStudioDraft('cta', this.value)">${['SIGN_UP','LEARN_MORE','SHOP_NOW','BOOK_NOW','DOWNLOAD','GET_OFFER','BET_NOW','PLAY_GAME','APPLY_NOW','CONTACT_US','SUBSCRIBE','GET_QUOTE','NO_BUTTON'].map(v => `<option value="${v}" ${draft.cta===v?'selected':''}>${v.replace(/_/g,' ')}</option>`).join('')}</select></div><div class="form-group"><label class="form-label">Destination URL</label><input id="as-link-url" class="form-input" value="${escapeHtml(draft.linkUrl)}" oninput="updateStudioDraft('linkUrl', this.value)" /></div></div>
      <div class="form-group"><label class="form-label">Display Link</label><input id="as-display-link" class="form-input" value="${escapeHtml(draft.displayLink || '')}" oninput="updateStudioDraft('displayLink', this.value)" /></div>
    </div>
    <div data-studio-section="preview" style="display:${adStudioSection==='preview'?'block':'none'};">
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:16px;">${previewPane('Before', current, s.original.review_feedback)}${previewPane('After', draftToPreview(draft), s.validation && !s.validation.valid ? s.validation.errors.join(', ') : null)}</div>
      <div class="mt-md text-muted" style="font-size:0.78rem;">Accurate enough for workflow preview, but Meta may still render placements slightly differently.</div>
    </div>
    <div data-studio-section="history" style="display:${adStudioSection==='history'?'block':'none'};"><div class="reco-card" style="background:var(--bg-elevated);">${s.logs.length ? s.logs.map(log => `<div style="padding:8px 0; border-bottom:1px solid var(--border-light);"><div style="font-weight:600; font-size:0.8rem;">${escapeHtml(log.action || '')}</div><div class="text-muted" style="font-size:0.72rem;">${fmtDateTime(log.created_at)}</div></div>`).join('') : '<div class="text-muted">No recent creative history log for this ad.</div>'}</div></div>
    <div style="display:flex; gap:8px; margin-top:18px; position:sticky; bottom:0; background:var(--bg-panel); padding-top:12px; flex-wrap:wrap;">
      <button class="btn btn-primary" onclick="validateAdStudio()">Validate</button>
      <button class="btn btn-primary" onclick="saveAdStudio()">Publish</button>
      <button class="btn" onclick="dupAd('${s.adId}','${escapeJs(s.original.name || '')}')">Duplicate</button>
      <button class="btn" onclick="resetAdStudio()">Revert</button>
      <button class="btn" onclick="closeDrawer()">Close</button>
    </div>
  `);
}

function switchAdStudioSection(section) { adStudioSection = section; renderAdStudio(); }
function updateStudioDraft(key, value) { if (!adStudioState) return; adStudioState.draft[key] = value; }
function resetAdStudio() { if (!adStudioState) return; adStudioState.draft = buildDraftFromStudio(adStudioState.original); adStudioState.validation = null; renderAdStudio(); }
function selectExistingCreative(id) { if (!adStudioState) return; adStudioState.draft.selectedCreativeId = id; adStudioState.draft.mode = 'existing_creative'; renderAdStudio(); }
function draftToPayload() { const s = adStudioState; return { accountId: ACCOUNT_ID, adId: s.adId, mode: s.draft.mode, name: s.draft.name, status: s.draft.status, selectedCreativeId: s.draft.selectedCreativeId, pageId: s.draft.pageId, instagramActorId: s.draft.instagramActorId, headline: s.draft.headline, primaryText: s.draft.primaryText, description: s.draft.description, cta: s.draft.cta, linkUrl: s.draft.linkUrl, displayLink: s.draft.displayLink, imageUrl: s.draft.imageUrl, imageHash: s.draft.imageHash, videoId: s.draft.videoId, versionNote: s.draft.versionNote }; }
async function validateAdStudio() { if (!adStudioState) return; try { const res = await apiPost('/meta/ad-validate', draftToPayload()); adStudioState.validation = res.validation; renderAdStudio(); toast(res.validation.valid ? 'Validation passed' : 'Validation has issues', res.validation.valid ? 'success' : 'error'); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
async function saveAdStudio() { if (!adStudioState) return; try { if (!adStudioState.validation || !adStudioState.validation.valid) { const res = await apiPost('/meta/ad-validate', draftToPayload()); adStudioState.validation = res.validation; if (!res.validation.valid) { renderAdStudio(); toast('Fix validation issues first', 'error'); return; } } const res = await apiPost('/meta/ad-studio-update', draftToPayload()); toast('Ad updated', 'success'); adStudioState.original = res.after; adStudioState.draft = buildDraftFromStudio(res.after); adStudioState.validation = res.validation || null; renderAdStudio(); loadAdCreative(adStudioState.adId); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
function studioWarningBanner(original, validation) { const messages = []; if (original.review_feedback) messages.push('<div class="alert-banner alert-warning">This ad has Meta review feedback. Check approval before publishing a new creative.</div>'); if (validation && !validation.valid) messages.push(`<div class="alert-banner alert-critical">${validation.errors.join(' • ')}</div>`); if (validation && validation.warning_reenter_review) messages.push('<div class="alert-banner alert-warning">Editing creatives may send the ad back into review.</div>'); return messages.join(''); }
function previewPane(title, preview, warning) { const img = preview.image_url || preview.thumbnail_url; return `<div class="reco-card" style="background:var(--bg-elevated);"><div class="reco-entity mb-sm">${title}</div>${warning ? `<div class="alert-banner alert-warning" style="margin-bottom:10px;">${escapeHtml(warning)}</div>` : ''}<div style="background:var(--bg-base); border-radius:8px; min-height:180px; display:flex; align-items:center; justify-content:center; overflow:hidden; margin-bottom:12px;">${preview.video_id ? `<div style="padding:20px; width:100%;"><div class="badge badge-active" style="margin-bottom:8px;">VIDEO</div>${img ? `<img src="${img}" style="width:100%; max-height:180px; object-fit:contain; border-radius:6px;" />` : `<div class="text-muted">Video ID: ${preview.video_id}</div>`}</div>` : img ? `<img src="${img}" style="width:100%; max-height:220px; object-fit:contain;" />` : '<div class="text-muted">No preview image</div>'}</div><div style="font-size:0.8rem; line-height:1.65;">${preview.headline ? `<div><span class="kpi-label" style="display:inline;">Headline:</span> ${escapeHtml(preview.headline)}</div>` : ''}${preview.primary_text ? `<div><span class="kpi-label" style="display:inline;">Primary:</span> ${escapeHtml(truncate(preview.primary_text, 160))}</div>` : ''}${preview.description ? `<div><span class="kpi-label" style="display:inline;">Description:</span> ${escapeHtml(preview.description)}</div>` : ''}${preview.cta ? `<div><span class="kpi-label" style="display:inline;">CTA:</span> ${escapeHtml(preview.cta)}</div>` : ''}${preview.link_url ? `<div><span class="kpi-label" style="display:inline;">URL:</span> ${escapeHtml(truncate(preview.link_url, 60))}</div>` : ''}</div></div>`; }
function draftToPreview(d) { return { headline:d.headline, primary_text:d.primaryText, description:d.description, cta:d.cta, link_url:d.linkUrl, display_link:d.displayLink, image_url:d.imageUrl, thumbnail_url:d.imageUrl, video_id:d.videoId, page_id:d.pageId, instagram_actor_id:d.instagramActorId }; }
function capitalizeFirst(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

async function pauseAd(metaId, name) { if (!confirmAction(`Pause "${name}"?`)) return; try { await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId }); toast(`Paused: ${name}`, 'success'); navigateTo('ads', pageState); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
async function resumeAd(metaId, name) { if (!confirmAction(`Resume "${name}"?`)) return; try { await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId }); toast(`Resumed: ${name}`, 'success'); navigateTo('ads', pageState); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
async function dupAd(metaId, name) { if (!confirmAction(`Duplicate "${name}"?`)) return; try { await apiPost('/actions/duplicate', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId }); toast(`Duplicated: ${name}`, 'success'); } catch (err) { toast(`Error: ${err.message}`, 'error'); } }
