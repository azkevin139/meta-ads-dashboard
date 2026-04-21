const { query, queryAll } = require('../db');

const SECRET_KEY_RE = /(password|secret|token|api[_-]?key|authorization|credential|access_token|encrypted)/i;

function clean(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SECRET_KEY_RE.test(key) ? '[REDACTED]' : redact(child);
  }
  return out;
}

function actorFromReq(req) {
  return {
    actor_user_id: req.user?.id || null,
    actor_email: req.user?.email || null,
    ip: clean(req.headers?.['x-forwarded-for']) || clean(req.socket?.remoteAddress),
    user_agent: clean(req.headers?.['user-agent']),
    request_id: req.requestId || clean(req.headers?.['x-request-id']),
  };
}

async function write(entry = {}) {
  await query(`
    INSERT INTO security_audit_log (
      actor_user_id, actor_email, action, target_type, target_id, account_id,
      before_json, after_json, result, ip, user_agent, request_id
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `, [
    entry.actor_user_id || null,
    clean(entry.actor_email),
    clean(entry.action) || 'unknown',
    clean(entry.target_type) || 'unknown',
    clean(entry.target_id),
    entry.account_id || null,
    entry.before_json ? JSON.stringify(redact(entry.before_json)) : null,
    entry.after_json ? JSON.stringify(redact(entry.after_json)) : null,
    clean(entry.result) || 'success',
    clean(entry.ip),
    clean(entry.user_agent),
    clean(entry.request_id),
  ]);
}

function fromRequest(req, entry = {}) {
  return write({
    ...actorFromReq(req),
    account_id: entry.account_id ?? req.metaAccount?.id ?? null,
    ...entry,
  }).catch((err) => {
    console.warn('[securityAudit] write failed:', err.message);
  });
}

async function list({ limit = 100, accountId, actorUserId, action } = {}) {
  const values = [];
  const filters = [];
  if (accountId) {
    values.push(accountId);
    filters.push(`account_id = $${values.length}`);
  }
  if (actorUserId) {
    values.push(actorUserId);
    filters.push(`actor_user_id = $${values.length}`);
  }
  if (action) {
    values.push(action);
    filters.push(`action = $${values.length}`);
  }
  values.push(Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500));
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return queryAll(`
    SELECT *
    FROM security_audit_log
    ${where}
    ORDER BY created_at DESC
    LIMIT $${values.length}
  `, values);
}

module.exports = {
  write,
  fromRequest,
  list,
  redact,
};
