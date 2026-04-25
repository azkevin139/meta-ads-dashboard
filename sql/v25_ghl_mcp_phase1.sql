ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ghl_mcp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ghl_mcp_token_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS ghl_mcp_location_id TEXT,
  ADD COLUMN IF NOT EXISTS ghl_mcp_mode TEXT NOT NULL DEFAULT 'disabled',
  ADD COLUMN IF NOT EXISTS ghl_mcp_scopes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ghl_mcp_tools_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ghl_mcp_last_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ghl_mcp_last_status TEXT,
  ADD COLUMN IF NOT EXISTS ghl_mcp_last_error TEXT;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_ghl_mcp_mode_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_ghl_mcp_mode_check
  CHECK (ghl_mcp_mode IN ('disabled', 'read_only', 'assistive_write', 'automated_write'));

CREATE TABLE IF NOT EXISTS ghl_mcp_runs (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL,
  tool_name TEXT,
  status TEXT NOT NULL,
  reason_code TEXT,
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  duration_ms INTEGER,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_mcp_runs_account_created
  ON ghl_mcp_runs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_mcp_runs_run_type
  ON ghl_mcp_runs(run_type, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ghl_mcp_runs TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE ghl_mcp_runs_id_seq TO meta_dash;
