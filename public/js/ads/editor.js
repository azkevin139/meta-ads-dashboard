(function () {
  const CTA_OPTIONS = ['SIGN_UP','LEARN_MORE','SHOP_NOW','BOOK_NOW','DOWNLOAD','GET_OFFER','BET_NOW','PLAY_GAME','APPLY_NOW','CONTACT_US','SUBSCRIBE'];
  const EDIT_CTA_OPTIONS = [...CTA_OPTIONS, 'GET_QUOTE', 'NO_BUTTON'];

  function createAdsEditor({ getPageState, loadCreative }) {
    let drawerBound = false;

    function bindDrawerActions() {
      if (drawerBound) return;
      drawerBound = true;
      document.addEventListener('click', async (event) => {
        const createSubmit = event.target.closest('[data-ad-drawer-submit-create]');
        if (createSubmit) return submitCreateAd(createSubmit.dataset.adDrawerSubmitCreate);
        const editSubmit = event.target.closest('[data-ad-drawer-save]');
        if (editSubmit) return saveAdEdit(editSubmit.dataset.adDrawerSave, editSubmit.dataset.adCreativeId || '');
      });
    }

    async function openCreateAd(adsetId) {
      openDrawer('Create Ad', '<div class="loading">Loading pages...</div>');

      let pages = [];
      try {
        const pgRes = await apiGet('/create/pages');
        pages = pgRes.data || [];
      } catch (e) {}

      setDrawerBody(`
        <div class="form-group">
          <label class="form-label">Ad Name</label>
          <input id="ca-name" class="form-input" type="text" placeholder="e.g. Slots — Jackpot Visual — V1" />
        </div>

        <div class="form-group">
          <label class="form-label">Facebook Page</label>
          <select id="ca-page" class="form-select">
            <option value="">Select page</option>
            ${pages.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}
          </select>
        </div>

        <div style="font-weight:600; font-size:0.82rem; color:var(--accent); margin:16px 0 10px; text-transform:uppercase; letter-spacing:0.06em;">Creative</div>

        <div class="form-group">
          <label class="form-label">Image URL</label>
          <input id="ca-image" class="form-input" type="url" placeholder="https://example.com/ad-image.jpg" />
          <div class="text-muted" style="font-size:0.7rem; margin-top:4px;">Direct URL to image. Will be uploaded to Meta.</div>
        </div>

        <div class="form-group">
          <label class="form-label">Primary Text</label>
          <textarea id="ca-primary" class="form-textarea" rows="4" placeholder="The main body text of your ad"></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Headline</label>
          <input id="ca-headline" class="form-input" type="text" placeholder="e.g. Bet NHL with $500 Bonus" />
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <input id="ca-description" class="form-input" type="text" placeholder="Optional description line" />
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">CTA Button</label>
            <select id="ca-cta" class="form-select">
              ${CTA_OPTIONS.map((c) => `<option value="${c}" ${c === 'SIGN_UP' ? 'selected' : ''}>${c.replace(/_/g, ' ')}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Destination URL</label>
            <input id="ca-link" class="form-input" type="url" placeholder="https://yoursite.com/landing" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Initial Status</label>
          <select id="ca-status" class="form-select">
            <option value="PAUSED">Paused</option>
            <option value="ACTIVE">Active</option>
          </select>
        </div>

        <div style="display: flex; gap: 8px; margin-top: 20px;">
          <button class="btn btn-primary" data-ad-drawer-submit-create="${adsetId}">Create Ad</button>
          <button class="btn" onclick="closeDrawer()">Cancel</button>
        </div>
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
        await apiPost('/create/ad', {
          name, adsetId, status, pageId,
          imageUrl, primaryText, headline, description, cta, linkUrl,
        });
        toast(`Ad created: ${name}`, 'success');
        closeDrawer();
        navigateTo('ads', getPageState());
      } catch (err) {
        toast(`Error: ${safeErrorMessage(err)}`, 'error');
      }
    }

    async function openEditAd(metaAdId, name) {
      openDrawer('Edit Ad', '<div class="loading">Loading...</div>');
      try {
        const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);
        setDrawerBody(`
          <div style="margin-bottom:16px;"><div style="font-weight:600; font-size:0.9rem;">${name}</div><div class="text-muted" style="font-size:0.75rem;">ID: ${metaAdId}</div></div>
          <div class="form-group"><label class="form-label">Primary Text</label><textarea id="edit-primary-text" class="form-textarea" rows="5">${escapeHtml(res.primary_text || '')}</textarea></div>
          <div class="form-group"><label class="form-label">Headline</label><input id="edit-headline" class="form-input" type="text" value="${escapeHtml(res.headline || '')}" /></div>
          <div class="form-group"><label class="form-label">Description</label><input id="edit-description" class="form-input" type="text" value="${escapeHtml(res.description || '')}" /></div>
          <div class="form-row">
            <div class="form-group"><label class="form-label">CTA</label><select id="edit-cta" class="form-select">${EDIT_CTA_OPTIONS.map((c) => `<option value="${c}" ${res.cta === c ? 'selected' : ''}>${c.replace(/_/g, ' ')}</option>`).join('')}</select></div>
            <div class="form-group"><label class="form-label">Link URL</label><input id="edit-link" class="form-input" type="url" value="${escapeHtml(res.link_url || '')}" /></div>
          </div>
          <div style="display:flex; gap:8px; margin-top:20px;">
            <button class="btn btn-primary" data-ad-drawer-save="${metaAdId}" data-ad-creative-id="${res.creative_id || ''}">Save Changes</button>
            <button class="btn" onclick="closeDrawer()">Cancel</button>
          </div>
          <div style="font-size:0.72rem; color:var(--text-muted); margin-top:12px;">Editing creates a new creative. Ad may re-enter review.</div>
        `);
      } catch (err) {
        setDrawerBody(`<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`);
      }
    }

    async function saveAdEdit(metaAdId, creativeId) {
      const headline = document.getElementById('edit-headline').value;
      const primaryText = document.getElementById('edit-primary-text').value;
      const description = document.getElementById('edit-description').value;
      const cta = document.getElementById('edit-cta').value;
      const linkUrl = document.getElementById('edit-link').value;
      if (!confirmAction('Save changes? Ad may re-enter review.')) return;
      try {
        toast('Saving...', 'info');
        await apiPost('/meta/update-ad', { adId: metaAdId, creativeId, headline, primaryText, description, cta, linkUrl });
        toast('Ad updated', 'success');
        closeDrawer();
        loadCreative(metaAdId);
      } catch (err) {
        toast(`Error: ${safeErrorMessage(err)}`, 'error');
      }
    }

    bindDrawerActions();

    return {
      openCreateAd,
      openEditAd,
    };
  }

  window.AdsEditorHelpers = {
    createAdsEditor,
  };
})();
