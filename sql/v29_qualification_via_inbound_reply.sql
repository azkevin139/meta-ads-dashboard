-- ============================================================
-- V29 Migration: qualification via inbound reply (engagement-based)
--
-- Phase 1A of the qualification rebuild. A lead is qualified when:
--   - lead_source IN (meta_lead_form, website_form)
--   - the contact sends an inbound reply through GHL Conversations
--   - on an allowed text-conversational channel
--   - after first_outbound_at (strict rule)
--
-- This migration introduces:
--   * ghl_conversation_events: durable event log of inbound + outbound
--     messages from the GHL Conversations webhook + reconciliation API.
--   * visitors denorm columns: first_outbound_at, first_inbound_reply_at,
--     qualified_at, qualified_reason, qualified_channel — so reports do
--     not recompute qualification on every request.
--
-- Run: sudo -u postgres psql -d meta_dashboard -f v29_qualification_via_inbound_reply.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS ghl_conversation_events (
  id BIGSERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ghl_contact_id TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel TEXT,
  body_preview TEXT,
  ghl_event_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT ghl_conversation_events_message_id_key UNIQUE (message_id)
);

CREATE INDEX IF NOT EXISTS idx_ghl_conversation_events_contact
  ON ghl_conversation_events(account_id, ghl_contact_id, ghl_event_at DESC);

CREATE INDEX IF NOT EXISTS idx_ghl_conversation_events_direction_event
  ON ghl_conversation_events(account_id, direction, ghl_event_at DESC);

ALTER TABLE visitors
  ADD COLUMN IF NOT EXISTS first_outbound_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_inbound_reply_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qualified_reason TEXT,
  ADD COLUMN IF NOT EXISTS qualified_channel TEXT;

CREATE INDEX IF NOT EXISTS idx_visitors_qualified_at
  ON visitors(account_id, qualified_at DESC) WHERE qualified_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_visitors_first_inbound_reply_at
  ON visitors(account_id, first_inbound_reply_at DESC) WHERE first_inbound_reply_at IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON ghl_conversation_events TO meta_dash;
GRANT USAGE, SELECT ON SEQUENCE ghl_conversation_events_id_seq TO meta_dash;

SELECT 'V29 qualification via inbound reply migration complete' AS status;
