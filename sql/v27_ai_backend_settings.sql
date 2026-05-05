CREATE TABLE IF NOT EXISTS ai_backend_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openai_api_key_encrypted TEXT,
  openai_project_id TEXT,
  openai_model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON ai_backend_settings TO meta_dash;
