-- Lifecycle and identity integrity controls.

CREATE UNIQUE INDEX IF NOT EXISTS idx_visitor_events_lifecycle_dedupe_key
  ON visitor_events(account_id, ((metadata->>'dedupe_key')))
  WHERE metadata->>'dedupe_key' IS NOT NULL;
