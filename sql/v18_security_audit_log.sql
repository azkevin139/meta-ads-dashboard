CREATE TABLE IF NOT EXISTS security_audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  before_json JSONB,
  after_json JSONB,
  result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'denied', 'failed')),
  ip TEXT,
  user_agent TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_created ON security_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_actor ON security_audit_log(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_account ON security_audit_log(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_action ON security_audit_log(action, created_at DESC);

GRANT SELECT, INSERT ON security_audit_log TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE security_audit_log_id_seq TO meta_dash;
