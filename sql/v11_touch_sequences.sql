CREATE TABLE IF NOT EXISTS touch_sequences (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  threshold_default INTEGER NOT NULL DEFAULT 3000,
  n8n_webhook_url TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touch_sequences_account ON touch_sequences(account_id);

CREATE TABLE IF NOT EXISTS touch_sequence_steps (
  id SERIAL PRIMARY KEY,
  sequence_id INTEGER NOT NULL REFERENCES touch_sequences(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  audience_source_type TEXT NOT NULL CHECK (audience_source_type IN ('meta_engagement', 'meta_website', 'first_party_push')),
  source_audience_id TEXT,
  segment_key TEXT,
  target_adset_id TEXT,
  pause_previous_adset BOOLEAN NOT NULL DEFAULT FALSE,
  reduce_previous_budget_to NUMERIC,
  threshold_count INTEGER NOT NULL DEFAULT 3000,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'ready', 'triggered', 'error', 'disabled')),
  last_size INTEGER,
  last_checked_at TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  last_triggered_count INTEGER,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sequence_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_touch_sequence_steps_sequence ON touch_sequence_steps(sequence_id);
CREATE INDEX IF NOT EXISTS idx_touch_sequence_steps_status ON touch_sequence_steps(status);

CREATE TABLE IF NOT EXISTS touch_sequence_events (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES touch_sequences(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES touch_sequence_steps(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_touch_sequence_events_sequence ON touch_sequence_events(sequence_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_touch_sequence_events_account ON touch_sequence_events(account_id, created_at DESC);
