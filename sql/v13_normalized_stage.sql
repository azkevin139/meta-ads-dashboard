-- ============================================================
-- V13 Migration: normalized lifecycle stage
-- Run: sudo -u postgres psql -d meta_dashboard -f v13_normalized_stage.sql
-- ============================================================

ALTER TABLE visitors ADD COLUMN IF NOT EXISTS normalized_stage TEXT;

UPDATE visitors
SET normalized_stage = CASE
  WHEN COALESCE(revenue, 0) > 0 THEN 'closed_won'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%closed won%' THEN 'closed_won'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%won%' THEN 'closed_won'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%closed lost%' THEN 'closed_lost'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%lost%' THEN 'closed_lost'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%show%' THEN 'showed'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%book%' OR lower(COALESCE(current_stage, '')) LIKE '%appoint%' OR lower(COALESCE(current_stage, '')) LIKE '%meeting%' THEN 'booked'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%qualif%' THEN 'qualified'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%contact%' THEN 'contacted'
  WHEN lower(COALESCE(current_stage, '')) LIKE '%lead%' OR lower(COALESCE(current_stage, '')) LIKE '%new%' OR meta_lead_id IS NOT NULL THEN 'new_lead'
  ELSE normalized_stage
END
WHERE normalized_stage IS NULL;

CREATE INDEX IF NOT EXISTS idx_visitors_normalized_stage ON visitors(normalized_stage);

SELECT 'V13 normalized lifecycle stage migration complete' AS status;
