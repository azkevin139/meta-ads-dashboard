-- CSP report-only violation ledger for enforcement readiness.

CREATE TABLE IF NOT EXISTS csp_violation_reports (
  id BIGSERIAL PRIMARY KEY,
  request_id TEXT,
  ip TEXT,
  user_agent TEXT,
  document_uri TEXT,
  violated_directive TEXT,
  effective_directive TEXT,
  blocked_uri TEXT,
  source_file TEXT,
  line_number INTEGER,
  column_number INTEGER,
  disposition TEXT,
  status_code INTEGER,
  script_sample TEXT,
  raw_report JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csp_violation_reports_created
  ON csp_violation_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_violation_reports_directive
  ON csp_violation_reports(effective_directive, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_csp_violation_reports_source
  ON csp_violation_reports(source_file, blocked_uri, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON csp_violation_reports TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE csp_violation_reports_id_seq TO meta_dash;
