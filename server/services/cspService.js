const { query, queryAll, queryOne } = require('../db');

function clean(value, max = 1000) {
  if (value === undefined || value === null) return null;
  return String(value).slice(0, max);
}

function normalizeReport(body = {}) {
  if (body['csp-report']) return body['csp-report'];
  if (Array.isArray(body) && body[0]?.body) return body[0].body;
  if (body.body && typeof body.body === 'object') return body.body;
  return body;
}

async function recordReport(req) {
  const report = normalizeReport(req.body || {});
  await query(`
    INSERT INTO csp_violation_reports (
      request_id, ip, user_agent, document_uri, violated_directive,
      effective_directive, blocked_uri, source_file, line_number,
      column_number, disposition, status_code, script_sample, raw_report
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
  `, [
    clean(req.requestId, 120),
    clean(req.headers['x-forwarded-for'] || req.socket.remoteAddress, 200),
    clean(req.headers['user-agent'], 500),
    clean(report['document-uri'] || report.documentURL, 1000),
    clean(report['violated-directive'] || report.violatedDirective, 200),
    clean(report['effective-directive'] || report.effectiveDirective, 200),
    clean(report['blocked-uri'] || report.blockedURL, 1000),
    clean(report['source-file'] || report.sourceFile, 1000),
    parseInt(report['line-number'] || report.lineNumber, 10) || null,
    parseInt(report['column-number'] || report.columnNumber, 10) || null,
    clean(report.disposition, 100),
    parseInt(report['status-code'] || report.statusCode, 10) || null,
    clean(report['script-sample'] || report.sample, 1000),
    JSON.stringify(report || {}),
  ]);
}

function isFirstParty(row) {
  const source = String(row.source_file || row.document_uri || '');
  const blocked = String(row.blocked_uri || '');
  return source.includes('track.lnxo.me') || blocked === 'inline' || blocked.includes('track.lnxo.me');
}

async function getSummary({ hours = 168, limit = 50 } = {}) {
  const cappedHours = Math.min(Math.max(parseInt(hours, 10) || 168, 1), 24 * 30);
  const cappedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const rows = await queryAll(`
    SELECT
      COALESCE(effective_directive, violated_directive, 'unknown') AS directive,
      COALESCE(blocked_uri, 'unknown') AS blocked_uri,
      COALESCE(source_file, document_uri, 'unknown') AS source_file,
      COUNT(*)::int AS count,
      MIN(created_at) AS first_seen_at,
      MAX(created_at) AS last_seen_at
    FROM csp_violation_reports
    WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
    GROUP BY 1,2,3
    ORDER BY count DESC, last_seen_at DESC
    LIMIT $2
  `, [cappedHours, cappedLimit]);
  const totals = await queryOne(`
    SELECT COUNT(*)::int AS total
    FROM csp_violation_reports
    WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
  `, [cappedHours]);
  const firstPartyRows = await queryAll(`
    SELECT
      COALESCE(effective_directive, violated_directive, 'unknown') AS directive,
      COALESCE(blocked_uri, 'unknown') AS blocked_uri,
      COALESCE(source_file, document_uri, 'unknown') AS source_file,
      COUNT(*)::int AS count
    FROM csp_violation_reports
    WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
    GROUP BY 1,2,3
  `, [cappedHours]);
  const firstPartyBlocking = firstPartyRows.filter(isFirstParty);
  return {
    window_hours: cappedHours,
    total: parseInt(totals?.total, 10) || 0,
    first_party_blocking: firstPartyBlocking.reduce((sum, row) => sum + (parseInt(row.count, 10) || 0), 0),
    enforcement_readiness: {
      ready: firstPartyBlocking.length === 0,
      status: firstPartyBlocking.length === 0 ? 'ready' : 'blocked',
      reasons: firstPartyBlocking.length === 0 ? [] : ['first_party_csp_violations_present'],
    },
    rows,
  };
}

module.exports = {
  getSummary,
  normalizeReport,
  recordReport,
};
