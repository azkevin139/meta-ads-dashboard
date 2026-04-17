/* ═══════════════════════════════════════════════════════════
   Ads Page — bulk + create + edit
   ═══════════════════════════════════════════════════════════ */

const adsBulk = window.AdsBulkHelpers.createAdsBulk({
  getPageState: () => pageState,
});
const adsCreative = window.AdsCreativeHelpers.createAdsCreative();
const adsActions = window.AdsActionHelpers.createAdsActions({
  getPageState: () => pageState,
});
const adsEditor = window.AdsEditorHelpers.createAdsEditor({
  getPageState: () => pageState,
  loadCreative: (adId) => adsCreative.loadAdCreative(adId),
});
const adsRowActions = window.RowActionHelpers;
const adsBulkSelection = window.BulkSelectionHelpers.createBulkSelection({
  checkboxSelector: '.ad-check',
  barId: 'ad-bulk-bar',
  countId: 'ad-bulk-count',
});

async function loadAds(container) {
  const metaAdsetId = pageState.metaAdsetId || pageState.adsetId;
  const adsetName = pageState.adsetName || 'Ad Set';
  const metaCampaignId = pageState.metaCampaignId;
  const campaignName = pageState.campaignName || 'Campaign';
  adsBulkSelection.clear();
  adsBulk.init(adsBulkSelection);

  if (!metaAdsetId) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎨</div><div class="empty-state-text">Select an ad set first</div><button class="btn mt-md" data-ads-nav="campaigns">← Go to Campaigns</button></div>';
    bindAdsControls(container);
    return;
  }

  document.getElementById('page-title').textContent = `Ads — ${adsetName}`;

  container.innerHTML = `
    <div class="flex-between mb-md">
      <div style="display: flex; gap: 8px;">
        <button class="btn btn-sm" data-ads-nav="adsets" data-campaign-id="${metaCampaignId || ''}" data-campaign-name="${escapeHtml(campaignName || '')}">← Back</button>
        <button class="btn btn-primary btn-sm" data-ad-create="${metaAdsetId}">+ New Ad</button>
      </div>
    </div>
    <div id="ad-bulk-bar" style="display:none; padding: 10px 16px; background: var(--accent-bg); border: 1px solid var(--accent-dim); border-radius: var(--radius); margin-bottom: 14px; align-items: center; gap: 12px;">
      <span id="ad-bulk-count" style="font-weight: 600; font-size: 0.85rem;">0 selected</span>
      <button class="btn btn-sm btn-danger" data-ad-bulk="pause">Pause</button>
      <button class="btn btn-sm" data-ad-bulk="resume">Resume</button>
      <button class="btn btn-sm" data-ad-bulk="clear">Clear</button>
    </div>
    <div id="ads-grid"><div class="loading">Loading ads</div></div>
  `;
  bindAdsControls(container);

  try {
    const res = await apiGet(`/meta/ads?adSetId=${metaAdsetId}`);
    const ads = (res.data || []).filter(a => ['ACTIVE','PAUSED','PENDING_REVIEW'].includes(a.effective_status));

    let insightsMap = {};
    try {
      const campaignRange = window.getCampaignDateRange ? window.getCampaignDateRange() : { from: daysAgoStr(1), to: daysAgoStr(1) };
      const insRes = await apiGet(`/meta/live?level=ad&since=${campaignRange.from}&until=${campaignRange.to}`);
      for (const row of (insRes.data || [])) { if (row.ad_id) insightsMap[row.ad_id] = row; }
    } catch (e) {}

    if (ads.length === 0) {
      document.getElementById('ads-grid').innerHTML = '<div class="empty-state"><div class="empty-state-text">No ads found</div></div>';
      return;
    }

    document.getElementById('ads-grid').innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 20px;">
        ${ads.map(ad => adCard(ad, insightsMap[ad.id])).join('')}
      </div>
    `;
    for (const ad of ads) { adsCreative.loadAdCreative(ad.id); }
  } catch (err) {
    document.getElementById('ads-grid').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

// ─── BULK ─────────────────────────────────────────────────

function updateAdSelection() { adsBulkSelection.sync(); }
function clearAdSelection() { adsBulkSelection.clear(); }
async function bulkAdAction(action) { return adsBulk.bulkAdAction(action); }

// ─── AD CARD ──────────────────────────────────────────────

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
          <input type="checkbox" class="ad-check" value="${ad.id}" />
          <div class="reco-entity" style="font-size: 0.85rem;">${ad.name}</div>
        </div>
        ${statusBadge(ad.effective_status)}
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

      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 8px; margin-bottom: 14px;">
        <div><div class="kpi-label">CPM</div><div class="mono" style="font-size:0.85rem;">${ins.cpm ? fmt(ins.cpm,'currency') : '—'}</div></div>
        <div><div class="kpi-label">CPC</div><div class="mono" style="font-size:0.85rem;">${ins.cpc ? fmt(ins.cpc,'currency') : '—'}</div></div>
        <div><div class="kpi-label">Impr.</div><div class="mono" style="font-size:0.85rem;">${ins.impressions ? fmt(ins.impressions,'compact') : '—'}</div></div>
        <div><div class="kpi-label">Clicks</div><div class="mono" style="font-size:0.85rem;">${ins.clicks ? fmt(ins.clicks,'compact') : '—'}</div></div>
      </div>

      <div style="display: flex; gap: 6px; padding-top: 12px; border-top: 1px solid var(--border-light);">
        <button class="btn btn-sm btn-primary" data-ad-edit="${ad.id}" data-ad-name="${escapeHtml(ad.name || '')}">Edit</button>
        ${ad.effective_status === 'ACTIVE'
          ? `<button class="btn btn-sm btn-danger" data-ad-status="pause" data-ad-id="${ad.id}" data-ad-name="${escapeHtml(ad.name || '')}">Pause</button>`
          : `<button class="btn btn-sm" data-ad-status="resume" data-ad-id="${ad.id}" data-ad-name="${escapeHtml(ad.name || '')}">Resume</button>`}
        <button class="btn btn-sm" data-ad-duplicate="${ad.id}" data-ad-name="${escapeHtml(ad.name || '')}">Duplicate</button>
      </div>
    </div>
  `;
}

function truncate(str, len) { return str && str.length > len ? str.substring(0, len) + '...' : str || ''; }
function escapeHtml(str) { return (str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function bindAdsControls(container) {
  if (container.__adsControlsBound) return;
  container.__adsControlsBound = true;
  adsRowActions.bind(container, {
    change: [
      { selector: '.ad-check', closest: false, handle: () => updateAdSelection() },
    ],
    click: [
      { selector: '[data-ads-nav]', handle: (event, match) => {
        if (match.dataset.adsNav === 'adsets') {
          return navigateTo('adsets', {
            metaCampaignId: match.dataset.campaignId || '',
            campaignName: match.dataset.campaignName || '',
          });
        }
        return navigateTo(match.dataset.adsNav);
      } },
      { selector: '[data-ad-create]', handle: (event, match) => adsEditor.openCreateAd(match.dataset.adCreate) },
      { selector: '[data-ad-bulk]', handle: (event, match) => match.dataset.adBulk === 'clear' ? clearAdSelection() : bulkAdAction(match.dataset.adBulk) },
      { selector: '[data-ad-edit]', handle: (event, match) => adsEditor.openEditAd(match.dataset.adEdit, match.dataset.adName || '') },
      { selector: '[data-ad-status]', handle: (event, match) => match.dataset.adStatus === 'pause' ? adsActions.pauseAd(match.dataset.adId, match.dataset.adName || '') : adsActions.resumeAd(match.dataset.adId, match.dataset.adName || '') },
      { selector: '[data-ad-duplicate]', handle: (event, match) => adsActions.duplicateAd(match.dataset.adDuplicate, match.dataset.adName || '') },
    ],
  });
}
