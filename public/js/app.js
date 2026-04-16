/* ═══════════════════════════════════════════════════════════
   Meta Ads Dashboard — V2 App Core
   Auth + Navigation + Utilities
   ═══════════════════════════════════════════════════════════ */

const sessionState = window.SessionState;
const apiClient = window.ApiClient;
const appStateHelpers = window.AppStateHelpers;
const apiRuntimeHelpers = window.ApiRuntimeHelpers;
const formatHelpers = window.FormatHelpers;
const cooldown = window.MetaCooldown;
const uiHelpers = window.UiHelpers;
const asyncSectionHelpers = window.AsyncSectionHelpers;
const dashboardMetrics = window.DashboardMetrics;
const editorUtils = window.EditorUtils;
const navigationHelpers = window.NavigationHelpers;
const layoutHelpersFactory = window.LayoutHelpers;
const authUiHelpers = window.AuthUiHelpers;
const headerStatusHelpers = window.HeaderStatusHelpers;

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const appState = appStateHelpers.createAppState();
appState.setCurrentUser(sessionState.getCurrentUser());
const clearMetaCooldown = cooldown.clear;
const renderMetaCooldown = cooldown.render;
const apiRuntime = apiRuntimeHelpers.createApiRuntime({
  apiClient,
  cooldown,
  onUnauthorized: () => {
    sessionState.clearCurrentUser();
    appState.setCurrentUser(null);
    showLogin();
  },
});
const api = apiRuntime.api;
const apiGet = apiRuntime.apiGet;
const apiPost = apiRuntime.apiPost;
const apiDelete = apiRuntime.apiDelete;
const headerStatus = headerStatusHelpers.createHeaderStatus({
  apiGet,
  getAccountId: () => appState.getAccountId(),
});

Object.defineProperties(window, {
  currentUser: { get: () => appState.getCurrentUser() },
  currentPage: { get: () => appState.getCurrentPage() },
  ACCOUNT_ID: { get: () => appState.getAccountId() },
  pageState: { get: () => appState.getPageState() },
});

window.DashboardApp = {
  getCurrentUser: () => appState.getCurrentUser(),
  getCurrentPage: () => appState.getCurrentPage(),
  getAccountId: () => appState.getAccountId(),
  getAccountContext: () => appState.getAccountContext(),
  navigateTo: (...args) => navigation.navigateTo(...args),
  hydrateAccountContext,
  switchActiveAccount,
};

// ─── FORMATTING ───────────────────────────────────────────

const fmt = formatHelpers.fmt;
const fmtDelta = formatHelpers.fmtDelta;
const fmtDate = formatHelpers.fmtDate;
const fmtDateTime = formatHelpers.fmtDateTime;
const fmtBudget = formatHelpers.fmtBudget;
const parseResults = dashboardMetrics.parseResults;
const parseCostPerResult = dashboardMetrics.parseCostPerResult;
const todayStr = dashboardMetrics.todayStr;
const daysAgoStr = dashboardMetrics.daysAgoStr;
const statusBadge = dashboardMetrics.statusBadge;
const urgencyBadge = dashboardMetrics.urgencyBadge;
const metricColor = dashboardMetrics.metricColor;
const sparkline = dashboardMetrics.sparkline;
const safeJson = editorUtils.safeJson;
const blankToUndefined = editorUtils.blankToUndefined;
const tagsToArray = editorUtils.tagsToArray;
const toLocalDateTime = editorUtils.toLocalDateTime;
const localDateTimeToIso = editorUtils.localDateTimeToIso;

// ─── NAVIGATION ───────────────────────────────────────────

const PAGES = {
  overview: { title: 'Overview', load: 'loadOverview', icon: 'grid' },
  intelligence: { title: 'Decision Center', load: 'loadIntelligence', icon: 'brain' },
  campaigns: { title: 'Campaigns', load: 'loadCampaigns', icon: 'list' },
  adsets: { title: 'Ad Sets', load: 'loadAdSets', icon: 'target' },
  ads: { title: 'Ads', load: 'loadAds', icon: 'image' },
  ai: { title: 'AI Analyst', load: 'loadAI', icon: 'brain' },
  logs: { title: 'Action Log', load: 'loadLogs', icon: 'clock' },
  admin: { title: 'Admin', load: 'loadAdmin', icon: 'users', adminOnly: true },
  settings: { title: 'Settings', load: 'loadSettings', icon: 'gear' },
};

async function hydrateAccountContext() {
  try {
    const accountContext = await apiGet('/accounts');
    appState.setAccountContext(accountContext);
    appState.setAccountId(accountContext.active?.id || 1);
    layoutHelpers.renderAccountSwitcher(accountContext, switchActiveAccount);
  } catch (e) {
    appState.setAccountContext(null);
    layoutHelpers.renderAccountSwitcher(null, switchActiveAccount);
  }
}

async function switchActiveAccount(accountId) {
  const id = parseInt(accountId, 10);
  if (!id || id === appState.getAccountId()) return;
  try {
    const res = await apiPost('/accounts/active', { accountId: id });
    appState.setAccountId(id);
    appState.setAccountContext({ ...(appState.getAccountContext() || {}), active: res.data });
    toast(`Switched to ${res.data?.label || res.data?.name || 'Meta account'}`, 'success');
    appState.resetPageState();
    navigateTo(appState.getCurrentPage());
    await headerStatus.updateAIBadge();
  } catch (err) {
    toast(`Account switch failed: ${err.message}`, 'error');
    layoutHelpers.renderAccountSwitcher(appState.getAccountContext(), switchActiveAccount);
  }
}

const navigation = navigationHelpers.createNavigation({
  getPages: () => PAGES,
  getPageState: () => appState.getPageState(),
  setPageState: (state) => { appState.setPageState(state); },
  setCurrentPage: (page) => { appState.setCurrentPage(page); },
});
const navigateTo = navigation.navigateTo;

// ─── TOAST NOTIFICATIONS ──────────────────────────────────

const toast = uiHelpers.toast;
const confirmAction = uiHelpers.confirmAction;

// ─── SLIDE DRAWER ─────────────────────────────────────────

const openDrawer = uiHelpers.openDrawer;
const closeDrawer = uiHelpers.closeDrawer;
const setDrawerBody = uiHelpers.setDrawerBody;
const layoutHelpers = layoutHelpersFactory.createLayoutHelpers({ escapeHtml });

// ─── AUTH: LOGIN / REGISTER SCREEN ────────────────────────

const authUi = authUiHelpers.createAuthUi({
  sessionState,
  onLoginSuccess: async (user) => {
    appState.setCurrentUser(user);
    await showDashboard();
  },
});
const showLogin = authUi.showLogin;
const handleLogin = authUi.handleLogin;

function handleLogout() {
  apiPost('/auth/logout').catch(() => {});
  appState.setCurrentUser(null);
  sessionState.clearCurrentUser();
  showLogin();
}

async function showDashboard() {
  // Verify token
  try {
    const res = await api('/auth/me');
    appState.setCurrentUser(res.user);
    sessionState.setCurrentUser(res.user);
  } catch (e) {
    showLogin();
    return;
  }

  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';

  layoutHelpers.applyUserLayout(appState.getCurrentUser());

  await hydrateAccountContext();

  const hash = location.hash.replace('#', '') || 'overview';
  navigateTo(hash);

  headerStatus.updateAIBadge();
}

// ─── INIT ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  renderMetaCooldown();
  navigation.bindNavHandlers();
  headerStatus.start();

  // Check auth
  showDashboard();
});
