-- Data Truth Layer: durable sync ledger and explicit attempted/success timestamps.

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  dataset TEXT NOT NULL,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  mode TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  attempted_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  coverage_start TIMESTAMPTZ,
  coverage_end TIMESTAMPTZ,
  partial_reason TEXT,
  error_summary TEXT,
  triggered_by TEXT,
  request_id TEXT,
  job_run_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sync_runs_status_check CHECK (status IN ('running', 'success', 'partial', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_account_dataset_started
  ON sync_runs(account_id, source, dataset, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_status
  ON sync_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_runs_partial_reason
  ON sync_runs(partial_reason);
CREATE INDEX IF NOT EXISTS idx_visitor_events_ghl_lifecycle_dedupe
  ON visitor_events(account_id, event_name, ((metadata->>'ghl_contact_id')), fired_at)
  WHERE metadata->>'source' = 'ghl'
    AND event_name IN ('GHLContactImported', 'GHLStageChanged', 'GHLBooked', 'GHLRevenueUpdated');

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_attempted_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_success_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_sync_attempted_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_sync_success_at TIMESTAMPTZ;

GRANT SELECT, INSERT, UPDATE, DELETE ON sync_runs TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE sync_runs_id_seq TO meta_dash;
