ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS product_mode TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS fast_sync_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_product_mode_check;

ALTER TABLE accounts
  ADD CONSTRAINT accounts_product_mode_check
  CHECK (product_mode IN ('general', 'lead_gen'));

CREATE TABLE IF NOT EXISTS audience_automation_rules (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  segment_key TEXT NOT NULL,
  threshold_type TEXT NOT NULL DEFAULT 'matchable_count',
  threshold_value INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  cooldown_minutes INTEGER NOT NULL DEFAULT 60,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audience_automation_rules
  DROP CONSTRAINT IF EXISTS audience_automation_rules_threshold_type_check;
ALTER TABLE audience_automation_rules
  ADD CONSTRAINT audience_automation_rules_threshold_type_check
  CHECK (threshold_type IN ('eligible_count', 'matchable_count'));

ALTER TABLE audience_automation_rules
  DROP CONSTRAINT IF EXISTS audience_automation_rules_action_type_check;
ALTER TABLE audience_automation_rules
  ADD CONSTRAINT audience_automation_rules_action_type_check
  CHECK (action_type IN ('create_audience', 'refresh_audience', 'notify_n8n'));

ALTER TABLE audience_automation_rules
  DROP CONSTRAINT IF EXISTS audience_automation_rules_threshold_value_check;
ALTER TABLE audience_automation_rules
  ADD CONSTRAINT audience_automation_rules_threshold_value_check
  CHECK (threshold_value > 0);

ALTER TABLE audience_automation_rules
  DROP CONSTRAINT IF EXISTS audience_automation_rules_cooldown_minutes_check;
ALTER TABLE audience_automation_rules
  ADD CONSTRAINT audience_automation_rules_cooldown_minutes_check
  CHECK (cooldown_minutes BETWEEN 1 AND 10080);

CREATE INDEX IF NOT EXISTS idx_audience_automation_rules_account_enabled
  ON audience_automation_rules(account_id, enabled, created_at DESC);

CREATE TABLE IF NOT EXISTS audience_rule_runs (
  id BIGSERIAL PRIMARY KEY,
  rule_id BIGINT NOT NULL REFERENCES audience_automation_rules(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  segment_key TEXT NOT NULL,
  status TEXT NOT NULL,
  eligible_count INTEGER,
  matchable_count INTEGER,
  reason_code TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE audience_rule_runs
  DROP CONSTRAINT IF EXISTS audience_rule_runs_status_check;
ALTER TABLE audience_rule_runs
  ADD CONSTRAINT audience_rule_runs_status_check
  CHECK (status IN ('triggered', 'skipped', 'blocked', 'failed'));

CREATE INDEX IF NOT EXISTS idx_audience_rule_runs_rule_created
  ON audience_rule_runs(rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audience_rule_runs_account_created
  ON audience_rule_runs(account_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON audience_automation_rules TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE audience_automation_rules_id_seq TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON audience_rule_runs TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE audience_rule_runs_id_seq TO meta_dash;
