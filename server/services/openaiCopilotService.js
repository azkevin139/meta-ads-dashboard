const fetch = require('node-fetch');
const config = require('../config');
const { queryOne } = require('../db');
const aiBackendSettings = require('./aiBackendSettingsService');

const RESPONSES_URL = 'https://api.openai.com/v1/responses';

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'proposals'],
  properties: {
    summary: { type: 'string' },
    proposals: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'type',
          'priority',
          'title',
          'why',
          'why_not_alternative',
          'expected_impact',
          'confidence',
          'requires_approval',
          'recommended_action',
          'data_used',
          'evidence',
        ],
        properties: {
          type: {
            type: 'string',
            enum: [
              'lead_followup',
              'pipeline_fix',
              'no_show_recovery',
              'campaign_change',
              'budget_change',
              'stage_change',
              'audience_action',
              'general',
            ],
          },
          priority: {
            type: 'string',
            enum: ['critical', 'high', 'medium', 'low'],
          },
          title: { type: 'string' },
          why: { type: 'string' },
          why_not_alternative: { type: 'string' },
          expected_impact: { type: 'string' },
          confidence: { type: 'number' },
          requires_approval: { type: 'boolean' },
          recommended_action: {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'target_scope', 'note'],
            properties: {
              kind: { type: 'string' },
              target_scope: { type: 'string' },
              target_ids: {
                type: 'array',
                items: { type: 'string' },
              },
              note: { type: 'string' },
            },
          },
          data_used: {
            type: 'array',
            items: { type: 'string' },
          },
          evidence: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `You are Revenue Copilot for a lead-generation business.
Your job is to propose the next best operator actions using the provided normalized diagnostics.

Rules:
- Think sales-first. Prioritize speed-to-lead, pipeline leaks, booked-call recovery, lead quality, and cash collected.
- Use only the evidence provided in the snapshot.
- Prefer the most constrained action that addresses the biggest revenue leak first.
- Every proposal must explain why this action is better than the most obvious alternative.
- Do not suggest execution that is impossible from the data given.
- Do not invent specific lead ids, campaign ids, or outcomes that are not present.
- Keep proposals concrete and ranked.
- Return JSON only.`;

const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['channel', 'subject', 'message', 'cta', 'notes'],
  properties: {
    channel: { type: 'string' },
    subject: { type: 'string' },
    message: { type: 'string' },
    cta: { type: 'string' },
    notes: { type: 'string' },
  },
};

const DRAFT_SYSTEM_PROMPT = `You write short sales follow-up drafts for lead generation.
Rules:
- Be concise and direct.
- Keep the copy usable by a human operator.
- Do not claim actions already taken.
- Do not invent personal details that are not present.
- Keep pressure moderate and commercial.
- Return JSON only.`;

function badGateway(message, reasonCode = 'openai_request_failed') {
  const err = new Error(message);
  err.httpStatus = 502;
  err.reasonCode = reasonCode;
  return err;
}

function serviceUnavailable(message, reasonCode = 'openai_not_configured') {
  const err = new Error(message);
  err.httpStatus = 503;
  err.reasonCode = reasonCode;
  return err;
}

function clampConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, Number(num.toFixed(3))));
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = Array.isArray(payload?.output) ? payload.output : [];
  const parts = [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const entry of content) {
      if (entry?.type === 'output_text' && typeof entry.text === 'string') {
        parts.push(entry.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function normalizeResponse(data = {}) {
  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  return {
    summary: typeof data.summary === 'string' ? data.summary.trim() : '',
    proposals: proposals.map((proposal) => ({
      type: typeof proposal.type === 'string' ? proposal.type : 'general',
      priority: ['critical', 'high', 'medium', 'low'].includes(proposal.priority) ? proposal.priority : 'medium',
      title: String(proposal.title || '').trim(),
      why: String(proposal.why || '').trim(),
      why_not_alternative: String(proposal.why_not_alternative || '').trim(),
      expected_impact: String(proposal.expected_impact || '').trim(),
      confidence: clampConfidence(proposal.confidence),
      requires_approval: proposal.requires_approval !== false,
      recommended_action: {
        kind: String(proposal.recommended_action?.kind || 'review').trim(),
        target_scope: String(proposal.recommended_action?.target_scope || 'account').trim(),
        target_ids: Array.isArray(proposal.recommended_action?.target_ids)
          ? proposal.recommended_action.target_ids.map((id) => String(id)).filter(Boolean)
          : [],
        note: String(proposal.recommended_action?.note || '').trim(),
      },
      data_used: Array.isArray(proposal.data_used) ? proposal.data_used.map((item) => String(item)).filter(Boolean) : [],
      evidence: Array.isArray(proposal.evidence) ? proposal.evidence.map((item) => String(item)).filter(Boolean) : [],
    })).filter((proposal) => proposal.title && proposal.why),
  };
}

async function generateProposals(snapshot) {
  const aiConfig = await aiBackendSettings.getEffectiveSettings();
  if (!aiConfig.apiKey) {
    throw serviceUnavailable('OpenAI is not configured on the backend');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiConfig.apiKey}`,
    };
    if (aiConfig.projectId) headers['OpenAI-Project'] = aiConfig.projectId;

    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: aiConfig.model,
        store: false,
        temperature: 0.2,
        instructions: SYSTEM_PROMPT,
        input: JSON.stringify(snapshot),
        text: {
          format: {
            type: 'json_schema',
            name: 'proposed_actions',
            strict: true,
            schema: OUTPUT_SCHEMA,
          },
        },
      metadata: {
        feature: 'proposed_actions',
        account_id: String(snapshot.account_id || ''),
      },
    }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reasonCode = res.status === 401
        ? 'openai_auth_failed'
        : res.status === 429
          ? 'openai_rate_limited'
          : 'openai_request_failed';
      throw badGateway(payload?.error?.message || `OpenAI request failed with HTTP ${res.status}`, reasonCode);
    }

    const content = extractOutputText(payload);
    if (!content) {
      throw badGateway('OpenAI returned no structured proposal payload', 'openai_empty_response');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw badGateway(`OpenAI returned invalid JSON: ${err.message}`, 'openai_invalid_json');
    }

    return {
      model: payload.model || config.openai.model,
      model_source: aiConfig.source,
      response_id: payload.id || null,
      ...normalizeResponse(parsed),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw badGateway('OpenAI proposal request timed out', 'openai_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateFollowupDraft({ proposal, snapshot }) {
  const aiConfig = await aiBackendSettings.getEffectiveSettings();
  if (!aiConfig.apiKey) {
    throw serviceUnavailable('OpenAI is not configured on the backend');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiConfig.apiKey}`,
    };
    if (aiConfig.projectId) headers['OpenAI-Project'] = aiConfig.projectId;

    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: aiConfig.model,
        store: false,
        temperature: 0.4,
        instructions: DRAFT_SYSTEM_PROMPT,
        input: JSON.stringify({
          account_id: snapshot?.account_id || null,
          account_name: snapshot?.account_name || null,
          product_mode: snapshot?.product_mode || null,
          proposal,
          diagnostics: snapshot?.diagnostics || {},
        }),
        text: {
          format: {
            type: 'json_schema',
            name: 'followup_draft',
            strict: true,
            schema: DRAFT_SCHEMA,
          },
        },
        metadata: {
          feature: 'followup_draft',
          account_id: String(snapshot?.account_id || ''),
        },
      }),
    });

    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reasonCode = res.status === 401
        ? 'openai_auth_failed'
        : res.status === 429
          ? 'openai_rate_limited'
          : 'openai_request_failed';
      throw badGateway(payload?.error?.message || `OpenAI request failed with HTTP ${res.status}`, reasonCode);
    }

    const content = extractOutputText(payload);
    if (!content) {
      throw badGateway('OpenAI returned no draft payload', 'openai_empty_response');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      throw badGateway(`OpenAI returned invalid JSON: ${err.message}`, 'openai_invalid_json');
    }

    return {
      model: payload.model || aiConfig.model,
      response_id: payload.id || null,
      channel: String(parsed.channel || '').trim(),
      subject: String(parsed.subject || '').trim(),
      message: String(parsed.message || '').trim(),
      cta: String(parsed.cta || '').trim(),
      notes: String(parsed.notes || '').trim(),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw badGateway('OpenAI draft request timed out', 'openai_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function getBackendStatus() {
  const effective = await aiBackendSettings.getEffectiveSettings();
  const latestRun = await queryOne(`
    SELECT status, reason_code, output_summary, created_at
    FROM copilot_runs
    ORDER BY created_at DESC
    LIMIT 1
  `, []);
  return {
    configured: Boolean(effective.apiKey),
    source: effective.source,
    project_configured: Boolean(effective.projectId),
    model: effective.model,
    project_id: effective.projectId || null,
    updated_at: effective.updatedAt,
    db_configured: effective.dbConfigured,
    latest_run: latestRun || null,
  };
}

async function testBackendConnection() {
  const aiConfig = await aiBackendSettings.getEffectiveSettings();
  if (!aiConfig.apiKey) {
    throw serviceUnavailable('OpenAI is not configured on the backend');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${aiConfig.apiKey}`,
    };
    if (aiConfig.projectId) headers['OpenAI-Project'] = aiConfig.projectId;
    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: aiConfig.model,
        store: false,
        temperature: 0,
        instructions: 'Return valid JSON only.',
        input: 'Ping',
        text: {
          format: {
            type: 'json_schema',
            name: 'openai_backend_ping',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['ok'],
              properties: {
                ok: { type: 'boolean' },
              },
            },
          },
        },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reasonCode = res.status === 401
        ? 'openai_auth_failed'
        : res.status === 429
          ? 'openai_rate_limited'
          : 'openai_request_failed';
      throw badGateway(payload?.error?.message || `OpenAI request failed with HTTP ${res.status}`, reasonCode);
    }
    return {
      status: 'ok',
      source: aiConfig.source,
      model: payload.model || aiConfig.model,
      response_id: payload.id || null,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw badGateway('OpenAI backend test timed out', 'openai_timeout');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  getBackendStatus,
  testBackendConnection,
  generateProposals,
  generateFollowupDraft,
};
