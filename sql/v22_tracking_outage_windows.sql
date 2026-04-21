-- Persist tracking outage windows in Postgres instead of runtime JSON files.

CREATE TABLE IF NOT EXISTS tracking_outage_windows (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  outage_start DATE NOT NULL,
  outage_end DATE NOT NULL,
  notes TEXT,
  last_backfill_at TIMESTAMPTZ,
  last_backfill JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'recovered', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (outage_end >= outage_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracking_outage_windows_account_active
  ON tracking_outage_windows(account_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_tracking_outage_windows_account_updated
  ON tracking_outage_windows(account_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON tracking_outage_windows TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE tracking_outage_windows_id_seq TO meta_dash;
