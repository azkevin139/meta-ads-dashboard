const { queryAll, queryOne } = require('../db');
const ghlMcp = require('./ghlMcpService');

const CACHE_TTL_MS = 5 * 60 * 1000;
const snapshotCache = new Map();

function getCacheKey(accountId) {
  return `revenue_copilot:${accountId}`;
}

function getCached(accountId) {
  const entry = snapshotCache.get(getCacheKey(accountId));
  if (!entry) return null;
  if ((Date.now() - entry.createdAt) > CACHE_TTL_MS) {
    snapshotCache.delete(getCacheKey(accountId));
    return null;
  }
  return entry.value;
}

function setCached(accountId, value) {
  snapshotCache.set(getCacheKey(accountId), {
    createdAt: Date.now(),
    value,
  });
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['data', 'items', 'conversations', 'messages', 'opportunities', 'pipelines', 'transactions', 'events', 'contacts']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

async function getLeadResponseAudit(accountId) {
  const row = await queryOne(`
    WITH leads AS (
      SELECT client_id, first_seen_at, normalized_stage
      FROM visitors
      WHERE account_id = $1
        AND first_seen_at >= NOW() - INTERVAL '24 hours'
        AND (ghl_contact_id IS NOT NULL OR meta_lead_id IS NOT NULL OR email_hash IS NOT NULL OR phone_hash IS NOT NULL)
    ),
    first_contact AS (
      SELECT
        ve.client_id,
        MIN(ve.fired_at) AS first_contact_at
      FROM visitor_events ve
      WHERE ve.account_id = $1
        AND (
          (ve.event_name = 'GHLStageChanged' AND lower(COALESCE(ve.metadata->>'normalized_stage', '')) = 'contacted')
          OR ve.event_name = 'known_contact_revisit_triggered'
        )
      GROUP BY ve.client_id
    )
    SELECT
      COUNT(*)::int AS new_leads_24h,
      COUNT(*) FILTER (WHERE fc.first_contact_at IS NULL)::int AS zero_response_count,
      COUNT(*) FILTER (WHERE leads.normalized_stage = 'new_lead' AND leads.first_seen_at < NOW() - INTERVAL '60 minutes')::int AS stale_new_leads,
      COUNT(*) FILTER (WHERE fc.first_contact_at IS NOT NULL AND EXTRACT(EPOCH FROM (fc.first_contact_at - leads.first_seen_at)) / 60.0 <= 5)::int AS within_5m,
      COUNT(*) FILTER (WHERE fc.first_contact_at IS NOT NULL AND EXTRACT(EPOCH FROM (fc.first_contact_at - leads.first_seen_at)) / 60.0 <= 15)::int AS within_15m,
      COUNT(*) FILTER (WHERE fc.first_contact_at IS NOT NULL AND EXTRACT(EPOCH FROM (fc.first_contact_at - leads.first_seen_at)) / 60.0 <= 60)::int AS within_60m,
      AVG(EXTRACT(EPOCH FROM (fc.first_contact_at - leads.first_seen_at)) / 60.0) FILTER (WHERE fc.first_contact_at IS NOT NULL) AS avg_first_response_minutes
    FROM leads
    LEFT JOIN first_contact fc ON fc.client_id = leads.client_id
  `, [accountId]);
  const total = parseInt(row?.new_leads_24h, 10) || 0;
  const pct = (value) => total ? Math.round(((parseInt(value, 10) || 0) / total) * 100) : 0;
  return {
    status: 'ok',
    data_source: ['internal_db'],
    warnings: [],
    metrics: {
      new_leads_24h: total,
      zero_response_count: parseInt(row?.zero_response_count, 10) || 0,
      stale_new_leads: parseInt(row?.stale_new_leads, 10) || 0,
      avg_first_response_minutes: row?.avg_first_response_minutes ? Math.round(Number(row.avg_first_response_minutes)) : null,
      contacted_within_5m_pct: pct(row?.within_5m),
      contacted_within_15m_pct: pct(row?.within_15m),
      contacted_within_60m_pct: pct(row?.within_60m),
    },
  };
}

async function getPipelineLeakageAudit(accountId, mcpStatus) {
  const stages = await queryAll(`
    SELECT
      COALESCE(normalized_stage, 'unknown') AS stage,
      COUNT(*)::int AS count
    FROM visitors
    WHERE account_id = $1
      AND (ghl_contact_id IS NOT NULL OR email_hash IS NOT NULL OR phone_hash IS NOT NULL)
    GROUP BY COALESCE(normalized_stage, 'unknown')
    ORDER BY count DESC, stage ASC
  `, [accountId]);

  const stuck = await queryOne(`
    SELECT
      COUNT(*) FILTER (WHERE normalized_stage = 'new_lead' AND last_seen_at < NOW() - INTERVAL '24 hours')::int AS new_lead_over_24h,
      COUNT(*) FILTER (WHERE normalized_stage = 'contacted' AND last_seen_at < NOW() - INTERVAL '72 hours')::int AS contacted_over_72h,
      COUNT(*) FILTER (WHERE normalized_stage = 'qualified' AND last_seen_at < NOW() - INTERVAL '7 days')::int AS qualified_over_7d,
      COUNT(*) FILTER (WHERE normalized_stage = 'booked' AND last_seen_at < NOW() - INTERVAL '2 days')::int AS booked_over_2d
    FROM visitors
    WHERE account_id = $1
  `, [accountId]);

  let pipelineCount = null;
  const warnings = [];
  const dataSource = ['internal_db'];
  if (mcpStatus?.available_tools?.includes('opportunities_get-pipelines')) {
    try {
      const payload = await ghlMcp.callTool(accountId, 'opportunities_get-pipelines', {});
      pipelineCount = asArray(payload).length;
      dataSource.push('ghl_mcp');
    } catch (err) {
      warnings.push(err.reasonCode || 'mcp_transport_failed');
    }
  }

  return {
    status: warnings.length ? 'partial' : 'ok',
    data_source: dataSource,
    warnings,
    metrics: {
      stage_counts: stages.map((row) => ({ stage: row.stage, count: parseInt(row.count, 10) || 0 })),
      stuck: {
        new_lead_over_24h: parseInt(stuck?.new_lead_over_24h, 10) || 0,
        contacted_over_72h: parseInt(stuck?.contacted_over_72h, 10) || 0,
        qualified_over_7d: parseInt(stuck?.qualified_over_7d, 10) || 0,
        booked_over_2d: parseInt(stuck?.booked_over_2d, 10) || 0,
      },
      pipeline_count: pipelineCount,
    },
  };
}

async function getConversationHealth(accountId, mcpStatus) {
  if (!mcpStatus?.available_tools?.includes('conversations_search-conversation')) {
    return {
      status: 'partial',
      data_source: ['ghl_mcp'],
      warnings: ['mcp_required_tool_missing'],
      metrics: {
        sampled_conversations: 0,
        unread_conversations: null,
        stale_conversations_over_24h: null,
      },
    };
  }

  try {
    const payload = await ghlMcp.callTool(accountId, 'conversations_search-conversation', { limit: 25 });
    const conversations = asArray(payload);
    const now = Date.now();
    const unread = conversations.filter((row) => Number(row.unreadCount || row.unread_count || row.unread || 0) > 0).length;
    const stale = conversations.filter((row) => {
      const last = parseDate(row.lastMessageDate || row.last_message_date || row.updatedAt || row.updated_at);
      return last && (now - last.getTime()) > (24 * 60 * 60 * 1000);
    }).length;
    return {
      status: 'ok',
      data_source: ['ghl_mcp'],
      warnings: [],
      metrics: {
        sampled_conversations: conversations.length,
        unread_conversations: unread,
        stale_conversations_over_24h: stale,
      },
    };
  } catch (err) {
    return {
      status: 'failed',
      data_source: ['ghl_mcp'],
      warnings: [err.reasonCode || 'mcp_transport_failed'],
      metrics: {
        sampled_conversations: 0,
        unread_conversations: null,
        stale_conversations_over_24h: null,
      },
    };
  }
}

async function getRevenueFeedbackSummary(accountId, mcpStatus) {
  const rows = await queryAll(`
    SELECT
      COALESCE(campaign_id, 'unattributed') AS campaign_id,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE normalized_stage = 'booked')::int AS booked,
      COUNT(*) FILTER (WHERE normalized_stage = 'closed_won' OR COALESCE(revenue, 0) > 0)::int AS won,
      COALESCE(SUM(revenue), 0) AS revenue
    FROM visitors
    WHERE account_id = $1
      AND (ghl_contact_id IS NOT NULL OR meta_lead_id IS NOT NULL OR email_hash IS NOT NULL OR phone_hash IS NOT NULL)
    GROUP BY COALESCE(campaign_id, 'unattributed')
    ORDER BY revenue DESC, leads DESC
    LIMIT 8
  `, [accountId]);

  let transactionCount = null;
  const warnings = [];
  const dataSource = ['internal_db'];
  if (mcpStatus?.available_tools?.includes('payments_list-transactions')) {
    try {
      const payload = await ghlMcp.callTool(accountId, 'payments_list-transactions', { limit: 25 });
      transactionCount = asArray(payload).length;
      dataSource.push('ghl_mcp');
    } catch (err) {
      warnings.push(err.reasonCode || 'mcp_transport_failed');
    }
  }

  return {
    status: warnings.length ? 'partial' : 'ok',
    data_source: dataSource,
    warnings,
    metrics: {
      transaction_sample_count: transactionCount,
      top_campaigns: rows.map((row) => {
        const leads = parseInt(row.leads, 10) || 0;
        const booked = parseInt(row.booked, 10) || 0;
        const won = parseInt(row.won, 10) || 0;
        const revenue = Number(row.revenue) || 0;
        return {
          campaign_id: row.campaign_id,
          leads,
          booked,
          won,
          revenue,
          booked_rate_pct: leads ? Math.round((booked / leads) * 100) : 0,
          won_rate_pct: leads ? Math.round((won / leads) * 100) : 0,
          revenue_per_lead: leads ? Number((revenue / leads).toFixed(2)) : 0,
        };
      }),
    },
  };
}

async function getDashboardSnapshot(accountId, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const cached = getCached(accountId);
    if (cached) return cached;
  }
  const mcpStatus = await ghlMcp.getConnectionStatus(accountId);
  const [leadResponseAudit, pipelineLeakageAudit, conversationHealth, revenueFeedbackSummary] = await Promise.all([
    getLeadResponseAudit(accountId),
    getPipelineLeakageAudit(accountId, mcpStatus),
    getConversationHealth(accountId, mcpStatus),
    getRevenueFeedbackSummary(accountId, mcpStatus),
  ]);
  const snapshot = {
    account_id: accountId,
    refreshed_at: new Date().toISOString(),
    mcp_status: mcpStatus,
    lead_response_audit: leadResponseAudit,
    pipeline_leakage_audit: pipelineLeakageAudit,
    conversation_health: conversationHealth,
    revenue_feedback_summary: revenueFeedbackSummary,
  };
  setCached(accountId, snapshot);
  return snapshot;
}

module.exports = {
  getLeadResponseAudit,
  getPipelineLeakageAudit,
  getConversationHealth,
  getRevenueFeedbackSummary,
  getDashboardSnapshot,
};
