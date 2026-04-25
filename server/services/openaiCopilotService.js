const fetch = require('node-fetch');
const config = require('../config');

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
  if (!config.openai.apiKey) {
    throw serviceUnavailable('OpenAI is not configured on the backend');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.openai.apiKey}`,
    };
    if (config.openai.projectId) headers['OpenAI-Project'] = config.openai.projectId;

    const res = await fetch(RESPONSES_URL, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: config.openai.model,
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

module.exports = {
  generateProposals,
};
