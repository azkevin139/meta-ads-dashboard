-- ============================================================
-- V6 Migration: Token health / expiry tracking
-- Run: sudo -u postgres psql -d meta_dashboard -f v6_token_health.sql
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_checked_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_scopes JSONB;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_is_system_user BOOLEAN DEFAULT FALSE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_last_error TEXT;

SELECT 'V6 token health migration complete' AS status;
