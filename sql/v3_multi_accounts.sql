-- ============================================================
-- V3 Migration: Multi-account switching
-- Run: sudo -u postgres psql -d meta_dashboard -f v3_multi_accounts.sql
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS encrypted_token TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_last4 TEXT;
ALTER TABLE accounts ALTER COLUMN access_token DROP NOT NULL;

UPDATE accounts
SET label = COALESCE(label, name)
WHERE label IS NULL;

ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS active_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_active_account ON user_sessions(active_account_id);

SELECT 'V3 multi-account migration complete' AS status;
