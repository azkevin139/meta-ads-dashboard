-- ============================================================
-- V32 Migration: durable job run heartbeat
--
-- Records scheduler/job executions separately from source-specific sync
-- ledgers so operators can see whether critical background jobs are alive,
-- failing, stale, or skipped.
--
-- Run: sudo -u postgres psql -d meta_dashboard -f v32_job_runs.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'global'
    CHECK (scope_type IN ('global', 'account')),
  scope_id TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped', 'stale')),
  duration_ms INTEGER,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_runs_name_started
  ON job_runs(job_name, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_runs_status_started
  ON job_runs(status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_runs_scope
  ON job_runs(scope_type, scope_id, started_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON job_runs TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE job_runs_id_seq TO meta_dash;

SELECT 'V32 job runs migration complete' AS status;
