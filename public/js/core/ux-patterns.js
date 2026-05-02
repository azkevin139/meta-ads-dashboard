(function () {
  const EVENT_BUFFER_LIMIT = 20;
  const EVENT_FLUSH_MS = 5000;
  const EVENT_MAX_PAYLOAD_KEYS = 12;
  let eventBuffer = [];
  let flushTimer = null;
  const firstClickByPage = new Set();
  const pageStartByPage = new Map();
  const sessionId = getSessionId();

  function getSessionId() {
    try {
      const key = 'linxio_ux_session_id';
      let value = window.sessionStorage.getItem(key);
      if (!value) {
        value = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(key, value);
      }
      return value;
    } catch (err) {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  function currentPageName() {
    return window.DashboardApp?.getCurrentPage?.() || window.currentPage || null;
  }

  function currentAccountId() {
    return window.DashboardApp?.getAccountId?.() || window.ACCOUNT_ID || null;
  }

  function currentRoute() {
    return `${window.location.pathname}${window.location.hash || ''}`;
  }

  function sanitizePayload(payload = {}) {
    const clean = {};
    Object.entries(payload || {}).slice(0, EVENT_MAX_PAYLOAD_KEYS).forEach(([key, value]) => {
      const safeKey = String(key).slice(0, 80);
      if (value === null || value === undefined) {
        clean[safeKey] = value;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        clean[safeKey] = value;
      } else {
        clean[safeKey] = String(value).slice(0, 500);
      }
    });
    return clean;
  }

  async function flushEvents() {
    if (!eventBuffer.length) return;
    const events = eventBuffer.splice(0, eventBuffer.length);
    clearTimeout(flushTimer);
    flushTimer = null;
    try {
      await window.ApiClient.request('/intelligence/ux-events', {
        method: 'POST',
        body: JSON.stringify({ accountId: currentAccountId(), events }),
      });
    } catch (err) {
      // Validation telemetry must never block operator workflows.
      if (eventBuffer.length < EVENT_BUFFER_LIMIT) eventBuffer = events.concat(eventBuffer).slice(0, EVENT_BUFFER_LIMIT);
    }
  }

  function enqueueEvent(event) {
    eventBuffer.push(event);
    if (eventBuffer.length >= EVENT_BUFFER_LIMIT) {
      flushEvents();
      return;
    }
    if (!flushTimer) flushTimer = setTimeout(flushEvents, EVENT_FLUSH_MS);
  }

  function recordFirstClick(page) {
    if (!page || firstClickByPage.has(page)) return;
    firstClickByPage.add(page);
    const startedAt = pageStartByPage.get(page) || performance.now();
    enqueueEvent({
      name: 'time_to_first_click',
      page,
      accountId: currentAccountId(),
      sessionId,
      route: currentRoute(),
      payload: { elapsed_ms: Math.round(performance.now() - startedAt) },
      at: new Date().toISOString(),
    });
  }

  function markPageStart(page = currentPageName()) {
    if (!page) return;
    if (!pageStartByPage.has(page)) pageStartByPage.set(page, performance.now());
  }

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
    const page = currentPageName();
    markPageStart(page);
    window.dispatchEvent(new CustomEvent('ux:track', {
      detail: {
        name,
        page,
        accountId: currentAccountId(),
        sessionId,
        route: currentRoute(),
        payload: sanitizePayload(payload),
        at: new Date().toISOString(),
      },
    }));
  }

  window.addEventListener('ux:track', (event) => {
    const detail = event.detail || {};
    if (!detail.name) return;
    enqueueEvent({
      name: String(detail.name).slice(0, 120),
      page: detail.page || currentPageName(),
      accountId: detail.accountId || currentAccountId(),
      sessionId: detail.sessionId || sessionId,
      route: detail.route || currentRoute(),
      payload: sanitizePayload(detail.payload || {}),
      at: detail.at || new Date().toISOString(),
    });
  });

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-ux-track]');
    if (!target) return;
    const page = currentPageName();
    recordFirstClick(page);
    track(target.dataset.uxTrack, {
      text: target.textContent?.trim() || '',
      navTarget: target.dataset.navTarget || target.dataset.intelNav || null,
      campaignId: target.dataset.campaignEdit || target.dataset.campaignOpen || null,
    });
  });

  window.addEventListener('beforeunload', () => {
    if (!eventBuffer.length) return;
    try {
      const csrfToken = window.SessionState?.getCsrfToken?.();
      fetch('/api/intelligence/ux-events', {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({ accountId: currentAccountId(), events: eventBuffer }),
      }).catch(() => {});
    } catch (err) {}
  });

  window.UXPatterns = {
    badgeClass,
    actionAlert,
    emptyState,
    track,
    markPageStart,
    flushEvents,
  };
})();
