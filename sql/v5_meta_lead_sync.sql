-- ============================================================
-- V5 Migration: Meta Lead Ads ingest state
-- Run: sudo -u postgres psql -d meta_dashboard -f v5_meta_lead_sync.sql
-- ============================================================

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_count INTEGER DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_leads_sync_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitors_meta_lead_id ON visitors(meta_lead_id) WHERE meta_lead_id IS NOT NULL;

SELECT 'V5 Meta lead sync migration complete' AS status;
