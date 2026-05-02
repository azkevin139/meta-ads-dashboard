(function () {
  function badgeClass(state) {
    const value = String(state || '').toLowerCase();
    if (['healthy', 'fresh', 'success', 'ok', 'active'].includes(value)) return 'active';
    if (['partial', 'stale', 'warning', 'skipped'].includes(value)) return 'warning';
    if (['blocked', 'failed', 'critical', 'error'].includes(value)) return 'critical';
    return 'low';
  }

  function actionAlert({ title, impact, nextStep, severity = 'warning', ctaLabel, target }) {
    return `
      <div class="alert-banner alert-${severity === 'critical' ? 'critical' : severity === 'info' ? 'info' : 'warning'}">
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700;">${escapeHtml(title || 'Action needed')}</div>
          ${impact ? `<div style="font-size:0.78rem; margin-top:3px;">Impact: ${escapeHtml(impact)}</div>` : ''}
          ${nextStep ? `<div style="font-size:0.78rem; margin-top:3px;">Next step: ${escapeHtml(nextStep)}</div>` : ''}
        </div>
        ${ctaLabel && target ? `<button class="btn btn-sm" data-nav-target="${escapeHtml(target)}" data-ux-track="alert_cta">${escapeHtml(ctaLabel)}</button>` : ''}
      </div>
    `;
  }

  function emptyState({ title, nextStep, ctaLabel, target }) {
    return `
      <div class="empty-state">
        <div class="empty-state-text">
          <div style="font-weight:700; color:var(--text-primary); margin-bottom:4px;">${escapeHtml(title || 'Nothing to show yet')}</div>
          ${nextStep ? `<div>${escapeHtml(nextStep)}</div>` : ''}
          ${ctaLabel && target ? `<button class="btn btn-sm mt-md" data-nav-target="${escapeHtml(target)}" data-ux-track="empty_state_cta">${escapeHtml(ctaLabel)}</button>` : ''}
        </div>
      </div>
    `;
  }

  function track(name, payload = {}) {
    window.dispatchEvent(new CustomEvent('ux:track', {
      detail: {
        name,
        page: window.currentPage || null,
        accountId: window.ACCOUNT_ID || null,
        payload,
        at: new Date().toISOString(),
      },
    }));
  }

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-ux-track]');
    if (!target) return;
    track(target.dataset.uxTrack, {
      text: target.textContent?.trim() || '',
      navTarget: target.dataset.navTarget || target.dataset.intelNav || null,
    });
  });

  window.UXPatterns = {
    badgeClass,
    actionAlert,
    emptyState,
    track,
  };
})();
