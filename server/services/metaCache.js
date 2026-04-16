// In-process cache + stale-while-revalidate + per-account call budget for Meta API reads.
//
// Design:
//   - Keyed by (accountId, endpoint, params).
//   - `fresh_ms`: below this age, cache is returned without a network call.
//   - `stale_ms`: above this age, cache is evicted and caller awaits a fresh fetch.
//   - Between fresh_ms and stale_ms: stale-while-revalidate — return cached value immediately,
//     kick off a background refresh so the next caller gets fresh data.
//   - Concurrency: if a refresh is already in-flight for a key, subsequent callers await
//     the same promise (dedupe).
//   - Budget: per-account rolling 1-hour counter. When ≥80% of BUDGET_HOUR, reads become
//     cache-only (stale cache still served; no network call; error if cold).
//
// Usage:
//   const data = await metaCache.wrap({ accountId, key, freshMs, staleMs }, () => metaApi.metaGet(...));

const DEFAULT_FRESH_MS = 60 * 1000;          // 60s default fresh window
const DEFAULT_STALE_MS = 60 * 60 * 1000;     // 1h absolute max
const BUDGET_HOUR = parseInt(process.env.META_CALL_BUDGET_PER_HOUR, 10) || 500;
const BUDGET_WARN_PCT = 0.8;

const cache = new Map();        // key → { value, storedAt, fresh_ms, stale_ms }
const inflight = new Map();     // key → Promise
const callLog = new Map();      // accountId → [timestamps]

function recordCall(accountId) {
  if (!accountId) return;
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const list = callLog.get(accountId) || [];
  // drop old entries + append new
  const kept = list.filter(ts => ts > cutoff);
  kept.push(now);
  callLog.set(accountId, kept);
}

function getCallsLastHour(accountId) {
  if (!accountId) return 0;
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const list = callLog.get(accountId) || [];
  return list.filter(ts => ts > cutoff).length;
}

function budgetStatus(accountId) {
  const used = getCallsLastHour(accountId);
  const pct = used / BUDGET_HOUR;
  return {
    used,
    limit: BUDGET_HOUR,
    pct,
    mode: pct >= 1 ? 'blocked' : pct >= BUDGET_WARN_PCT ? 'cache_only' : 'normal',
  };
}

function buildKey({ accountId, key }) {
  return `${accountId || 'global'}::${key}`;
}

async function wrap({ accountId, key, freshMs = DEFAULT_FRESH_MS, staleMs = DEFAULT_STALE_MS, forceRefresh = false }, fetcher) {
  const fullKey = buildKey({ accountId, key });
  const now = Date.now();
  const entry = cache.get(fullKey);
  const age = entry ? now - entry.storedAt : Infinity;

  // If we have an absolutely-fresh entry and no force, return as-is.
  if (!forceRefresh && entry && age < (entry.fresh_ms || freshMs)) {
    return { data: entry.value, from: 'cache', age_ms: age, stale: false };
  }

  const budget = budgetStatus(accountId);

  // Budget enforcement:
  //  - In normal mode we always fetch if cache is expired.
  //  - In cache_only mode we return stale cache; only fetch if cache is missing.
  //  - In blocked mode we only return cache (any age) or fail.
  const wantNetwork = !(budget.mode === 'cache_only' && entry && age < (entry.stale_ms || staleMs))
    && !(budget.mode === 'blocked' && entry);

  if (!wantNetwork && entry) {
    return { data: entry.value, from: 'cache', age_ms: age, stale: age >= (entry.fresh_ms || freshMs), budget: budget.mode };
  }

  // Stale-while-revalidate: if entry exists within staleMs, return it and refresh async.
  if (!forceRefresh && entry && age < (entry.stale_ms || staleMs) && budget.mode === 'normal') {
    triggerBackgroundRefresh(fullKey, accountId, fetcher, freshMs, staleMs);
    return { data: entry.value, from: 'cache', age_ms: age, stale: true, refreshing: true };
  }

  // Either no cache or past the stale horizon — block the caller on a fetch.
  if (inflight.has(fullKey)) {
    const value = await inflight.get(fullKey);
    return { data: value, from: 'network_deduped', age_ms: 0 };
  }

  const promise = (async () => {
    try {
      recordCall(accountId);
      const fresh = await fetcher();
      cache.set(fullKey, { value: fresh, storedAt: Date.now(), fresh_ms: freshMs, stale_ms: staleMs });
      return fresh;
    } finally {
      inflight.delete(fullKey);
    }
  })();
  inflight.set(fullKey, promise);
  try {
    const value = await promise;
    return { data: value, from: 'network', age_ms: 0 };
  } catch (err) {
    // If we have any cached value, return it instead of exploding.
    if (entry) return { data: entry.value, from: 'cache_fallback', age_ms: age, error: err.message };
    throw err;
  }
}

function triggerBackgroundRefresh(fullKey, accountId, fetcher, freshMs, staleMs) {
  if (inflight.has(fullKey)) return;
  const promise = (async () => {
    try {
      recordCall(accountId);
      const fresh = await fetcher();
      cache.set(fullKey, { value: fresh, storedAt: Date.now(), fresh_ms: freshMs, stale_ms: staleMs });
    } catch (err) {
      // keep stale cache; log once
      console.warn(`[metaCache] background refresh failed for ${fullKey}: ${err.message}`);
    } finally {
      inflight.delete(fullKey);
    }
  })();
  inflight.set(fullKey, promise);
  promise.catch(() => {});
}

function invalidate(accountId, matcher) {
  const prefix = `${accountId || 'global'}::`;
  for (const key of cache.keys()) {
    if (!key.startsWith(prefix)) continue;
    if (!matcher || matcher(key.slice(prefix.length))) {
      cache.delete(key);
    }
  }
}

function stats() {
  return {
    entries: cache.size,
    inflight: inflight.size,
    budget_hour_limit: BUDGET_HOUR,
    warn_pct: BUDGET_WARN_PCT,
    per_account: Array.from(callLog.entries()).map(([id, list]) => ({
      account_id: id,
      calls_last_hour: list.length,
      status: budgetStatus(id).mode,
    })),
  };
}

module.exports = {
  wrap,
  invalidate,
  budgetStatus,
  getCallsLastHour,
  recordCall,
  stats,
  DEFAULT_FRESH_MS,
  DEFAULT_STALE_MS,
  BUDGET_HOUR,
};
