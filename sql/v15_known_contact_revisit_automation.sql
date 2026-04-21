CREATE TABLE IF NOT EXISTS known_contact_revisit_jobs (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  ghl_contact_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  page_url TEXT,
  page_path TEXT,
  event_name TEXT DEFAULT 'PageView',
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'suppressed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_contact_revisit_jobs_due
  ON known_contact_revisit_jobs(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_known_contact_revisit_jobs_contact
  ON known_contact_revisit_jobs(account_id, ghl_contact_id, rule_key, created_at DESC);

CREATE TABLE IF NOT EXISTS known_contact_revisit_sends (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  ghl_contact_id TEXT NOT NULL,
  rule_key TEXT NOT NULL,
  job_id BIGINT REFERENCES known_contact_revisit_jobs(id) ON DELETE SET NULL,
  page_url TEXT,
  delivery_target TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'sent' CHECK (delivery_status IN ('sent', 'failed')),
  response_code INTEGER,
  response_body TEXT,
  payload JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_known_contact_revisit_sends_contact
  ON known_contact_revisit_sends(account_id, ghl_contact_id, rule_key, sent_at DESC);
