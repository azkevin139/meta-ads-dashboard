-- ============================================================
-- V4 Migration: First-party tracking and attribution views
-- Run: sudo -u postgres psql -d meta_dashboard -f v4_tracking_attribution.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS visitors (
  client_id TEXT PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  meta_account_id TEXT,
  fbclid TEXT,
  fbc TEXT,
  fbp TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  ad_id TEXT,
  adset_id TEXT,
  campaign_id TEXT,
  referrer TEXT,
  landing_page TEXT,
  email_hash TEXT,
  phone_hash TEXT,
  ghl_contact_id TEXT,
  meta_lead_id TEXT,
  current_stage TEXT,
  revenue NUMERIC(12,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  raw JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_visitors_account ON visitors(account_id);
CREATE INDEX IF NOT EXISTS idx_visitors_campaign ON visitors(campaign_id);
CREATE INDEX IF NOT EXISTS idx_visitors_adset ON visitors(adset_id);
CREATE INDEX IF NOT EXISTS idx_visitors_ad ON visitors(ad_id);
CREATE INDEX IF NOT EXISTS idx_visitors_ghl ON visitors(ghl_contact_id);
CREATE INDEX IF NOT EXISTS idx_visitors_meta_lead ON visitors(meta_lead_id);
CREATE INDEX IF NOT EXISTS idx_visitors_seen ON visitors(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS visitor_events (
  id BIGSERIAL PRIMARY KEY,
  client_id TEXT REFERENCES visitors(client_id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  event_name TEXT NOT NULL,
  page_url TEXT,
  campaign_id TEXT,
  adset_id TEXT,
  ad_id TEXT,
  value NUMERIC(12,2),
  currency TEXT DEFAULT 'USD',
  metadata JSONB DEFAULT '{}'::jsonb,
  fired_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_visitor_events_client ON visitor_events(client_id);
CREATE INDEX IF NOT EXISTS idx_visitor_events_account ON visitor_events(account_id);
CREATE INDEX IF NOT EXISTS idx_visitor_events_event ON visitor_events(event_name);
CREATE INDEX IF NOT EXISTS idx_visitor_events_fired ON visitor_events(fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_events_campaign ON visitor_events(campaign_id);

CREATE TABLE IF NOT EXISTS audience_snapshots (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  audience_id TEXT NOT NULL,
  name TEXT,
  subtype TEXT,
  approximate_count BIGINT,
  delivery_status JSONB,
  operation_status JSONB,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audience_snapshots_account ON audience_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_audience_snapshots_audience ON audience_snapshots(audience_id, captured_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON visitors TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON visitor_events TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON audience_snapshots TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE visitor_events_id_seq TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE audience_snapshots_id_seq TO meta_dash;

SELECT 'V4 tracking attribution migration complete' AS status;
