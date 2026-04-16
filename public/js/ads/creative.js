(function () {
  function createAdsCreative() {
    function truncate(str, len) {
      return str && str.length > len ? str.substring(0, len) + '...' : str || '';
    }

    async function loadAdCreative(metaAdId) {
      const imgEl = document.getElementById(`creative-${metaAdId}`);
      const detailEl = document.getElementById(`details-${metaAdId}`);
      try {
        const res = await apiGet(`/meta/ad-detail?adId=${metaAdId}`);
        if (imgEl) {
          const imgUrl = res.image_url || res.thumbnail_url;
          imgEl.innerHTML = imgUrl
            ? `<img src="${imgUrl}" alt="Creative" style="width:100%; max-height:350px; object-fit:contain; border-radius:6px; background:var(--bg-base);" onerror="this.parentElement.innerHTML='<div style=\\'padding:30px; text-align:center; color:var(--text-muted);\\'>Preview not available</div>'" />`
            : '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
        }
        if (detailEl) {
          detailEl.innerHTML = `<div style="font-size:0.8rem; line-height:1.7;">
            ${res.headline ? `<div><span class="kpi-label" style="display:inline;">Headline:</span> ${res.headline}</div>` : ''}
            ${res.primary_text ? `<div><span class="kpi-label" style="display:inline;">Primary Text:</span> <span class="text-secondary">${truncate(res.primary_text,150)}</span></div>` : ''}
            ${res.cta ? `<div><span class="kpi-label" style="display:inline;">CTA:</span> ${res.cta.replace(/_/g,' ')}</div>` : ''}
            ${res.link_url ? `<div><span class="kpi-label" style="display:inline;">Link:</span> <a href="${res.link_url}" target="_blank" style="font-size:0.75rem;">${truncate(res.link_url,50)}</a></div>` : ''}
          </div>`;
        }
      } catch (e) {
        if (imgEl) imgEl.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-muted);">Preview not available</div>';
        if (detailEl) detailEl.innerHTML = '';
      }
    }

    return { loadAdCreative };
  }

  window.AdsCreativeHelpers = {
    createAdsCreative,
  };
})();
