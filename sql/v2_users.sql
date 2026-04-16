-- ============================================================
-- V2 Migration: Users + Auth
-- Run: sudo -u postgres psql -d meta_dashboard -f v2_users.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'viewer')),
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  login_count   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Sessions for tracking active connections
CREATE TABLE IF NOT EXISTS user_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT UNIQUE NOT NULL,
  ip_address    TEXT,
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token);

SELECT 'V2 users migration complete' AS status;
