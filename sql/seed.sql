-- ============================================================
-- Meta Ads Operator Dashboard — V1 Seed Data
-- Run AFTER schema.sql
-- psql -U your_user -d meta_dashboard -f seed.sql
-- ============================================================
-- Generates 30 days of realistic metrics for a gambling operator
-- account with multiple campaigns, ad sets, and ads.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. ACCOUNT
-- ============================================================
INSERT INTO accounts (meta_account_id, name, currency, timezone, access_token)
VALUES ('act_100200300', 'Casino Operator — Canada', 'CAD', 'America/Toronto', 'PLACEHOLDER_TOKEN')
RETURNING id;
-- account id = 1

-- ============================================================
-- 2. CAMPAIGNS
-- ============================================================
INSERT INTO campaigns (meta_campaign_id, account_id, name, objective, status, effective_status, daily_budget, buying_type, synced_at) VALUES
  ('120001', 1, 'CA — Casino — Slots — Prospecting',     'OUTCOME_LEADS',  'ACTIVE', 'ACTIVE',  15000, 'AUCTION', NOW()),
  ('120002', 1, 'CA — Casino — Table Games — Retargeting', 'OUTCOME_LEADS',  'ACTIVE', 'ACTIVE',  10000, 'AUCTION', NOW()),
  ('120003', 1, 'CA — Sportsbook — NHL — Prospecting',    'OUTCOME_LEADS',  'ACTIVE', 'ACTIVE',   8000, 'AUCTION', NOW()),
  ('120004', 1, 'CA — Casino — Brand Awareness',           'OUTCOME_AWARENESS', 'PAUSED', 'PAUSED', 5000, 'AUCTION', NOW()),
  ('120005', 1, 'CA — Sportsbook — NBA — Retargeting',    'OUTCOME_LEADS',  'ACTIVE', 'ACTIVE',   6000, 'AUCTION', NOW());
-- campaign ids = 1..5

-- ============================================================
-- 3. AD SETS
-- ============================================================
INSERT INTO adsets (meta_adset_id, campaign_id, account_id, name, status, effective_status, daily_budget, bid_strategy, optimization_goal, billing_event, targeting_summary, placements, attribution_setting, synced_at) VALUES
  -- Campaign 1: Casino Slots Prospecting
  ('230001', 1, 1, 'ON 25-54 — LAL 2% — Auto',      'ACTIVE', 'ACTIVE',  5000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'ON 25-54 LAL 2% Depositors', 'automatic', '7d_click_1d_view', NOW()),
  ('230002', 1, 1, 'QC 25-54 — LAL 2% — Auto',      'ACTIVE', 'ACTIVE',  5000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'QC 25-54 LAL 2% Depositors', 'automatic', '7d_click_1d_view', NOW()),
  ('230003', 1, 1, 'BC 25-54 — Interest Casino',     'ACTIVE', 'ACTIVE',  5000, 'COST_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'BC 25-54 Interest: Casino, Gambling', 'automatic', '7d_click_1d_view', NOW()),

  -- Campaign 2: Casino Table Games Retargeting
  ('230004', 2, 1, 'CA — Visited No Deposit — 7d',   'ACTIVE', 'ACTIVE',  5000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'Website Visitors 7d No Deposit', 'automatic', '7d_click_1d_view', NOW()),
  ('230005', 2, 1, 'CA — Deposited No Play 14d',     'ACTIVE', 'ACTIVE',  5000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'Depositors 14d No Table Play', 'automatic', '7d_click_1d_view', NOW()),

  -- Campaign 3: Sportsbook NHL Prospecting
  ('230006', 3, 1, 'ON 25-44 — NHL Interest',        'ACTIVE', 'ACTIVE',  4000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'ON 25-44 Interest: NHL, Hockey', 'automatic', '7d_click_1d_view', NOW()),
  ('230007', 3, 1, 'QC 25-44 — LAL 3% Bettors',     'ACTIVE', 'ACTIVE',  4000, 'COST_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'QC 25-44 LAL 3% Sports Bettors', 'automatic', '7d_click_1d_view', NOW()),

  -- Campaign 5: Sportsbook NBA Retargeting
  ('230008', 5, 1, 'CA — NBA Bettors — No Bet 7d',   'ACTIVE', 'ACTIVE',  3000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'NBA Bettors No Bet 7d', 'automatic', '7d_click_1d_view', NOW()),
  ('230009', 5, 1, 'CA — NBA Visitors — 3d',         'ACTIVE', 'ACTIVE',  3000, 'LOWEST_COST_WITHOUT_CAP', 'OFFSITE_CONVERSIONS', 'IMPRESSIONS', 'NBA Page Visitors 3d', 'automatic', '7d_click_1d_view', NOW());
-- adset ids = 1..9

-- ============================================================
-- 4. ADS (3 per ad set for the main ones, 2 for smaller ones)
-- ============================================================
INSERT INTO ads (meta_ad_id, adset_id, campaign_id, account_id, name, status, effective_status, creative_id, creative_meta, synced_at) VALUES
  -- Adset 1: ON Slots LAL
  ('340001', 1, 1, 1, 'Slots — Jackpot Visual — V1',    'ACTIVE', 'ACTIVE', 'cr_001', '{"headline":"Hit the Jackpot Tonight","body":"500+ slots. $500 welcome bonus.","cta":"SIGN_UP","format":"image"}', NOW()),
  ('340002', 1, 1, 1, 'Slots — Neon Reel — V2',         'ACTIVE', 'ACTIVE', 'cr_002', '{"headline":"Spin & Win Big","body":"New slots every week. Join free.","cta":"SIGN_UP","format":"image"}', NOW()),
  ('340003', 1, 1, 1, 'Slots — Video Testimonial — V1', 'ACTIVE', 'ACTIVE', 'cr_003', '{"headline":"See How Players Win","body":"Real winners. Real payouts.","cta":"LEARN_MORE","format":"video"}', NOW()),

  -- Adset 2: QC Slots LAL
  ('340004', 2, 1, 1, 'Slots — FR Jackpot — V1',        'ACTIVE', 'ACTIVE', 'cr_004', '{"headline":"Décrochez le Jackpot","body":"500+ machines. Bonus de 500$.","cta":"SIGN_UP","format":"image"}', NOW()),
  ('340005', 2, 1, 1, 'Slots — FR Neon — V2',           'ACTIVE', 'ACTIVE', 'cr_005', '{"headline":"Tournez et Gagnez","body":"Nouvelles machines chaque semaine.","cta":"SIGN_UP","format":"image"}', NOW()),

  -- Adset 3: BC Interest Casino
  ('340006', 3, 1, 1, 'Casino — Lifestyle — V1',        'ACTIVE', 'ACTIVE', 'cr_006', '{"headline":"Your Casino, Your Rules","body":"Play anytime from BC.","cta":"SIGN_UP","format":"image"}', NOW()),
  ('340007', 3, 1, 1, 'Casino — Welcome Bonus — V1',    'ACTIVE', 'ACTIVE', 'cr_007', '{"headline":"$500 Welcome Bonus","body":"Start playing today.","cta":"SIGN_UP","format":"image"}', NOW()),

  -- Adset 4: Retargeting Visited No Deposit
  ('340008', 4, 2, 1, 'Retarget — Reminder — V1',       'ACTIVE', 'ACTIVE', 'cr_008', '{"headline":"You Left Something Behind","body":"Your $500 bonus is waiting.","cta":"SIGN_UP","format":"image"}', NOW()),
  ('340009', 4, 2, 1, 'Retarget — Urgency — V2',        'ACTIVE', 'ACTIVE', 'cr_009', '{"headline":"Bonus Expires Soon","body":"Claim your $500 before midnight.","cta":"SIGN_UP","format":"image"}', NOW()),

  -- Adset 5: Deposited No Play
  ('340010', 5, 2, 1, 'Reactivate — Table Games — V1',  'ACTIVE', 'ACTIVE', 'cr_010', '{"headline":"Try Blackjack on Us","body":"Free $25 table credit.","cta":"LEARN_MORE","format":"image"}', NOW()),

  -- Adset 6: NHL ON
  ('340011', 6, 3, 1, 'NHL — Playoff Odds — V1',        'ACTIVE', 'ACTIVE', 'cr_011', '{"headline":"Bet on the Playoffs","body":"Best odds on NHL. Bet $10 get $50.","cta":"SIGN_UP","format":"image"}', NOW()),
  ('340012', 6, 3, 1, 'NHL — Live Betting — V2',        'ACTIVE', 'ACTIVE', 'cr_012', '{"headline":"Live NHL Betting","body":"Bet while you watch.","cta":"SIGN_UP","format":"video"}', NOW()),

  -- Adset 7: NHL QC
  ('340013', 7, 3, 1, 'NHL — FR Playoffs — V1',         'ACTIVE', 'ACTIVE', 'cr_013', '{"headline":"Pariez sur les Séries","body":"Meilleures cotes LNH.","cta":"SIGN_UP","format":"image"}', NOW()),

  -- Adset 8: NBA Retarget Bettors
  ('340014', 8, 5, 1, 'NBA — Come Back — V1',           'ACTIVE', 'ACTIVE', 'cr_014', '{"headline":"NBA Playoffs Are Here","body":"Your team needs you. Bet now.","cta":"SIGN_UP","format":"image"}', NOW()),

  -- Adset 9: NBA Visitors
  ('340015', 9, 5, 1, 'NBA — Free Bet — V1',            'ACTIVE', 'ACTIVE', 'cr_015', '{"headline":"$25 Free NBA Bet","body":"First bet on us.","cta":"SIGN_UP","format":"image"}', NOW());
-- ad ids = 1..15

-- ============================================================
-- 5. DAILY INSIGHTS — 30 days of data
-- ============================================================
-- We use generate_series + pseudo-random math to create
-- realistic metric curves with trends and variance.
-- ============================================================

-- Helper function for bounded random
CREATE OR REPLACE FUNCTION rand_between(low NUMERIC, high NUMERIC) 
RETURNS NUMERIC AS $$
  SELECT low + (random() * (high - low));
$$ LANGUAGE sql;

-- ----- ACCOUNT-LEVEL insights -----
INSERT INTO daily_insights (date, account_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date,
  1,
  'account',
  ROUND(rand_between(350, 550), 2),            -- total daily spend CAD
  ROUND(rand_between(80000, 150000))::bigint,
  ROUND(rand_between(2000, 5000))::bigint,
  ROUND(rand_between(60000, 120000))::bigint,
  ROUND(rand_between(2.2, 3.8), 2),
  ROUND(rand_between(3.5, 6.0), 2),
  ROUND(rand_between(0.08, 0.18), 4),
  ROUND(rand_between(1.1, 1.8), 2),
  ROUND(rand_between(15, 40))::int,
  ROUND(rand_between(800, 3500), 2),
  ROUND(rand_between(10, 28), 2),
  ROUND(rand_between(1.8, 6.5), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- ----- CAMPAIGN-LEVEL insights (for campaigns 1,2,3,5) -----
-- Campaign 1: Casino Slots (biggest spender, good performance)
INSERT INTO daily_insights (date, account_id, campaign_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 1, 'campaign',
  ROUND(rand_between(120, 180), 2),
  ROUND(rand_between(30000, 55000))::bigint,
  ROUND(rand_between(800, 1600))::bigint,
  ROUND(rand_between(25000, 45000))::bigint,
  ROUND(rand_between(2.5, 3.5), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.09, 0.16), 4),
  ROUND(rand_between(1.1, 1.6), 2),
  ROUND(rand_between(6, 18))::int,
  ROUND(rand_between(400, 1500), 2),
  ROUND(rand_between(9, 22), 2),
  ROUND(rand_between(2.5, 7.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Campaign 2: Casino Retargeting (lower spend, better CPA)
INSERT INTO daily_insights (date, account_id, campaign_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 2, 'campaign',
  ROUND(rand_between(70, 110), 2),
  ROUND(rand_between(15000, 30000))::bigint,
  ROUND(rand_between(500, 1100))::bigint,
  ROUND(rand_between(10000, 22000))::bigint,
  ROUND(rand_between(3.0, 4.5), 2),
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(0.07, 0.14), 4),
  ROUND(rand_between(1.2, 2.0), 2),
  ROUND(rand_between(4, 12))::int,
  ROUND(rand_between(300, 1000), 2),
  ROUND(rand_between(7, 18), 2),
  ROUND(rand_between(3.0, 8.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Campaign 3: NHL Sportsbook (seasonal, moderate)
INSERT INTO daily_insights (date, account_id, campaign_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 3, 'campaign',
  ROUND(rand_between(60, 95), 2),
  ROUND(rand_between(12000, 28000))::bigint,
  ROUND(rand_between(350, 800))::bigint,
  ROUND(rand_between(10000, 22000))::bigint,
  ROUND(rand_between(2.0, 3.2), 2),
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(0.10, 0.20), 4),
  ROUND(rand_between(1.1, 1.5), 2),
  ROUND(rand_between(3, 10))::int,
  ROUND(rand_between(200, 800), 2),
  ROUND(rand_between(8, 25), 2),
  ROUND(rand_between(2.0, 6.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Campaign 5: NBA Retargeting (smaller budget)
INSERT INTO daily_insights (date, account_id, campaign_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 5, 'campaign',
  ROUND(rand_between(40, 70), 2),
  ROUND(rand_between(8000, 18000))::bigint,
  ROUND(rand_between(250, 600))::bigint,
  ROUND(rand_between(6000, 14000))::bigint,
  ROUND(rand_between(2.5, 4.0), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.08, 0.18), 4),
  ROUND(rand_between(1.1, 1.7), 2),
  ROUND(rand_between(2, 8))::int,
  ROUND(rand_between(100, 600), 2),
  ROUND(rand_between(8, 22), 2),
  ROUND(rand_between(2.0, 6.5), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- ----- AD SET LEVEL insights (top 4 ad sets, 30 days each) -----
-- Adset 1: ON Slots LAL (strong performer)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 1, 1, 'adset',
  ROUND(rand_between(40, 65), 2),
  ROUND(rand_between(10000, 20000))::bigint,
  ROUND(rand_between(300, 600))::bigint,
  ROUND(rand_between(8000, 16000))::bigint,
  ROUND(rand_between(2.5, 3.5), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.08, 0.15), 4),
  ROUND(rand_between(1.1, 1.5), 2),
  ROUND(rand_between(2, 7))::int,
  ROUND(rand_between(150, 600), 2),
  ROUND(rand_between(8, 20), 2),
  ROUND(rand_between(2.5, 7.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Adset 4: Retargeting Visited No Deposit (high CTR, good CPA)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 2, 4, 'adset',
  ROUND(rand_between(35, 60), 2),
  ROUND(rand_between(8000, 16000))::bigint,
  ROUND(rand_between(300, 700))::bigint,
  ROUND(rand_between(5000, 12000))::bigint,
  ROUND(rand_between(3.2, 5.0), 2),
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(0.06, 0.12), 4),
  ROUND(rand_between(1.3, 2.2), 2),
  ROUND(rand_between(2, 7))::int,
  ROUND(rand_between(200, 700), 2),
  ROUND(rand_between(6, 16), 2),
  ROUND(rand_between(3.5, 9.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Adset 6: NHL ON (moderate, shows fatigue trend in recent days)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 3, 6, 'adset',
  ROUND(rand_between(30, 50), 2),
  ROUND(rand_between(6000, 14000))::bigint,
  ROUND(rand_between(150, 400))::bigint,
  ROUND(rand_between(5000, 11000))::bigint,
  -- CTR declining over time to simulate fatigue
  ROUND(GREATEST(1.5, 3.0 - (EXTRACT(EPOCH FROM (d::date - (CURRENT_DATE - INTERVAL '30 days'))) / 86400) * 0.04 + rand_between(-0.3, 0.3)), 2),
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(0.10, 0.22), 4),
  -- Frequency rising over time
  ROUND(LEAST(3.5, 1.2 + (EXTRACT(EPOCH FROM (d::date - (CURRENT_DATE - INTERVAL '30 days'))) / 86400) * 0.06 + rand_between(-0.2, 0.2)), 2),
  ROUND(rand_between(1, 5))::int,
  ROUND(rand_between(80, 400), 2),
  ROUND(rand_between(8, 30), 2),
  ROUND(rand_between(1.5, 5.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Adset 8: NBA Retarget (small but efficient)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 5, 8, 'adset',
  ROUND(rand_between(18, 38), 2),
  ROUND(rand_between(4000, 9000))::bigint,
  ROUND(rand_between(120, 320))::bigint,
  ROUND(rand_between(3000, 7000))::bigint,
  ROUND(rand_between(2.5, 4.2), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.07, 0.16), 4),
  ROUND(rand_between(1.1, 1.8), 2),
  ROUND(rand_between(1, 4))::int,
  ROUND(rand_between(50, 300), 2),
  ROUND(rand_between(7, 22), 2),
  ROUND(rand_between(2.0, 7.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- ----- AD LEVEL insights (top 6 ads, 30 days) -----
-- Ad 1: Slots Jackpot V1 (winner)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 1, 1, 1, 'ad',
  ROUND(rand_between(15, 28), 2),
  ROUND(rand_between(4000, 8000))::bigint,
  ROUND(rand_between(120, 260))::bigint,
  ROUND(rand_between(3000, 6500))::bigint,
  ROUND(rand_between(2.8, 3.8), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.07, 0.14), 4),
  ROUND(rand_between(1.1, 1.5), 2),
  ROUND(rand_between(1, 4))::int,
  ROUND(rand_between(60, 300), 2),
  ROUND(rand_between(6, 18), 2),
  ROUND(rand_between(3.0, 8.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Ad 2: Slots Neon V2 (decent)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 1, 1, 2, 'ad',
  ROUND(rand_between(12, 22), 2),
  ROUND(rand_between(3000, 7000))::bigint,
  ROUND(rand_between(80, 200))::bigint,
  ROUND(rand_between(2500, 5500))::bigint,
  ROUND(rand_between(2.2, 3.2), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.09, 0.17), 4),
  ROUND(rand_between(1.1, 1.5), 2),
  ROUND(rand_between(0, 3))::int,
  ROUND(rand_between(30, 220), 2),
  ROUND(rand_between(8, 24), 2),
  ROUND(rand_between(2.0, 6.5), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Ad 8: Retarget Reminder V1 (strong retargeting performer)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 2, 4, 8, 'ad',
  ROUND(rand_between(18, 35), 2),
  ROUND(rand_between(4000, 9000))::bigint,
  ROUND(rand_between(160, 400))::bigint,
  ROUND(rand_between(3000, 7000))::bigint,
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(0.05, 0.11), 4),
  ROUND(rand_between(1.3, 2.2), 2),
  ROUND(rand_between(1, 5))::int,
  ROUND(rand_between(100, 450), 2),
  ROUND(rand_between(5, 14), 2),
  ROUND(rand_between(4.0, 10.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Ad 11: NHL Playoff Odds V1 (fatiguing — mirrors adset 6 trend)
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 3, 6, 11, 'ad',
  ROUND(rand_between(15, 30), 2),
  ROUND(rand_between(3000, 7000))::bigint,
  ROUND(rand_between(80, 220))::bigint,
  ROUND(rand_between(2500, 5500))::bigint,
  ROUND(GREATEST(1.3, 2.8 - (EXTRACT(EPOCH FROM (d::date - (CURRENT_DATE - INTERVAL '30 days'))) / 86400) * 0.04 + rand_between(-0.3, 0.3)), 2),
  ROUND(rand_between(3.5, 5.5), 2),
  ROUND(rand_between(0.10, 0.24), 4),
  ROUND(LEAST(3.5, 1.2 + (EXTRACT(EPOCH FROM (d::date - (CURRENT_DATE - INTERVAL '30 days'))) / 86400) * 0.06 + rand_between(-0.2, 0.2)), 2),
  ROUND(rand_between(0, 3))::int,
  ROUND(rand_between(30, 250), 2),
  ROUND(rand_between(10, 35), 2),
  ROUND(rand_between(1.2, 4.5), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Ad 14: NBA Come Back V1
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 5, 8, 14, 'ad',
  ROUND(rand_between(10, 22), 2),
  ROUND(rand_between(2000, 5000))::bigint,
  ROUND(rand_between(60, 180))::bigint,
  ROUND(rand_between(1500, 4000))::bigint,
  ROUND(rand_between(2.5, 4.2), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.07, 0.16), 4),
  ROUND(rand_between(1.1, 1.8), 2),
  ROUND(rand_between(0, 3))::int,
  ROUND(rand_between(30, 200), 2),
  ROUND(rand_between(7, 25), 2),
  ROUND(rand_between(2.0, 7.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- Ad 15: NBA Free Bet V1
INSERT INTO daily_insights (date, account_id, campaign_id, adset_id, ad_id, level, spend, impressions, clicks, reach, ctr, cpm, cpc, frequency, conversions, conversion_value, cost_per_result, roas)
SELECT
  d::date, 1, 5, 9, 15, 'ad',
  ROUND(rand_between(8, 18), 2),
  ROUND(rand_between(1500, 4000))::bigint,
  ROUND(rand_between(50, 150))::bigint,
  ROUND(rand_between(1200, 3200))::bigint,
  ROUND(rand_between(2.8, 4.5), 2),
  ROUND(rand_between(3.0, 5.0), 2),
  ROUND(rand_between(0.08, 0.18), 4),
  ROUND(rand_between(1.1, 1.6), 2),
  ROUND(rand_between(0, 2))::int,
  ROUND(rand_between(20, 150), 2),
  ROUND(rand_between(8, 28), 2),
  ROUND(rand_between(1.8, 6.0), 2)
FROM generate_series(CURRENT_DATE - INTERVAL '30 days', CURRENT_DATE - INTERVAL '1 day', '1 day') d;

-- ============================================================
-- 6. SAMPLE AI RECOMMENDATIONS (yesterday)
-- ============================================================
INSERT INTO ai_recommendations (date, account_id, campaign_id, adset_id, ad_id, level, issue_type, root_cause, recommendation, urgency, confidence, expected_impact, status) VALUES
(
  CURRENT_DATE - 1, 1, 3, 6, NULL, 'adset',
  'fatigue',
  'Frequency reached 2.8 with CTR declining 35% over 14 days. Audience ON 25-44 NHL Interest is saturated.',
  'Duplicate this ad set into a fresh LAL 3% audience. Pause the current ad set if frequency exceeds 3.0 tomorrow.',
  'high', 0.85,
  'Expected CTR recovery of 20-30% within 5 days on fresh audience.',
  'pending'
),
(
  CURRENT_DATE - 1, 1, 3, 6, 11, 'ad',
  'ctr_drop',
  'Ad "NHL Playoff Odds V1" CTR dropped from 2.8% to 1.6% over 2 weeks while frequency rose. Creative exhaustion likely.',
  'Test 2 new NHL creatives (live-action highlight reel + player stat card format). Keep this ad running at reduced spend until replacements exit learning.',
  'high', 0.78,
  'New creatives typically recover 40-60% of original CTR in this vertical.',
  'pending'
),
(
  CURRENT_DATE - 1, 1, 2, 4, 8, 'ad',
  'winner_detected',
  'Ad "Retarget Reminder V1" has 42% lower CPA than campaign average over trailing 7 days with stable frequency.',
  'Increase budget on parent ad set by 20%. Consider duplicating this creative into prospecting campaigns with adjusted copy.',
  'medium', 0.90,
  'Scaling by 20% typically holds CPA within 10% variance for retargeting.',
  'pending'
),
(
  CURRENT_DATE - 1, 1, 1, 3, NULL, 'adset',
  'cpa_spike',
  'BC Interest Casino ad set CPA up 45% vs 7-day average. Cost cap may be limiting delivery to lower-quality placements.',
  'Switch bid strategy to lowest cost for 48 hours to re-enter learning. If CPA does not recover, pause and reallocate budget to ON LAL ad set.',
  'critical', 0.72,
  'Bid strategy reset typically resolves delivery issues within 2-3 days.',
  'pending'
);

-- ============================================================
-- 7. SAMPLE ACTION LOG
-- ============================================================
INSERT INTO action_log (account_id, entity_type, entity_id, entity_name, action, details, source, performed_by) VALUES
(1, 'campaign', '120004', 'CA — Casino — Brand Awareness', 'pause', '{"reason": "Reallocating budget to performance campaigns", "previous_status": "ACTIVE"}', 'manual', 'kevin'),
(1, 'adset', '230003', 'BC 25-54 — Interest Casino', 'budget_change', '{"old_budget": 3000, "new_budget": 5000, "reason": "Testing increased spend on interest targeting"}', 'manual', 'kevin'),
(1, 'ad', '340003', 'Slots — Video Testimonial — V1', 'status_change', '{"old_status": "PAUSED", "new_status": "ACTIVE", "reason": "Re-testing after creative edit"}', 'manual', 'kevin');

-- ============================================================
-- CLEANUP helper function
-- ============================================================
DROP FUNCTION IF EXISTS rand_between(NUMERIC, NUMERIC);

COMMIT;

-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT 'accounts' AS table_name, COUNT(*) AS rows FROM accounts
UNION ALL SELECT 'campaigns', COUNT(*) FROM campaigns
UNION ALL SELECT 'adsets', COUNT(*) FROM adsets
UNION ALL SELECT 'ads', COUNT(*) FROM ads
UNION ALL SELECT 'daily_insights', COUNT(*) FROM daily_insights
UNION ALL SELECT 'ai_recommendations', COUNT(*) FROM ai_recommendations
UNION ALL SELECT 'action_log', COUNT(*) FROM action_log
ORDER BY table_name;
