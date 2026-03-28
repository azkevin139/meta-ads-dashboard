/* ═══════════════════════════════════════════════════════════
   AI Analyst Page
   ═══════════════════════════════════════════════════════════ */

async function loadAI(container) {
  container.innerHTML = `
    <div class="flex-between mb-md">
      <div></div>
      <button class="btn btn-primary" onclick="triggerAnalysis()">▶ Run Analysis Now</button>
    </div>
    <div id="ai-content"><div class="loading">Loading AI recommendations</div></div>
  `;

  try {
    const res = await apiGet(`/ai/daily?accountId=${ACCOUNT_ID}`);
    const recs = res.data || [];

    if (recs.length === 0) {
      document.getElementById('ai-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🤖</div>
          <div class="empty-state-text">No AI recommendations yet. Run an analysis or wait for the scheduled daily run.</div>
        </div>`;
      return;
    }

    // Group by status
    const pending = recs.filter(r => r.status === 'pending');
    const resolved = recs.filter(r => r.status !== 'pending');

    let html = '';

    if (pending.length > 0) {
      html += `<div class="mb-md"><h3 style="font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px;">Pending Actions (${pending.length})</h3>`;
      html += pending.map(r => recoCard(r, true)).join('');
      html += '</div>';
    }

    if (resolved.length > 0) {
      html += `<div><h3 style="font-size: 0.85rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 12px;">History</h3>`;
      html += resolved.map(r => recoCard(r, false)).join('');
      html += '</div>';
    }

    document.getElementById('ai-content').innerHTML = html;

  } catch (err) {
    document.getElementById('ai-content').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

function recoCard(rec, showActions) {
  const entityName = rec.campaign_name || rec.adset_name || rec.ad_name || 'Account-level';
  const statusLabel = rec.status !== 'pending' ? `<span class="badge badge-${rec.status === 'approved' ? 'active' : 'paused'}">${rec.status}</span>` : '';

  return `
    <div class="reco-card urgency-${rec.urgency}">
      <div class="reco-header">
        <div>
          <div class="reco-entity">${entityName}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">${rec.level} · ${rec.issue_type.replace(/_/g, ' ')}</div>
        </div>
        <div class="reco-meta">
          ${statusLabel}
          ${urgencyBadge(rec.urgency)}
          <span class="reco-confidence">${Math.round((rec.confidence || 0) * 100)}% conf.</span>
        </div>
      </div>

      <div class="reco-body">
        <div class="reco-issue"><strong>Root cause:</strong> ${rec.root_cause || '—'}</div>
        <div class="reco-action"><strong>Recommendation:</strong> ${rec.recommendation}</div>
        ${rec.expected_impact ? `<div class="reco-impact">${rec.expected_impact}</div>` : ''}
      </div>

      <div class="reco-footer">
        <span class="reco-date">${fmtDate(rec.date)} · ${fmtDateTime(rec.created_at)}</span>
        ${showActions ? `
          <div class="btn-group">
            <button class="btn btn-sm btn-primary" onclick="approveRec(${rec.id})">✓ Approve</button>
            <button class="btn btn-sm" onclick="dismissRec(${rec.id})">✕ Dismiss</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

async function approveRec(id) {
  try {
    await apiPost(`/ai/approve/${id}`);
    toast('Recommendation approved', 'success');
    navigateTo('ai');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function dismissRec(id) {
  try {
    await apiPost(`/ai/dismiss/${id}`);
    toast('Recommendation dismissed', 'info');
    navigateTo('ai');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function triggerAnalysis() {
  toast('Running AI analysis...', 'info');
  try {
    const res = await apiPost(`/ai/run?accountId=${ACCOUNT_ID}`);
    const count = res.data?.recommendations?.length || 0;
    toast(`Analysis complete: ${count} recommendation${count !== 1 ? 's' : ''}`, 'success');
    navigateTo('ai');
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}
