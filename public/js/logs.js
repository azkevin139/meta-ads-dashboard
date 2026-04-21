/* ═══════════════════════════════════════════════════════════
   Action Log Page
   ═══════════════════════════════════════════════════════════ */

async function loadLogs(container) {
  container.innerHTML = `
    <div class="table-container">
      <div class="table-header">
        <span class="table-title">Action Log</span>
        <span class="text-muted" style="font-size: 0.78rem;">Every write action is recorded</span>
      </div>
      <div id="logs-table"><div class="loading">Loading logs</div></div>
    </div>
  `;

  try {
    const res = await apiGet(`/logs?accountId=${ACCOUNT_ID}&limit=100`);
    const logs = res.data || [];

    if (logs.length === 0) {
      document.getElementById('logs-table').innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-text">No actions recorded yet</div></div>';
      return;
    }

    document.getElementById('logs-table').innerHTML = `
      <div style="overflow-x: auto;">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Entity</th>
              <th>Name</th>
              <th>Action</th>
              <th>Details</th>
              <th>Source</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => {
              const details = log.details || {};
              let detailStr = '';

              if (log.action === 'budget_change') {
                detailStr = `$${(details.old_budget / 100).toFixed(2)} → $${(details.new_budget / 100).toFixed(2)}`;
              } else if (log.action === 'pause' || log.action === 'resume') {
                detailStr = `${details.previous_status || '?'} → ${details.new_status || '?'}`;
              } else if (log.action === 'duplicate') {
                detailStr = `New: ${details.new_id || '—'}`;
              } else if (details.reason) {
                detailStr = details.reason;
              } else {
                detailStr = JSON.stringify(details).substring(0, 60);
              }

              const actionColor = log.action === 'pause' ? 'text-yellow'
                : log.action === 'resume' ? 'text-green'
                : log.action === 'budget_change' ? 'text-secondary'
                : '';

              return `
                <tr>
                  <td style="font-size: 0.78rem;">${fmtDateTime(log.created_at)}</td>
                  <td><span class="badge badge-low" style="font-size: 0.65rem;">${log.entity_type}</span></td>
                  <td class="name-cell">${log.entity_name || log.entity_id}</td>
                  <td class="${actionColor}" style="font-weight: 500;">${log.action}</td>
                  <td style="font-size: 0.78rem; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis;">${detailStr}</td>
                  <td><span class="log-source">${log.source}</span></td>
                  <td class="text-muted">${log.performed_by}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    document.getElementById('logs-table').innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
  }
}
