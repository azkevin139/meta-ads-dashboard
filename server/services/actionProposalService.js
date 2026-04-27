const { query, queryAll, queryOne } = require('../db');
const config = require('../config');
const revenueCopilot = require('./revenueCopilotService');
const openaiCopilot = require('./openaiCopilotService');

const PROPOSAL_STATUSES = ['proposed', 'approved', 'dismissed'];
const ALLOWED_ACTIONS = [
  'suggest_budget_change',
  'suggest_ad_pause',
  'suggest_followup_message',
  'suggest_stage_update',
  'suggest_pipeline_fix',
];

function badRequest(message) {
  const err = new Error(message);
  err.httpStatus = 400;
  return err;
}

function notFound(message) {
  const err = new Error(message);
  err.httpStatus = 404;
  return err;
}

function summarizeDiagnostics(snapshot) {
  return {
    lead_response: snapshot.lead_response_audit?.metrics || {},
    pipeline: snapshot.pipeline_leakage_audit?.metrics?.stuck || {},
    conversation: snapshot.conversation_health?.metrics || {},
    revenue_sources: (snapshot.revenue_feedback_summary?.metrics?.top_campaigns || []).length,
  };
}

async function getRecentAdsSummary(accountId) {
  return queryAll(`
    SELECT
      c.meta_campaign_id,
      c.name,
      COALESCE(SUM(di.spend), 0) AS spend,
      COALESCE(SUM(di.conversions), 0) AS results,
      ROUND(AVG(di.ctr), 2) AS avg_ctr,
      ROUND(AVG(di.cost_per_result), 2) AS avg_cpa,
      ROUND(AVG(di.roas), 2) AS avg_roas
    FROM daily_insights di
    JOIN campaigns c ON c.id = di.campaign_id
    WHERE di.account_id = $1
      AND di.level = 'campaign'
      AND di.date >= CURRENT_DATE - INTERVAL '7 days'
    GROUP BY c.meta_campaign_id, c.name
    ORDER BY COALESCE(SUM(di.spend), 0) DESC
    LIMIT 8
  `, [accountId]);
}

async function getRecentAudienceStatus(accountId) {
  return queryAll(`
    SELECT
      segment_key,
      segment_name,
      meta_audience_id,
      last_push_at,
      last_push_count,
      auto_refresh,
      refresh_interval_hours,
      last_push_error
    FROM audience_pushes
    WHERE account_id = $1
    ORDER BY COALESCE(last_push_at, created_at) DESC
    LIMIT 8
  `, [accountId]);
}

async function buildSnapshot(accountId, { forceRefresh = false } = {}) {
  const account = await queryOne(`
    SELECT id, name, product_mode, meta_account_id, ghl_location_id
    FROM accounts
    WHERE id = $1
  `, [accountId]);
  if (!account) throw notFound('Account not found');

  const diagnostics = await revenueCopilot.getDashboardSnapshot(accountId, { forceRefresh });
  const [recentAds, recentAudiences] = await Promise.all([
    getRecentAdsSummary(accountId),
    getRecentAudienceStatus(accountId),
  ]);

  return {
    account_id: account.id,
    account_name: account.name,
    product_mode: account.product_mode || 'general',
    meta_account_id: account.meta_account_id || null,
    ghl_location_id: account.ghl_location_id || null,
    diagnostics,
    recent_ads_summary: recentAds.map((row) => ({
      campaign_id: row.meta_campaign_id,
      campaign_name: row.name,
      spend: Number(row.spend) || 0,
      results: Number(row.results) || 0,
      avg_ctr: Number(row.avg_ctr) || 0,
      avg_cpa: Number(row.avg_cpa) || 0,
      avg_roas: Number(row.avg_roas) || 0,
    })),
    recent_audience_status: recentAudiences.map((row) => ({
      segment_key: row.segment_key,
      segment_name: row.segment_name,
      meta_audience_id: row.meta_audience_id,
      last_push_at: row.last_push_at,
      last_push_count: row.last_push_count,
      auto_refresh: row.auto_refresh,
      refresh_interval_hours: row.refresh_interval_hours,
      last_push_error: row.last_push_error,
    })),
    allowed_actions: ALLOWED_ACTIONS,
  };
}

async function insertRun(accountId, status, inputSummary, outputSummary, reasonCode = null) {
  const result = await query(`
    INSERT INTO copilot_runs (account_id, status, input_summary, output_summary, reason_code)
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5)
    RETURNING *
  `, [
    accountId,
    status,
    JSON.stringify(inputSummary || {}),
    JSON.stringify(outputSummary || {}),
    reasonCode,
  ]);
  return result.rows[0];
}

async function generateProposals(accountId, { forceRefresh = true } = {}) {
  const snapshot = await buildSnapshot(accountId, { forceRefresh });
  const inputSummary = {
    product_mode: snapshot.product_mode,
    diagnostics: summarizeDiagnostics(snapshot.diagnostics || {}),
    recent_ads_count: snapshot.recent_ads_summary.length,
    recent_audience_count: snapshot.recent_audience_status.length,
    openai_configured: Boolean(config.openai.apiKey),
  };

  try {
    const generated = await openaiCopilot.generateProposals(snapshot);
    const run = await insertRun(accountId, generated.proposals.length ? 'success' : 'partial', inputSummary, {
      model: generated.model,
      response_id: generated.response_id,
      summary: generated.summary,
      proposal_count: generated.proposals.length,
    });

    const proposals = [];
    for (const proposal of generated.proposals) {
      const inserted = await query(`
        INSERT INTO copilot_proposals (
          run_id, account_id, proposal_type, priority, title, why, why_not_alternative,
          expected_impact, confidence, requires_approval, payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
        RETURNING *
      `, [
        run.id,
        accountId,
        proposal.type,
        proposal.priority,
        proposal.title,
        proposal.why,
        proposal.why_not_alternative,
        proposal.expected_impact,
        proposal.confidence,
        proposal.requires_approval !== false,
        JSON.stringify({
          recommended_action: proposal.recommended_action,
          data_used: proposal.data_used,
          evidence: proposal.evidence,
        }),
      ]);
      proposals.push(inserted.rows[0]);
    }

    return {
      run,
      summary: generated.summary,
      proposals,
    };
  } catch (err) {
    await insertRun(accountId, 'failed', inputSummary, {
      message: err.message,
    }, err.reasonCode || 'proposal_generation_failed');
    throw err;
  }
}

async function listProposals(accountId, { status = 'proposed', limit = 12 } = {}) {
  if (!PROPOSAL_STATUSES.includes(status) && status !== 'all') {
    throw badRequest('Invalid status');
  }
  const values = [accountId];
  let where = 'WHERE account_id = $1';
  if (status !== 'all') {
    values.push(status);
    where += ` AND status = $${values.length}`;
  }
  values.push(Math.min(Math.max(parseInt(limit, 10) || 12, 1), 50));
  const rows = await queryAll(`
    SELECT *
    FROM copilot_proposals
    ${where}
    ORDER BY created_at DESC
    LIMIT $${values.length}
  `, values);
  const latestRun = await queryOne(`
    SELECT *
    FROM copilot_runs
    WHERE account_id = $1
    ORDER BY created_at DESC
    LIMIT 1
  `, [accountId]);
  return { rows, latestRun };
}

async function getProposal(accountId, proposalId) {
  const row = await queryOne(`
    SELECT *
    FROM copilot_proposals
    WHERE id = $1 AND account_id = $2
    LIMIT 1
  `, [proposalId, accountId]);
  if (!row) throw notFound('Proposal not found');
  return row;
}

async function updateProposalStatus(accountId, proposalId, status, userId, note = null) {
  if (!['approved', 'dismissed', 'proposed'].includes(status)) {
    throw badRequest('Invalid proposal status');
  }
  const field = status === 'approved'
    ? 'status = $3, approved_at = NOW(), approved_by = $4'
    : status === 'dismissed'
      ? 'status = $3, dismissed_at = NOW(), dismissed_by = $4'
      : 'status = $3, approved_at = NULL, approved_by = NULL, dismissed_at = NULL, dismissed_by = NULL';
  const result = await query(`
    UPDATE copilot_proposals
    SET ${field},
        payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
          'review_note', $5,
          'review_note_updated_at', NOW()::text,
          'review_note_status', $3
        )
    WHERE id = $1 AND account_id = $2
    RETURNING *
  `, [proposalId, accountId, status, userId || null, note ? String(note).trim() : '']);
  if (!result.rows[0]) throw notFound('Proposal not found');
  return result.rows[0];
}

module.exports = {
  PROPOSAL_STATUSES,
  buildSnapshot,
  generateProposals,
  listProposals,
  getProposal,
  updateProposalStatus,
};
