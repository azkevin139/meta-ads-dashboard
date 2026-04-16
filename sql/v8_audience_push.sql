-- ============================================================
-- V8 Migration: Track which first-party segments are pushed to Meta
-- Run: sudo -u postgres psql -d meta_dashboard -f v8_audience_push.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS audience_pushes (
  id             SERIAL PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  segment_key    TEXT NOT NULL,
  segment_name   TEXT,
  meta_audience_id TEXT,
  last_push_at   TIMESTAMPTZ,
  last_push_count INTEGER DEFAULT 0,
  last_push_error TEXT,
  refresh_interval_hours INTEGER DEFAULT 24,
  auto_refresh   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, segment_key)
);

CREATE INDEX IF NOT EXISTS idx_audience_pushes_account ON audience_pushes(account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON audience_pushes TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE audience_pushes_id_seq TO meta_dash;

SELECT 'V8 audience push migration complete' AS status;
