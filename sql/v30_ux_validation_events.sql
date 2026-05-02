CREATE TABLE IF NOT EXISTS ux_validation_events (
  id bigserial PRIMARY KEY,
  account_id bigint,
  user_id bigint,
  event_name text NOT NULL,
  page text,
  session_id text,
  route text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ux_validation_events_created
  ON ux_validation_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ux_validation_events_account_created
  ON ux_validation_events (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ux_validation_events_name_created
  ON ux_validation_events (event_name, created_at DESC);

GRANT SELECT, INSERT ON ux_validation_events TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE ux_validation_events_id_seq TO meta_dash;
