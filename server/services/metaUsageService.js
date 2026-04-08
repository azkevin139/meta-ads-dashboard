const fetch = require('node-fetch');
const config = require('../config');

const state = {
  latest: {
    last_seen_at: null,
    source: null,
    app_usage: null,
    ad_account_usage: null,
    business_use_case_usage: [],
    warning_level: 'unknown',
    safe_to_write: true,
    safe_to_read: true,
    estimated_regain_seconds: 0,
    last_error: null,
  },
};

function parseJsonHeader(value) {
  if (!value) return null;
  try {
    if (Array.isArray(value)) value = value[0];
    return JSON.parse(value);
  } catch (err) {
    return null;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBucUsage(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const items = [];
  for (const [businessId, entries] of Object.entries(raw)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      items.push({
        business_id: businessId,
        type: entry.type || 'unknown',
        call_count: numberOrNull(entry.call_count),
        total_cputime: numberOrNull(entry.total_cputime),
        total_time: numberOrNull(entry.total_time),
        estimated_time_to_regain_access: numberOrNull(entry.estimated_time_to_regain_access),
        ads_api_access_tier: entry.ads_api_access_tier || null,
      });
    }
  }
  return items;
}

function getBucType(snapshot, type) {
  return (snapshot.business_use_case_usage || []).find(item => item.type === type) || null;
}

function maxMetricPercent(snapshot) {
  const values = [];
  if (snapshot.app_usage) values.push(snapshot.app_usage.call_count, snapshot.app_usage.total_cputime, snapshot.app_usage.total_time);
  if (snapshot.ad_account_usage) values.push(snapshot.ad_account_usage.acc_id_util_pct);
  for (const item of snapshot.business_use_case_usage || []) values.push(item.call_count, item.total_cputime, item.total_time);
  const filtered = values.filter(v => typeof v === 'number' && Number.isFinite(v));
  return filtered.length ? Math.max(...filtered) : 0;
}

function computeWarningLevel(snapshot) {
  const maxPct = maxMetricPercent(snapshot);
  if (maxPct >= 95) return 'critical';
  if (maxPct >= 85) return 'high';
  if (maxPct >= 70) return 'medium';
  return 'low';
}

function computeEstimatedRegainSeconds(snapshot) {
  let seconds = 0;
  if (snapshot.ad_account_usage && typeof snapshot.ad_account_usage.reset_time_duration === 'number') {
    seconds = Math.max(seconds, snapshot.ad_account_usage.reset_time_duration);
  }
  for (const item of snapshot.business_use_case_usage || []) {
    if (typeof item.estimated_time_to_regain_access === 'number') {
      seconds = Math.max(seconds, item.estimated_time_to_regain_access * 60);
    }
  }
  return seconds;
}

function computeSafety(snapshot) {
  const adsManagement = getBucType(snapshot, 'ads_management');
  const adsInsights = getBucType(snapshot, 'ads_insights');
  const app = snapshot.app_usage || {};
  const adAcct = snapshot.ad_account_usage || {};

  const writePressure = Math.max(
    numberOrNull(adsManagement?.call_count) || 0,
    numberOrNull(adsManagement?.total_cputime) || 0,
    numberOrNull(adsManagement?.total_time) || 0,
    numberOrNull(adAcct.acc_id_util_pct) || 0,
    numberOrNull(app.total_cputime) || 0,
    numberOrNull(app.total_time) || 0
  );

  const readPressure = Math.max(
    numberOrNull(adsInsights?.call_count) || 0,
    numberOrNull(adsInsights?.total_cputime) || 0,
    numberOrNull(adsInsights?.total_time) || 0,
    numberOrNull(app.call_count) || 0,
    numberOrNull(app.total_cputime) || 0,
    numberOrNull(app.total_time) || 0
  );

  return {
    safe_to_write: writePressure < 85,
    safe_to_read: readPressure < 90,
  };
}

function recordHeaders(headers, context = {}) {
  if (!headers) return getSummary();

  const appUsage = parseJsonHeader(headers.get ? headers.get('x-app-usage') : null);
  const adAccountUsage = parseJsonHeader(headers.get ? headers.get('x-ad-account-usage') : null);
  const bucUsage = normalizeBucUsage(parseJsonHeader(headers.get ? headers.get('x-business-use-case-usage') : null));

  if (!appUsage && !adAccountUsage && bucUsage.length === 0) {
    return getSummary();
  }

  const next = {
    ...state.latest,
    last_seen_at: new Date().toISOString(),
    source: context.source || 'meta_probe',
    app_usage: appUsage || state.latest.app_usage,
    ad_account_usage: adAccountUsage || state.latest.ad_account_usage,
    business_use_case_usage: bucUsage.length > 0 ? bucUsage : state.latest.business_use_case_usage,
  };

  next.estimated_regain_seconds = computeEstimatedRegainSeconds(next);
  next.warning_level = computeWarningLevel(next);
  const safety = computeSafety(next);
  next.safe_to_write = safety.safe_to_write;
  next.safe_to_read = safety.safe_to_read;

  state.latest = next;
  return getSummary();
}

function recordError(error) {
  state.latest = {
    ...state.latest,
    last_error: error ? {
      message: error.message || 'Unknown Meta error',
      code: error.code || null,
      type: error.type || null,
      subcode: error.error_subcode || null,
      at: new Date().toISOString(),
    } : null,
  };
  return getSummary();
}

async function fetchLiveStatus() {
  if (!config.meta.accessToken || !config.meta.adAccountId) {
    state.latest = {
      ...state.latest,
      warning_level: 'unknown',
      safe_to_write: false,
      safe_to_read: false,
    };
    return getSummary();
  }

  const url = new URL(`${config.meta.baseUrl()}/${config.meta.adAccountId}`);
  url.searchParams.set('fields', 'id');
  const tokenKey = 'access' + '_token';
  url.searchParams.set(tokenKey, config.meta.accessToken);

  const res = await fetch(url.toString());
  recordHeaders(res.headers, { source: 'meta_live_probe' });

  let payload = {};
  try {
    payload = await res.json();
  } catch (err) {}

  if (payload && payload.error) {
    const error = new Error(payload.error.message || 'Meta probe failed');
    error.code = payload.error.code;
    error.type = payload.error.type;
    error.error_subcode = payload.error.error_subcode || null;
    recordError(error);
    throw error;
  }

  return getSummary();
}

function getSummary() {
  const snapshot = JSON.parse(JSON.stringify(state.latest));
  const adsManagement = getBucType(snapshot, 'ads_management');
  const adsInsights = getBucType(snapshot, 'ads_insights');
  return {
    ...snapshot,
    summary: {
      ads_management: adsManagement,
      ads_insights: adsInsights,
      app_call_count: snapshot.app_usage?.call_count ?? null,
      app_cpu: snapshot.app_usage?.total_cputime ?? null,
      app_time: snapshot.app_usage?.total_time ?? null,
      ad_account_util_pct: snapshot.ad_account_usage?.acc_id_util_pct ?? null,
      reset_time_duration: snapshot.ad_account_usage?.reset_time_duration ?? null,
      ads_api_access_tier: snapshot.ad_account_usage?.ads_api_access_tier || adsManagement?.ads_api_access_tier || adsInsights?.ads_api_access_tier || null,
    },
  };
}

module.exports = {
  fetchLiveStatus,
  getSummary,
  recordHeaders,
  recordError,
};
