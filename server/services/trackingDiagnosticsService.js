const stats = new Map();

function ensure(metaAccountId) {
  const key = String(metaAccountId || '').trim() || '__unknown__';
  if (!stats.has(key)) {
    stats.set(key, {
      meta_account_id: key,
      request_count: 0,
      success_count: 0,
      failure_count: 0,
      last_payload_at: null,
      last_success_at: null,
      last_failure_at: null,
      last_account_id: null,
      last_status: null,
      last_error: null,
      last_page_url: null,
    });
  }
  return stats.get(key);
}

function recordAttempt({ metaAccountId, pageUrl }) {
  const entry = ensure(metaAccountId);
  entry.request_count += 1;
  entry.last_payload_at = new Date().toISOString();
  entry.last_page_url = pageUrl || entry.last_page_url || null;
  return entry;
}

function recordSuccess({ metaAccountId, accountId, status = 200, pageUrl }) {
  const entry = ensure(metaAccountId);
  entry.success_count += 1;
  entry.last_success_at = new Date().toISOString();
  entry.last_status = status;
  entry.last_account_id = accountId || entry.last_account_id || null;
  entry.last_error = null;
  entry.last_page_url = pageUrl || entry.last_page_url || null;
  return entry;
}

function recordFailure({ metaAccountId, accountId, status = 500, error, pageUrl }) {
  const entry = ensure(metaAccountId);
  entry.failure_count += 1;
  entry.last_failure_at = new Date().toISOString();
  entry.last_status = status;
  entry.last_account_id = accountId || entry.last_account_id || null;
  entry.last_error = error || null;
  entry.last_page_url = pageUrl || entry.last_page_url || null;
  return entry;
}

function get(metaAccountId) {
  if (!metaAccountId) return null;
  const key = String(metaAccountId || '').trim() || '__unknown__';
  return stats.has(key) ? { ...stats.get(key) } : null;
}

function list() {
  return Array.from(stats.values()).map((row) => ({ ...row })).sort((a, b) => {
    const aTime = new Date(a.last_payload_at || 0).getTime();
    const bTime = new Date(b.last_payload_at || 0).getTime();
    return bTime - aTime;
  });
}

function latest() {
  return list()[0] || null;
}

module.exports = {
  recordAttempt,
  recordSuccess,
  recordFailure,
  get,
  list,
  latest,
};
