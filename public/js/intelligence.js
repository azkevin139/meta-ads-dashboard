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
let proposedActionTypeFilter = 'all';
let intelShellState = {
  proposals: null,
  revenueCopilot: null,
  trueRoas: null,
  dataHealthSummary: null,
  creativeRows: null,
};
let intelActiveNavTarget = 'intel-action-queue';
let intelSectionState = {
  overview: false,
  proposals: false,
  revenue: false,
  audiences: false,
  touch: false,
  lifecycle: false,
  identity: false,
  performance: false,
  creative: false,
  journeys: false,
};
let intelWorkspaceState = {
  audiences: 'segments',
  performance: 'funnel',
  creative: 'library',
};

async function loadIntelligence(container) {
  container.innerHTML = `
    <div class="intel-shell">
      <div class="intel-live-header mb-md">
        <div id="intel-live-state">
          <div class="intel-eyebrow">Decision Center</div>
          <div class="intel-live-title">Loading account state</div>
          <div class="intel-live-subtitle">Checking health, blockers, and proposed actions.</div>
        </div>
        <div class="intel-live-actions">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm ${intelPreset === 'today' ? 'btn-primary' : ''}" onclick="setIntelPreset('today')">Today</button>
            <button class="btn btn-sm ${intelPreset === 'yesterday' ? 'btn-primary' : ''}" onclick="setIntelPreset('yesterday')">Yesterday</button>
            <button class="btn btn-sm ${intelPreset === '7d' ? 'btn-primary' : ''}" onclick="setIntelPreset('7d')">7d</button>
            <button class="btn btn-sm ${intelPreset === '30d' ? 'btn-primary' : ''}" onclick="setIntelPreset('30d')">30d</button>
            <button class="btn btn-sm ${intelPreset === 'custom' ? 'btn-primary' : ''}" onclick="openIntelDateRange()">Custom</button>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm" id="intel-shell-refresh">Refresh</button>
            <button class="btn btn-sm" onclick="openTargetSettings()">Targets</button>
            <button class="btn btn-sm" data-intel-nav="settings">Settings</button>
          </div>
        </div>
      </div>
      <div id="intel-summary" class="mb-md"><div class="loading">Loading top summary</div></div>
      <div id="intel-action-queue" class="mb-md"><div class="loading">Loading action queue</div></div>
      <div id="intel-decision-pipeline" class="mb-md"><div class="loading">Loading decision pipeline</div></div>
      <div class="intel-nav-shell mb-md">
        <button class="btn btn-sm" data-intel-nav="intel-action-queue">Now</button>
        <button class="btn btn-sm" data-intel-nav="intel-section-revenue">Revenue</button>
        <button class="btn btn-sm" data-intel-nav="intel-section-audiences">Audiences</button>
        <button class="btn btn-sm" data-intel-nav="intel-section-overview">Diagnostics</button>
      </div>

      <section id="intel-section-overview" class="intel-section is-expanded">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Diagnostics</div>
            <div class="intel-section-subtitle">Data health, rule queues, and deeper operating context. Open this after the action queue.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="overview">Collapse</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="overview">
          <div id="intel-freshness" class="mb-md"></div>
          <div id="intel-rules"><div class="loading">Loading decision queues</div></div>
        </div>
      </section>

      <section id="intel-section-proposals" class="intel-section is-expanded">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Action Details</div>
            <div class="intel-section-subtitle">Full proposal list with justification, tradeoff, confidence, and approval history.</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm" id="intel-proposals-filter-proposed">Proposed</button>
            <button class="btn btn-sm" id="intel-proposals-filter-approved">Approved</button>
            <button class="btn btn-sm" id="intel-proposals-filter-dismissed">Dismissed</button>
            <button class="btn btn-sm btn-primary" id="intel-proposals-generate">Generate</button>
            <button class="btn btn-sm intel-section-toggle" data-intel-toggle="proposals">Collapse</button>
          </div>
        </div>
        <div class="intel-section-body" data-intel-section-body="proposals">
          <div id="intel-proposed-actions"><div class="loading">Loading proposed actions</div></div>
        </div>
      </section>

      <section id="intel-section-revenue" class="intel-section is-expanded">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Revenue Copilot</div>
            <div class="intel-section-subtitle">Lead response, pipeline leakage, conversation health, and revenue feedback.</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm" id="intel-revenue-copilot-refresh">Refresh</button>
            <button class="btn btn-sm intel-section-toggle" data-intel-toggle="revenue">Collapse</button>
          </div>
        </div>
        <div class="intel-section-body" data-intel-section-body="revenue">
          <div id="intel-revenue-copilot"><div class="loading">Loading revenue copilot</div></div>
        </div>
      </section>

      <section id="intel-section-audiences" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Audiences</div>
            <div class="intel-section-subtitle">Segment readiness, automation thresholds, and touch progression.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="audiences">Expand</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="audiences">
          <div class="intel-workspace-tabs mb-md">
            <button class="btn btn-sm" data-intel-workspace="audiences" data-intel-workspace-tab="segments">Segments</button>
            <button class="btn btn-sm" data-intel-workspace="audiences" data-intel-workspace-tab="automation">Automation</button>
          </div>
          <div data-intel-workspace-panel="audiences:segments">
            <div class="table-container mb-md">
              <div class="table-header">
                <span class="table-title">Audience Segments</span><span class="badge badge-active">RETARGETING</span>
              </div>
              <div id="intel-audience-segments"><div class="loading">Loading audience segments</div></div>
            </div>
          </div>
          <div data-intel-workspace-panel="audiences:automation">
            <div class="table-container">
              <div class="table-header">
                <span class="table-title">Audience Automation</span>
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                  <button class="btn btn-sm" onclick="openAudienceAutomationEditor()">Create Rule</button>
                  <button class="btn btn-sm" onclick="runAudienceAutomationEvaluator()">Run Evaluator</button>
                </div>
              </div>
              <div id="intel-audience-automation"><div class="loading">Loading audience automation</div></div>
            </div>
          </div>
        </div>
      </section>

      <section id="intel-section-touch" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Touch Sequences</div>
            <div class="intel-section-subtitle">Audience-size triggered retargeting sequences and next-touch control.</div>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn btn-sm" onclick="openTouchSequenceEditor()">Create Sequence</button>
            <button class="btn btn-sm" onclick="runTouchSequenceMonitor()">Run Monitor</button>
            <button class="btn btn-sm intel-section-toggle" data-intel-toggle="touch">Expand</button>
          </div>
        </div>
        <div class="intel-section-body" data-intel-section-body="touch">
          <div id="intel-touch-sequences"><div class="loading">Loading touch sequences</div></div>
        </div>
      </section>

      <section id="intel-section-lifecycle" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Lifecycle</div>
            <div class="intel-section-subtitle">Stage progression, lifecycle events, and CRM-side movement.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="lifecycle">Expand</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="lifecycle">
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
        </div>
      </section>

      <section id="intel-section-identity" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Identity Integrity</div>
            <div class="intel-section-subtitle">Confidence, collisions, and trust boundaries for stitched contacts.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="identity">Expand</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="identity">
          <div class="table-container mb-md">
            <div class="table-header"><span class="table-title">Identity Stitching</span><span class="badge badge-warning">CONFIDENCE</span></div>
            <div id="intel-identity-health"><div class="loading">Loading identity health</div></div>
          </div>
          <div class="table-container">
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
        </div>
      </section>

      <section id="intel-section-performance" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Performance</div>
            <div class="intel-section-subtitle">Funnels, breakdowns, true ROAS, and audience health.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="performance">Expand</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="performance">
          <div class="intel-workspace-tabs mb-md">
            <button class="btn btn-sm" data-intel-workspace="performance" data-intel-workspace-tab="funnel">Funnel</button>
            <button class="btn btn-sm" data-intel-workspace="performance" data-intel-workspace-tab="roas">ROAS</button>
            <button class="btn btn-sm" data-intel-workspace="performance" data-intel-workspace-tab="audience-health">Audience Health</button>
            <button class="btn btn-sm" data-intel-workspace="performance" data-intel-workspace-tab="breakdowns">Breakdowns</button>
          </div>
          <div data-intel-workspace-panel="performance:funnel">
            <div class="table-container">
              <div class="table-header"><span class="table-title">First-Party Funnel</span><span class="badge badge-active">META + TRACKING</span></div>
              <div id="intel-funnel"><div class="loading">Loading funnel</div></div>
            </div>
          </div>
          <div data-intel-workspace-panel="performance:roas">
            <div class="table-container">
              <div class="table-header"><span class="table-title">True ROAS</span><span class="badge badge-active">FIRST PARTY</span></div>
              <div id="intel-roas"><div class="loading">Loading ROAS</div></div>
            </div>
          </div>
          <div data-intel-workspace-panel="performance:audience-health">
            <div class="table-container">
              <div class="table-header"><span class="table-title">Audience Health</span><span class="badge badge-active">META</span></div>
              <div id="intel-audiences"><div class="loading">Loading audiences</div></div>
            </div>
          </div>
          <div data-intel-workspace-panel="performance:breakdowns">
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
        </div>
      </section>

      <section id="intel-section-creative" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Creative</div>
            <div class="intel-section-subtitle">Larger creative cards with metrics visible on first scan.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="creative">Expand</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="creative">
          <div class="intel-workspace-tabs mb-md">
            <button class="btn btn-sm" data-intel-workspace="creative" data-intel-workspace-tab="library">Library</button>
            <button class="btn btn-sm" data-intel-workspace="creative" data-intel-workspace-tab="winners">Winners</button>
          </div>
          <div class="table-container">
            <div class="table-header"><span class="table-title">Creative Workspace</span><span class="badge badge-active">GROUPED</span></div>
            <div id="intel-creatives"><div class="loading">Loading creatives</div></div>
          </div>
        </div>
      </section>

      <section id="intel-section-journeys" class="intel-section">
        <div class="intel-section-header">
          <div>
            <div class="intel-section-title">Journeys</div>
            <div class="intel-section-subtitle">Recent visitor journeys and contact-level timelines.</div>
          </div>
          <button class="btn btn-sm intel-section-toggle" data-intel-toggle="journeys">Expand</button>
        </div>
        <div class="intel-section-body" data-intel-section-body="journeys">
          <div class="table-container">
            <div class="table-header"><span class="table-title">Recent Journeys</span><span class="badge badge-active">TRACKING</span></div>
            <div id="intel-journeys"><div class="loading">Loading journeys</div></div>
          </div>
        </div>
      </section>
    </div>
  `;
  const revenueRefreshButton = document.getElementById('intel-revenue-copilot-refresh');
  if (revenueRefreshButton) revenueRefreshButton.onclick = () => loadRevenueCopilot(true);
  const shellRefreshButton = document.getElementById('intel-shell-refresh');
  if (shellRefreshButton) shellRefreshButton.onclick = () => loadIntelligence(container);
  const generateProposalsButton = document.getElementById('intel-proposals-generate');
  if (generateProposalsButton) generateProposalsButton.onclick = () => generateProposedActions();
  const proposedFilterButton = document.getElementById('intel-proposals-filter-proposed');
  if (proposedFilterButton) proposedFilterButton.onclick = () => setProposalFilter('proposed');
  const approvedFilterButton = document.getElementById('intel-proposals-filter-approved');
  if (approvedFilterButton) approvedFilterButton.onclick = () => setProposalFilter('approved');
  const dismissedFilterButton = document.getElementById('intel-proposals-filter-dismissed');
  if (dismissedFilterButton) dismissedFilterButton.onclick = () => setProposalFilter('dismissed');
  syncIntelProposalFilterButtons();
  document.querySelectorAll('[data-intel-nav]').forEach((button) => {
    button.onclick = () => handleIntelNav(button.dataset.intelNav);
  });
  document.querySelectorAll('[data-intel-toggle]').forEach((button) => {
    button.onclick = () => toggleIntelSection(button.dataset.intelToggle);
  });
  document.querySelectorAll('[data-intel-workspace][data-intel-workspace-tab]').forEach((button) => {
    button.onclick = () => setIntelWorkspaceTab(button.dataset.intelWorkspace, button.dataset.intelWorkspaceTab);
  });
  applyIntelSectionState();
  syncIntelNavButtons();
  applyIntelWorkspaceState();
  bindIntelSectionObserver();
  renderIntelSummary();

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

function handleIntelNav(targetId) {
  if (targetId === 'settings') {
    navigateTo('settings');
    return;
  }
  intelActiveNavTarget = targetId;
  const sectionKey = String(targetId || '').replace('intel-section-', '');
  if (Object.prototype.hasOwnProperty.call(intelSectionState, sectionKey)) {
    intelSectionState[sectionKey] = true;
    applyIntelSectionState();
  }
  syncIntelNavButtons();
  const target = document.getElementById(targetId);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleIntelSection(key) {
  if (!Object.prototype.hasOwnProperty.call(intelSectionState, key)) return;
  intelSectionState[key] = !intelSectionState[key];
  applyIntelSectionState();
}

function applyIntelSectionState() {
  Object.entries(intelSectionState).forEach(([key, expanded]) => {
    const section = document.getElementById(`intel-section-${key}`);
    const body = document.querySelector(`[data-intel-section-body="${key}"]`);
    const button = document.querySelector(`[data-intel-toggle="${key}"]`);
    if (section) section.classList.toggle('is-expanded', expanded);
    if (body) body.style.display = expanded ? '' : 'none';
    if (button) button.textContent = expanded ? 'Collapse' : 'Expand';
  });
}

function syncIntelNavButtons() {
  document.querySelectorAll('[data-intel-nav]').forEach((button) => {
    const target = button.dataset.intelNav;
    button.classList.toggle('btn-primary', target !== 'settings' && target === intelActiveNavTarget);
  });
}

function bindIntelSectionObserver() {
  if (!('IntersectionObserver' in window)) return;
  const sections = Array.from(document.querySelectorAll('.intel-section[id]'));
  if (!sections.length) return;
  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    if (!visible.length) return;
    const nextTarget = visible[0].target.id;
    if (nextTarget && nextTarget !== intelActiveNavTarget) {
      intelActiveNavTarget = nextTarget;
      syncIntelNavButtons();
    }
  }, {
    root: null,
    rootMargin: '-96px 0px -55% 0px',
    threshold: [0.15, 0.35, 0.6],
  });
  sections.forEach((section) => observer.observe(section));
}

function syncIntelProposalFilterButtons() {
  const filters = ['proposed', 'approved', 'dismissed'];
  filters.forEach((status) => {
    const button = document.getElementById(`intel-proposals-filter-${status}`);
    if (!button) return;
    button.classList.toggle('btn-primary', proposedActionFilter === status);
  });
}

function proposalTypeLabel(type) {
  return String(type || 'general').replace(/_/g, ' ');
}

function proposalCanGenerateDraft(row) {
  const action = row?.payload?.recommended_action || {};
  return row?.proposal_type === 'lead_followup' || /followup|message|outreach/i.test(String(action.kind || ''));
}

function proposalTargetActions(row) {
  const action = row?.payload?.recommended_action || {};
  const targetScope = String(action.target_scope || '').toLowerCase();
  const targetIds = Array.isArray(action.target_ids) ? action.target_ids.filter(Boolean) : [];
  const buttons = [];
  if ((targetScope.includes('campaign') || row?.proposal_type === 'campaign_change' || row?.proposal_type === 'budget_change') && targetIds[0]) {
    buttons.push(`<button class="btn btn-sm" onclick="openProposalTargetCampaign('${escapeJs(targetIds[0])}')">Open Campaign</button>`);
  }
  if (targetScope.includes('adset') && targetIds[0]) {
    buttons.push(`<button class="btn btn-sm" onclick="openProposalTargetAdSet('${escapeJs(targetIds[0])}')">Open Ad Set</button>`);
  }
  if (targetScope.includes('audience') && targetIds[0]) {
    buttons.push(`<button class="btn btn-sm" onclick="copyAudienceId('${escapeJs(targetIds[0])}')">Copy Audience ID</button>`);
  }
  return buttons.join('');
}

function getProposalApprovalPreview(row) {
  const action = row?.payload?.recommended_action || {};
  const type = row?.proposal_type || 'general';
  const consequences = [];
  if (type === 'lead_followup' || /followup|message|outreach/i.test(String(action.kind || ''))) {
    consequences.push('Marks this recommendation as approved for operator follow-up.');
    consequences.push('Does not send any CRM message yet. Execution remains manual.');
    consequences.push('Keeps the proposal visible in approved history for accountability.');
  } else if (type === 'campaign_change' || type === 'budget_change') {
    consequences.push('Marks the ad-change recommendation as approved for operator execution.');
    consequences.push('Does not change campaign budget or status automatically.');
    consequences.push('Keeps the change in approved history so operators can track whether it was actually applied.');
  } else {
    consequences.push('Marks this recommendation as approved for human execution.');
    consequences.push('Does not trigger downstream systems automatically in the current read-only phase.');
  }
  return consequences;
}

function setIntelWorkspaceTab(workspace, tab) {
  if (!workspace || !tab) return;
  intelWorkspaceState[workspace] = tab;
  applyIntelWorkspaceState();
  if (workspace === 'creative') loadCreativeLibrary();
}

function applyIntelWorkspaceState() {
  Object.entries(intelWorkspaceState).forEach(([workspace, activeTab]) => {
    document.querySelectorAll(`[data-intel-workspace="${workspace}"][data-intel-workspace-tab]`).forEach((button) => {
      button.classList.toggle('btn-primary', button.dataset.intelWorkspaceTab === activeTab);
    });
    document.querySelectorAll(`[data-intel-workspace-panel^="${workspace}:"]`).forEach((panel) => {
      panel.style.display = panel.dataset.intelWorkspacePanel === `${workspace}:${activeTab}` ? '' : 'none';
    });
  });
}

function sumBy(rows, key) {
  return (rows || []).reduce((sum, row) => sum + (Number(row?.[key]) || 0), 0);
}

function renderIntelSummary() {
  const el = document.getElementById('intel-summary');
  if (!el) return;
  const health = intelShellState.dataHealthSummary || { state: 'unavailable', label: 'loading', rows: [] };
  const revenue = intelShellState.revenueCopilot || {};
  const lead = revenue.lead_response_audit?.metrics || {};
  const topCampaigns = revenue.revenue_feedback_summary?.metrics?.top_campaigns || [];
  const trueRoasRows = intelShellState.trueRoas || [];
  const proposalRows = intelShellState.proposals?.rows || [];
  const latestProposalRun = intelShellState.proposals?.latestRun || null;
  const spend = sumBy(trueRoasRows, 'spend');
  const firstPartyRevenue = sumBy(trueRoasRows, 'first_party_revenue');
  const booked = sumBy(topCampaigns, 'booked');
  const urgentActions = proposalRows.filter((row) => row.status === 'proposed' && ['critical', 'high'].includes(row.priority)).length;
  const openActions = proposalRows.filter((row) => row.status === 'proposed').length;
  const trueRoas = spend > 0 ? Number((firstPartyRevenue / spend).toFixed(2)) : null;
  const blockerCount = (health.rows || []).filter((row) => row.status === 'failed' || row.status === 'partial' || row.status === 'skipped').length;
  const latestSync = (health.rows || [])
    .map((row) => row.last_successful_at || row.last_attempted_at)
    .filter(Boolean)
    .sort()
    .pop();
  const lastSyncLabel = latestSync ? fmtDateTime(latestSync) : 'No sync recorded';
  const statusLabel = health.state === 'fresh' ? 'Healthy'
    : health.state === 'partial' || health.state === 'stale' ? 'Partial'
      : health.state === 'failed' ? 'Blocked'
        : 'Checking';
  const stateBadge = health.state === 'fresh' ? 'active'
    : health.state === 'partial' || health.state === 'stale' ? 'warning'
      : health.state === 'failed' ? 'critical'
        : 'low';
  const primaryIssue = latestProposalRun?.reason_code === 'openai_auth_failed'
    ? 'AI proposal generation blocked by OpenAI backend auth'
    : (health.rows || []).find((row) => row.status === 'failed' || row.status === 'partial' || row.status === 'skipped')?.partial_reason
      || (urgentActions ? `${urgentActions} urgent action${urgentActions === 1 ? '' : 's'} waiting` : 'No urgent blocker detected');

  const topAlert = latestProposalRun?.reason_code === 'openai_auth_failed'
    ? `<div class="alert-banner alert-critical" style="margin-top:12px;">AI proposal generation is blocked by backend OpenAI auth. Fix the platform OpenAI key in Admin before using Proposed Actions.</div>`
    : urgentActions > 0
      ? `<div class="alert-banner alert-warning" style="margin-top:12px;">${fmt(urgentActions, 'integer')} urgent proposed action${urgentActions === 1 ? '' : 's'} need review before traffic or retargeting changes.</div>`
      : '';

  const liveState = document.getElementById('intel-live-state');
  if (liveState) {
    liveState.innerHTML = `
      <div class="intel-eyebrow">Decision Center</div>
      <div class="intel-live-title">Status: ${escapeHtml(statusLabel)}</div>
      <div class="intel-live-subtitle">${escapeHtml(primaryIssue)} · Last sync ${escapeHtml(lastSyncLabel)}</div>
    `;
  }

  el.innerHTML = `
    <div class="intel-summary-shell">
      <div class="intel-summary-header">
        <div>
          <div class="intel-section-title">Account Status</div>
          <div class="intel-section-subtitle">Health, blockers, and current operating state before any drilldown.</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <span class="badge badge-${stateBadge}">${escapeHtml(statusLabel)}</span>
          <span class="badge badge-${urgentActions ? 'warning' : 'active'}">${fmt(openActions, 'integer')} open actions</span>
          <span class="badge badge-${blockerCount ? 'critical' : 'low'}">${fmt(blockerCount, 'integer')} blockers</span>
        </div>
      </div>
      <div class="intel-status-strip">
        <div><div class="intel-summary-label">Primary issue</div><div class="intel-status-value">${escapeHtml(primaryIssue)}</div></div>
        <div><div class="intel-summary-label">Last sync</div><div class="intel-status-value">${escapeHtml(lastSyncLabel)}</div></div>
        <div><div class="intel-summary-label">Urgent actions</div><div class="intel-status-value">${fmt(urgentActions, 'integer')}</div></div>
        <div><div class="intel-summary-label">Active blockers</div><div class="intel-status-value">${fmt(blockerCount, 'integer')}</div></div>
      </div>
      <div class="intel-summary-grid intel-delta-grid">
        <div class="intel-summary-card">
          <div class="intel-summary-label">Spend</div>
          <div class="intel-summary-value">${spend ? fmt(spend, 'currency') : '—'}</div>
          <div class="intel-summary-note">Current selected range</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">True ROAS</div>
          <div class="intel-summary-value">${trueRoas === null ? '—' : `${fmt(trueRoas, 'decimal')}x`}</div>
          <div class="intel-summary-note">First-party revenue / spend</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">Booked Calls</div>
          <div class="intel-summary-value">${fmt(booked, 'integer')}</div>
          <div class="intel-summary-note">From Revenue Copilot source mix</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">Uncontacted Leads</div>
          <div class="intel-summary-value">${fmt(lead.zero_response_count || 0, 'integer')}</div>
          <div class="intel-summary-note">${fmt(lead.new_leads_24h || 0, 'integer')} new leads in 24h</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">Stale New Leads</div>
          <div class="intel-summary-value">${fmt(lead.stale_new_leads || 0, 'integer')}</div>
          <div class="intel-summary-note">Leads aging without enough follow-up</div>
        </div>
      </div>
      ${topAlert}
    </div>
  `;
  renderIntelActionQueue();
}

function actionCard({ group, title, impact, blocker, nextStep, cta, targetId, badge = 'warning' }) {
  return `
    <div class="intel-action-card">
      <div class="intel-action-group">${escapeHtml(group)}</div>
      <div class="intel-action-title">${escapeHtml(title)}</div>
      <div class="intel-action-impact">${escapeHtml(impact)}</div>
      <div class="intel-action-meta">
        <span class="badge badge-${blocker ? 'critical' : badge}">${blocker ? 'Blocker' : 'Action'}</span>
        <span class="text-muted">${escapeHtml(nextStep)}</span>
      </div>
      <button class="btn btn-sm ${blocker ? 'btn-primary' : ''}" data-intel-nav="${escapeHtml(targetId)}">${escapeHtml(cta)}</button>
    </div>
  `;
}

function renderIntelActionQueue() {
  const el = document.getElementById('intel-action-queue');
  if (!el) return;
  const proposals = (intelShellState.proposals?.rows || []).filter((row) => row.status === 'proposed');
  const health = intelShellState.dataHealthSummary || { rows: [] };
  const latestRun = intelShellState.proposals?.latestRun || null;
  const revenue = intelShellState.revenueCopilot || {};
  const lead = revenue.lead_response_audit?.metrics || {};
  const actions = [];

  if (latestRun?.reason_code === 'openai_auth_failed') {
    actions.push({
      group: 'Blocked system',
      title: 'AI proposal generation blocked',
      impact: 'New proposed actions cannot be generated until the backend OpenAI key is fixed.',
      blocker: true,
      nextStep: 'Open Admin and repair AI Backend Status.',
      cta: 'Fix AI backend',
      targetId: 'settings',
      rank: 1,
    });
  }

  (health.rows || []).filter((row) => ['failed', 'partial', 'skipped'].includes(row.status)).slice(0, 2).forEach((row) => {
    actions.push({
      group: 'Data blocker',
      title: `${row.source}/${row.dataset} is ${row.status}`,
      impact: 'Operators may act on stale, partial, or unavailable data.',
      blocker: row.status === 'failed',
      nextStep: row.partial_reason ? row.partial_reason.replace(/_/g, ' ') : 'Review data health diagnostics.',
      cta: 'Open diagnostics',
      targetId: 'intel-section-overview',
      rank: row.status === 'failed' ? 2 : 4,
    });
  });

  proposals
    .filter((row) => ['critical', 'high'].includes(row.priority))
    .slice(0, 3)
    .forEach((row) => {
      actions.push({
        group: row.priority === 'critical' ? 'Urgent' : 'Needs approval',
        title: row.title || proposalTypeLabel(row.proposal_type),
        impact: row.expected_impact || row.why || 'This proposed action needs operator review.',
        blocker: false,
        nextStep: 'Review the recommendation and approve, dismiss, or generate a draft.',
        cta: 'Review action',
        targetId: 'intel-section-proposals',
        rank: row.priority === 'critical' ? 3 : 5,
      });
    });

  if ((lead.zero_response_count || 0) > 0) {
    actions.push({
      group: 'Revenue leak',
      title: `${fmt(lead.zero_response_count, 'integer')} leads have no response`,
      impact: 'Speed-to-lead decay can reduce booked calls and reply rate.',
      blocker: false,
      nextStep: 'Review Revenue Copilot lead response audit.',
      cta: 'Open revenue',
      targetId: 'intel-section-revenue',
      rank: 6,
    });
  }

  const finalActions = actions.sort((a, b) => a.rank - b.rank).slice(0, 6);
  el.innerHTML = `
    <div class="intel-action-queue">
      <div class="intel-summary-header">
        <div>
          <div class="intel-section-title">Now</div>
          <div class="intel-section-subtitle">The next operator actions, ranked by blocker, revenue impact, and approval need.</div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="btn btn-sm btn-primary" data-intel-nav="intel-section-proposals" data-ux-track="decision_now_action_details">Open action details</button>
          <button class="btn btn-sm" id="intel-action-generate" data-ux-track="decision_now_generate">Generate</button>
        </div>
      </div>
      ${finalActions.length
        ? `<div class="intel-action-grid">${finalActions.map(actionCard).join('')}</div>`
        : `<div class="empty-state" style="padding:28px 12px;"><div class="empty-state-text">No urgent actions. Check Revenue, Audiences, or Diagnostics when you need detail.</div></div>`}
    </div>
  `;
  el.querySelectorAll('[data-intel-nav]').forEach((button) => {
    button.onclick = () => handleIntelNav(button.dataset.intelNav);
  });
  const generate = document.getElementById('intel-action-generate');
  if (generate) generate.onclick = () => generateProposedActions();
  renderDecisionPipeline();
}

function renderDecisionPipeline() {
  const el = document.getElementById('intel-decision-pipeline');
  if (!el) return;
  const rows = (intelShellState.proposals?.rows || []);
  const counts = {
    detected: rows.length,
    evidence: rows.filter((row) => (row.payload?.evidence || []).length || (row.payload?.data_used || []).length).length,
    recommendation: rows.filter((row) => row.status === 'proposed').length,
    approval: rows.filter((row) => row.status === 'approved').length,
    applied: rows.filter((row) => row.status === 'executed').length,
    monitoring: rows.filter((row) => row.status === 'dismissed' || row.status === 'approved').length,
  };
  const stages = [
    ['Detected issue', counts.detected],
    ['Evidence', counts.evidence],
    ['Recommendation', counts.recommendation],
    ['Approval', counts.approval],
    ['Applied', counts.applied],
    ['Monitoring', counts.monitoring],
  ];
  const activeIndex = counts.recommendation ? 2 : counts.approval ? 3 : counts.detected ? 1 : 0;
  el.innerHTML = `
    <div class="decision-pipeline-card">
      <div class="decision-pipeline-header">
        <div>
          <div class="intel-eyebrow">Decision Pipeline</div>
          <div class="decision-pipeline-title">Detected issue → Evidence → Recommendation → Approval → Applied → Monitoring</div>
        </div>
        <button class="btn btn-sm" data-intel-nav="intel-section-proposals">Open recommendations</button>
      </div>
      <div class="decision-pipeline-steps">
        ${stages.map(([label, count], index) => `
          <div class="decision-step ${index === activeIndex ? 'is-active' : ''}">
            <span>${escapeHtml(label)}</span>
            <strong>${fmt(count, 'integer')}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  el.querySelectorAll('[data-intel-nav]').forEach((button) => {
    button.onclick = () => handleIntelNav(button.dataset.intelNav);
  });
}

async function loadRevenueCopilot(forceRefresh = false) {
  const el = document.getElementById('intel-revenue-copilot');
  if (!el) return;
  try {
    const res = await apiGet(`/intelligence/revenue-copilot${forceRefresh ? '?refresh=1' : ''}`);
    const data = res.data || {};
    intelShellState.revenueCopilot = data;
    renderIntelSummary();
    const mcp = data.mcp_status || {};
    const lead = data.lead_response_audit || {};
    const pipe = data.pipeline_leakage_audit || {};
    const convo = data.conversation_health || {};
    const revenue = data.revenue_feedback_summary || {};
    const topCampaigns = revenue.metrics?.top_campaigns || [];
    const stageCounts = pipe.metrics?.stage_counts || [];
    const leadMetrics = lead.metrics || {};
    const pipelineMetrics = pipe.metrics || {};
    const convoMetrics = convo.metrics || {};
    el.innerHTML = `
      <div class="intel-metrics-grid">
        <div class="intel-summary-card">
          <div class="intel-summary-label">New Leads 24h</div>
          <div class="intel-summary-value">${fmt(leadMetrics.new_leads_24h || 0, 'integer')}</div>
          <div class="intel-summary-note">Lead flow entering the CRM in the current window.</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">Zero Response</div>
          <div class="intel-summary-value">${fmt(leadMetrics.zero_response_count || 0, 'integer')}</div>
          <div class="intel-summary-note">Leads with no outbound follow-up yet.</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">Unread Conversations</div>
          <div class="intel-summary-value">${convoMetrics.unread_conversations === null || convoMetrics.unread_conversations === undefined ? '—' : fmt(convoMetrics.unread_conversations, 'integer')}</div>
          <div class="intel-summary-note">Sampled unread CRM threads from MCP.</div>
        </div>
        <div class="intel-summary-card">
          <div class="intel-summary-label">Pipeline Count</div>
          <div class="intel-summary-value">${pipelineMetrics.pipeline_count === null || pipelineMetrics.pipeline_count === undefined ? '—' : fmt(pipelineMetrics.pipeline_count, 'integer')}</div>
          <div class="intel-summary-note">Number of MCP pipelines visible to this account.</div>
        </div>
      </div>
      <div class="intel-copilot-layout">
        <div class="intel-copilot-main">
          <div class="table-container">
            <div class="table-header"><span class="table-title">Lead Response Audit</span><span class="badge badge-warning">SPEED TO LEAD</span></div>
            <div style="overflow:auto;"><table>
              <thead><tr><th>Metric</th><th class="right">Value</th></tr></thead>
              <tbody>
                <tr><td>New leads 24h</td><td class="right">${fmt(leadMetrics.new_leads_24h || 0, 'integer')}</td></tr>
                <tr><td>Zero response</td><td class="right">${fmt(leadMetrics.zero_response_count || 0, 'integer')}</td></tr>
                <tr><td>Stale new leads</td><td class="right">${fmt(leadMetrics.stale_new_leads || 0, 'integer')}</td></tr>
                <tr><td>Avg first response</td><td class="right">${leadMetrics.avg_first_response_minutes === null || leadMetrics.avg_first_response_minutes === undefined ? '—' : `${fmt(leadMetrics.avg_first_response_minutes, 'integer')}m`}</td></tr>
                <tr><td>Contacted within 15m</td><td class="right">${fmt(leadMetrics.contacted_within_15m_pct || 0, 'integer')}%</td></tr>
                <tr><td>Contacted within 60m</td><td class="right">${fmt(leadMetrics.contacted_within_60m_pct || 0, 'integer')}%</td></tr>
              </tbody>
            </table></div>
          </div>
          <div class="intel-copilot-two-up">
            <div class="table-container">
              <div class="table-header"><span class="table-title">Pipeline Leakage</span><span class="badge badge-warning">STUCK</span></div>
              <div style="overflow:auto;"><table>
                <thead><tr><th>Leak</th><th class="right">Value</th></tr></thead>
                <tbody>
                  <tr><td>New lead >24h</td><td class="right">${fmt(pipelineMetrics.stuck?.new_lead_over_24h || 0, 'integer')}</td></tr>
                  <tr><td>Contacted >72h</td><td class="right">${fmt(pipelineMetrics.stuck?.contacted_over_72h || 0, 'integer')}</td></tr>
                  <tr><td>Qualified >7d</td><td class="right">${fmt(pipelineMetrics.stuck?.qualified_over_7d || 0, 'integer')}</td></tr>
                  <tr><td>Booked >2d</td><td class="right">${fmt(pipelineMetrics.stuck?.booked_over_2d || 0, 'integer')}</td></tr>
                </tbody>
              </table></div>
            </div>
            <div class="table-container">
              <div class="table-header"><span class="table-title">Conversation Health</span><span class="badge badge-low">MCP</span></div>
              <div style="overflow:auto;"><table>
                <thead><tr><th>Signal</th><th class="right">Value</th></tr></thead>
                <tbody>
                  <tr><td>Unread convos</td><td class="right">${convoMetrics.unread_conversations === null || convoMetrics.unread_conversations === undefined ? '—' : fmt(convoMetrics.unread_conversations, 'integer')}</td></tr>
                  <tr><td>High-intent stale</td><td class="right">${convoMetrics.high_intent_stale === null || convoMetrics.high_intent_stale === undefined ? '—' : fmt(convoMetrics.high_intent_stale, 'integer')}</td></tr>
                  <tr><td>Inbound no reply</td><td class="right">${convoMetrics.inbound_without_reply === null || convoMetrics.inbound_without_reply === undefined ? '—' : fmt(convoMetrics.inbound_without_reply, 'integer')}</td></tr>
                </tbody>
              </table></div>
            </div>
          </div>
        </div>
        <div class="intel-copilot-side">
          <div class="reco-card intel-copilot-status-card">
            <div class="reco-entity" style="font-size:0.84rem; margin-bottom:6px;">MCP status</div>
            <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
              <span class="badge badge-${mcp.status === 'ok' ? 'active' : mcp.status === 'partial' ? 'warning' : mcp.status === 'disabled' ? 'low' : 'critical'}">${escapeHtml(mcp.status || 'unknown')}</span>
              <span class="text-muted" style="font-size:0.76rem;">${escapeHtml(mcp.mode || 'disabled')}</span>
              ${data.refreshed_at ? `<span class="text-muted" style="font-size:0.76rem;">${fmtDateTime(data.refreshed_at)}</span>` : ''}
            </div>
            ${mcp.last_error ? `<div class="alert-banner alert-warning" style="margin-top:8px;">${escapeHtml(mcp.last_error)}</div>` : ''}
          </div>
          <div class="table-container" style="margin-top:12px;">
            <div class="table-header"><span class="table-title">Stage Counts</span></div>
            ${stageCounts.length ? `<div style="overflow:auto;"><table>
              <thead><tr><th>Stage</th><th class="right">Count</th></tr></thead>
              <tbody>${stageCounts.map((row) => `<tr><td>${escapeHtml(row.stage)}</td><td class="right">${fmt(row.count || 0, 'integer')}</td></tr>`).join('')}</tbody>
            </table></div>` : '<div class="text-muted" style="font-size:0.76rem; padding:12px;">No stage data yet.</div>'}
          </div>
          <div class="table-container" style="margin-top:12px;">
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
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function setProposalFilter(status) {
  proposedActionFilter = status;
  syncIntelProposalFilterButtons();
  loadProposedActions();
}

async function loadProposedActions() {
  const el = document.getElementById('intel-proposed-actions');
  if (!el) return;
  try {
    const res = await apiGet('/intelligence/proposed-actions?status=all&limit=36');
    const allRows = res.data || [];
    const latestRun = res.latest_run || null;
    intelShellState.proposals = { rows: allRows, latestRun };
    renderIntelSummary();
    const summary = latestRun?.output_summary?.summary || '';
    const latestError = latestRun?.output_summary?.message || '';
    const counts = {
      proposed: allRows.filter((row) => row.status === 'proposed').length,
      approved: allRows.filter((row) => row.status === 'approved').length,
      dismissed: allRows.filter((row) => row.status === 'dismissed').length,
      urgent: allRows.filter((row) => row.status === 'proposed' && ['critical', 'high'].includes(row.priority)).length,
    };
    const typeCounts = new Map();
    allRows.forEach((row) => {
      const key = row.proposal_type || 'general';
      typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
    });
    const typeFilterBar = `
      <div class="intel-workspace-tabs" style="margin-bottom:10px;">
        <button class="btn btn-sm ${proposedActionTypeFilter === 'all' ? 'btn-primary' : ''}" onclick="setProposalTypeFilter('all')">All types ${fmt(allRows.length, 'integer')}</button>
        ${Array.from(typeCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([type, count]) => `
          <button class="btn btn-sm ${proposedActionTypeFilter === type ? 'btn-primary' : ''}" onclick="setProposalTypeFilter('${escapeJs(type)}')">${escapeHtml(proposalTypeLabel(type))} ${fmt(count, 'integer')}</button>
        `).join('')}
      </div>
    `;
    const rows = allRows.filter((row) => (proposedActionFilter === 'all' ? true : row.status === proposedActionFilter)
      && (proposedActionTypeFilter === 'all' ? true : (row.proposal_type || 'general') === proposedActionTypeFilter));
    const proposedFilterButton = document.getElementById('intel-proposals-filter-proposed');
    if (proposedFilterButton) proposedFilterButton.textContent = `Proposed ${fmt(counts.proposed, 'integer')}`;
    const approvedFilterButton = document.getElementById('intel-proposals-filter-approved');
    if (approvedFilterButton) approvedFilterButton.textContent = `Approved ${fmt(counts.approved, 'integer')}`;
    const dismissedFilterButton = document.getElementById('intel-proposals-filter-dismissed');
    if (dismissedFilterButton) dismissedFilterButton.textContent = `Dismissed ${fmt(counts.dismissed, 'integer')}`;
    const meta = latestRun
      ? `<div class="text-muted" style="font-size:0.76rem; margin-bottom:10px;">Last run ${fmtDateTime(latestRun.created_at)} · ${escapeHtml(latestRun.status)}${latestRun.reason_code ? ` · ${escapeHtml(latestRun.reason_code)}` : ''}</div>`
      : '<div class="text-muted" style="font-size:0.76rem; margin-bottom:10px;">No proposal run yet.</div>';
    if (!rows.length) {
      el.innerHTML = `
        <div class="intel-proposal-review-bar" style="margin-bottom:10px;">
          <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.proposed, 'integer')}</div><div class="intel-proposal-review-label">Open</div></div>
          <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.urgent, 'integer')}</div><div class="intel-proposal-review-label">Urgent</div></div>
          <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.approved, 'integer')}</div><div class="intel-proposal-review-label">Approved</div></div>
          <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.dismissed, 'integer')}</div><div class="intel-proposal-review-label">Dismissed</div></div>
        </div>
        ${typeFilterBar}
        ${meta}
        ${latestError ? `<div class="alert-banner alert-critical" style="margin-bottom:10px;">${escapeHtml(latestError)}</div>` : ''}
        ${summary ? `<div class="alert-banner alert-warning" style="margin-bottom:10px;">${escapeHtml(summary)}</div>` : ''}
        <div class="text-muted" style="font-size:0.78rem; padding:12px;">No ${escapeHtml(proposedActionFilter)} actions yet.</div>
      `;
      return;
    }
    const groupedRows = rows.reduce((acc, row) => {
      const key = row.proposal_type || 'general';
      if (!acc[key]) acc[key] = [];
      acc[key].push(row);
      return acc;
    }, {});
    el.innerHTML = `
      <div class="intel-proposal-review-bar" style="margin-bottom:10px;">
        <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.proposed, 'integer')}</div><div class="intel-proposal-review-label">Open</div></div>
        <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.urgent, 'integer')}</div><div class="intel-proposal-review-label">Urgent</div></div>
        <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.approved, 'integer')}</div><div class="intel-proposal-review-label">Approved</div></div>
        <div class="intel-proposal-review-stat"><div class="intel-proposal-review-count">${fmt(counts.dismissed, 'integer')}</div><div class="intel-proposal-review-label">Dismissed</div></div>
      </div>
      ${typeFilterBar}
      ${meta}
      ${latestError ? `<div class="alert-banner alert-critical" style="margin-bottom:10px;">${escapeHtml(latestError)}</div>` : ''}
      ${summary ? `<div class="alert-banner alert-warning" style="margin-bottom:10px;">${escapeHtml(summary)}</div>` : ''}
      <div class="intel-proposals-grid">
        ${Object.entries(groupedRows).sort((a, b) => a[0].localeCompare(b[0])).map(([groupType, groupRows]) => `
          <div class="table-container">
            <div class="table-header">
              <span class="table-title">${escapeHtml(proposalTypeLabel(groupType))}</span>
              <span class="badge badge-low">${fmt(groupRows.length, 'integer')}</span>
            </div>
            <div style="display:grid; gap:12px; padding:12px;">
        ${groupRows.map((row) => {
          const payload = row.payload || {};
          const dataUsed = Array.isArray(payload.data_used) ? payload.data_used : [];
          const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
          const action = payload.recommended_action || {};
          const badge = row.status === 'approved' ? 'active' : row.status === 'dismissed' ? 'low' : row.priority === 'critical' ? 'critical' : row.priority === 'high' ? 'warning' : 'active';
          const confidencePct = fmt(Number(row.confidence || 0) * 100, 'integer');
          const activeDecision = row.status === 'proposed' && ['critical', 'high'].includes(row.priority);
          return `
            <div class="reco-card intel-proposal-card ${activeDecision ? 'active-decision' : ''} urgency-${escapeHtml(row.priority || 'low')}">
              <div class="proposal-mini-pipeline">
                <span class="done">Issue</span><span class="done">Evidence</span><span class="current">Recommendation</span><span>Approval</span><span>Monitoring</span>
              </div>
              <div class="intel-proposal-header">
                <div>
                  <div class="intel-proposal-title">${escapeHtml(row.title)}</div>
                  <div class="intel-proposal-meta">${fmtDateTime(row.created_at)} · confidence ${confidencePct}%</div>
                </div>
                <div class="intel-proposal-badges">
                  <span class="badge badge-${badge}">${escapeHtml(row.priority)}</span>
                  <span class="badge badge-${row.status === 'approved' ? 'active' : row.status === 'dismissed' ? 'low' : 'warning'}">${escapeHtml(row.status)}</span>
                </div>
              </div>
              <div class="intel-proposal-pill-row">
                <div class="intel-proposal-pill">
                  <div class="intel-proposal-pill-label">Recommended action</div>
                  <div class="intel-proposal-pill-value">${escapeHtml(action.kind || 'review')}</div>
                </div>
                <div class="intel-proposal-pill">
                  <div class="intel-proposal-pill-label">Scope</div>
                  <div class="intel-proposal-pill-value">${escapeHtml(action.target_scope || 'account')}</div>
                </div>
                <div class="intel-proposal-pill">
                  <div class="intel-proposal-pill-label">Expected impact</div>
                  <div class="intel-proposal-pill-value">${escapeHtml(row.expected_impact || '—')}</div>
                </div>
              </div>
              <div class="intel-proposal-body">
                <div class="intel-proposal-panel">
                  <div class="intel-proposal-panel-label">Why this</div>
                  <div class="intel-proposal-panel-copy">${escapeHtml(row.why)}</div>
                </div>
                <div class="intel-proposal-panel">
                  <div class="intel-proposal-panel-label">Why not another action</div>
                  <div class="intel-proposal-panel-copy">${escapeHtml(row.why_not_alternative || '—')}</div>
                </div>
                ${action.note ? `<div class="intel-proposal-panel">
                  <div class="intel-proposal-panel-label">Execution note</div>
                  <div class="intel-proposal-panel-copy">${escapeHtml(action.note)}</div>
                </div>` : ''}
                ${dataUsed.length ? `<div class="intel-proposal-panel">
                  <div class="intel-proposal-panel-label">Data used</div>
                  <div class="intel-proposal-chip-row">${dataUsed.map((item) => `<span class="badge badge-low">${escapeHtml(item)}</span>`).join('')}</div>
                </div>` : ''}
                ${evidence.length ? `<div class="intel-proposal-panel">
                  <div class="intel-proposal-panel-label">Evidence</div>
                  <ul class="intel-proposal-evidence">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
                </div>` : ''}
              </div>
              <div class="intel-proposal-actions">
                <button class="btn btn-sm intel-proposal-review" data-id="${row.id}">Review</button>
                ${proposalCanGenerateDraft(row) ? `<button class="btn btn-sm intel-proposal-draft" data-id="${row.id}">Generate Draft</button>` : ''}
                ${row.status === 'proposed' ? `
                <button class="btn btn-sm btn-primary intel-proposal-preview" data-id="${row.id}">Preview Approval</button>
                <button class="btn btn-sm intel-proposal-status" data-id="${row.id}" data-status="dismissed">Dismiss</button>
                ` : `
                <button class="btn btn-sm intel-proposal-status" data-id="${row.id}" data-status="proposed">Reopen</button>
                `}
              </div>
            </div>
          `;
        }).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
    el.querySelectorAll('.intel-proposal-status').forEach((button) => {
      button.onclick = () => updateProposalStatus(button.dataset.id, button.dataset.status);
    });
    el.querySelectorAll('.intel-proposal-review').forEach((button) => {
      button.onclick = () => openProposalReviewDrawer(button.dataset.id);
    });
    el.querySelectorAll('.intel-proposal-preview').forEach((button) => {
      button.onclick = () => openProposalReviewDrawer(button.dataset.id, { previewApproval: true });
    });
    el.querySelectorAll('.intel-proposal-draft').forEach((button) => {
      button.onclick = () => openProposalReviewDrawer(button.dataset.id, { generateDraft: true });
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

async function updateProposalStatus(proposalId, status, note = '') {
  try {
    await apiPost(`/intelligence/proposed-actions/${proposalId}/status`, { status, note });
    toast(status === 'proposed' ? 'Proposal reopened.' : `Proposal ${status}.`);
    await loadProposedActions();
  } catch (err) {
    toast(`Error: ${safeErrorMessage(err)}`, 'error');
  }
}

function setProposalTypeFilter(type) {
  proposedActionTypeFilter = type || 'all';
  loadProposedActions();
}

function openProposalReviewDrawer(proposalId, options = {}) {
  const rows = intelShellState.proposals?.rows || [];
  const row = rows.find((item) => String(item.id) === String(proposalId));
  if (!row) {
    toast('Proposal not found', 'error');
    return;
  }
  const payload = row.payload || {};
  const action = payload.recommended_action || {};
  const dataUsed = Array.isArray(payload.data_used) ? payload.data_used : [];
  const evidence = Array.isArray(payload.evidence) ? payload.evidence : [];
  const targetIds = Array.isArray(action.target_ids) ? action.target_ids : [];
  const reviewNote = String(payload.review_note || '').trim();
  const targetButtons = proposalTargetActions(row);
  const consequences = getProposalApprovalPreview(row);
  const footer = row.status === 'proposed'
    ? `
      ${proposalCanGenerateDraft(row) ? `<button class="btn" onclick="loadProposalDraft(${row.id})">Generate Draft</button>` : ''}
      <button class="btn btn-primary" onclick="approveProposalFromDrawer(${row.id})">Approve</button>
      <button class="btn" onclick="dismissProposalFromDrawer(${row.id})">Dismiss</button>
      <button class="btn" onclick="closeDrawer()">Close</button>
    `
    : `
      ${proposalCanGenerateDraft(row) ? `<button class="btn" onclick="loadProposalDraft(${row.id})">Generate Draft</button>` : ''}
      <button class="btn" onclick="reopenProposalFromDrawer(${row.id})">Reopen</button>
      <button class="btn" onclick="closeDrawer()">Close</button>
    `;
  openDrawer(`Action Review · ${escapeHtml(row.title)}`, `
    <div class="intel-proposal-review-detail">
      <div class="intel-proposal-review-detail-meta">
        <span class="badge badge-${row.priority === 'critical' ? 'critical' : row.priority === 'high' ? 'warning' : 'low'}">${escapeHtml(row.priority)}</span>
        <span class="badge badge-${row.status === 'approved' ? 'active' : row.status === 'dismissed' ? 'low' : 'warning'}">${escapeHtml(row.status)}</span>
        <span class="text-muted" style="font-size:0.76rem;">${fmtDateTime(row.created_at)}</span>
      </div>
      <div class="form-group">
        <label class="form-label">Why this</label>
        <div class="intel-review-copy">${escapeHtml(row.why || '—')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Why not another action</label>
        <div class="intel-review-copy">${escapeHtml(row.why_not_alternative || '—')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Expected impact</label>
        <div class="intel-review-copy">${escapeHtml(row.expected_impact || '—')}</div>
      </div>
      <div class="form-group">
        <label class="form-label">Approval consequences</label>
        <ul class="intel-proposal-evidence">${consequences.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Action</label>
          <div class="intel-review-copy">${escapeHtml(action.kind || 'review')}</div>
        </div>
        <div class="form-group">
          <label class="form-label">Scope</label>
          <div class="intel-review-copy">${escapeHtml(action.target_scope || 'account')}</div>
        </div>
      </div>
      ${targetButtons ? `<div class="form-group">
        <label class="form-label">Open target</label>
        <div class="btn-group">${targetButtons}</div>
      </div>` : ''}
      ${action.note ? `<div class="form-group">
        <label class="form-label">Execution note</label>
        <div class="intel-review-copy">${escapeHtml(action.note)}</div>
      </div>` : ''}
      ${targetIds.length ? `<div class="form-group">
        <label class="form-label">Target IDs</label>
        <div class="intel-proposal-chip-row">${targetIds.map((item) => `<span class="badge badge-low">${escapeHtml(item)}</span>`).join('')}</div>
      </div>` : ''}
      ${dataUsed.length ? `<div class="form-group">
        <label class="form-label">Data used</label>
        <div class="intel-proposal-chip-row">${dataUsed.map((item) => `<span class="badge badge-low">${escapeHtml(item)}</span>`).join('')}</div>
      </div>` : ''}
      ${evidence.length ? `<div class="form-group">
        <label class="form-label">Evidence</label>
        <ul class="intel-proposal-evidence">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Operator note</label>
        <textarea id="proposal-review-note" class="form-textarea" rows="3" placeholder="Why you approved, dismissed, or reopened this proposal.">${escapeHtml(reviewNote)}</textarea>
      </div>
      <div id="proposal-draft-slot"></div>
    </div>
  `, footer);
  if (options.previewApproval) {
    const slot = document.getElementById('proposal-draft-slot');
    if (slot) {
      slot.innerHTML = `<div class="alert-banner alert-info" style="margin-top:8px;">Approving now only marks this action as operator-approved. No CRM or ads execution happens automatically in the current phase.</div>`;
    }
  }
  if (options.generateDraft && proposalCanGenerateDraft(row)) {
    loadProposalDraft(row.id);
  }
}

async function approveProposalFromDrawer(proposalId) {
  await updateProposalStatus(proposalId, 'approved', document.getElementById('proposal-review-note')?.value || '');
  closeDrawer();
}

async function dismissProposalFromDrawer(proposalId) {
  await updateProposalStatus(proposalId, 'dismissed', document.getElementById('proposal-review-note')?.value || '');
  closeDrawer();
}

async function reopenProposalFromDrawer(proposalId) {
  await updateProposalStatus(proposalId, 'proposed', document.getElementById('proposal-review-note')?.value || '');
  closeDrawer();
}

async function loadProposalDraft(proposalId) {
  const slot = document.getElementById('proposal-draft-slot');
  if (!slot) return;
  slot.innerHTML = '<div class="loading" style="padding:24px;">Generating follow-up draft</div>';
  try {
    const res = await apiPost(`/intelligence/proposed-actions/${proposalId}/draft`, {});
    const draft = res.data || {};
    slot.innerHTML = `
      <div class="form-group">
        <label class="form-label">Draft channel</label>
        <div class="intel-review-copy">${escapeHtml(draft.channel || 'follow-up')}</div>
      </div>
      ${draft.subject ? `<div class="form-group">
        <label class="form-label">Subject</label>
        <div class="intel-review-copy">${escapeHtml(draft.subject)}</div>
      </div>` : ''}
      <div class="form-group">
        <label class="form-label">Draft message</label>
        <div class="intel-review-copy">${escapeHtml(draft.message || '—')}</div>
      </div>
      ${draft.cta ? `<div class="form-group">
        <label class="form-label">CTA</label>
        <div class="intel-review-copy">${escapeHtml(draft.cta)}</div>
      </div>` : ''}
      ${draft.notes ? `<div class="form-group">
        <label class="form-label">Operator notes</label>
        <div class="intel-review-copy">${escapeHtml(draft.notes)}</div>
      </div>` : ''}
    `;
  } catch (err) {
    slot.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}

function openProposalTargetCampaign(campaignId) {
  navigateTo('adsets', { metaCampaignId: campaignId, campaignName: '' });
}

function openProposalTargetAdSet(adsetId) {
  navigateTo('ads', { metaAdsetId: adsetId, adsetName: '', metaCampaignId: '', campaignName: '' });
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
    intelShellState.dataHealthSummary = summary;
    renderIntelSummary();
    const range = intelDateFrom === intelDateTo ? intelDateFrom : `${intelDateFrom} to ${intelDateTo}`;
    el.innerHTML = window.DataHealth.panel(summary, `Decision Data Health · ${range}`);
    return intelDataHealth;
  } catch (err) {
    intelShellState.dataHealthSummary = {
      state: 'failed',
      summary: `Data health unavailable: ${safeErrorMessage(err)}`,
    };
    renderIntelSummary();
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
    intelShellState.trueRoas = rows;
    renderIntelSummary();
    el.innerHTML = rows.length ? `<div style="overflow:auto;"><table><thead><tr><th>Campaign</th><th class="right">Spend</th><th class="right">Meta ROAS</th><th class="right">Your ROAS</th><th class="right">Revenue</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td class="name-cell">${escapeHtml(r.name)}</td><td class="right">${fmt(r.spend,'currency')}</td><td class="right">${fmt(r.meta_reported_roas,'decimal')}x</td><td class="right">${fmt(r.true_roas,'decimal')}x</td><td class="right">${fmt(r.first_party_revenue,'currency')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-text">No first-party revenue yet</div></div>';
  } catch (err) {
    intelShellState.trueRoas = [];
    renderIntelSummary();
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
    const sourceRows = (res.data || []).slice(0, 30);
    intelShellState.creativeRows = sourceRows;
    const rows = intelWorkspaceState.creative === 'winners'
      ? sourceRows
          .slice()
          .sort((a, b) => ((Number(b.spend) || 0) * (Number(b.ctr) || 0)) - ((Number(a.spend) || 0) * (Number(a.ctr) || 0)))
          .slice(0, 12)
      : sourceRows;
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
