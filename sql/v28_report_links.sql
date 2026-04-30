-- Signed, revocable client report links.

CREATE TABLE IF NOT EXISTS report_links (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  preset_restrictions JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  last_viewed_at TIMESTAMPTZ,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE report_links
  ADD COLUMN IF NOT EXISTS last_viewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_report_links_account_created
  ON report_links(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_links_token_hash
  ON report_links(token_hash);

CREATE TABLE IF NOT EXISTS report_link_views (
  id BIGSERIAL PRIMARY KEY,
  report_link_id BIGINT NOT NULL REFERENCES report_links(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ip TEXT,
  user_agent TEXT,
  preset TEXT,
  since DATE,
  until DATE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_link_views_link_viewed
  ON report_link_views(report_link_id, viewed_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_link_views_account_viewed
  ON report_link_views(account_id, viewed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON report_links TO meta_dash;
GRANT SELECT, INSERT, UPDATE, DELETE ON report_link_views TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE report_links_id_seq TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE report_link_views_id_seq TO meta_dash;
