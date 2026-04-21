CREATE TABLE IF NOT EXISTS user_account_access (
  id BIGSERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_account_access_user ON user_account_access(user_id);
CREATE INDEX IF NOT EXISTS idx_user_account_access_account ON user_account_access(account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_account_access TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE user_account_access_id_seq TO meta_dash;
