ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS tracking_allowed_origins TEXT[] DEFAULT NULL;

CREATE TABLE IF NOT EXISTS webhook_event_ledger (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source, event_id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_event_ledger_source_received ON webhook_event_ledger(source, received_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_event_ledger TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE webhook_event_ledger_id_seq TO meta_dash;
