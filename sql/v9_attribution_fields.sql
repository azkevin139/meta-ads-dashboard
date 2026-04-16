-- ============================================================
-- V9 Migration: Extended attribution fields on visitors
-- Run: sudo -u postgres psql -d meta_dashboard -f v9_attribution_fields.sql
-- ============================================================

ALTER TABLE visitors ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS source_event_type TEXT;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lead_form_id TEXT;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS lead_form_name TEXT;
ALTER TABLE visitors ADD COLUMN IF NOT EXISTS gclid TEXT;

CREATE INDEX IF NOT EXISTS idx_visitors_source_event ON visitors(source_event_type) WHERE source_event_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_visitors_lead_form ON visitors(lead_form_id) WHERE lead_form_id IS NOT NULL;

SELECT 'V9 attribution fields migration complete' AS status;
