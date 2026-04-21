-- Minimal identity collision review and resolution workflow.

CREATE TABLE IF NOT EXISTS identity_collision_groups (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  collision_key TEXT NOT NULL,
  identity_type TEXT NOT NULL CHECK (identity_type IN ('email_hash', 'phone_hash')),
  identity_hash TEXT NOT NULL,
  confidence_bucket TEXT NOT NULL DEFAULT 'low',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
  member_count INTEGER NOT NULL DEFAULT 0,
  downstream_effect TEXT NOT NULL DEFAULT 'blocked_from_sensitive_automation',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, collision_key)
);

CREATE TABLE IF NOT EXISTS identity_collision_members (
  id BIGSERIAL PRIMARY KEY,
  collision_group_id BIGINT NOT NULL REFERENCES identity_collision_groups(id) ON DELETE CASCADE,
  client_id TEXT,
  ghl_contact_id TEXT,
  source TEXT NOT NULL DEFAULT 'visitors',
  identity_type TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(collision_group_id, client_id, ghl_contact_id)
);

CREATE TABLE IF NOT EXISTS identity_collision_resolutions (
  id BIGSERIAL PRIMARY KEY,
  collision_group_id BIGINT NOT NULL REFERENCES identity_collision_groups(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK (decision IN ('confirmed_same_person', 'keep_separate', 'ignore', 'reopen')),
  previous_status TEXT,
  next_status TEXT NOT NULL,
  decided_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_collision_groups_account_status
  ON identity_collision_groups(account_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_collision_groups_key
  ON identity_collision_groups(account_id, collision_key);
CREATE INDEX IF NOT EXISTS idx_identity_collision_members_group
  ON identity_collision_members(collision_group_id);
CREATE INDEX IF NOT EXISTS idx_identity_collision_resolutions_group
  ON identity_collision_resolutions(collision_group_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON identity_collision_groups TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_collision_members TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON identity_collision_resolutions TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE identity_collision_groups_id_seq TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE identity_collision_members_id_seq TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE identity_collision_resolutions_id_seq TO meta_dash;
