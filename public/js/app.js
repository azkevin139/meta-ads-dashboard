/* ═══════════════════════════════════════════════════════════
   Meta Ads Dashboard — Shared JS
   ═══════════════════════════════════════════════════════════ */

const API_BASE = '/api';
const ACCOUNT_ID = 1; // default account

// ─── API WRAPPER ──────────────────────────────────────────

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

async function apiGet(path) {
  return api(path);
}

async function apiPost(path, body) {
  return api(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ─── FORMATTING ───────────────────────────────────────────

function fmt(value, type = 'number') {
  if (value === null || value === undefined) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return value;

  switch (type) {
    case 'currency':
      return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent':
      return n.toFixed(2) + '%';
    case 'decimal':
      return n.toFixed(2);
    case 'integer':
      return Math.round(n).toLocaleString('en-US');
    case 'compact':
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return Math.round(n).toLocaleString('en-US');
    default:
      return n.toLocaleString('en-US');
  }
}

function fmtDelta(value) {
  if (value === null || value === undefined || value === 0) return { text: '0%', cls: 'flat' };
  const n = parseFloat(value);
  const arrow = n > 0 ? '↑' : '↓';
  return {
    text: `${arrow} ${Math.abs(n)}%`,
    cls: n > 0 ? 'up' : 'down',
  };
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtBudget(cents) {
  if (!cents) return '—';
  return '$' + (cents / 100).toFixed(2);
}

// ─── STATUS HELPERS ───────────────────────────────────────

function statusBadge(status) {
  const s = (status || '').toUpperCase();
  const cls = s === 'ACTIVE' ? 'badge-active'
    : s === 'PAUSED' ? 'badge-paused'
    : 'badge-error';
  return `<span class="badge ${cls}">${s}</span>`;
}

function urgencyBadge(urgency) {
  const cls = `badge-${urgency}`;
  return `<span class="badge ${cls}">${urgency}</span>`;
}

// CPA / ROAS coloring
function metricColor(value, thresholds, invert = false) {
  // thresholds = { good: X, bad: Y }
  const n = parseFloat(value);
  if (isNaN(n)) return '';
  if (invert) {
    // For CPA: lower is better
    if (n <= thresholds.good) return 'text-green';
    if (n >= thresholds.bad) return 'text-red';
  } else {
    // For ROAS/CTR: higher is better
    if (n >= thresholds.good) return 'text-green';
    if (n <= thresholds.bad) return 'text-red';
  }
  return '';
}

// ─── NAVIGATION ───────────────────────────────────────────

const PAGES = {
  overview: { title: 'Overview', load: 'loadOverview' },
  campaigns: { title: 'Campaigns', load: 'loadCampaigns' },
  adsets: { title: 'Ad Sets', load: 'loadAdSets' },
  ads: { title: 'Ads', load: 'loadAds' },
  ai: { title: 'AI Analyst', load: 'loadAI' },
  logs: { title: 'Action Log', load: 'loadLogs' },
  settings: { title: 'Settings', load: 'loadSettings' },
};

let currentPage = 'overview';
let pageState = {}; // for passing context between pages (campaignId, adsetId, etc.)

function navigateTo(page, state = {}) {
  currentPage = page;
  pageState = { ...pageState, ...state };

  // Update active nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update header title
  const pageConfig = PAGES[page];
  if (pageConfig) {
    document.getElementById('page-title').textContent = pageConfig.title;
  }

  // Load page content
  const body = document.getElementById('page-body');
  body.innerHTML = '<div class="loading">Loading</div>';

  if (pageConfig && pageConfig.load) {
    const fn = typeof pageConfig.load === 'string' ? window[pageConfig.load] : pageConfig.load;
    if (fn) fn(body);
  }

  // Update URL without reload
  history.pushState({ page, ...state }, '', `#${page}`);
}

// Handle back/forward
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.page) {
    navigateTo(e.state.page, e.state);
  }
});

// ─── TOAST NOTIFICATIONS ──────────────────────────────────

function toast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(10px)';
    el.style.transition = 'all 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

// ─── CONFIRM DIALOG ───────────────────────────────────────

function confirmAction(message) {
  return window.confirm(message);
}

// ─── SPARKLINE SVG ────────────────────────────────────────

function sparkline(data, width = 60, height = 20) {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => {
    const x = i * step;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const trending = data[data.length - 1] >= data[0];
  const color = trending ? 'var(--green)' : 'var(--red)';

  return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ─── SLIDE DRAWER ─────────────────────────────────────────

function openDrawer(title, bodyHtml, footerHtml) {
  closeDrawer(); // close any existing
  
  const overlay = document.createElement('div');
  overlay.className = 'drawer-overlay';
  overlay.id = 'drawer-overlay';
  overlay.onclick = closeDrawer;
  document.body.appendChild(overlay);

  const drawer = document.createElement('div');
  drawer.className = 'drawer';
  drawer.id = 'drawer-panel';
  drawer.innerHTML = `
    <div class="drawer-header">
      <span class="drawer-title">${title}</span>
      <button class="drawer-close" onclick="closeDrawer()">✕ Close</button>
    </div>
    <div class="drawer-body" id="drawer-body">${bodyHtml}</div>
    ${footerHtml ? `<div class="drawer-footer">${footerHtml}</div>` : ''}
  `;
  drawer.onclick = (e) => e.stopPropagation();
  document.body.appendChild(drawer);

  // Animate open
  requestAnimationFrame(() => {
    overlay.classList.add('open');
    drawer.classList.add('open');
  });
}

function closeDrawer() {
  const overlay = document.getElementById('drawer-overlay');
  const drawer = document.getElementById('drawer-panel');
  if (overlay) {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 250);
  }
  if (drawer) {
    drawer.classList.remove('open');
    setTimeout(() => drawer.remove(), 300);
  }
}

function setDrawerBody(html) {
  const body = document.getElementById('drawer-body');
  if (body) body.innerHTML = html;
}

// ─── INIT ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Setup nav click handlers
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(el.dataset.page);
    });
  });

  // Load initial page from hash or default
  const hash = location.hash.replace('#', '') || 'overview';
  navigateTo(hash);
});
