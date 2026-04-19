-- ============================================================
-- V14 Migration: Meta lead sync observability
-- Run: sudo -u postgres psql -d meta_dashboard -f v14_meta_lead_sync_state.sql
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_mode TEXT DEFAULT 'incremental';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_scan_count INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_ad_count INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_since TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_until TIMESTAMPTZ;

SELECT 'V14 Meta lead sync state migration complete' AS status;
