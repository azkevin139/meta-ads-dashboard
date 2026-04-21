const { query, queryAll, queryOne } = require('../db');

const VALID_STATUSES = new Set(['running', 'success', 'partial', 'failed', 'skipped']);

function cleanInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function cleanText(value, max = 1000) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).slice(0, max);
}

function cleanDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusFromResult({ skipped, error, partialReason, errorCount } = {}) {
  if (skipped) return 'skipped';
  if (error) return 'failed';
  if (partialReason || cleanInt(errorCount) > 0) return 'partial';
  return 'success';
}

async function startRun({
  source,
  dataset,
  accountId,
  mode,
  coverageStart,
  coverageEnd,
  triggeredBy,
  requestId,
  jobRunId,
  metadata,
} = {}) {
  if (!source) throw new Error('sync run source required');
  if (!dataset) throw new Error('sync run dataset required');
  const row = await queryOne(`
    INSERT INTO sync_runs (
      source, dataset, account_id, mode, coverage_start, coverage_end,
      triggered_by, request_id, job_run_id, metadata
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::jsonb, '{}'::jsonb))
    RETURNING *
  `, [
    source,
    dataset,
    accountId || null,
    cleanText(mode, 80),
    cleanDate(coverageStart),
    cleanDate(coverageEnd),
    cleanText(triggeredBy, 120),
    cleanText(requestId, 120),
    cleanText(jobRunId, 120),
    metadata ? JSON.stringify(metadata) : null,
  ]);
  return row;
}

async function finishRun(runOrId, {
  status,
  attemptedCount,
  importedCount,
  changedCount,
  skippedCount,
  errorCount,
  coverageStart,
  coverageEnd,
  partialReason,
  errorSummary,
  metadata,
} = {}) {
  const id = typeof runOrId === 'object' ? runOrId.id : runOrId;
  if (!id) return null;
  const nextStatus = VALID_STATUSES.has(status) ? status : statusFromResult({
    skipped: status === 'skipped',
    error: errorSummary,
    partialReason,
    errorCount,
  });
  return queryOne(`
    UPDATE sync_runs
    SET finished_at = NOW(),
        status = $2,
        attempted_count = $3,
        imported_count = $4,
        changed_count = $5,
        skipped_count = $6,
        error_count = $7,
        coverage_start = COALESCE($8, coverage_start),
        coverage_end = COALESCE($9, coverage_end),
        partial_reason = $10,
        error_summary = $11,
        metadata = COALESCE(sync_runs.metadata, '{}'::jsonb) || COALESCE($12::jsonb, '{}'::jsonb),
        updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `, [
    id,
    nextStatus,
    cleanInt(attemptedCount),
    cleanInt(importedCount),
    cleanInt(changedCount),
    cleanInt(skippedCount),
    cleanInt(errorCount),
    cleanDate(coverageStart),
    cleanDate(coverageEnd),
    cleanText(partialReason, 200),
    cleanText(errorSummary, 2000),
    metadata ? JSON.stringify(metadata) : null,
  ]);
}

async function recordRun(input = {}, result = {}) {
  const run = await startRun(input);
  return finishRun(run.id, result);
}

async function markRunFailed(runOrId, err, extra = {}) {
  return finishRun(runOrId, {
    ...extra,
    status: 'failed',
    errorCount: extra.errorCount || 1,
    errorSummary: err?.message || String(err || 'Sync failed'),
  });
}

async function getLatestRun(accountId, source, dataset) {
  return queryOne(`
    SELECT *
    FROM sync_runs
    WHERE account_id = $1
      AND source = $2
      AND dataset = $3
    ORDER BY started_at DESC
    LIMIT 1
  `, [accountId, source, dataset]);
}

async function getHealth(accountId) {
  const params = [];
  let where = '';
  if (accountId) {
    params.push(accountId);
    where = 'WHERE account_id = $1';
  }
  const rows = await queryAll(`
    WITH scoped AS (
      SELECT *
      FROM sync_runs
      ${where}
    ),
    latest AS (
      SELECT DISTINCT ON (account_id, source, dataset) *
      FROM scoped
      ORDER BY account_id, source, dataset, started_at DESC
    ),
    successful AS (
      SELECT
        account_id,
        source,
        dataset,
        MAX(finished_at) AS last_successful_at
      FROM scoped
      WHERE status = 'success'
      GROUP BY account_id, source, dataset
    )
    SELECT latest.*, successful.last_successful_at
    FROM latest
    LEFT JOIN successful
      ON successful.account_id IS NOT DISTINCT FROM latest.account_id
     AND successful.source = latest.source
     AND successful.dataset = latest.dataset
    ORDER BY latest.account_id, latest.source, latest.dataset
  `, params);

  return rows.map((row) => ({
    id: row.id,
    account_id: row.account_id,
    source: row.source,
    dataset: row.dataset,
    mode: row.mode,
    status: row.status,
    started_at: row.started_at,
    finished_at: row.finished_at,
    last_attempted_at: row.started_at,
    last_successful_at: row.last_successful_at || null,
    attempted_count: row.attempted_count,
    imported_count: row.imported_count,
    changed_count: row.changed_count,
    skipped_count: row.skipped_count,
    error_count: row.error_count,
    coverage_start: row.coverage_start,
    coverage_end: row.coverage_end,
    partial_reason: row.partial_reason,
    error_summary: row.error_summary,
    triggered_by: row.triggered_by,
    request_id: row.request_id,
    metadata: row.metadata || {},
  }));
}

module.exports = {
  startRun,
  finishRun,
  recordRun,
  markRunFailed,
  getLatestRun,
  getHealth,
  statusFromResult,
};
