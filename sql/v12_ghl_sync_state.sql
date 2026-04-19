-- ============================================================
-- V12 Migration: GHL sync state + observability
-- Run: sudo -u postgres psql -d meta_dashboard -f v12_ghl_sync_state.sql
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_sync_mode TEXT DEFAULT 'incremental';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_scan_count INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_match_count INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_cursor TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_last_bootstrap_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ghl_oldest_synced_at TIMESTAMPTZ;

SELECT 'V12 GHL sync state migration complete' AS status;
