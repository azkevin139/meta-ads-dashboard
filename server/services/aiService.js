const fetch = require('node-fetch');
const config = require('../config');
const { queryAll, queryOne, query } = require('../db');
const intelligence = require('./intelligenceService');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM_PROMPT = `You are a senior paid media analyst reviewing Meta Ads performance data.
You receive structured daily metrics and produce actionable recommendations.

Rules:
- Be specific. Reference campaign/adset/ad names and numbers.
- Every recommendation must have a clear action (pause, scale, duplicate, test).
- Rate urgency as: critical, high, medium, low.
- Rate confidence from 0.0 to 1.0.
- Never recommend spending more without evidence of positive ROAS or CPA trend.
- If data is insufficient (< 3 days of history), say so.
- Output ONLY valid JSON. No markdown, no commentary, no code fences.

Output schema:
{
  "analysis_date": "YYYY-MM-DD",
  "account": "string",
  "recommendations": [
    {
      "entity_type": "campaign|adset|ad",
      "entity_name": "string",
      "entity_id": "string",
      "issue_type": "fatigue|cpa_spike|ctr_drop|budget_waste|zero_conversions|winner_detected|learning_unstable",
      "root_cause": "string",
      "recommendation": "string",
      "urgency": "critical|high|medium|low",
      "confidence": 0.0-1.0,
      "expected_impact": "string"
    }
  ],
  "summary": "string"
}`;

// ─── BUILD CONTEXT FOR AI ─────────────────────────────────

async function buildAnalysisContext(accountId) {
  // Get account info
  const account = await queryOne('SELECT * FROM accounts WHERE id = $1', [accountId]);
  if (!account) throw new Error('Account not found');

  // Yesterday's campaign data
  const yesterday = await queryAll(`
    SELECT
      di.campaign_id, c.meta_campaign_id, c.name, c.status,
      di.spend, di.impressions, di.clicks, di.ctr, di.cpm, di.cpc,
      di.frequency, di.conversions, di.cost_per_result, di.roas
    FROM daily_insights di
    JOIN campaigns c ON c.id = di.campaign_id
    WHERE di.account_id = $1 AND di.level = 'campaign'
      AND di.date = CURRENT_DATE - 1
    ORDER BY di.spend DESC
  `, [accountId]);

  // 7-day averages
  const avg7d = await queryAll(`
    SELECT
      campaign_id,
      ROUND(AVG(spend), 2) AS avg_spend,
      ROUND(AVG(ctr), 2) AS avg_ctr,
      ROUND(AVG(cpc), 4) AS avg_cpc,
      ROUND(AVG(cost_per_result), 2) AS avg_cpa,
      ROUND(AVG(roas), 2) AS avg_roas,
      ROUND(AVG(frequency), 2) AS avg_frequency,
      ROUND(AVG(conversions), 1) AS avg_conversions
    FROM daily_insights
    WHERE account_id = $1 AND level = 'campaign'
      AND date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY campaign_id
  `, [accountId]);

  // 30-day averages
  const avg30d = await queryAll(`
    SELECT
      campaign_id,
      ROUND(AVG(ctr), 2) AS avg_ctr,
      ROUND(AVG(cost_per_result), 2) AS avg_cpa,
      ROUND(AVG(roas), 2) AS avg_roas
    FROM daily_insights
    WHERE account_id = $1 AND level = 'campaign'
      AND date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY campaign_id
  `, [accountId]);

  // 3-day trend direction
  const trend3d = await queryAll(`
    SELECT
      campaign_id,
      CASE WHEN (array_agg(ctr ORDER BY date DESC))[1] < (array_agg(ctr ORDER BY date DESC))[3]
        THEN 'declining' ELSE 'stable_or_rising' END AS ctr_trend,
      CASE WHEN (array_agg(cost_per_result ORDER BY date DESC))[1] > (array_agg(cost_per_result ORDER BY date DESC))[3]
        THEN 'rising' ELSE 'stable_or_declining' END AS cpa_trend,
      CASE WHEN (array_agg(frequency ORDER BY date DESC))[1] > (array_agg(frequency ORDER BY date DESC))[3]
        THEN 'rising' ELSE 'stable_or_declining' END AS frequency_trend
    FROM daily_insights
    WHERE account_id = $1 AND level = 'campaign'
      AND date >= CURRENT_DATE - INTERVAL '3 days'
    GROUP BY campaign_id
    HAVING COUNT(*) >= 3
  `, [accountId]);

  // Build lookup maps
  const avg7dMap = {};
  for (const r of avg7d) avg7dMap[r.campaign_id] = r;
  const avg30dMap = {};
  for (const r of avg30d) avg30dMap[r.campaign_id] = r;
  const trend3dMap = {};
  for (const r of trend3d) trend3dMap[r.campaign_id] = r;

  // Assemble entities
  const entities = yesterday.map((y) => ({
    type: 'campaign',
    name: y.name,
    id: y.meta_campaign_id,
    status: y.status,
    yesterday: {
      spend: parseFloat(y.spend),
      impressions: parseInt(y.impressions),
      clicks: parseInt(y.clicks),
      ctr: parseFloat(y.ctr),
      cpm: parseFloat(y.cpm),
      cpc: parseFloat(y.cpc),
      conversions: parseInt(y.conversions),
      cpa: parseFloat(y.cost_per_result),
      roas: parseFloat(y.roas),
      frequency: parseFloat(y.frequency),
    },
    avg_7d: avg7dMap[y.campaign_id] ? {
      spend: parseFloat(avg7dMap[y.campaign_id].avg_spend),
      ctr: parseFloat(avg7dMap[y.campaign_id].avg_ctr),
      cpa: parseFloat(avg7dMap[y.campaign_id].avg_cpa),
      roas: parseFloat(avg7dMap[y.campaign_id].avg_roas),
      frequency: parseFloat(avg7dMap[y.campaign_id].avg_frequency),
    } : null,
    avg_30d: avg30dMap[y.campaign_id] ? {
      ctr: parseFloat(avg30dMap[y.campaign_id].avg_ctr),
      cpa: parseFloat(avg30dMap[y.campaign_id].avg_cpa),
      roas: parseFloat(avg30dMap[y.campaign_id].avg_roas),
    } : null,
    trend_3d: trend3dMap[y.campaign_id] ? {
      ctr: trend3dMap[y.campaign_id].ctr_trend,
      cpa: trend3dMap[y.campaign_id].cpa_trend,
      frequency: trend3dMap[y.campaign_id].frequency_trend,
    } : null,
  }));

  let liveDecisionContext = null;
  try {
    const rules = await intelligence.getDecisionRules({ preset: 'yesterday' });
    liveDecisionContext = {
      targets: intelligence.readTargets(),
      queues: Object.fromEntries(Object.entries(rules.queues || {}).map(([key, value]) => [key, value.length])),
      top_recommendations: (rules.data || []).slice(0, 20).map(item => ({
        name: item.name,
        spend: item.spend,
        results: item.results,
        cpa: item.cpa,
        confidence: item.confidence,
        recommendation: item.recommendations && item.recommendations[0],
      })),
    };
  } catch (err) {
    liveDecisionContext = { error: err.message };
  }

  return {
    account: account.name,
    currency: account.currency,
    date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
    entities,
    live_decision_context: liveDecisionContext,
  };
}

// ─── CALL GPT-4o ──────────────────────────────────────────

async function callOpenAI(context) {
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: config.openai.model,
      temperature: 0.3,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(context) },
      ],
    }),
  });

  const data = await res.json();

  if (data.error) {
    throw new Error(`OpenAI error: ${data.error.message}`);
  }

  const content = data.choices[0].message.content;

  // Parse JSON (strip code fences if present)
  const clean = content.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  return JSON.parse(clean);
}

// ─── RUN ANALYSIS + SAVE ─────────────────────────────────

async function runAnalysis(accountId) {
  const context = await buildAnalysisContext(accountId);

  if (context.entities.length === 0) {
    return { recommendations: [], summary: 'No campaign data for yesterday.' };
  }

  const result = await callOpenAI(context);

  // Save recommendations to DB
  for (const rec of (result.recommendations || [])) {
    // Resolve internal IDs from meta IDs
    let campaignId = null;
    let adsetId = null;
    let adId = null;

    if (rec.entity_type === 'campaign' && rec.entity_id) {
      const c = await queryOne('SELECT id FROM campaigns WHERE meta_campaign_id = $1', [rec.entity_id]);
      if (c) campaignId = c.id;
    }

    await query(`
      INSERT INTO ai_recommendations (date, account_id, campaign_id, adset_id, ad_id, level, issue_type, root_cause, recommendation, urgency, confidence, expected_impact, context_snapshot)
      VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      accountId,
      campaignId,
      adsetId,
      adId,
      rec.entity_type,
      rec.issue_type,
      rec.root_cause,
      rec.recommendation,
      rec.urgency,
      rec.confidence,
      rec.expected_impact,
      JSON.stringify(context),
    ]);
  }

  return result;
}

// ─── GET RECOMMENDATIONS ──────────────────────────────────

async function getRecommendations(accountId, status = 'pending') {
  return queryAll(`
    SELECT * FROM v_pending_recommendations
    WHERE account_id = $1
    ${status !== 'all' ? "AND status = '" + status + "'" : ''}
    ORDER BY created_at DESC
  `, [accountId]);
}

async function getDailyAnalysis(accountId) {
  // Get today's or most recent analysis
  const recs = await queryAll(`
    SELECT r.*, c.name AS campaign_name
    FROM ai_recommendations r
    LEFT JOIN campaigns c ON c.id = r.campaign_id
    WHERE r.account_id = $1
    ORDER BY r.date DESC, 
      CASE r.urgency WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
    LIMIT 20
  `, [accountId]);

  return recs;
}

async function updateRecommendation(recId, status, resolvedBy = 'kevin') {
  return query(`
    UPDATE ai_recommendations
    SET status = $1, resolved_by = $2, resolved_at = NOW()
    WHERE id = $3
  `, [status, resolvedBy, recId]);
}

module.exports = {
  buildAnalysisContext,
  runAnalysis,
  getRecommendations,
  getDailyAnalysis,
  updateRecommendation,
};
