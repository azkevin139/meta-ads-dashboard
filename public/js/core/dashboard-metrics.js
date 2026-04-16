(function () {
  const EVENT_TYPE_MAP = {
    INITIATE_CHECKOUT: { types: ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout'], label: 'Initiate Checkout' },
    PURCHASE: { types: ['offsite_conversion.fb_pixel_purchase', 'purchase', 'omni_purchase'], label: 'Purchase' },
    LEAD: { types: ['offsite_conversion.fb_pixel_lead', 'lead', 'onsite_conversion.lead_grouped', 'leadgen.other'], label: 'Lead' },
    COMPLETE_REGISTRATION: { types: ['offsite_conversion.fb_pixel_complete_registration', 'complete_registration'], label: 'Registration' },
    ADD_TO_CART: { types: ['offsite_conversion.fb_pixel_add_to_cart', 'add_to_cart'], label: 'Add to Cart' },
    VIEW_CONTENT: { types: ['offsite_conversion.fb_pixel_view_content', 'view_content'], label: 'View Content' },
    CONTACT: { types: ['offsite_conversion.fb_pixel_contact', 'contact'], label: 'Contact' },
    SUBSCRIBE: { types: ['offsite_conversion.fb_pixel_subscribe', 'subscribe'], label: 'Subscribe' },
    SCHEDULE: { types: ['offsite_conversion.fb_pixel_schedule', 'schedule'], label: 'Schedule' },
    START_TRIAL: { types: ['offsite_conversion.fb_pixel_start_trial', 'start_trial'], label: 'Start Trial' },
    SUBMIT_APPLICATION: { types: ['offsite_conversion.fb_pixel_submit_application', 'submit_application'], label: 'Submit Application' },
    ADD_PAYMENT_INFO: { types: ['offsite_conversion.fb_pixel_add_payment_info', 'add_payment_info'], label: 'Payment Info' },
    SEARCH: { types: ['offsite_conversion.fb_pixel_search', 'search'], label: 'Search' },
    DONATE: { types: ['offsite_conversion.fb_pixel_donate', 'donate'], label: 'Donate' },
    LINK_CLICK: { types: ['link_click'], label: 'Link Click' },
    LANDING_PAGE_VIEW: { types: ['landing_page_view'], label: 'Landing Page View' },
    INSTALL: { types: ['app_install', 'mobile_app_install'], label: 'Install' },
  };

  const DEFAULT_RESULT_PRIORITY = ['INITIATE_CHECKOUT', 'PURCHASE', 'LEAD', 'COMPLETE_REGISTRATION'];

  function parseResults(actions, desiredEvent = null) {
    if (!actions || !Array.isArray(actions)) return { count: 0, type: '—' };
    const desiredKey = desiredEvent && desiredEvent.event_type ? String(desiredEvent.event_type).toUpperCase() : null;
    const desiredLabel = desiredEvent && desiredEvent.event_label ? desiredEvent.event_label : null;

    const tryKey = (key) => {
      const spec = EVENT_TYPE_MAP[key];
      if (!spec) return null;
      for (const action of actions) {
        if (spec.types.includes(action.action_type)) {
          return { count: parseInt(action.value, 10) || 0, type: desiredLabel && key === desiredKey ? desiredLabel : spec.label };
        }
      }
      return null;
    };

    if (desiredKey) {
      const hit = tryKey(desiredKey);
      if (hit) return hit;
    }

    for (const key of DEFAULT_RESULT_PRIORITY) {
      const hit = tryKey(key);
      if (hit) return hit;
    }
    return { count: 0, type: desiredLabel || '—' };
  }

  function parseCostPerResult(costPerActions, resultType) {
    if (!costPerActions || !Array.isArray(costPerActions)) return 0;
    const wanted = String(resultType || '').toLowerCase();
    for (const spec of Object.values(EVENT_TYPE_MAP)) {
      if (spec.label.toLowerCase() !== wanted) continue;
      for (const action of costPerActions) {
        if (spec.types.includes(action.action_type)) return parseFloat(action.value) || 0;
      }
    }
    return 0;
  }

  function todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  function daysAgoStr(n) {
    const date = new Date();
    date.setDate(date.getDate() - n);
    return date.toISOString().split('T')[0];
  }

  function statusBadge(status) {
    const s = String(status || '').toUpperCase();
    const cls = s === 'ACTIVE' ? 'badge-active' : s === 'PAUSED' ? 'badge-paused' : 'badge-error';
    return `<span class="badge ${cls}">${s}</span>`;
  }

  function urgencyBadge(urgency) {
    return `<span class="badge badge-${urgency}">${urgency}</span>`;
  }

  function metricColor(value, thresholds, invert = false) {
    const n = parseFloat(value);
    if (Number.isNaN(n)) return '';
    if (invert) {
      if (n <= thresholds.good) return 'text-green';
      if (n >= thresholds.bad) return 'text-red';
      return '';
    }
    if (n >= thresholds.good) return 'text-green';
    if (n <= thresholds.bad) return 'text-red';
    return '';
  }

  function sparkline(data, width = 60, height = 20) {
    if (!data || data.length < 2) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const step = width / (data.length - 1);
    const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(' ');
    const color = data[data.length - 1] >= data[0] ? 'var(--green)' : 'var(--red)';
    return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function kpiCard(label, value) {
    return `<div class="kpi-card"><div class="kpi-label">${label}</div><div class="kpi-value">${value}</div></div>`;
  }

  function formatSeconds(totalSeconds) {
    const s = Math.max(0, Math.round(totalSeconds || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  window.DashboardMetrics = {
    EVENT_TYPE_MAP,
    parseResults,
    parseCostPerResult,
    todayStr,
    daysAgoStr,
    statusBadge,
    urgencyBadge,
    metricColor,
    sparkline,
    kpiCard,
    formatSeconds,
  };
})();
