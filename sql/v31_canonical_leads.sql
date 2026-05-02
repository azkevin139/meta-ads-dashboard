-- ============================================================
-- V31 Migration: canonical lead identity contract
--
-- Creates a durable account-scoped lead identity layer. The system keeps
-- hashed email/phone values instead of raw PII and links source rows into
-- one canonical lead record for reporting, qualification, dedupe, and
-- attribution.
--
-- Run: sudo -u postgres psql -d meta_dashboard -f v31_canonical_leads.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS canonical_leads (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  primary_ghl_contact_id TEXT,
  primary_phone_hash TEXT,
  primary_email_hash TEXT,
  primary_meta_lead_id TEXT,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  identity_confidence TEXT NOT NULL DEFAULT 'low'
    CHECK (identity_confidence IN ('low', 'medium', 'high')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_leads_ghl_contact
  ON canonical_leads(account_id, primary_ghl_contact_id)
  WHERE primary_ghl_contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_leads_phone_hash
  ON canonical_leads(account_id, primary_phone_hash)
  WHERE primary_phone_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_leads_email_hash
  ON canonical_leads(account_id, primary_email_hash)
  WHERE primary_email_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_leads_meta_lead
  ON canonical_leads(account_id, primary_meta_lead_id)
  WHERE primary_meta_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_leads_account_seen
  ON canonical_leads(account_id, first_seen_at, last_seen_at);

CREATE TABLE IF NOT EXISTS canonical_lead_links (
  id BIGSERIAL PRIMARY KEY,
  canonical_lead_id BIGINT NOT NULL REFERENCES canonical_leads(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  match_method TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_lead_links_lead
  ON canonical_lead_links(canonical_lead_id);

CREATE INDEX IF NOT EXISTS idx_canonical_lead_links_account_source
  ON canonical_lead_links(account_id, source_type, source_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON canonical_leads TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON canonical_lead_links TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE canonical_leads_id_seq TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE canonical_lead_links_id_seq TO meta_dash;

SELECT 'V31 canonical leads migration complete' AS status;
