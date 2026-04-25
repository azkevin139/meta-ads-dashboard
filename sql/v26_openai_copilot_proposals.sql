CREATE TABLE IF NOT EXISTS copilot_runs (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
  input_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_copilot_runs_account_created
  ON copilot_runs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS copilot_proposals (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT REFERENCES copilot_runs(id) ON DELETE SET NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  proposal_type TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  why TEXT NOT NULL,
  why_not_alternative TEXT,
  expected_impact TEXT,
  confidence NUMERIC(4,3),
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'dismissed')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by BIGINT,
  dismissed_at TIMESTAMPTZ,
  dismissed_by BIGINT
);

CREATE INDEX IF NOT EXISTS idx_copilot_proposals_account_status_created
  ON copilot_proposals(account_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_copilot_proposals_run
  ON copilot_proposals(run_id);

