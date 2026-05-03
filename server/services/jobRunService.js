const { queryOne, queryAll } = require('../db');

const VALID_STATUS = new Set(['running', 'success', 'partial', 'failed', 'skipped', 'stale']);

function cleanText(value, max = 2000) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).slice(0, max);
}

function normalizeStatus(status) {
  return VALID_STATUS.has(status) ? status : 'success';
}

async function startRun({
  jobName,
  scopeType = 'global',
  scopeId = null,
  summary = {},
} = {}) {
  if (!jobName) throw new Error('jobName required');
  return queryOne(
    `
    INSERT INTO job_runs (job_name, scope_type, scope_id, summary_json)
    VALUES ($1, $2, $3, COALESCE($4::jsonb, '{}'::jsonb))
    RETURNING *
    `,
    [jobName, scopeType, scopeId ? String(scopeId) : null, JSON.stringify(summary || {})]
  );
}

async function finishRun(runOrId, {
  status = 'success',
  summary = {},
  error = null,
} = {}) {
  const id = typeof runOrId === 'object' ? runOrId?.id : runOrId;
  if (!id) return null;
  return queryOne(
    `
    UPDATE job_runs
    SET
      finished_at = NOW(),
      status = $2,
      duration_ms = GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000))::int,
      summary_json = COALESCE(job_runs.summary_json, '{}'::jsonb) || COALESCE($3::jsonb, '{}'::jsonb),
      error_text = $4
    WHERE id = $1
    RETURNING *
    `,
    [
      id,
      normalizeStatus(status),
      JSON.stringify(summary || {}),
      error ? cleanText(error.message || error) : null,
    ]
  );
}

async function markFailed(runOrId, error, summary = {}) {
  return finishRun(runOrId, { status: 'failed', summary, error });
}

async function recordRun(input, fn, { summarize } = {}) {
  const run = await startRun(input);
  try {
    const result = await fn(run);
    const summary = summarize ? summarize(result) : {};
    const status = summary?.status || (Array.isArray(result) && result.some((row) => row?.error) ? 'partial' : 'success');
    await finishRun(run, { status, summary });
    return result;
  } catch (err) {
    await markFailed(run, err);
    throw err;
  }
}

async function getHealth({ limit = 100 } = {}) {
  const rows = await queryAll(
    `
    WITH latest AS (
      SELECT DISTINCT ON (job_name, scope_type, scope_id)
        *
      FROM job_runs
      ORDER BY job_name, scope_type, scope_id, started_at DESC
    ),
    successful AS (
      SELECT job_name, scope_type, scope_id, MAX(finished_at) AS last_successful_at
      FROM job_runs
      WHERE status = 'success'
      GROUP BY job_name, scope_type, scope_id
    )
    SELECT latest.*, successful.last_successful_at
    FROM latest
    LEFT JOIN successful
      ON successful.job_name = latest.job_name
     AND successful.scope_type = latest.scope_type
     AND successful.scope_id IS NOT DISTINCT FROM latest.scope_id
    ORDER BY latest.started_at DESC
    LIMIT $1
    `,
    [Math.max(1, Math.min(parseInt(limit, 10) || 100, 500))]
  );
  return rows.map((row) => ({
    id: row.id,
    job_name: row.job_name,
    scope_type: row.scope_type,
    scope_id: row.scope_id,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    duration_ms: row.duration_ms,
    last_successful_at: row.last_successful_at || null,
    summary: row.summary_json || {},
    error_text: row.error_text || null,
  }));
}

module.exports = {
  startRun,
  finishRun,
  markFailed,
  recordRun,
  getHealth,
};
