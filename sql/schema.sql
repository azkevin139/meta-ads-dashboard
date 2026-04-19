-- ============================================================
-- Meta Ads Operator Dashboard — V1 Schema
-- Run: psql -U your_user -d meta_dashboard -f schema.sql
-- ============================================================

-- Clean slate (drop in reverse dependency order)
DROP TABLE IF EXISTS action_log CASCADE;
DROP TABLE IF EXISTS ai_recommendations CASCADE;
DROP TABLE IF EXISTS touch_sequence_events CASCADE;
DROP TABLE IF EXISTS touch_sequence_steps CASCADE;
DROP TABLE IF EXISTS touch_sequences CASCADE;
DROP TABLE IF EXISTS daily_insights CASCADE;
DROP TABLE IF EXISTS ads CASCADE;
DROP TABLE IF EXISTS adsets CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;

-- ============================================================
-- 1. ACCOUNTS
-- ============================================================
CREATE TABLE accounts (
  id              SERIAL PRIMARY KEY,
  meta_account_id TEXT UNIQUE NOT NULL,       -- e.g. 'act_123456789'
  name            TEXT NOT NULL,
  label           TEXT,
  currency        TEXT DEFAULT 'USD',
  timezone        TEXT DEFAULT 'America/Montreal',
  access_token    TEXT,                        -- legacy/plain fallback only
  encrypted_token TEXT,                        -- primary token storage
  token_last4     TEXT,
  token_expires_at TIMESTAMPTZ,
  token_checked_at TIMESTAMPTZ,
  token_scopes    JSONB,
  token_is_system_user BOOLEAN DEFAULT FALSE,
  token_last_error TEXT,
  last_leads_sync_at TIMESTAMPTZ,
  last_leads_sync_count INTEGER DEFAULT 0,
  last_leads_sync_error TEXT,
  ghl_api_key_encrypted TEXT,
  ghl_location_id TEXT,
  ghl_last_sync_at TIMESTAMPTZ,
  ghl_last_sync_count INTEGER DEFAULT 0,
  ghl_last_scan_count INTEGER DEFAULT 0,
  ghl_last_match_count INTEGER DEFAULT 0,
  ghl_last_sync_mode TEXT DEFAULT 'incremental',
  ghl_last_cursor TEXT,
  ghl_last_bootstrap_at TIMESTAMPTZ,
  ghl_oldest_synced_at TIMESTAMPTZ,
  ghl_last_sync_error TEXT,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 1B. USERS + SESSIONS
-- ============================================================
CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT,
  role          TEXT DEFAULT 'viewer' CHECK (role IN ('admin', 'operator', 'viewer')),
  is_active     BOOLEAN DEFAULT TRUE,
  last_login    TIMESTAMPTZ,
  login_count   INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);

CREATE TABLE user_sessions (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token             TEXT UNIQUE NOT NULL,
  ip_address        TEXT,
  user_agent        TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,
  active_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_token ON user_sessions(token);
CREATE INDEX idx_sessions_active_account ON user_sessions(active_account_id);

-- ============================================================
-- 2. CAMPAIGNS
-- ============================================================
CREATE TABLE campaigns (
  id               SERIAL PRIMARY KEY,
  meta_campaign_id TEXT UNIQUE NOT NULL,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             TEXT,
  objective        TEXT,                       -- OUTCOME_LEADS, OUTCOME_SALES, etc.
  status           TEXT DEFAULT 'UNKNOWN',     -- ACTIVE, PAUSED, DELETED, ARCHIVED
  effective_status TEXT,                        -- Meta's computed status
  daily_budget     NUMERIC,                    -- in cents (Meta standard)
  lifetime_budget  NUMERIC,
  buying_type      TEXT DEFAULT 'AUCTION',
  special_ad_categories JSONB DEFAULT '[]',
  synced_at        TIMESTAMPTZ,                -- last time synced from Meta
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_campaigns_account ON campaigns(account_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);

-- ============================================================
-- 3. AD SETS
-- ============================================================
CREATE TABLE adsets (
  id               SERIAL PRIMARY KEY,
  meta_adset_id    TEXT UNIQUE NOT NULL,
  campaign_id      INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name             TEXT,
  status           TEXT DEFAULT 'UNKNOWN',
  effective_status TEXT,
  daily_budget     NUMERIC,
  lifetime_budget  NUMERIC,
  bid_strategy     TEXT,                       -- LOWEST_COST_WITHOUT_CAP, COST_CAP, etc.
  bid_amount       NUMERIC,
  optimization_goal TEXT,                      -- OFFSITE_CONVERSIONS, LINK_CLICKS, etc.
  billing_event    TEXT,                       -- IMPRESSIONS, LINK_CLICKS
  targeting        JSONB,                      -- full targeting spec from Meta
  targeting_summary TEXT,                      -- human-readable: "CA 25-54 LAL 2%"
  placements       TEXT,                       -- 'automatic' or summary string
  attribution_setting TEXT,                    -- '7d_click_1d_view' etc.
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,
  synced_at        TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_adsets_campaign ON adsets(campaign_id);
CREATE INDEX idx_adsets_account ON adsets(account_id);
CREATE INDEX idx_adsets_status ON adsets(status);

-- ============================================================
-- 4. ADS
-- ============================================================
CREATE TABLE ads (
  id             SERIAL PRIMARY KEY,
  meta_ad_id     TEXT UNIQUE NOT NULL,
  adset_id       INTEGER NOT NULL REFERENCES adsets(id) ON DELETE CASCADE,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name           TEXT,
  status         TEXT DEFAULT 'UNKNOWN',
  effective_status TEXT,
  creative_id    TEXT,                         -- Meta creative ID
  preview_url    TEXT,                         -- ad preview permalink
  creative_meta  JSONB,                        -- headline, body, CTA, image hash, video ID
  synced_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ads_adset ON ads(adset_id);
CREATE INDEX idx_ads_campaign ON ads(campaign_id);
CREATE INDEX idx_ads_account ON ads(account_id);
CREATE INDEX idx_ads_status ON ads(status);

-- ============================================================
-- 5. DAILY INSIGHTS (metrics warehouse)
-- One row per entity per day. This is the core table.
-- ============================================================
CREATE TABLE daily_insights (
  id               SERIAL PRIMARY KEY,
  date             DATE NOT NULL,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id      INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
  adset_id         INTEGER REFERENCES adsets(id) ON DELETE CASCADE,
  ad_id            INTEGER REFERENCES ads(id) ON DELETE CASCADE,
  level            TEXT NOT NULL CHECK (level IN ('account', 'campaign', 'adset', 'ad')),
  
  -- Core metrics
  spend            NUMERIC(12,2) DEFAULT 0,
  impressions      BIGINT DEFAULT 0,
  clicks           BIGINT DEFAULT 0,
  reach            BIGINT DEFAULT 0,
  
  -- Computed rates
  ctr              NUMERIC(8,4) DEFAULT 0,    -- click-through rate %
  cpm              NUMERIC(10,2) DEFAULT 0,   -- cost per 1000 impressions
  cpc              NUMERIC(10,4) DEFAULT 0,   -- cost per click
  frequency        NUMERIC(6,2) DEFAULT 0,    -- impressions / reach
  
  -- Conversions
  conversions      INTEGER DEFAULT 0,
  conversion_value NUMERIC(12,2) DEFAULT 0,
  cost_per_result  NUMERIC(10,2) DEFAULT 0,
  roas             NUMERIC(8,2) DEFAULT 0,
  
  -- Raw Meta actions (full detail for custom breakdowns)
  actions_json     JSONB,
  
  -- Metadata
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  
  -- One row per entity per day
  UNIQUE(date, level, account_id, campaign_id, adset_id, ad_id)
);

CREATE INDEX idx_insights_date ON daily_insights(date);
CREATE INDEX idx_insights_date_level ON daily_insights(date, level);
CREATE INDEX idx_insights_account ON daily_insights(account_id);
CREATE INDEX idx_insights_campaign ON daily_insights(campaign_id);
CREATE INDEX idx_insights_adset ON daily_insights(adset_id);
CREATE INDEX idx_insights_ad ON daily_insights(ad_id);

-- Partial index for fast "yesterday account-level" queries
CREATE INDEX idx_insights_account_level 
  ON daily_insights(date, account_id) 
  WHERE level = 'account';

-- ============================================================
-- 6. AI RECOMMENDATIONS
-- ============================================================
CREATE TABLE ai_recommendations (
  id               SERIAL PRIMARY KEY,
  date             DATE NOT NULL,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  campaign_id      INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  adset_id         INTEGER REFERENCES adsets(id) ON DELETE SET NULL,
  ad_id            INTEGER REFERENCES ads(id) ON DELETE SET NULL,
  level            TEXT NOT NULL CHECK (level IN ('account', 'campaign', 'adset', 'ad')),
  
  -- AI output
  issue_type       TEXT NOT NULL,              -- 'fatigue', 'cpa_spike', 'ctr_drop', 'budget_waste', 'zero_conversions', 'learning_unstable'
  root_cause       TEXT,
  recommendation   TEXT NOT NULL,
  urgency          TEXT NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),
  confidence       NUMERIC(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  expected_impact  TEXT,
  
  -- Lifecycle
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed', 'executed')),
  resolved_by      TEXT,                       -- who approved/dismissed
  resolved_at      TIMESTAMPTZ,
  
  -- Context snapshot (so you can see what the AI saw)
  context_snapshot JSONB,
  
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_reco_date ON ai_recommendations(date);
CREATE INDEX idx_reco_account ON ai_recommendations(account_id);
CREATE INDEX idx_reco_status ON ai_recommendations(status);
CREATE INDEX idx_reco_urgency ON ai_recommendations(urgency);

-- ============================================================
-- 6B. TOUCH SEQUENCES
-- ============================================================
CREATE TABLE touch_sequences (
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

CREATE INDEX idx_touch_sequences_account ON touch_sequences(account_id);

CREATE TABLE touch_sequence_steps (
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

CREATE INDEX idx_touch_sequence_steps_sequence ON touch_sequence_steps(sequence_id);
CREATE INDEX idx_touch_sequence_steps_status ON touch_sequence_steps(status);

CREATE TABLE touch_sequence_events (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sequence_id INTEGER NOT NULL REFERENCES touch_sequences(id) ON DELETE CASCADE,
  step_id INTEGER REFERENCES touch_sequence_steps(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_touch_sequence_events_sequence ON touch_sequence_events(sequence_id, created_at DESC);
CREATE INDEX idx_touch_sequence_events_account ON touch_sequence_events(account_id, created_at DESC);

-- ============================================================
-- 7. ACTION LOG (full audit trail)
-- ============================================================
CREATE TABLE action_log (
  id             SERIAL PRIMARY KEY,
  account_id     INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type    TEXT NOT NULL CHECK (entity_type IN ('campaign', 'adset', 'ad', 'account')),
  entity_id      TEXT NOT NULL,                -- Meta ID (not internal)
  entity_name    TEXT,                         -- for readability in the log
  action         TEXT NOT NULL,                -- 'pause', 'resume', 'duplicate', 'budget_change', 'create', 'status_change'
  details        JSONB,                        -- before/after values, budget old/new, etc.
  source         TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_approved', 'n8n', 'system')),
  performed_by   TEXT DEFAULT 'kevin',
  recommendation_id INTEGER REFERENCES ai_recommendations(id) ON DELETE SET NULL,
  
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_log_account ON action_log(account_id);
CREATE INDEX idx_log_entity ON action_log(entity_type, entity_id);
CREATE INDEX idx_log_action ON action_log(action);
CREATE INDEX idx_log_created ON action_log(created_at DESC);

-- ============================================================
-- HELPER VIEWS
-- ============================================================

-- Latest insights per campaign (yesterday or most recent date)
CREATE OR REPLACE VIEW v_campaign_latest AS
SELECT DISTINCT ON (campaign_id)
  di.*,
  c.name AS campaign_name,
  c.objective,
  c.status AS campaign_status,
  c.effective_status AS campaign_effective_status
FROM daily_insights di
JOIN campaigns c ON c.id = di.campaign_id
WHERE di.level = 'campaign'
ORDER BY campaign_id, date DESC;

-- Latest insights per ad set
CREATE OR REPLACE VIEW v_adset_latest AS
SELECT DISTINCT ON (adset_id)
  di.*,
  a.name AS adset_name,
  a.bid_strategy,
  a.targeting_summary,
  a.status AS adset_status
FROM daily_insights di
JOIN adsets a ON a.id = di.adset_id
WHERE di.level = 'adset'
ORDER BY adset_id, date DESC;

-- Latest insights per ad
CREATE OR REPLACE VIEW v_ad_latest AS
SELECT DISTINCT ON (ad_id)
  di.*,
  a.name AS ad_name,
  a.status AS ad_status,
  a.preview_url,
  a.creative_meta
FROM daily_insights di
JOIN ads a ON a.id = di.ad_id
WHERE di.level = 'ad'
ORDER BY ad_id, date DESC;

-- Rolling 7-day averages per campaign
CREATE OR REPLACE VIEW v_campaign_7d_avg AS
SELECT
  campaign_id,
  ROUND(AVG(spend), 2) AS avg_spend,
  ROUND(AVG(ctr), 4) AS avg_ctr,
  ROUND(AVG(cpm), 2) AS avg_cpm,
  ROUND(AVG(cpc), 4) AS avg_cpc,
  ROUND(AVG(cost_per_result), 2) AS avg_cpa,
  ROUND(AVG(roas), 2) AS avg_roas,
  ROUND(AVG(frequency), 2) AS avg_frequency,
  ROUND(AVG(conversions), 1) AS avg_conversions
FROM daily_insights
WHERE level = 'campaign'
  AND date >= CURRENT_DATE - INTERVAL '7 days'
GROUP BY campaign_id;

-- Pending AI recommendations
CREATE OR REPLACE VIEW v_pending_recommendations AS
SELECT
  r.*,
  c.name AS campaign_name,
  a.name AS adset_name,
  ad.name AS ad_name
FROM ai_recommendations r
LEFT JOIN campaigns c ON c.id = r.campaign_id
LEFT JOIN adsets a ON a.id = r.adset_id
LEFT JOIN ads ad ON ad.id = r.ad_id
WHERE r.status = 'pending'
ORDER BY
  CASE r.urgency
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'medium' THEN 3
    WHEN 'low' THEN 4
  END,
  r.date DESC;

-- ============================================================
-- DONE
-- ============================================================
SELECT 'Schema created successfully' AS status;
