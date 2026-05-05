#!/usr/bin/env node
require('dotenv').config();

const crypto = require('crypto');
const { pool } = require('../server/db');

const E2E = {
  adminEmail: 'e2e-admin@linxio.test',
  adminPassword: 'E2E-password-123!',
  accountA: 9001,
  accountB: 9002,
  campaignA: 9101,
  campaignB: 9201,
  adsetA: 9301,
  adA: 9401,
  validToken: 'E2EvalidReportToken_12345678901234567890123',
  revokedToken: 'E2ErevokedReportToken_123456789012345678901',
  expiredToken: 'E2EexpiredReportToken_123456789012345678901',
};

function assertSafeDatabase() {
  const raw = process.env.DATABASE_URL || '';
  if (!raw) throw new Error('DATABASE_URL is required for E2E seeding');
  const parsed = new URL(raw);
  const dbName = parsed.pathname.replace(/^\//, '');
  const host = parsed.hostname;
  const safeByName = /(?:test|e2e)/i.test(dbName);
  const safeByHost = ['localhost', '127.0.0.1', '::1'].includes(host);
  if (process.env.E2E_SEED_ALLOW === 'true' || process.env.CI === 'true' || (process.env.NODE_ENV === 'test' && (safeByName || safeByHost))) {
    return;
  }
  throw new Error(
    `Refusing to seed non-test database "${dbName}" on "${host}". `
    + 'Use a test database or set E2E_SEED_ALLOW=true intentionally.'
  );
}

function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function dubaiToday() {
  const now = new Date();
  return new Date(now.getTime() + 4 * 3600000).toISOString().slice(0, 10);
}

function addDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function query(sql, params = []) {
  return pool.query(sql, params);
}

async function cleanup() {
  await query('DELETE FROM user_sessions WHERE user_id = $1', [E2E.accountA]);
  await query('DELETE FROM user_account_access WHERE user_id = $1 OR account_id IN ($2, $3)', [E2E.accountA, E2E.accountA, E2E.accountB]);
  await query('DELETE FROM report_link_views WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM report_links WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM daily_insights WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM visitor_events WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM visitors WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM ads WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM adsets WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM campaigns WHERE account_id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM accounts WHERE id IN ($1, $2)', [E2E.accountA, E2E.accountB]);
  await query('DELETE FROM users WHERE email = $1', [E2E.adminEmail]);
}

async function seedAccounts() {
  await query(`
    INSERT INTO accounts (id, meta_account_id, name, label, currency, timezone, access_token, token_last4, product_mode, fast_sync_enabled, is_active)
    VALUES
      ($1, 'act_e2e_9001', 'E2E Primary Account', 'E2E Primary Account', 'USD', 'Asia/Dubai', 'test-token-a', 'kenA', 'lead_gen', true, true),
      ($2, 'act_e2e_9002', 'E2E Secondary Account', 'E2E Secondary Account', 'USD', 'Asia/Dubai', 'test-token-b', 'kenB', 'lead_gen', true, true)
  `, [E2E.accountA, E2E.accountB]);

  await query(`
    INSERT INTO users (id, email, password_hash, name, role, is_active)
    VALUES ($1, $2, $3, 'E2E Admin', 'admin', true)
  `, [E2E.accountA, E2E.adminEmail, hashPassword(E2E.adminPassword)]);

  await query(`
    INSERT INTO user_account_access (user_id, account_id, role)
    VALUES ($1, $2, 'admin'), ($1, $3, 'admin')
    ON CONFLICT (user_id, account_id) DO UPDATE SET role = EXCLUDED.role
  `, [E2E.accountA, E2E.accountA, E2E.accountB]);
}

async function seedCampaignData() {
  const today = dubaiToday();
  const yesterday = addDays(today, -1);
  const previous = addDays(today, -8);

  await query(`
    INSERT INTO campaigns (id, meta_campaign_id, account_id, name, objective, status, effective_status, daily_budget, buying_type, synced_at)
    VALUES
      ($1, 'cmp_e2e_a', $2, 'E2E Lead Campaign', 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 5000, 'AUCTION', NOW()),
      ($3, 'cmp_e2e_b', $4, 'E2E Other Account Campaign', 'OUTCOME_LEADS', 'ACTIVE', 'ACTIVE', 3000, 'AUCTION', NOW())
  `, [E2E.campaignA, E2E.accountA, E2E.campaignB, E2E.accountB]);

  await query(`
    INSERT INTO adsets (id, meta_adset_id, campaign_id, account_id, name, status, effective_status, daily_budget, optimization_goal, targeting, synced_at)
    VALUES ($1, 'as_e2e_a', $2, $3, 'E2E Lead Ad Set', 'ACTIVE', 'ACTIVE', 5000, 'LEAD_GENERATION', '{}'::jsonb, NOW())
  `, [E2E.adsetA, E2E.campaignA, E2E.accountA]);

  await query(`
    INSERT INTO ads (id, meta_ad_id, adset_id, campaign_id, account_id, name, status, effective_status, creative_id, creative_meta, synced_at)
    VALUES ($1, 'ad_e2e_a', $2, $3, $4, 'E2E Feed Visual', 'ACTIVE', 'ACTIVE', 'creative_e2e_a', '{"image_url":"https://example.com/e2e-feed.jpg"}'::jsonb, NOW())
  `, [E2E.adA, E2E.adsetA, E2E.campaignA, E2E.accountA]);

  await query(`
    INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, actions_json, ctr, cpc)
    VALUES
      ($1::date, $2, NULL, NULL, NULL, 'account', 120.00, 10000, 400, 8500, '{"actions":[{"action_type":"link_click","value":"400"}]}'::jsonb, 4.0, 0.30),
      ($3::date, $2, NULL, NULL, NULL, 'account', 80.00, 7000, 250, 6000, '{"actions":[{"action_type":"link_click","value":"250"}]}'::jsonb, 3.5, 0.32),
      ($1::date, $2, $4, NULL, NULL, 'campaign', 120.00, 10000, 400, 8500, '{"actions":[{"action_type":"lead","value":"7"},{"action_type":"link_click","value":"400"}]}'::jsonb, 4.0, 0.30),
      ($1::date, $2, $4, $5, $6, 'ad', 120.00, 10000, 400, 8500, '{"actions":[{"action_type":"lead","value":"7"},{"action_type":"link_click","value":"400"}]}'::jsonb, 4.0, 0.30)
  `, [yesterday, E2E.accountA, previous, E2E.campaignA, E2E.adsetA, E2E.adA]);

  await query(`
    INSERT INTO visitors (
      client_id, account_id, meta_account_id, utm_source, source, source_event_type,
      campaign_id, adset_id, ad_id, email_hash, phone_hash, ghl_contact_id, meta_lead_id,
      normalized_stage, first_seen_at, last_seen_at, resolved_at,
      first_inbound_reply_at, qualified_at, qualified_reason, qualified_channel, raw
    )
    VALUES
      ('e2e-meta-lead-1', $1, 'act_e2e_9001', 'facebook', 'meta', 'fb-lead-form', 'cmp_e2e_a', 'as_e2e_a', 'ad_e2e_a', 'email_hash_1', 'phone_hash_1', 'ghl_e2e_1', 'meta_e2e_1', 'qualified', $2::date, $2::date, $2::date, $2::date, $2::date, 'inbound_reply', 'whatsapp', '{}'::jsonb),
      ('e2e-website-lead-1', $1, 'act_e2e_9001', 'landing-page', 'website', 'website-form', 'cmp_e2e_a', 'as_e2e_a', 'ad_e2e_a', 'email_hash_2', 'phone_hash_2', 'ghl_e2e_2', NULL, 'booked', $2::date, $2::date, $2::date, $2::date, $2::date, 'inbound_reply', 'email', '{}'::jsonb),
      ('e2e-website-lead-2', $1, 'act_e2e_9001', 'landing-page', 'website', 'website-form', 'cmp_e2e_a', 'as_e2e_a', 'ad_e2e_a', 'email_hash_3', 'phone_hash_3', 'ghl_e2e_3', NULL, 'new', $2::date, $2::date, $2::date, NULL, NULL, NULL, NULL, '{}'::jsonb)
  `, [E2E.accountA, yesterday]);

  await query(`
    INSERT INTO visitor_events (client_id, account_id, event_name, page_url, campaign_id, adset_id, ad_id, fired_at)
    VALUES
      ('e2e-website-lead-1', $1, 'Lead', 'https://example.com/e2e', 'cmp_e2e_a', 'as_e2e_a', 'ad_e2e_a', $2::date),
      ('e2e-website-lead-2', $1, 'Lead', 'https://example.com/e2e', 'cmp_e2e_a', 'as_e2e_a', 'ad_e2e_a', $2::date),
      ('e2e-website-lead-1', $1, 'PageView', 'https://example.com/e2e', 'cmp_e2e_a', 'as_e2e_a', 'ad_e2e_a', $2::date)
  `, [E2E.accountA, yesterday]);
}

async function seedReportLinks() {
  await query(`
    INSERT INTO report_links (account_id, name, token_hash, preset_restrictions, expires_at, revoked_at, created_by_user_id)
    VALUES
      ($1, 'E2E valid report', $2, '["7d","14d","30d","60d"]'::jsonb, NOW() + INTERVAL '7 days', NULL, $1),
      ($1, 'E2E revoked report', $3, '[]'::jsonb, NOW() + INTERVAL '7 days', NOW(), $1),
      ($1, 'E2E expired report', $4, '[]'::jsonb, NOW() - INTERVAL '1 day', NULL, $1)
  `, [
    E2E.accountA,
    hashToken(E2E.validToken),
    hashToken(E2E.revokedToken),
    hashToken(E2E.expiredToken),
  ]);
}

async function main() {
  assertSafeDatabase();
  await cleanup();
  await seedAccounts();
  await seedCampaignData();
  await seedReportLinks();
  console.log(JSON.stringify({
    ok: true,
    adminEmail: E2E.adminEmail,
    accountIds: [E2E.accountA, E2E.accountB],
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
