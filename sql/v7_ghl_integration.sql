-- ============================================================
-- V7 Migration: GHL integration per account
-- Run: sudo -u postgres psql -d meta_dashboard -f v7_ghl_integration.sql
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_api_key_encrypted TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_location_id TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_sync_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_sync_count INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_sync_error TEXT;

CREATE INDEX IF NOT EXISTS idx_visitors_email_hash ON visitors(email_hash) WHERE email_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitors_phone_hash ON visitors(phone_hash) WHERE phone_hash IS NOT NULL;

SELECT 'V7 GHL integration migration complete' AS status;
