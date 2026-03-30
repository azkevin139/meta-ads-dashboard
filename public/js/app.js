/* ═══════════════════════════════════════════════════════════
   Meta Ads Dashboard — V2 App Core
   Auth + Navigation + Utilities
   ═══════════════════════════════════════════════════════════ */

const API_BASE = '/api';
const ACCOUNT_ID = 1;

// ─── AUTH STATE ───────────────────────────────────────────

let authToken = localStorage.getItem('auth_token') || null;
let currentUser = null;

function getAuthHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (authToken) h['Authorization'] = `Bearer ${authToken}`;
  return h;
}

// ─── API WRAPPER ──────────────────────────────────────────

async function api(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: getAuthHeaders(),
    ...options,
  });
  const data = await res.json();
  if (res.status === 401) {
    // Token expired
    authToken = null;
    localStorage.removeItem('auth_token');
    showLogin();
    throw new Error('Session expired — please login again');
  }
  if (!res.ok) throw new Error(data.error || `API error ${res.status}`);
  return data;
}

async function apiGet(path) { return api(path); }

async function apiPost(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

async function apiDelete(path) {
  return api(path, { method: 'DELETE' });
}

// ─── FORMATTING ───────────────────────────────────────────

function fmt(value, type = 'number') {
  if (value === null || value === undefined) return '—';
  const n = parseFloat(value);
  if (isNaN(n)) return value;
  switch (type) {
    case 'currency': return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'percent': return n.toFixed(2) + '%';
    case 'decimal': return n.toFixed(2);
    case 'integer': return Math.round(n).toLocaleString('en-US');
    case 'compact':
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return Math.round(n).toLocaleString('en-US');
    default: return n.toLocaleString('en-US');
  }
}

function fmtDelta(value) {
  if (value === null || value === undefined || value === 0) return { text: '0%', cls: 'flat' };
  const n = parseFloat(value);
  const arrow = n > 0 ? '↑' : '↓';
  return { text: `${arrow} ${Math.abs(n)}%`, cls: n > 0 ? 'up' : 'down' };
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateTime(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtBudget(cents) {
  if (!cents) return '—';
  return '$' + (cents / 100).toFixed(2);
}

// ─── CONVERSION PARSER ───────────────────────────────────
// Extract specific conversion types from Meta's actions array
// Priority: initiate_checkout > purchase > lead > complete_registration

function parseResults(actions) {
  if (!actions || !Array.isArray(actions)) return { count: 0, type: '—' };
  
  // Look for initiate_checkout first (your primary conversion)
  for (const a of actions) {
    if (a.action_type === 'offsite_conversion.fb_pixel_initiate_checkout' ||
        a.action_type === 'initiate_checkout') {
      return { count: parseInt(a.value) || 0, type: 'Initiate Checkout' };
    }
  }
  // Fallback to other conversion types
  for (const a of actions) {
    if (a.action_type === 'offsite_conversion.fb_pixel_purchase' || a.action_type === 'purchase') {
      return { count: parseInt(a.value) || 0, type: 'Purchase' };
    }
  }
  for (const a of actions) {
    if (a.action_type === 'offsite_conversion.fb_pixel_lead' || a.action_type === 'lead') {
      return { count: parseInt(a.value) || 0, type: 'Lead' };
    }
  }
  for (const a of actions) {
    if (a.action_type === 'offsite_conversion.fb_pixel_complete_registration' || a.action_type === 'complete_registration') {
      return { count: parseInt(a.value) || 0, type: 'Registration' };
    }
  }
  return { count: 0, type: '—' };
}

function parseCostPerResult(costPerActions, resultType) {
  if (!costPerActions || !Array.isArray(costPerActions)) return 0;
  // Match the same action type
  const typeMap = {
    'Initiate Checkout': ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout'],
    'Purchase': ['offsite_conversion.fb_pixel_purchase', 'purchase'],
    'Lead': ['offsite_conversion.fb_pixel_lead', 'lead'],
    'Registration': ['offsite_conversion.fb_pixel_complete_registration', 'complete_registration'],
  };
  const types = typeMap[resultType] || [];
  for (const a of costPerActions) {
    if (types.includes(a.action_type)) {
      return parseFloat(a.value) || 0;
    }
  }
  return 0;
}

// Date helpers for date picker
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

// ─── STATUS HELPERS ───────────────────────────────────────

function statusBadge(status) {
  const s = (status || '').toUpperCase();
  const cls = s === 'ACTIVE' ? 'badge-active' : s === 'PAUSED' ? 'badge-paused' : 'badge-error';
  return `<span class="badge ${cls}">${s}</span>`;
}

function urgencyBadge(urgency) {
  return `<span class="badge badge-${urgency}">${urgency}</span>`;
}

function metricColor(value, thresholds, invert = false) {
  const n = parseFloat(value);
  if (isNaN(n)) return '';
  if (invert) {
    if (n <= thresholds.good) return 'text-green';
    if (n >= thresholds.bad) return 'text-red';
  } else {
    if (n >= thresholds.good) return 'text-green';
    if (n <= thresholds.bad) return 'text-red';
  }
  return '';
}

// ─── NAVIGATION ───────────────────────────────────────────

const PAGES = {
  overview: { title: 'Overview', load: 'loadOverview', icon: 'grid' },
  campaigns: { title: 'Campaigns', load: 'loadCampaigns', icon: 'list' },
  adsets: { title: 'Ad Sets', load: 'loadAdSets', icon: 'target' },
  ads: { title: 'Ads', load: 'loadAds', icon: 'image' },
  ai: { title: 'AI Analyst', load: 'loadAI', icon: 'brain' },
  logs: { title: 'Action Log', load: 'loadLogs', icon: 'clock' },
  admin: { title: 'Admin', load: 'loadAdmin', icon: 'users', adminOnly: true },
  settings: { title: 'Settings', load: 'loadSettings', icon: 'gear' },
};

let currentPage = 'overview';
let pageState = {};

function navigateTo(page, state = {}) {
  currentPage = page;
  pageState = { ...pageState, ...state };

  // Update active nav (desktop + mobile)
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  const pageConfig = PAGES[page];
  if (pageConfig) {
    document.getElementById('page-title').textContent = pageConfig.title;
  }

  const body = document.getElementById('page-body');
  body.innerHTML = '<div class="loading">Loading</div>';

  if (pageConfig && pageConfig.load) {
    const fn = typeof pageConfig.load === 'string' ? window[pageConfig.load] : pageConfig.load;
    if (fn) fn(body);
  }

  history.pushState({ page, ...state }, '', `#${page}`);
}

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.page) navigateTo(e.state.page, e.state);
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

function confirmAction(message) { return window.confirm(message); }

// ─── SPARKLINE ────────────────────────────────────────────

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

// ─── SLIDE DRAWER ─────────────────────────────────────────

function openDrawer(title, bodyHtml, footerHtml) {
  closeDrawer();
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
  requestAnimationFrame(() => { overlay.classList.add('open'); drawer.classList.add('open'); });
}

function closeDrawer() {
  const overlay = document.getElementById('drawer-overlay');
  const drawer = document.getElementById('drawer-panel');
  if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 250); }
  if (drawer) { drawer.classList.remove('open'); setTimeout(() => drawer.remove(), 300); }
}

function setDrawerBody(html) {
  const body = document.getElementById('drawer-body');
  if (body) body.innerHTML = html;
}

// ─── AUTH: LOGIN / REGISTER SCREEN ────────────────────────

function showLogin() {
  document.getElementById('app-layout').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-screen').innerHTML = `
    <div class="login-card">
      <div class="login-logo"><span class="dot" style="width:10px; height:10px; background:var(--green); border-radius:50%; display:inline-block;"></span> Ad Command</div>
      <div class="login-subtitle">Sign in to your dashboard</div>
      <div id="login-error"></div>
      <div id="login-form">
        <input id="login-email" class="form-input" type="email" placeholder="Email" autocomplete="email" style="margin-bottom: 12px;" />
        <input id="login-password" class="form-input" type="password" placeholder="Password" autocomplete="current-password" style="margin-bottom: 16px;" />
        <button class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 0.9rem;" onclick="handleLogin()">Sign In</button>
        <div style="text-align: center; margin-top: 14px;">
          <span class="text-muted" style="font-size: 0.8rem;">No account?</span>
          <a href="#" onclick="showRegister(); return false;" style="font-size: 0.8rem; margin-left: 4px;">Register</a>
        </div>
      </div>
    </div>
  `;
}

function showRegister() {
  document.getElementById('login-screen').innerHTML = `
    <div class="login-card">
      <div class="login-logo"><span class="dot" style="width:10px; height:10px; background:var(--green); border-radius:50%; display:inline-block;"></span> Ad Command</div>
      <div class="login-subtitle">Create your account</div>
      <div id="login-error"></div>
      <div id="login-form">
        <input id="reg-name" class="form-input" type="text" placeholder="Full Name" style="margin-bottom: 12px;" />
        <input id="reg-email" class="form-input" type="email" placeholder="Email" autocomplete="email" style="margin-bottom: 12px;" />
        <input id="reg-password" class="form-input" type="password" placeholder="Password (min 6 chars)" autocomplete="new-password" style="margin-bottom: 12px;" />
        <input id="reg-meta-token" class="form-input" type="text" placeholder="Meta API Token (optional)" style="margin-bottom: 16px;" />
        <button class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 0.9rem;" onclick="handleRegister()">Create Account</button>
        <div style="text-align: center; margin-top: 14px;">
          <span class="text-muted" style="font-size: 0.8rem;">Already have an account?</span>
          <a href="#" onclick="showLogin(); return false;" style="font-size: 0.8rem; margin-left: 4px;">Sign In</a>
        </div>
      </div>
    </div>
  `;
}

async function handleLogin() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const errorDiv = document.getElementById('login-error');
  errorDiv.innerHTML = '';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('auth_token', authToken);
    showDashboard();
  } catch (err) {
    errorDiv.innerHTML = `<div class="alert-banner alert-critical" style="margin-bottom:12px; font-size:0.82rem;">${err.message}</div>`;
  }
}

async function handleRegister() {
  const name = document.getElementById('reg-name').value;
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  const metaToken = document.getElementById('reg-meta-token').value;
  const errorDiv = document.getElementById('login-error');
  errorDiv.innerHTML = '';

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Auto-login after register
    await handleLoginWithCredentials(email, password);
  } catch (err) {
    errorDiv.innerHTML = `<div class="alert-banner alert-critical" style="margin-bottom:12px; font-size:0.82rem;">${err.message}</div>`;
  }
}

async function handleLoginWithCredentials(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  authToken = data.token;
  currentUser = data.user;
  localStorage.setItem('auth_token', authToken);
  showDashboard();
}

function handleLogout() {
  apiPost('/auth/logout').catch(() => {});
  authToken = null;
  currentUser = null;
  localStorage.removeItem('auth_token');
  showLogin();
}

async function showDashboard() {
  // Verify token
  try {
    const res = await api('/auth/me');
    currentUser = res.user;
  } catch (e) {
    showLogin();
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';

  // Show/hide admin nav
  const adminNav = document.getElementById('nav-admin');
  const adminNavMobile = document.getElementById('nav-admin-mobile');
  if (adminNav) adminNav.style.display = currentUser.role === 'admin' ? '' : 'none';
  if (adminNavMobile) adminNavMobile.style.display = currentUser.role === 'admin' ? '' : 'none';

  // Show user info
  const userInfo = document.getElementById('user-info');
  if (userInfo) userInfo.textContent = currentUser.name || currentUser.email;

  const hash = location.hash.replace('#', '') || 'overview';
  navigateTo(hash);

  updateAIBadge();
}

// ─── INIT ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Nav click handlers (desktop)
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); navigateTo(el.dataset.page); });
  });
  // Nav click handlers (mobile)
  document.querySelectorAll('.mobile-nav-item').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); navigateTo(el.dataset.page); });
  });

  // Check auth
  if (authToken) {
    showDashboard();
  } else {
    showLogin();
  }
});

// ─── PERIODIC UPDATES ─────────────────────────────────────

function updateClock() {
  const el = document.getElementById('header-time');
  if (el) el.textContent = new Date().toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function updateAIBadge() {
  try {
    const res = await apiGet(`/ai/recommendations?accountId=${ACCOUNT_ID}&status=pending`);
    const count = (res.data || []).length;
    const badge = document.getElementById('ai-badge');
    const badgeMobile = document.getElementById('ai-badge-mobile');
    if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'inline' : 'none'; }
    if (badgeMobile) { badgeMobile.textContent = count; badgeMobile.style.display = count > 0 ? 'inline' : 'none'; }
  } catch (e) { /* silent */ }
}

setInterval(updateClock, 30000);
setInterval(updateAIBadge, 60000);
