/* ═══════════════════════════════════════════════════════════
   Decision Center — Meta-token intelligence
   ═══════════════════════════════════════════════════════════ */

let intelPreset = 'yesterday';
let intelDateFrom = daysAgoStr(1);
let intelDateTo = daysAgoStr(1);
let intelBreakdown = 'publisher_platform';
let touchSequenceDefaults = [];
let touchSequenceCache = [];
let touchSequenceEditingId = null;
let intelDataHealth = null;
let audienceAutomationCatalog = { segments: [], thresholdTypes: [], actionTypes: [] };
let proposedActionFilter = 'proposed';

async function loadIntelligence(container) {
  container.innerHTML = `
    <div class="flex-between mb-md" style="flex-wrap:wrap; gap:10px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="btn btn-sm ${intelPreset === 'today' ? 'btn-primary' : ''}" onclick="setIntelPreset('today')">Today</button>
        <button class="btn btn-sm ${intelPreset === 'yesterday' ? 'btn-primary' : ''}" onclick="setIntelPreset('yesterday')">Yesterday</button>
        <button class="btn btn-sm ${intelPreset === '7d' ? 'btn-primary' : ''}" onclick="setIntelPreset('7d')">7d</button>
        <button class="btn btn-sm ${intelPreset === '30d' ? 'btn-primary' : ''}" onclick="setIntelPreset('30d')">30d</button>
        <button class="btn btn-sm ${intelPreset === 'custom' ? 'btn-primary' : ''}" onclick="openIntelDateRange()">Custom</button>
      </div>
      <button class="btn btn-sm" onclick="openTargetSettings()">Targets</button>
    </div>
    <div id="intel-freshness" class="mb-md"></div>
    <div id="intel-rules" class="mb-md"><div class="loading">Loading decision queues</div></div>
    <div class="table-container mb-md">
      <div class="table-header">
        <span class="table-title">Touch Sequences</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="openTouchSequenceEditor()">Create Sequence</button>
          <button class="btn btn-sm" onclick="runTouchSequenceMonitor()">Run Monitor</button>
        </div>
      </div>
      <div id="intel-touch-sequences"><div class="loading">Loading touch sequences</div></div>
    </div>
    <div class="table-container mb-md">
      <div class="table-header"><span class="table-title">Audience Segments</span><span class="badge badge-active">RETARGETING</span></div>
      <div id="intel-audience-segments"><div class="loading">Loading audience segments</div></div>
    </div>
    <div class="table-container mb-md">
      <div class="table-header">
        <span class="table-title">Audience Automation</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="openAudienceAutomationEditor()">Create Rule</button>
          <button class="btn btn-sm" onclick="runAudienceAutomationEvaluator()">Run Evaluator</button>
        </div>
      </div>
      <div id="intel-audience-automation"><div class="loading">Loading audience automation</div></div>
    </div>
    <div class="table-container mb-md">
      <div class="table-header">
        <span class="table-title">Revenue Copilot</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" id="intel-revenue-copilot-refresh">Refresh</button>
        </div>
      </div>
      <div id="intel-revenue-copilot"><div class="loading">Loading revenue copilot</div></div>
    </div>
    <div class="table-container mb-md">
      <div class="table-header">
        <span class="table-title">Proposed Actions</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" id="intel-proposals-filter-proposed">Proposed</button>
          <button class="btn btn-sm" id="intel-proposals-filter-approved">Approved</button>
          <button class="btn btn-sm" id="intel-proposals-filter-dismissed">Dismissed</button>
          <button class="btn btn-sm btn-primary" id="intel-proposals-generate">Generate</button>
        </div>
      </div>
      <div id="intel-proposed-actions"><div class="loading">Loading proposed actions</div></div>
    </div>
    <div class="grid-two mb-md" style="display:grid; grid-template-columns: minmax(0,1fr) minmax(320px,0.8fr); gap:16px;">
      <div class="table-container">
        <div class="table-header"><span class="table-title">Lifecycle Summary</span><span class="badge badge-active">CRM + TRACKING</span></div>
        <div id="intel-lifecycle-summary"><div class="loading">Loading lifecycle summary</div></div>
      </div>
      <div class="table-container">
        <div class="table-header"><span class="table-title">Lifecycle Events</span><span class="badge badge-active">LEDGER</span></div>
        <div id="intel-lifecycle-events"><div class="loading">Loading lifecycle events</div></div>
      </div>
    </div>
    <div class="table-container mb-md">
      <div class="table-header"><span class="table-title">Identity Stitching</span><span class="badge badge-warning">CONFIDENCE</span></div>
      <div id="intel-identity-health"><div class="loading">Loading identity health</div></div>
    </div>
    <div class="table-container mb-md">
      <div class="table-header">
        <span class="table-title">Collision Review</span>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm" onclick="loadIdentityCollisions('open')">Open</button>
          <button class="btn btn-sm" onclick="loadIdentityCollisions('ignored')">Ignored</button>
          <button class="btn btn-sm" onclick="loadIdentityCollisions('resolved')">Resolved</button>
        </div>
      </div>
      <div id="intel-identity-collisions"><div class="loading">Loading collision review queue</div></div>
    </div>
    <div class="grid-two mb-md" style="display:grid; grid-template-columns: minmax(0,1.2fr) minmax(320px,0.8fr); gap:16px;">
      <div class="table-container">
        <div class="table-header"><span class="table-title">First-Party Funnel</span><span class="badge badge-active">META + TRACKING</span></div>
        <div id="intel-funnel"><div class="loading">Loading funnel</div></div>
      </div>
      <div class="table-container">
        <div class="table-header">
          <span class="table-title">Breakdowns</span>
          <select class="form-select" style="max-width:180px; padding:6px 8px; font-size:0.78rem;" onchange="setIntelBreakdown(this.value)">
            ${['publisher_platform','platform_position','impression_device','age','gender','country','region'].map(b => `<option value="${b}" ${intelBreakdown === b ? 'selected' : ''}>${b.replace(/_/g,' ')}</option>`).join('')}
          </select>
        </div>
        <div id="intel-breakdowns"><div class="loading">Loading breakdown</div></div>
      </div>
    </div>
    <div class="table-container">
      <div class="table-header"><span class="table-title">Creative Library</span><span class="badge badge-active">GROUPED</span></div>
      <div id="intel-creatives"><div class="loading">Loading creatives</div></div>
    </div>
    <div class="grid-two mt-md" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,0.8fr); gap:16px;">
      <div class="table-container">
        <div class="table-header"><span class="table-title">True ROAS</span><span class="badge badge-active">FIRST PARTY</span></div>
        <div id="intel-roas"><div class="loading">Loading ROAS</div></div>
      </div>
      <div class="table-container">
        <div class="table-header"><span class="table-title">Audience Health</span><span class="badge badge-active">META</span></div>
        <div id="intel-audiences"><div class="loading">Loading audiences</div></div>
      </div>
    </div>
    <div class="table-container mt-md">
      <div class="table-header"><span class="table-title">Recent Journeys</span><span class="badge badge-active">TRACKING</span></div>
      <div id="intel-journeys"><div class="loading">Loading journeys</div></div>
    </div>
  `;
  const revenueRefreshButton = document.getElementById('intel-revenue-copilot-refresh');
  if (revenueRefreshButton) revenueRefreshButton.onclick = () => loadRevenueCopilot(true);
  const generateProposalsButton = document.getElementById('intel-proposals-generate');
  if (generateProposalsButton) generateProposalsButton.onclick = () => generateProposedActions();
  const proposedFilterButton = document.getElementById('intel-proposals-filter-proposed');
  if (proposedFilterButton) proposedFilterButton.onclick = () => setProposalFilter('proposed');
  const approvedFilterButton = document.getElementById('intel-proposals-filter-approved');
  if (approvedFilterButton) approvedFilterButton.onclick = () => setProposalFilter('approved');
  const dismissedFilterButton = document.getElementById('intel-proposals-filter-dismissed');
  if (dismissedFilterButton) dismissedFilterButton.onclick = () => setProposalFilter('dismissed');

  await Promise.all([
    loadDecisionQueues(),
    loadTouchSequences(),
    loadAudienceSegments(),
    loadAudienceAutomation(),
    loadRevenueCopilot(),
    loadProposedActions(),
    loadLifecycleSummary(),
    loadIdentityHealth(),
    loadIdentityCollisions(),
    loadFunnel(),
    loadBreakdowns(),
    loadCreativeLibrary(),
    loadTrueRoas(),
    loadAudienceHealth(),
    loadJourneys(),
  ]);
  await loadIntelDataHealth();
}

async function loadRevenueCopilot(forceRefresh = false) {
  const el = document.getElementById('intel-revenue-copilot');
  if (!el) return;
  try {
    const res = await apiGet(`/intelligence/revenue-copilot${forceRefresh ? '?refresh=1' : ''}`);
    const data = res.data || {};
    const mcp = data.mcp_status || {};
    const lead = data.lead_response_audit || {};
    const pipe = data.pipeline_leakage_audit || {};
    const convo = data.conversation_health || {};
    const revenue = data.revenue_feedback_summary || {};
    const topCampaigns = revenue.metrics?.top_campaigns || [];
    const stageCounts = pipe.metrics?.stage_counts || [];
    el.innerHTML = `
      <div class="grid-two" style="display:grid; grid-template-columns:minmax(0,1fr) minmax(320px,0.9fr); gap:16px;">
        <div>
          <div class="reco-card" style="padding:12px; margin-bottom:12px;">
            <div class="reco-entity" style="font-size:0.84rem; margin-bottom:6px;">MCP status</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              <span class="badge badge-${mcp.status === 'ok' ? 'active' : mcp.status === 'partial' ? 'warning' : mcp.status === 'disabled' ? 'low' : 'critical'}">${escapeHtml(mcp.status || 'unknown')}</span>
              <span class="text-muted" style="font-size:0.76rem;">${escapeHtml(mcp.mode || 'disabled')}</span>
              ${data.refreshed_at ? `<span class="text-muted" style="font-size:0.76rem;">${fmtDateTime(data.refreshed_at)}</span>` : ''}
            </div>
            ${mcp.last_error ? `<div class="alert-banner alert-warning" style="margin-top:8px;">${escapeHtml(mcp.last_error)}</div>` : ''}
          </div>
          <div style="overflow:auto;"><table>
            <thead><tr><th>Lead response</th><th class="right">Value</th></tr></thead>
            <tbody>
              <tr><td>New leads 24h</td><td class="right">${fmt(lead.metrics?.new_leads_24h || 0, 'integer')}</td></tr>
              <tr><td>Zero response</td><td class="right">${fmt(lead.metrics?.zero_response_count || 0, 'integer')}</td></tr>
              <tr><td>Stale new leads</td><td class="right">${fmt(lead.metrics?.stale_new_leads || 0, 'integer')}</td></tr>
              <tr><td>Avg first response</td><td class="right">${lead.metrics?.avg_first_response_minutes === null || lead.metrics?.avg_first_response_minutes === undefined ? '—' : `${fmt(lead.metrics.avg_first_response_minutes, 'integer')}m`}</td></tr>
              <tr><td>Contacted within 15m</td><td class="right">${fmt(lead.metrics?.contacted_within_15m_pct || 0, 'integer')}%</td></tr>
              <tr><td>Contacted within 60m</td><td class="right">${fmt(lead.metrics?.contacted_within_60m_pct || 0, 'integer')}%</td></tr>
            </tbody>
          </table></div>
        </div>
        <div>
          <div style="overflow:auto;"><table>
            <thead><tr><th>Pipeline leakage</th><th class="right">Value</th></tr></thead>
            <tbody>
              <tr><td>New lead >24h</td><td class="right">${fmt(pipe.metrics?.stuck?.new_lead_over_24h || 0, 'integer')}</td></tr>
              <tr><td>Contacted >72h</td><td class="right">${fmt(pipe.metrics?.stuck?.contacted_over_72h || 0, 'integer')}</td></tr>
              <tr><td>Qualified >7d</td><td class="right">${fmt(pipe.metrics?.stuck?.qualified_over_7d || 0, 'integer')}</td></tr>
              <tr><td>Booked >2d</td><td class="right">${fmt(pipe.metrics?.stuck?.booked_over_2d || 0, 'integer')}</td></tr>
              <tr><td>Pipelines (MCP)</td><td class="right">${pipe.metrics?.pipeline_count === null || pipe.metrics?.pipeline_count === undefined ? '—' : fmt(pipe.metrics.pipeline_count, 'integer')}</td></tr>
              <tr><td>Unread convos (sample)</td><td class="right">${convo.metrics?.unread_conversations === null || convo.metrics?.unread_conversations === undefined ? '—' : fmt(convo.metrics.unread_conversations, 'integer')}</td></tr>
            </tbody>
          </table></div>
        </div>
      </div>
      <div class="grid-two" style="display:grid; grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr); gap:16px; margin-top:12px;">
        <div class="table-container">
          <div class="table-header"><span class="table-title">Stage Counts</span></div>
          ${stageCounts.length ? `<div style="overflow:auto;"><table>
            <thead><tr><th>Stage</th><th class="right">Count</th></tr></thead>
            <tbody>${stageCounts.map((row) => `<tr><td>${escapeHtml(row.stage)}</td><td class="right">${fmt(row.count || 0, 'integer')}</td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="text-muted" style="font-size:0.76rem; padding:12px;">No stage data yet.</div>'}
        </div>
        <div class="table-container">
          <div class="table-header"><span class="table-title">Top Revenue Sources</span></div>
          ${topCampaigns.length ? `<div style="overflow:auto;"><table>
            <thead><tr><th>Campaign</th><th class="right">Leads</th><th class="right">Booked %</th><th class="right">Won %</th><th class="right">Rev/Lead</th></tr></thead>
            <tbody>${topCampaigns.map((row) => `<tr>
              <td class="name-cell"><span class="mono">${escapeHtml(row.campaign_id)}</span></td>
              <td class="right">${fmt(row.leads || 0, 'integer')}</td>
              <td class="right">${fmt(row.booked_rate_pct || 0, 'integer')}%</td>
              <td class="right">${fmt(row.won_rate_pct || 0, 'integer')}%</td>
              <td class="right">${fmt(row.revenue_per_lead || 0, 'currency')}</td>
            </tr>`).join('')}</tbody>
          </table></div>` : '<div class="text-muted" style="font-size:0.76rem; padding:12px;">No revenue source data yet.</div>'}
        </div>
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function setProposalFilter(status) {
  proposedActionFilter = status;
  loadProposedActions();
}

async function loadProposedActions() {
  const el = document.getElementById('intel-proposed-actions');
  if (!el) return;
  try {
    const res = await apiGet(`/intelligence/proposed-actions?status=${encodeURIComponent(proposedActionFilter)}&limit=12`);
    const rows = res.data || [];
    const latestRun = res.latest_run || null;
    const summary = latestRun?.output_summary?.summary || '';
    const latestError = latestRun?.output_summary?.message || '';
    const meta = latestRun
      ? `<div class="text-muted" style="font-size:0.76rem; margin-bottom:10px;">Last run ${fmtDateTime(latestRun.created_at)} · ${escapeHtml(latestRun.status)}${latestRun.reason_code ? ` · ${escapeHtml(latestRun.reason_code)}` : ''}</div>`
      : '<div class="text-muted" style="font-size:0.76rem; margin-bottom:10px;">No proposal run yet.</div>';
    if (!rows.length) {
      el.innerHTML = `
        ${meta}
        ${latestError ? `<div class="alert-banner alert-critical" style="margin-bottom:10px;">${escapeHtml(latestError)}</div>` : ''}
        ${summary ? `<div class="alert-banner alert-warning" style="margin-bottom:10px;">${escapeHtml(summary)}</div>` : ''}
        <div class="text-muted" style="font-size:0.78rem; padding:12px;">No ${escapeHtml(proposedActionFilter)} actions yet.</div>
      `;
      return;
    }
    el.innerHTML = `
      ${meta}
      ${latestError ? `<div class="alert-banner alert-critical" style="margin-bottom:10px;">${escapeHtml(latestError)}</div>` : ''}
      ${summary ? `<div class="alert-banner alert-warning" style="margin-bottom:10px;">${escapeHtml(summary)}</div>` : ''}
      <div style="display:grid; gap:12px;">
        ${rows.map((row) => {
          const payload = row.payload || {};
          const dataUsed = Array.isArray(payload.data_used) ? payload.data_used : [];
          const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
          const action = payload.recommended_action || {};
          const badge = row.status === 'approved' ? 'active' : row.status === 'dismissed' ? 'low' : row.priority === 'critical' ? 'critical' : row.priority === 'high' ? 'warning' : 'active';
          return `
            <div class="reco-card" style="padding:14px;">
              <div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
                <div>
                  <div style="font-weight:700; font-size:0.95rem;">${escapeHtml(row.title)}</div>
                  <div class="text-muted" style="font-size:0.74rem; margin-top:4px;">${fmtDateTime(row.created_at)} · confidence ${fmt(Number(row.confidence || 0) * 100, 'integer')}%</div>
                </div>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                  <span class="badge badge-${badge}">${escapeHtml(row.priority)}</span>
                  <span class="badge badge-${row.status === 'approved' ? 'active' : row.status === 'dismissed' ? 'low' : 'warning'}">${escapeHtml(row.status)}</span>
                </div>
              </div>
              <div style="margin-top:10px; display:grid; gap:8px;">
                <div><div class="text-muted" style="font-size:0.72rem;">Why</div><div>${escapeHtml(row.why)}</div></div>
                <div><div class="text-muted" style="font-size:0.72rem;">Why not another action</div><div>${escapeHtml(row.why_not_alternative || '—')}</div></div>
                <div><div class="text-muted" style="font-size:0.72rem;">Expected impact</div><div>${escapeHtml(row.expected_impact || '—')}</div></div>
                <div><div class="text-muted" style="font-size:0.72rem;">Recommended action</div><div>${escapeHtml(action.kind || 'review')} · ${escapeHtml(action.target_scope || 'account')}${action.note ? ` · ${escapeHtml(action.note)}` : ''}</div></div>
                ${dataUsed.length ? `<div><div class="text-muted" style="font-size:0.72rem;">Data used</div><div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:4px;">${dataUsed.map((item) => `<span class="badge badge-low">${escapeHtml(item)}</span>`).join('')}</div></div>` : ''}
                ${evidence.length ? `<div><div class="text-muted" style="font-size:0.72rem;">Evidence</div><ul style="margin:6px 0 0 18px;">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></div>` : ''}
              </div>
              ${row.status === 'proposed' ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px;">
                <button class="btn btn-sm btn-primary intel-proposal-status" data-id="${row.id}" data-status="approved">Approve</button>
                <button class="btn btn-sm intel-proposal-status" data-id="${row.id}" data-status="dismissed">Dismiss</button>
              </div>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
    el.querySelectorAll('.intel-proposal-status').forEach((button) => {
      button.onclick = () => updateProposalStatus(button.dataset.id, button.dataset.status);
    });
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function generateProposedActions() {
  try {
    const res = await apiPost('/intelligence/proposed-actions/generate', {});
    const count = res.data?.proposals?.length || 0;
    toast(`Generated ${count} proposed action${count === 1 ? '' : 's'}.`);
    proposedActionFilter = 'proposed';
    await loadProposedActions();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function updateProposalStatus(proposalId, status) {
  try {
    await apiPost(`/intelligence/proposed-actions/${proposalId}/status`, { status });
    toast(`Proposal ${status}.`);
    await loadProposedActions();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function loadAudienceAutomation() {
  const el = document.getElementById('intel-audience-automation');
  if (!el) return;
  try {
    const [rulesRes, runsRes] = await Promise.all([
      apiGet('/intelligence/audience-automation/rules'),
      apiGet('/intelligence/audience-automation/runs?limit=12'),
    ]);
    const rows = rulesRes.data || [];
    const runs = runsRes.data || [];
    const readiness = rulesRes.readiness || { status: 'ready' };
    window.__intelAudienceAutomationRows = rows;
    audienceAutomationCatalog = {
      segments: rulesRes.available_segments || [],
      thresholdTypes: rulesRes.threshold_types || [],
      actionTypes: rulesRes.action_types || [],
    };
    const readinessBanner = readiness.status === 'blocked' && readiness.reason_code === 'meta_custom_audience_terms_not_accepted'
      ? `<div class="alert-banner alert-warning" style="margin-bottom:10px;">
          <div style="font-weight:600; margin-bottom:4px;">Meta audience validation required for this ad account</div>
          <div style="font-size:0.78rem; line-height:1.45;">${escapeHtml(readiness.message || 'Meta requires Custom Audience terms acceptance before uploaded customer-list audiences can be created for this ad account.')}</div>
          ${readiness.blocker_url ? `<div style="margin-top:8px;"><a class="btn btn-sm" href="${escapeHtml(readiness.blocker_url)}" target="_blank" rel="noopener">Open Meta Terms</a></div>` : ''}
        </div>`
      : '';
    el.innerHTML = `
      <div class="text-muted" style="font-size:0.76rem; margin-bottom:10px;">Lead-gen automation runs every 15 minutes on fast-sync accounts. Thresholds use matchable identifiers by default so audiences only trigger when Meta customer match can actually use them.</div>
      ${readinessBanner}
      ${rows.length ? `<div style="overflow:auto;"><table>
        <thead><tr><th>Segment</th><th class="right">Eligible</th><th class="right">Matchable</th><th>Threshold</th><th>Action</th><th>Status</th><th>Audience</th><th>Last Run</th><th>Actions</th></tr></thead>
        <tbody>
          ${rows.map((row) => {
            const latest = row.latest_run || null;
            const audienceId = row.audience_push?.meta_audience_id || '—';
            const reason = row.current_reason || latest?.reason_code || '';
            const status = row.current_status || 'waiting';
            const badge = status === 'blocked' ? 'critical' : status === 'ready' ? 'active' : status === 'triggered' ? 'active' : status === 'disabled' ? 'warning' : 'low';
            const blockerLink = latest?.payload?.blocker_url ? `<div style="margin-top:6px;"><a href="${escapeHtml(latest.payload.blocker_url)}" target="_blank" rel="noopener" style="font-size:0.72rem;">Open Meta terms</a></div>` : '';
            return `<tr>
              <td class="name-cell">
                <div style="font-weight:600;">${escapeHtml(row.segment_key)}</div>
                ${reason ? `<div class="text-muted" style="font-size:0.72rem;">${escapeHtml(reason.replace(/_/g, ' '))}</div>${blockerLink}` : ''}
              </td>
              <td class="right">${fmt(row.stats?.eligible_count || 0, 'integer')}</td>
              <td class="right">${fmt(row.stats?.matchable_count || 0, 'integer')}</td>
              <td><span class="mono">${escapeHtml(row.threshold_type)} ≥ ${fmt(row.threshold_value, 'integer')}</span></td>
              <td>${escapeHtml(row.action_type)}</td>
              <td><span class="badge badge-${badge}">${escapeHtml(status.replace(/_/g, ' '))}</span></td>
              <td>${audienceId !== '—' ? `<span class="mono">${escapeHtml(audienceId)}</span>` : '<span class="text-muted">—</span>'}</td>
              <td>${latest?.created_at ? `${fmtDateTime(latest.created_at)}<div class="text-muted" style="font-size:0.72rem;">${escapeHtml(latest.status)}${latest.reason_code ? ` · ${escapeHtml(latest.reason_code)}` : ''}</div>` : '<span class="text-muted">Never</span>'}</td>
              <td><div class="btn-group">
                <button class="btn btn-sm" onclick="openAudienceAutomationEditor(${row.id})">Edit</button>
                <button class="btn btn-sm" onclick="toggleAudienceAutomationRule(${row.id}, ${row.enabled})">${row.enabled ? 'Disable' : 'Enable'}</button>
                <button class="btn btn-sm btn-danger" onclick="deleteAudienceAutomationRule(${row.id})">Delete</button>
              </div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>` : '<div class="empty-state"><div class="empty-state-text">No audience automation rules yet</div></div>'}
      <div class="table-container" style="margin-top:12px;">
        <div class="table-header"><span class="table-title">Recent Rule Runs</span><span class="badge badge-low">${fmt(runs.length, 'integer')}</span></div>
        ${runs.length ? `<div style="overflow:auto;"><table>
          <thead><tr><th>When</th><th>Segment</th><th>Status</th><th class="right">Eligible</th><th class="right">Matchable</th><th>Reason</th></tr></thead>
          <tbody>${runs.map((run) => `<tr>
            <td>${fmtDateTime(run.created_at)}</td>
            <td class="name-cell">${escapeHtml(run.segment_key)}</td>
            <td><span class="badge badge-${run.status === 'triggered' ? 'active' : run.status === 'blocked' || run.status === 'failed' ? 'critical' : 'warning'}">${escapeHtml(run.status)}</span></td>
            <td class="right">${fmt(run.eligible_count || 0, 'integer')}</td>
            <td class="right">${fmt(run.matchable_count || 0, 'integer')}</td>
            <td>${escapeHtml(run.reason_code || '—')}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<div class="text-muted" style="font-size:0.76rem; padding:12px;">No automation runs recorded yet.</div>'}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function openAudienceAutomationEditor(ruleId = null) {
  const rows = Array.isArray(audienceAutomationCatalog.segments) ? audienceAutomationCatalog.segments : [];
  const existingRows = window.__intelAudienceAutomationRows || [];
  const existing = existingRows.find((row) => Number(row.id) === Number(ruleId)) || null;
  openDrawer(existing ? 'Edit Audience Rule' : 'Create Audience Rule', `
    <div class="form-group">
      <label class="form-label">Segment</label>
      <select id="aud-automation-segment" class="form-select">
        ${rows.map((segment) => `<option value="${escapeHtml(segment.key)}" ${existing?.segment_key === segment.key ? 'selected' : ''}>${escapeHtml(segment.key)}</option>`).join('')}
      </select>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Threshold type</label>
        <select id="aud-automation-threshold-type" class="form-select">
          ${(audienceAutomationCatalog.thresholdTypes || ['matchable_count', 'eligible_count']).map((value) => `<option value="${escapeHtml(value)}" ${existing?.threshold_type === value || (!existing && value === 'matchable_count') ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Threshold value</label>
        <input id="aud-automation-threshold-value" class="form-input" type="number" min="1" value="${existing?.threshold_value || 100}" />
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Action</label>
        <select id="aud-automation-action-type" class="form-select">
          ${(audienceAutomationCatalog.actionTypes || ['create_audience', 'refresh_audience', 'notify_n8n']).map((value) => `<option value="${escapeHtml(value)}" ${existing?.action_type === value || (!existing && value === 'create_audience') ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Cooldown minutes</label>
        <input id="aud-automation-cooldown" class="form-input" type="number" min="1" max="10080" value="${existing?.cooldown_minutes || 60}" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Webhook URL (notify_n8n only)</label>
      <input id="aud-automation-webhook" class="form-input" type="url" value="${escapeHtml(existing?.config?.webhook_url || '')}" />
    </div>
    <label style="display:flex; align-items:center; gap:8px; font-size:0.82rem; margin-top:6px;">
      <input id="aud-automation-enabled" type="checkbox" ${existing?.enabled !== false ? 'checked' : ''} />
      Enabled
    </label>
    <div style="display:flex; gap:8px; margin-top:18px;">
      <button class="btn btn-primary" onclick="saveAudienceAutomationRule(${existing?.id || 'null'})">Save Rule</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>
  `);
}

async function saveAudienceAutomationRule(ruleId = null) {
  try {
    const actionType = document.getElementById('aud-automation-action-type').value;
    const webhookUrl = document.getElementById('aud-automation-webhook').value.trim();
    const payload = {
      id: ruleId || undefined,
      segment_key: document.getElementById('aud-automation-segment').value,
      threshold_type: document.getElementById('aud-automation-threshold-type').value,
      threshold_value: parseInt(document.getElementById('aud-automation-threshold-value').value, 10),
      action_type: actionType,
      cooldown_minutes: parseInt(document.getElementById('aud-automation-cooldown').value, 10),
      enabled: document.getElementById('aud-automation-enabled').checked,
      config: actionType === 'notify_n8n' && webhookUrl ? { webhook_url: webhookUrl } : {},
    };
    await apiPost('/intelligence/audience-automation/rules', payload);
    toast('Audience automation rule saved', 'success');
    closeDrawer();
    loadAudienceAutomation();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function toggleAudienceAutomationRule(ruleId, currentlyEnabled) {
  try {
    const rows = window.__intelAudienceAutomationRows || [];
    const existing = rows.find((row) => Number(row.id) === Number(ruleId));
    if (!existing) return toast('Rule not found', 'error');
    await apiPost('/intelligence/audience-automation/rules', {
      id: existing.id,
      segment_key: existing.segment_key,
      threshold_type: existing.threshold_type,
      threshold_value: existing.threshold_value,
      action_type: existing.action_type,
      cooldown_minutes: existing.cooldown_minutes,
      enabled: !currentlyEnabled,
      config: existing.config || {},
    });
    toast(`Rule ${!currentlyEnabled ? 'enabled' : 'disabled'}`, 'success');
    loadAudienceAutomation();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function deleteAudienceAutomationRule(ruleId) {
  if (!confirmAction('Delete this audience automation rule?')) return;
  try {
    await apiDelete(`/intelligence/audience-automation/rules/${ruleId}`);
    toast('Audience automation rule deleted', 'success');
    loadAudienceAutomation();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function runAudienceAutomationEvaluator() {
  try {
    const allowed = await confirmDegradedDataAction('Audience automation evaluation', [
      { source: 'meta', dataset: 'leads' },
      { source: 'ghl', dataset: 'contacts' },
      { source: 'tracking', dataset: 'recovery' },
    ]);
    if (!allowed) return;
    const res = await apiPost('/intelligence/audience-automation/evaluate-now', {});
    const data = res.data || {};
    toast(`Evaluated ${data.evaluated || 0} rule(s): ${data.triggered || 0} triggered, ${data.blocked || 0} blocked`, 'success');
    loadAudienceAutomation();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function loadIntelDataHealth() {
  const el = document.getElementById('intel-freshness');
  if (!el || !window.DataHealth) return null;
  try {
    intelDataHealth = await window.DataHealth.load({ force: true });
    const summary = window.DataHealth.summarizeHealth(intelDataHealth, [
      { source: 'meta', dataset: 'warehouse_insights' },
      { source: 'meta', dataset: 'leads' },
      { source: 'ghl', dataset: 'contacts' },
      { source: 'tracking', dataset: 'recovery' },
    ]);
    const range = intelDateFrom === intelDateTo ? intelDateFrom : `${intelDateFrom} to ${intelDateTo}`;
    el.innerHTML = window.DataHealth.panel(summary, `Decision Data Health · ${range}`);
    return intelDataHealth;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-warning">Data health unavailable: ${safeErrorMessage(err)}</div>`;
    return null;
  }
}

async function confirmDegradedDataAction(actionLabel, datasets) {
  if (!window.DataHealth) return true;
  const health = intelDataHealth || await window.DataHealth.load({ force: true }).catch(() => null);
  const summary = window.DataHealth.summarizeHealth(health, datasets);
  if (summary.state === 'failed') {
    const reason = (summary.rows || []).find((row) => row.status === 'failed')?.partial_reason || 'upstream sync failed';
    toast(`${actionLabel} blocked: data health is failed (${reason})`, 'error');
    return false;
  }
  if (summary.state === 'partial' || summary.state === 'stale') {
    const details = (summary.rows || [])
      .map((row) => `${row.source}/${row.dataset}: ${row.status}${row.partial_reason ? ` (${row.partial_reason})` : ''}`)
      .join('\n');
    return confirmAction(`${actionLabel} is using ${summary.state} data.\n\n${details || 'No detailed health rows available.'}\n\nContinue anyway?`);
  }
  return true;
}

async function loadIdentityHealth() {
  const el = document.getElementById('intel-identity-health');
  if (!el) return;
  try {
    const res = await apiGet('/intelligence/identity-health');
    const data = res.data || {};
    const confidence = data.confidence || [];
    const collisions = data.collisions || [];
    el.innerHTML = `
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px;">
        ${confidence.map((row) => `<div class="reco-card" style="padding:10px 12px;">
          <div class="kpi-label">${escapeHtml(row.label)}</div>
          <div style="font-weight:600; font-size:1rem;">${fmt(row.count, 'integer')}</div>
          <div class="text-muted" style="font-size:0.72rem; line-height:1.35;">${escapeHtml(row.meaning)}</div>
        </div>`).join('')}
      </div>
      ${collisions.length ? `<div class="alert-banner alert-warning" style="margin-top:10px;">${fmt(collisions.length, 'integer')} identity collision group(s) need review before using low-confidence stitched audiences.</div>
      <div style="overflow:auto; margin-top:10px;"><table>
        <thead><tr><th>Method</th><th>Hash</th><th class="right">Browser IDs</th><th class="right">GHL Contacts</th><th>Last Seen</th></tr></thead>
        <tbody>${collisions.map((row) => `<tr>
          <td>${escapeHtml(row.method)}</td>
          <td class="mono">${escapeHtml(row.identity_hash || '')}</td>
          <td class="right">${fmt(row.client_ids, 'integer')}</td>
          <td class="right">${fmt(row.ghl_contacts, 'integer')}</td>
          <td>${fmtDateTime(row.last_seen_at)}</td>
        </tr>`).join('')}</tbody>
      </table></div>` : '<div class="text-muted" style="font-size:0.78rem; margin-top:10px;">No email/phone identity collisions detected.</div>'}
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function loadIdentityCollisions(status = 'open') {
  const el = document.getElementById('intel-identity-collisions');
  if (!el) return;
  try {
    const res = await apiGet(`/intelligence/identity-collisions?status=${encodeURIComponent(status)}`);
    const rows = res.data || [];
    const metrics = res.metrics || {};
    const readiness = metrics.launch_readiness || {};
    const metricHtml = `
      <div class="reco-card" style="padding:10px 12px; margin-bottom:10px;">
        <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
          <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
            <span class="badge badge-${readiness.ready ? 'active' : 'critical'}">Launch ${escapeHtml(readiness.status || 'unknown')}</span>
            <span class="badge badge-${metrics.urgent_open_groups ? 'critical' : 'active'}">Urgent ${fmt(metrics.urgent_open_groups || 0, 'integer')}</span>
            <span class="badge badge-${metrics.important_open_groups ? 'warning' : 'active'}">Important ${fmt(metrics.important_open_groups || 0, 'integer')}</span>
            <span class="badge badge-low">Open ${fmt(metrics.open_groups || 0, 'integer')}</span>
          </div>
          <div class="text-muted" style="font-size:0.72rem;">Oldest open: ${fmt(metrics.oldest_open_age_days || 0, 'integer')}d · Excluded rows: ${fmt(metrics.rows_excluded_from_sensitive_actions || 0, 'integer')}</div>
        </div>
        ${(readiness.reasons || []).length ? `<div class="text-orange" style="font-size:0.72rem; margin-top:6px;">${readiness.reasons.map((reason) => escapeHtml(reason.replace(/_/g, ' '))).join(' · ')}</div>` : ''}
      </div>
    `;
    if (!rows.length) {
      el.innerHTML = `${metricHtml}<div class="empty-state"><div class="empty-state-text">No ${escapeHtml(status)} collision groups</div></div>`;
      return;
    }
    el.innerHTML = `${metricHtml}<div style="display:grid; gap:10px;">
      ${rows.map((group) => `
        <div class="reco-card" style="padding:12px 14px;">
          <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:600; font-size:0.86rem;">${escapeHtml(group.identity_type.replace('_', ' '))} · <span class="mono">${escapeHtml(group.identity_hash || '')}</span></div>
              <div class="text-muted" style="font-size:0.72rem;">${fmt(group.member_count, 'integer')} members · score ${fmt(group.priority?.score || 0, 'integer')} · ${escapeHtml(group.downstream_effect.replace(/_/g, ' '))}${group.latest_decision ? ` · latest: ${escapeHtml(group.latest_decision.replace(/_/g, ' '))}` : ''}</div>
            </div>
            <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
              <span class="badge badge-${group.priority?.level === 'urgent' ? 'critical' : group.priority?.level === 'important' ? 'warning' : 'low'}">${escapeHtml(group.priority?.level || 'normal')}</span>
              <span class="badge badge-${group.status === 'open' ? 'critical' : group.status === 'ignored' ? 'warning' : 'active'}">${escapeHtml(group.status)}</span>
              <button class="btn btn-sm" onclick="openCollisionResolutionDrawer(${group.id}, 'confirmed_same_person')">Confirm same</button>
              <button class="btn btn-sm" onclick="openCollisionResolutionDrawer(${group.id}, 'keep_separate')">Keep separate</button>
              <button class="btn btn-sm" onclick="openCollisionResolutionDrawer(${group.id}, '${group.status === 'open' ? 'ignore' : 'reopen'}')">${group.status === 'open' ? 'Ignore' : 'Reopen'}</button>
            </div>
          </div>
          <div class="alert-banner alert-${group.priority?.level === 'urgent' ? 'critical' : 'warning'}" style="margin-top:10px;">
            <div style="font-size:0.76rem; line-height:1.45;">
              <strong>Evidence:</strong> ${escapeHtml(group.evidence?.why_collided || 'Multiple identities share one hash.')}
              <br><strong>Restrictions:</strong> ${(group.evidence?.restrictions || []).map((item) => escapeHtml(item.replace(/_/g, ' '))).join(', ')}
              <br><strong>If confirmed:</strong> ${escapeHtml(group.evidence?.confirm_same_person_effect || '')}
            </div>
          </div>
          <div style="overflow:auto; margin-top:10px;">
            <table>
              <thead><tr><th>Client</th><th>GHL Contact</th><th>Source</th><th>Confidence</th><th>Last Seen</th></tr></thead>
              <tbody>${(group.members || []).map((member) => `<tr>
                <td class="mono">${escapeHtml(member.client_id || '—')}</td>
                <td class="mono">${escapeHtml(member.ghl_contact_id || '—')}</td>
                <td>${escapeHtml(member.metadata?.source || member.source || 'visitors')}</td>
                <td><span class="badge badge-${member.confidence === 'high' ? 'active' : member.confidence === 'medium' ? 'warning' : 'critical'}">${escapeHtml(member.confidence)}</span></td>
                <td>${member.metadata?.last_seen_at ? fmtDateTime(member.metadata.last_seen_at) : '—'}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>
          ${group.latest_rationale ? `<div class="text-muted" style="font-size:0.72rem; margin-top:8px;">Rationale: ${escapeHtml(group.latest_rationale)}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function openCollisionResolutionDrawer(groupId, decision) {
  const labels = {
    confirmed_same_person: 'Confirm Same Person',
    keep_separate: 'Keep Separate',
    ignore: 'Ignore For Now',
    reopen: 'Reopen Collision',
  };
  const requiresRationale = decision === 'confirmed_same_person' || decision === 'keep_separate';
  openDrawer(labels[decision] || 'Resolve Collision', `
    <div class="alert-banner alert-warning" style="margin-bottom:12px;">
      This decision changes downstream trust policy for this collision group. It does not mutate visitor or GHL source records.
    </div>
    <div class="form-group">
      <label class="form-label">Decision</label>
      <input class="form-input" value="${escapeHtml((labels[decision] || decision))}" disabled>
    </div>
    <div class="form-group">
      <label class="form-label">Rationale${requiresRationale ? ' required' : ''}</label>
      <textarea id="collision-resolution-rationale" class="form-textarea" rows="4" placeholder="Explain why this decision is safe."></textarea>
    </div>
  `, `
    <button class="btn btn-primary" onclick="submitCollisionResolution(${groupId}, '${escapeJs(decision)}')">Save Decision</button>
    <button class="btn" onclick="closeDrawer()">Cancel</button>
  `);
}

async function submitCollisionResolution(groupId, decision) {
  const rationale = document.getElementById('collision-resolution-rationale')?.value.trim() || '';
  if ((decision === 'confirmed_same_person' || decision === 'keep_separate') && rationale.length < 5) {
    toast('Rationale is required for this decision', 'error');
    return;
  }
  try {
    await apiPost(`/intelligence/identity-collisions/${groupId}/resolve`, { decision, rationale });
    toast('Collision decision saved', 'success');
    closeDrawer();
    await Promise.all([loadIdentityHealth(), loadIdentityCollisions()]);
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function loadLifecycleSummary() {
  const summaryEl = document.getElementById('intel-lifecycle-summary');
  const eventsEl = document.getElementById('intel-lifecycle-events');
  try {
    const res = await apiGet(`/intelligence/lifecycle-summary?${intelRangeQuery()}`);
    const data = res.data || {};
    const stages = data.stages || [];
    const events = data.events || [];
    summaryEl.innerHTML = stages.length ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px;">
      ${stages.map((row) => `<div class="reco-card" style="padding:10px 12px;">
        <div class="kpi-label">${escapeHtml(row.stage.replace(/_/g, ' '))}</div>
        <div style="font-weight:600; font-size:1rem;">${fmt(row.count, 'integer')}</div>
      </div>`).join('')}
    </div>` : '<div class="empty-state"><div class="empty-state-text">No lifecycle stage data yet</div></div>';
    eventsEl.innerHTML = events.length ? `<div style="display:grid; gap:8px;">
      ${events.map((row) => `<div class="reco-card" style="padding:10px 12px;">
        <div class="flex-between" style="gap:10px;"><div>${escapeHtml(row.event_name)}</div><div style="font-weight:600;">${fmt(row.count, 'integer')}</div></div>
      </div>`).join('')}
    </div>` : '<div class="empty-state"><div class="empty-state-text">No lifecycle events yet</div></div>';
  } catch (err) {
    summaryEl.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
    eventsEl.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function loadTouchSequences() {
  const el = document.getElementById('intel-touch-sequences');
  try {
    const res = await apiGet('/intelligence/touch-sequences');
    touchSequenceDefaults = res.defaults || [];
    const sequences = res.data || [];
    touchSequenceCache = sequences;
    if (!sequences.length) {
      const defaults = touchSequenceDefaults.map((step) => `<li>${step.step_number}. ${escapeHtml(step.name)} <span class="text-muted">(${escapeHtml(step.audience_source_type.replace(/_/g, ' '))})</span></li>`).join('');
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-text">No touch sequences configured yet</div>
        <div class="text-muted" style="font-size:0.78rem; margin-top:8px;">Configure the sequence here, then the worker will monitor thresholds, activate the next ad set, and emit the signed n8n webhook.</div>
        <div style="margin-top:10px;"><button class="btn btn-sm btn-primary" onclick="openTouchSequenceEditor()">Create 7-touch sequence</button></div>
        <ol style="margin-top:10px; padding-left:18px; font-size:0.78rem; color:var(--text-secondary);">${defaults}</ol>
      </div>`;
      return;
    }

    el.innerHTML = sequences.map((sequence) => `
      <div class="reco-card" style="margin-bottom:12px;">
        <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
          <div>
            <div class="reco-entity">${escapeHtml(sequence.name)}</div>
            <div class="text-muted" style="font-size:0.74rem;">Threshold default: ${fmt(sequence.threshold_default, 'integer')} · ${sequence.n8n_webhook_url ? 'n8n webhook configured' : 'no webhook'}</div>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span class="badge badge-${sequence.enabled ? 'active' : 'low'}">${sequence.enabled ? 'enabled' : 'disabled'}</span>
            <button class="btn btn-sm" onclick="openTouchSequenceEditor(${sequence.id})">Edit</button>
            <button class="btn btn-sm" onclick="runTouchSequenceMonitor(${sequence.id})">Run</button>
            <button class="btn btn-sm" onclick="deleteTouchSequence(${sequence.id})">Delete</button>
          </div>
        </div>
        <div style="overflow:auto; margin-top:12px;">
          <table>
            <thead><tr><th>#</th><th>Step</th><th>Source</th><th class="right">Size</th><th class="right">Threshold</th><th>Status</th><th>Next</th><th>Target Ad Set</th></tr></thead>
            <tbody>
              ${(sequence.steps || []).map((step) => `
                <tr>
                  <td>${step.step_number}</td>
                  <td class="name-cell">
                    ${escapeHtml(step.name)}
                    <div class="text-muted" style="font-size:0.72rem;">${escapeHtml(step.source_audience_name || step.source_audience_id || step.segment_key || 'unconfigured')}</div>
                    ${step.last_error ? `<div class="text-red" style="font-size:0.72rem;">${escapeHtml(step.last_error)}</div>` : ''}
                  </td>
                  <td>${escapeHtml((step.audience_source_type || '').replace(/_/g, ' '))}</td>
                  <td class="right">${fmt(step.current_size || step.last_size || 0, 'integer')}</td>
                  <td class="right">${fmt(step.threshold_count || 0, 'integer')}</td>
                  <td><span class="badge badge-${step.status === 'triggered' ? 'active' : step.status === 'error' ? 'critical' : step.status === 'ready' ? 'warning' : 'low'}">${escapeHtml((step.status || 'waiting').replace(/_/g, ' '))}</span></td>
                  <td>${step.next_step_name ? `${step.next_step_number}. ${escapeHtml(step.next_step_name)}` : '<span class="text-muted">—</span>'}</td>
                  <td>${step.target_adset_id ? `<span class="mono">${escapeHtml(step.target_adset_id)}</span>` : '<span class="text-muted">—</span>'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${(sequence.events || []).length ? `<div style="margin-top:12px;">
          <div class="text-muted" style="font-size:0.74rem; margin-bottom:6px;">Recent events</div>
          <div style="display:grid; gap:8px;">
            ${(sequence.events || []).slice(0, 5).map(renderTouchSequenceEvent).join('')}
          </div>
        </div>` : ''}
      </div>
    `).join('');
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function runTouchSequenceMonitor(sequenceId) {
  try {
    const allowed = await confirmDegradedDataAction('Touch sequence monitor', [
      { source: 'meta', dataset: 'warehouse_insights' },
      { source: 'meta', dataset: 'entities' },
      { source: 'ghl', dataset: 'contacts' },
    ]);
    if (!allowed) return;
    toast('Running sequence monitor…', 'info');
    const path = sequenceId ? `/intelligence/touch-sequences/${sequenceId}/run-monitor` : '/intelligence/touch-sequences/run-monitor';
    await apiPost(path, {});
    toast('Sequence monitor complete', 'success');
    loadTouchSequences();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

function renderTouchSequenceEvent(event) {
  const payload = event.payload || {};
  const execution = payload.execution || {};
  const webhook = payload.webhook || {};
  const outcome = execution.error
    ? `<span class="badge badge-critical">execution failed</span>`
    : execution.skipped
      ? `<span class="badge badge-low">${escapeHtml(execution.reason || 'skipped')}</span>`
      : execution.activated_adset_id
        ? `<span class="badge badge-active">activated ${escapeHtml(execution.activated_adset_id)}</span>`
        : `<span class="badge badge-low">${escapeHtml(event.event_type)}</span>`;
  const webhookBadge = webhook.error
    ? `<span class="badge badge-warning">webhook error</span>`
    : webhook.delivered
      ? '<span class="badge badge-active">webhook sent</span>'
      : webhook.skipped
        ? '<span class="badge badge-low">webhook skipped</span>'
        : '';
  return `<div class="reco-card" style="padding:10px 12px;">
    <div class="flex-between" style="gap:10px; flex-wrap:wrap;">
      <div>
        <div style="font-size:0.8rem; font-weight:600;">${escapeHtml(event.event_type)} · ${escapeHtml(payload.step_name || 'step')}</div>
        <div class="text-muted" style="font-size:0.72rem;">${fmtDateTime(event.created_at)}${payload.current_size ? ` · size ${fmt(payload.current_size, 'integer')}` : ''}${payload.threshold_count ? ` / ${fmt(payload.threshold_count, 'integer')}` : ''}</div>
      </div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">${outcome}${webhookBadge}</div>
    </div>
    ${execution.error ? `<div class="text-red" style="font-size:0.72rem; margin-top:6px;">${escapeHtml(execution.error)}</div>` : ''}
    ${webhook.error ? `<div class="text-orange" style="font-size:0.72rem; margin-top:6px;">${escapeHtml(webhook.error)}</div>` : ''}
  </div>`;
}

function touchSequenceFormBody(sequence) {
  return `
    <div class="form-group">
      <label class="form-label">Sequence name</label>
      <input id="touch-sequence-name" class="form-input" value="${escapeHtml(sequence.name || '')}" placeholder="7-touch lead-gen sequence">
    </div>
    <div class="form-group">
      <label class="form-label">Description</label>
      <textarea id="touch-sequence-description" class="form-textarea" rows="2" placeholder="Optional operator note">${escapeHtml(sequence.description || '')}</textarea>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Default threshold</label>
        <input id="touch-sequence-threshold" class="form-input" type="number" min="1" value="${escapeHtml(sequence.threshold_default || 3000)}">
      </div>
      <div class="form-group">
        <label class="form-label">Signed n8n webhook URL</label>
        <input id="touch-sequence-webhook" class="form-input" value="${escapeHtml(sequence.n8n_webhook_url || '')}" placeholder="https://n8n.example/webhook/...">
      </div>
    </div>
    <label style="display:flex; gap:8px; align-items:center; margin-bottom:12px;">
      <input id="touch-sequence-enabled" type="checkbox" ${sequence.enabled !== false ? 'checked' : ''}>
      <span>Sequence enabled</span>
    </label>
    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:10px;">
      <div style="font-weight:600;">Steps</div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm" onclick="loadDefaultTouchSequenceSteps()">Load 7-touch template</button>
        <button class="btn btn-sm" onclick="addTouchSequenceStep()">Add Step</button>
      </div>
    </div>
    <div id="touch-sequence-steps">${renderTouchSequenceSteps(sequence.steps || [])}</div>
  `;
}

function renderTouchSequenceSteps(steps) {
  return steps.map((step, index) => `
    <div class="reco-card" style="margin-bottom:10px;" data-touch-sequence-step="${index}">
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Step #</label>
          <input class="form-input" data-ts-field="step_number" type="number" min="1" value="${escapeHtml(step.step_number || (index + 1))}">
        </div>
        <div class="form-group" style="flex:2;">
          <label class="form-label">Step name</label>
          <input class="form-input" data-ts-field="name" value="${escapeHtml(step.name || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Source type</label>
          <select class="form-select" data-ts-field="audience_source_type">
            ${['meta_engagement', 'meta_website', 'first_party_push'].map((value) => `<option value="${value}" ${step.audience_source_type === value ? 'selected' : ''}>${value.replace(/_/g, ' ')}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Meta audience ID</label>
          <input class="form-input" data-ts-field="source_audience_id" value="${escapeHtml(step.source_audience_id || '')}" placeholder="Needed for Meta-native steps">
        </div>
        <div class="form-group">
          <label class="form-label">First-party segment key</label>
          <input class="form-input" data-ts-field="segment_key" value="${escapeHtml(step.segment_key || '')}" placeholder="Needed for first_party_push">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Target ad set ID</label>
          <input class="form-input" data-ts-field="target_adset_id" value="${escapeHtml(step.target_adset_id || '')}" placeholder="Ad set to activate for this step">
        </div>
        <div class="form-group">
          <label class="form-label">Threshold</label>
          <input class="form-input" data-ts-field="threshold_count" type="number" min="1" value="${escapeHtml(step.threshold_count || '')}">
        </div>
        <div class="form-group">
          <label class="form-label">Reduce previous budget to</label>
          <input class="form-input" data-ts-field="reduce_previous_budget_to" type="number" min="0" step="0.01" value="${escapeHtml(step.reduce_previous_budget_to ?? '')}" placeholder="Optional">
        </div>
      </div>
      <div style="display:flex; justify-content:space-between; gap:10px; flex-wrap:wrap; align-items:center;">
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" data-ts-field="enabled" ${step.enabled !== false ? 'checked' : ''}>
          <span>Enabled</span>
        </label>
        <label style="display:flex; gap:8px; align-items:center;">
          <input type="checkbox" data-ts-field="pause_previous_adset" ${step.pause_previous_adset ? 'checked' : ''}>
          <span>Pause previous ad set on trigger</span>
        </label>
        <button class="btn btn-sm" onclick="removeTouchSequenceStep(${index})">Remove</button>
      </div>
    </div>
  `).join('');
}

function getTouchSequenceDraft() {
  const sequence = touchSequenceEditingId
    ? (touchSequenceCache.find((row) => row.id === touchSequenceEditingId) || {})
    : {};
  const baseSteps = sequence.steps && sequence.steps.length
    ? sequence.steps
    : touchSequenceDefaults.length
      ? touchSequenceDefaults
      : [{ step_number: 1, name: 'Touch 1', audience_source_type: 'meta_engagement', enabled: true }];
  const steps = baseSteps.map((step) => ({ ...step }));
  return {
    ...sequence,
    name: sequence.name || '7-touch lead-gen sequence',
    description: sequence.description || '',
    threshold_default: sequence.threshold_default || 3000,
    n8n_webhook_url: sequence.n8n_webhook_url || '',
    enabled: sequence.enabled !== false,
    steps,
  };
}

function openTouchSequenceEditor(sequenceId = null) {
  touchSequenceEditingId = sequenceId;
  const draft = getTouchSequenceDraft();
  openDrawer(sequenceId ? 'Edit Touch Sequence' : 'Create Touch Sequence', touchSequenceFormBody(draft), `
    <button class="btn btn-primary" onclick="saveTouchSequence()">Save Sequence</button>
    <button class="btn" onclick="closeDrawer()">Cancel</button>
  `);
}

function loadDefaultTouchSequenceSteps() {
  document.getElementById('touch-sequence-steps').innerHTML = renderTouchSequenceSteps(touchSequenceDefaults.map((step) => ({ ...step })));
}

function addTouchSequenceStep() {
  const container = document.getElementById('touch-sequence-steps');
  const current = Array.from(container.querySelectorAll('[data-touch-sequence-step]')).length;
  const next = {
    step_number: current + 1,
    name: `Touch ${current + 1}`,
    audience_source_type: 'meta_engagement',
    enabled: true,
  };
  container.insertAdjacentHTML('beforeend', renderTouchSequenceSteps([next]).replace('data-touch-sequence-step="0"', `data-touch-sequence-step="${current}"`));
}

function removeTouchSequenceStep(index) {
  const row = document.querySelector(`[data-touch-sequence-step="${index}"]`);
  row?.remove();
}

function collectTouchSequenceSteps() {
  return Array.from(document.querySelectorAll('[data-touch-sequence-step]')).map((row) => ({
    step_number: parseInt(row.querySelector('[data-ts-field="step_number"]').value, 10),
    name: row.querySelector('[data-ts-field="name"]').value.trim(),
    audience_source_type: row.querySelector('[data-ts-field="audience_source_type"]').value,
    source_audience_id: row.querySelector('[data-ts-field="source_audience_id"]').value.trim(),
    segment_key: row.querySelector('[data-ts-field="segment_key"]').value.trim(),
    target_adset_id: row.querySelector('[data-ts-field="target_adset_id"]').value.trim(),
    threshold_count: row.querySelector('[data-ts-field="threshold_count"]').value.trim(),
    reduce_previous_budget_to: row.querySelector('[data-ts-field="reduce_previous_budget_to"]').value.trim(),
    enabled: row.querySelector('[data-ts-field="enabled"]').checked,
    pause_previous_adset: row.querySelector('[data-ts-field="pause_previous_adset"]').checked,
  }));
}

async function saveTouchSequence() {
  const name = document.getElementById('touch-sequence-name').value.trim();
  const steps = collectTouchSequenceSteps();
  if (!name) {
    toast('Sequence name is required', 'error');
    return;
  }
  if (!steps.length) {
    toast('Add at least one step', 'error');
    return;
  }
  try {
    await apiPost('/intelligence/touch-sequences', {
      id: touchSequenceEditingId || undefined,
      name,
      description: document.getElementById('touch-sequence-description').value.trim(),
      threshold_default: parseInt(document.getElementById('touch-sequence-threshold').value, 10) || 3000,
      n8n_webhook_url: document.getElementById('touch-sequence-webhook').value.trim(),
      enabled: document.getElementById('touch-sequence-enabled').checked,
      steps,
    });
    toast('Touch sequence saved', 'success');
    closeDrawer();
    await loadTouchSequences();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function deleteTouchSequence(sequenceId) {
  if (!confirmAction('Delete this touch sequence?')) return;
  try {
    await apiDelete(`/intelligence/touch-sequences/${sequenceId}`);
    toast('Touch sequence deleted', 'success');
    await loadTouchSequences();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

function intelRangeQuery() {
  return `since=${encodeURIComponent(intelDateFrom)}&until=${encodeURIComponent(intelDateTo)}`;
}

async function loadDecisionQueues() {
  const el = document.getElementById('intel-rules');
  try {
    const res = await apiGet(`/intelligence/rules?${intelRangeQuery()}`);
    const queues = res.queues || {};
    const paging = res.meta?.paging;
    if (paging && paging.truncated) {
      const freshness = document.getElementById('intel-freshness');
      if (freshness) freshness.innerHTML = `<div class="alert-banner alert-warning">Meta returned more data than the safety page limit. Results may be partial.</div>`;
    }
    const order = ['Kill Waste', 'Scale Winners', 'Refresh Creative', 'Needs Tracking Review', 'Watch Closely', 'Needs More Data'];
    el.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:14px;">
        ${order.map(q => queueCard(q, queues[q] || [])).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function queueCard(title, items) {
  return `<div class="reco-card">
    <div class="flex-between mb-sm"><div class="reco-entity">${title}</div><span class="badge badge-low">${items.length}</span></div>
    ${items.length ? items.slice(0, 4).map(item => {
      const rec = item.recommendations[0];
      return `<div style="padding:10px 0; border-top:1px solid var(--border-light);">
        <div style="font-weight:600; font-size:0.82rem; line-height:1.35;">${escapeHtml(item.name)}</div>
        <div class="text-muted" style="font-size:0.74rem; margin-top:3px;">${escapeHtml(rec.reason)}</div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">
          <span class="badge badge-${rec.urgency === 'critical' ? 'critical' : rec.urgency === 'high' ? 'warning' : 'low'}">${rec.urgency}</span>
          <span class="badge badge-low">${item.confidence}</span>
          <span class="badge badge-low">CPA ${item.cpa ? fmt(item.cpa, 'currency') : '—'}</span>
        </div>
      </div>`;
    }).join('') : '<div class="text-muted" style="font-size:0.8rem;">No items</div>'}
  </div>`;
}

async function loadFunnel() {
  const el = document.getElementById('intel-funnel');
  try {
    const res = await apiGet(`/intelligence/first-party-funnel?${intelRangeQuery()}`);
    const rows = (res.data || []).sort((a, b) => b.spend - a.spend).slice(0, 20);
    el.innerHTML = rows.length ? `<div style="overflow:auto;"><table><thead><tr><th>Campaign</th><th class="right">Spend</th><th class="right">Clicks</th><th class="right">Visits</th><th class="right">Leads</th><th class="right">Contacted</th><th class="right">Qualified</th><th class="right">Closed</th><th class="right">ROAS</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="name-cell">${escapeHtml(r.name)}</td><td class="right">${fmt(r.spend,'currency')}</td><td class="right">${fmt(r.link_clicks || r.clicks,'integer')}</td><td class="right">${fmt(r.page_visits || r.landing_page_views,'integer')}</td><td class="right">${fmt(r.leads,'integer')}</td><td class="right">${fmt(r.ghl_contacted,'integer')}</td><td class="right">${fmt(r.qualified,'integer')}</td><td class="right">${fmt(r.closed,'integer')}</td><td class="right">${r.true_roas ? fmt(r.true_roas,'decimal') + 'x' : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-text">No funnel data</div></div>';
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function loadAudienceSegments() {
  const el = document.getElementById('intel-audience-segments');
  try {
    const [res, pushRes] = await Promise.all([
      apiGet(`/intelligence/audience-segments?${intelRangeQuery()}`),
      apiGet('/intelligence/audience-pushes').catch(() => ({ data: [] })),
    ]);
    const rows = res.data || [];
    const pushes = pushRes.data || [];
    const pushBySegment = Object.fromEntries(pushes.map(p => [p.segment_key, p]));
    const statusBadge = {
      healthy: 'active',
      watch: 'warning',
      too_small: 'critical',
      ready_to_build: 'active',
      waiting_for_data: 'low',
    };

    if (!rows.length) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-text">No audience segments yet</div></div>';
      return;
    }

    el.innerHTML = `<div style="overflow:auto;"><table>
      <thead><tr><th>Segment</th><th>Source</th><th class="right">Size</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.map(segment => {
          const source = segment.source === 'meta_custom_audience' ? 'Meta audience' : 'First-party';
          const lifecycle = lifecycleBadge(segment.key);
          const size = formatSegmentSize(segment);
          const status = segment.retargeting_status || 'waiting_for_data';
          const existingPush = pushBySegment[segment.key];
          const isFirstParty = segment.source === 'first_party';
          const canPush = isFirstParty && segment.size >= 100;
          let actions = '';
          if (segment.audience_id) {
            actions = `<button class="btn btn-sm" onclick="copyAudienceId('${escapeJs(segment.audience_id)}')">Copy ID</button><button class="btn btn-sm btn-primary" onclick="useAudienceInAdSet('${escapeJs(segment.audience_id)}','${escapeJs(segment.name)}')">Use</button>`;
          } else if (isFirstParty) {
            if (existingPush && existingPush.meta_audience_id) {
              actions = `<button class="btn btn-sm" onclick="copyAudienceId('${escapeJs(existingPush.meta_audience_id)}')">Copy ID</button>
                <button class="btn btn-sm" onclick="pushSegmentToMeta('${escapeJs(segment.key)}','${escapeJs(segment.name)}')">Refresh</button>
                <button class="btn btn-sm" onclick="toggleAutoRefresh(${existingPush.id}, ${existingPush.auto_refresh})">Auto: ${existingPush.auto_refresh ? 'on' : 'off'}</button>
                <button class="btn btn-sm btn-primary" onclick="useAudienceInAdSet('${escapeJs(existingPush.meta_audience_id)}','${escapeJs(segment.name)}')">Use</button>`;
            } else if (canPush) {
              actions = `<button class="btn btn-sm btn-primary" onclick="pushSegmentToMeta('${escapeJs(segment.key)}','${escapeJs(segment.name)}')">Push to Meta</button>`;
            } else {
              actions = '<span class="text-muted" style="font-size:0.74rem;">Need 100+ identifiers</span>';
            }
          } else {
            actions = '<span class="text-muted" style="font-size:0.74rem;">Needs captured IDs</span>';
          }
          return `<tr>
            <td class="name-cell">
              <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">${escapeHtml(segment.name)}${lifecycle}</div>
              <div class="text-muted" style="font-size:0.72rem; line-height:1.35;">${escapeHtml(segment.description || '')}</div>
              ${existingPush?.meta_audience_id ? `<div class="mono text-muted" style="font-size:0.68rem; margin-top:2px;">→ ${escapeHtml(existingPush.meta_audience_id)}</div>` : ''}
              ${segment.audience_id ? `<div class="mono text-muted" style="font-size:0.68rem; margin-top:2px;">${escapeHtml(segment.audience_id)}</div>` : ''}
            </td>
            <td>${source}</td>
            <td class="right">${size}</td>
            <td><span class="badge badge-${statusBadge[status] || 'low'}">${escapeHtml(status.replace(/_/g, ' '))}</span></td>
            <td><div class="btn-group">${actions}</div></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>`;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function lifecycleBadge(segmentKey) {
  const map = {
    new_lead_contacts: ['info', 'New lead'],
    contacted_contacts: ['warning', 'Contacted'],
    qualified_contacts: ['active', 'Qualified'],
    booked_contacts: ['warning', 'Booked'],
    showed_contacts: ['active', 'Showed'],
    closed_won_contacts: ['active', 'Closed won'],
    closed_lost_contacts: ['critical', 'Closed lost'],
  };
  const badge = map[segmentKey];
  if (!badge) return '';
  return `<span class="badge badge-${badge[0]}" style="font-size:0.68rem;">${escapeHtml(badge[1])}</span>`;
}

async function pushSegmentToMeta(segmentKey, segmentName) {
  try {
    const allowed = await confirmDegradedDataAction('Audience push', [
      { source: 'meta', dataset: 'leads' },
      { source: 'ghl', dataset: 'contacts' },
      { source: 'tracking', dataset: 'recovery' },
    ]);
    if (!allowed) return;
    toast('Uploading to Meta…', 'info');
    const result = await apiPost('/intelligence/audience-push', { segmentKey, segmentName });
    const excluded = result.policy?.excluded_collision_rows || 0;
    const warning = result.policy?.warning ? ` ${result.policy.warning}` : '';
    toast(`Uploaded ${result.uploaded || 0} identifier(s) to Meta audience ${result.meta_audience_id}${excluded ? `; excluded ${excluded} collision row(s)` : ''}.${warning}`, result.policy?.warning ? 'warning' : 'success');
    loadAudienceSegments();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

async function toggleAutoRefresh(pushId, currentlyOn) {
  try {
    await apiPost(`/intelligence/audience-push/${pushId}/auto-refresh`, { enabled: !currentlyOn, hours: 24 });
    toast(`Auto-refresh ${!currentlyOn ? 'enabled' : 'disabled'}`, 'success');
    loadAudienceSegments();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

function formatSegmentSize(segment) {
  const lower = segment.lower_bound || segment.approximate_count_lower_bound || 0;
  const upper = segment.upper_bound || segment.approximate_count_upper_bound || segment.size || 0;
  if (lower && upper && lower !== upper) return `${fmt(lower, 'integer')}–${fmt(upper, 'integer')}`;
  return fmt(segment.size || upper || lower || 0, 'integer');
}

function escapeJs(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ');
}

async function copyAudienceId(audienceId) {
  try {
    await navigator.clipboard.writeText(audienceId);
  } catch (err) {
    const input = document.createElement('input');
    input.value = audienceId;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toast('Audience ID copied', 'success');
}

function useAudienceInAdSet(audienceId, audienceName) {
  localStorage.setItem('pending_custom_audience_ids', audienceId);
  localStorage.setItem('pending_custom_audience_name', audienceName || audienceId);
  toast('Audience saved for the next ad set. Pick a campaign, then create a new ad set.', 'success');
  navigateTo('campaigns');
}

async function loadTrueRoas() {
  const el = document.getElementById('intel-roas');
  try {
    const res = await apiGet(`/intelligence/true-roas?${intelRangeQuery()}`);
    const rows = (res.data || []).slice(0, 12);
    el.innerHTML = rows.length ? `<div style="overflow:auto;"><table><thead><tr><th>Campaign</th><th class="right">Spend</th><th class="right">Meta ROAS</th><th class="right">Your ROAS</th><th class="right">Revenue</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="name-cell">${escapeHtml(r.name)}</td><td class="right">${fmt(r.spend,'currency')}</td><td class="right">${fmt(r.meta_reported_roas,'decimal')}x</td><td class="right">${fmt(r.true_roas,'decimal')}x</td><td class="right">${fmt(r.first_party_revenue,'currency')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-text">No first-party revenue yet</div></div>';
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function loadAudienceHealth() {
  const el = document.getElementById('intel-audiences');
  try {
    const res = await apiGet('/intelligence/audience-health');
    const rows = (res.data || []).slice(0, 15);
    const badge = { healthy: 'active', watch: 'warning', too_small: 'critical' };
    el.innerHTML = rows.length ? `<div style="overflow:auto;"><table><thead><tr><th>Audience</th><th class="right">Size</th><th>Status</th></tr></thead><tbody>
      ${rows.map(a => {
        const lower = a.approximate_count_lower_bound || a.approximate_count || 0;
        const upper = a.approximate_count_upper_bound || a.approximate_count || 0;
        const size = lower && upper && lower !== upper ? `${fmt(lower,'integer')}–${fmt(upper,'integer')}` : fmt(a.approximate_count,'integer');
        return `<tr><td class="name-cell">${escapeHtml(a.name || a.id)}<div class="text-muted" style="font-size:0.7rem;">${escapeHtml(a.subtype || '')}</div></td><td class="right">${size}</td><td><span class="badge badge-${badge[a.status] || 'low'}">${a.status.replace('_',' ')}</span></td></tr>`;
      }).join('')}
    </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-text">No custom audiences returned</div></div>';
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function loadJourneys() {
  const el = document.getElementById('intel-journeys');
  try {
    const res = await apiGet('/intelligence/journey?limit=10');
    const rows = res.data || [];
    el.innerHTML = rows.length ? `<div style="display:grid; gap:10px;">
      ${rows.map(item => {
        const v = item.visitor || {};
        const events = item.events || [];
        return `<div class="reco-card" style="cursor:pointer;" onclick="openContactDrawer('${escapeJs(v.client_id)}')">
          <div class="flex-between" style="gap:12px; align-items:flex-start;">
            <div><div style="font-weight:600;">${escapeHtml(v.ghl_contact_id || v.client_id)}</div><div class="text-muted" style="font-size:0.74rem;">Campaign ${escapeHtml(v.campaign_id || 'unknown')} · ${fmtDateTime(v.first_seen_at)}</div></div>
            <div class="right"><div>${fmt(v.revenue || 0, 'currency')}</div><div class="text-muted" style="font-size:0.74rem;">${escapeHtml(v.current_stage || 'unresolved')}</div></div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
            ${events.slice(-6).map(e => `<span class="badge badge-low">${escapeHtml(e.event_name)} · ${fmtDateTime(e.fired_at)}</span>`).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>` : '<div class="empty-state"><div class="empty-state-text">No tracked journeys yet</div></div>';
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function openContactDrawer(clientId) {
  if (!clientId) return;
  openDrawer('Contact Journey', '<div class="loading">Loading journey</div>');
  try {
    const res = await apiGet(`/intelligence/contact?clientId=${encodeURIComponent(clientId)}`);
    renderContactDrawer(res.data);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`);
  }
}

function renderContactDrawer(detail) {
  if (!detail) {
    setDrawerBody('<div class="empty-state"><div class="empty-state-text">Contact not found</div></div>');
    return;
  }
  const v = detail.visitor || {};
  const events = detail.events || [];
  const ads = detail.ads_seen || [];
  const campaigns = detail.campaigns || {};

  const timeline = events.length ? events.map(e => {
    const campaignName = e.campaign_id && campaigns[e.campaign_id]?.name ? campaigns[e.campaign_id].name : e.campaign_id;
    return `<div style="padding:10px 12px; border-left:2px solid var(--border); margin-left:6px; margin-bottom:6px; position:relative;">
      <div style="position:absolute; left:-7px; top:14px; width:10px; height:10px; border-radius:50%; background:var(--accent);"></div>
      <div style="font-weight:600; font-size:0.82rem;">${escapeHtml(e.event_name)}</div>
      <div class="text-muted" style="font-size:0.72rem;">${fmtDateTime(e.fired_at)}${e.page_url ? ` · ${escapeHtml(e.page_url)}` : ''}</div>
      ${campaignName ? `<div class="text-muted" style="font-size:0.7rem;">Campaign: ${escapeHtml(campaignName)}</div>` : ''}
      ${e.value ? `<div style="font-size:0.76rem; color:var(--green); font-weight:600;">${fmt(e.value, 'currency')}</div>` : ''}
    </div>`;
  }).join('') : '<div class="text-muted" style="font-size:0.82rem;">No events recorded yet.</div>';

  const adsHtml = ads.length ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px;">
    ${ads.map(ad => `<div class="reco-card" style="padding:10px;">
      ${ad.image_url ? `<div style="height:120px; background:var(--bg-elevated); border-radius:6px; overflow:hidden; margin-bottom:8px; display:flex; align-items:center; justify-content:center;"><img src="${ad.image_url}" style="width:100%; height:100%; object-fit:cover;"></div>` : ''}
      <div style="font-weight:600; font-size:0.82rem; line-height:1.35;">${escapeHtml(ad.headline || ad.name || ad.id)}</div>
      ${ad.body ? `<div class="text-muted" style="font-size:0.72rem; margin-top:4px; display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;">${escapeHtml(ad.body)}</div>` : ''}
      ${ad.campaign_id && campaigns[ad.campaign_id]?.name ? `<div class="text-muted" style="font-size:0.7rem; margin-top:6px;">${escapeHtml(campaigns[ad.campaign_id].name)}</div>` : ''}
    </div>`).join('')}
  </div>` : '<div class="text-muted" style="font-size:0.82rem;">No ads attributed yet.</div>';

  setDrawerBody(`
    <div class="mb-md">
      <div style="font-weight:600; font-size:1rem;">${escapeHtml(v.ghl_contact_id || v.client_id)}</div>
      <div class="text-muted" style="font-size:0.76rem;">${escapeHtml(v.current_stage || 'unresolved')} · ${fmtDateTime(v.first_seen_at)}${v.last_seen_at ? ' → ' + fmtDateTime(v.last_seen_at) : ''}</div>
    </div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:10px; margin-bottom:16px;">
      <div><div class="kpi-label">Revenue</div><div style="font-weight:600;">${fmt(v.revenue || 0, 'currency')}</div></div>
      <div><div class="kpi-label">Events</div><div style="font-weight:600;">${events.length}</div></div>
      <div><div class="kpi-label">Ads seen</div><div style="font-weight:600;">${ads.length}</div></div>
      <div><div class="kpi-label">fbclid</div><div style="font-weight:600;">${v.fbclid ? '<span class="text-green">yes</span>' : '—'}</div></div>
    </div>
    <div class="mb-md">
      <div class="reco-entity mb-sm" style="font-size:0.82rem;">Ads seen</div>
      ${adsHtml}
    </div>
    <div>
      <div class="reco-entity mb-sm" style="font-size:0.82rem;">Timeline</div>
      ${timeline}
    </div>
  `);
}

async function loadBreakdowns() {
  const el = document.getElementById('intel-breakdowns');
  try {
    const res = await apiGet(`/intelligence/breakdowns?breakdown=${intelBreakdown}&${intelRangeQuery()}`);
    const rows = (res.data || []).sort((a, b) => (parseFloat(b.spend) || 0) - (parseFloat(a.spend) || 0)).slice(0, 12);
    el.innerHTML = rows.length ? `<div style="overflow:auto;"><table><thead><tr><th>Segment</th><th class="right">Spend</th><th class="right">Results</th><th class="right">CPA</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${escapeHtml(r.segment)}</td><td class="right">${fmt(r.spend,'currency')}</td><td class="right">${fmt(r.results,'integer')}</td><td class="right">${r.cpa ? fmt(r.cpa,'currency') : '—'}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-text">No breakdown data</div></div>';
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function loadCreativeLibrary() {
  const el = document.getElementById('intel-creatives');
  try {
    const res = await apiGet(`/intelligence/creative-library?${intelRangeQuery()}`);
    const rows = (res.data || []).slice(0, 30);
    el.innerHTML = rows.length ? `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:14px;">
      ${rows.map(c => `<div class="reco-card">
        <div style="height:150px; background:var(--bg-elevated); border-radius:6px; display:flex; align-items:center; justify-content:center; overflow:hidden; margin-bottom:10px;">
          ${c.image_url ? `<img src="${c.image_url}" alt="" style="width:100%; height:100%; object-fit:contain;">` : '<span class="text-muted">No preview</span>'}
        </div>
        <div style="font-weight:600; font-size:0.84rem; line-height:1.35;">${escapeHtml(c.headline || 'Untitled creative')}</div>
        <div class="text-muted" style="font-size:0.74rem; margin-top:4px; min-height:32px;">${escapeHtml(truncate(c.primary_text || '', 90))}</div>
        <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-top:12px; font-size:0.78rem;">
          <div><div class="kpi-label">Ads</div><div>${c.ads}</div></div>
          <div><div class="kpi-label">Spend</div><div>${fmt(c.spend,'currency')}</div></div>
          <div><div class="kpi-label">CTR</div><div>${fmt(c.ctr,'percent')}</div></div>
          <div><div class="kpi-label">CPA</div><div>${c.cpa ? fmt(c.cpa,'currency') : '—'}</div></div>
        </div>
      </div>`).join('')}
    </div>` : '<div class="empty-state"><div class="empty-state-text">No creative data</div></div>';
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

async function openTargetSettings() {
  openDrawer('Performance Targets', '<div class="loading">Loading targets</div>');
  try {
    const res = await apiGet('/intelligence/targets');
    const t = res.data.account || res.defaults || {};
    setDrawerBody(`
      <div class="form-group"><label class="form-label">Primary Event</label><select id="target-event" class="form-select">${['Initiate Checkout','Purchase','Lead','Registration'].map(v => `<option value="${v}" ${t.primary_event === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="form-row"><div class="form-group"><label class="form-label">Target CPA</label><input id="target-cpa" class="form-input" type="number" step="0.01" value="${t.target_cpa || 0}"></div><div class="form-group"><label class="form-label">Target ROAS</label><input id="target-roas" class="form-input" type="number" step="0.01" value="${t.target_roas || 0}"></div></div>
      <div class="form-row"><div class="form-group"><label class="form-label">Max Frequency</label><input id="target-frequency" class="form-input" type="number" step="0.1" value="${t.max_frequency || 0}"></div><div class="form-group"><label class="form-label">Min Spend Before Judgment</label><input id="target-min-spend" class="form-input" type="number" step="0.01" value="${t.min_spend_before_judgment || 0}"></div></div>
      <div class="form-group"><label class="form-label">Scale Budget %</label><input id="target-scale" class="form-input" type="number" step="1" value="${t.scale_budget_pct || 20}"></div>
      <div style="display:flex; gap:8px; margin-top:18px;"><button class="btn btn-primary" onclick="saveTargetSettings()">Save Targets</button><button class="btn" onclick="closeDrawer()">Cancel</button></div>
    `);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`);
  }
}

async function saveTargetSettings() {
  const account = {
    primary_event: document.getElementById('target-event').value,
    target_cpa: parseFloat(document.getElementById('target-cpa').value) || 0,
    target_roas: parseFloat(document.getElementById('target-roas').value) || 0,
    max_frequency: parseFloat(document.getElementById('target-frequency').value) || 0,
    min_spend_before_judgment: parseFloat(document.getElementById('target-min-spend').value) || 0,
    scale_budget_pct: parseFloat(document.getElementById('target-scale').value) || 0,
  };
  try {
    await apiPost('/intelligence/targets', { account });
    toast('Targets saved', 'success');
    closeDrawer();
    navigateTo('intelligence');
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

function setIntelPreset(preset) {
  intelPreset = preset;
  if (preset === 'today') { intelDateFrom = todayStr(); intelDateTo = todayStr(); }
  if (preset === 'yesterday') { intelDateFrom = daysAgoStr(1); intelDateTo = daysAgoStr(1); }
  if (preset === '7d') { intelDateFrom = daysAgoStr(7); intelDateTo = daysAgoStr(1); }
  if (preset === '30d') { intelDateFrom = daysAgoStr(30); intelDateTo = daysAgoStr(1); }
  navigateTo('intelligence');
}

function openIntelDateRange() {
  openDrawer('Custom Timeframe', `
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">From</label>
        <input id="intel-custom-from" class="form-input" type="date" value="${escapeHtml(intelDateFrom)}" />
      </div>
      <div class="form-group">
        <label class="form-label">To</label>
        <input id="intel-custom-to" class="form-input" type="date" value="${escapeHtml(intelDateTo)}" />
      </div>
    </div>
    <div style="display:flex; gap:8px; margin-top:18px;">
      <button class="btn btn-primary" onclick="applyIntelDateRange()">Apply</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>
  `);
}

function applyIntelDateRange() {
  const from = document.getElementById('intel-custom-from').value;
  const to = document.getElementById('intel-custom-to').value;
  if (!from || !to || from > to) {
    toast('Choose a valid date range', 'error');
    return;
  }
  intelPreset = 'custom';
  intelDateFrom = from;
  intelDateTo = to;
  closeDrawer();
  navigateTo('intelligence');
}

function setIntelBreakdown(value) {
  intelBreakdown = value;
  loadBreakdowns();
}
