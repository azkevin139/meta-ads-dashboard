(function () {
  const asyncSection = window.AsyncSectionHelpers;

  function healthBadge(status) {
    const value = String(status || 'unavailable');
    const cls = value === 'success' ? 'active'
      : value === 'partial' || value === 'skipped' ? 'warning'
      : value === 'failed' ? 'critical'
      : 'low';
    return `<span class="badge badge-${cls}">${escapeHtml(value)}</span>`;
  }

  function formatCoverage(row) {
    if (!row.coverage_start && !row.coverage_end) return '—';
    return `${fmtDate(row.coverage_start)} → ${fmtDate(row.coverage_end)}`;
  }

  function formatReason(row) {
    if (row.partial_reason) return `<span class="mono">${escapeHtml(row.partial_reason)}</span>`;
    if (row.error_summary) return `<span class="text-red">${escapeHtml(row.error_summary)}</span>`;
    return '<span class="text-muted">—</span>';
  }

  function renderRunRows(rows) {
    if (!rows.length) {
      return '<tr><td colspan="8" class="text-muted">No sync runs recorded yet.</td></tr>';
    }
    return rows.map(row => `
      <tr>
        <td>
          <div style="font-weight:500;">${escapeHtml(row.source)} / ${escapeHtml(row.dataset)}</div>
          <div class="text-muted" style="font-size:0.72rem;">Account ${escapeHtml(row.account_id || '—')} · ${escapeHtml(row.mode || '—')}</div>
        </td>
        <td>${healthBadge(row.status)}</td>
        <td style="font-size:0.78rem;">${fmtDateTime(row.last_attempted_at)}</td>
        <td style="font-size:0.78rem;">${fmtDateTime(row.last_successful_at)}</td>
        <td style="font-size:0.78rem;">${formatCoverage(row)}</td>
        <td class="mono" style="font-size:0.75rem;">${fmt(row.attempted_count || 0, 'integer')} / ${fmt(row.imported_count || 0, 'integer')}</td>
        <td class="mono" style="font-size:0.75rem;">${fmt(row.changed_count || 0, 'integer')} / ${fmt(row.skipped_count || 0, 'integer')}</td>
        <td style="font-size:0.75rem;">${formatReason(row)}</td>
      </tr>
    `).join('');
  }

  function renderCoverageRows(rows) {
    if (!rows.length) {
      return '<tr><td colspan="6" class="text-muted">No warehouse coverage rows yet.</td></tr>';
    }
    return rows.map(row => `
      <tr>
        <td>Account ${escapeHtml(row.account_id || '—')}</td>
        <td>${escapeHtml(row.level || '—')}</td>
        <td>${fmtDate(row.coverage_start)}</td>
        <td>${fmtDate(row.coverage_end)}</td>
        <td class="mono">${fmt(row.day_count || 0, 'integer')}</td>
        <td class="mono">${fmt(row.row_count || 0, 'integer')}</td>
      </tr>
    `).join('');
  }

  function readinessBadge(readiness) {
    const status = readiness?.status || 'unknown';
    const cls = status === 'ready' ? 'active' : status === 'blocked' ? 'critical' : 'warning';
    return `<span class="badge badge-${cls}">${escapeHtml(status)}</span>`;
  }

  function formatCspValue(value, max = 72) {
    const text = String(value || '—');
    const short = text.length > max ? `${text.slice(0, max - 1)}…` : text;
    return `<span title="${escapeHtml(text)}">${escapeHtml(short)}</span>`;
  }

  function renderCspRows(rows) {
    if (!rows.length) {
      return '<tr><td colspan="6" class="text-muted">No CSP violation reports in this window.</td></tr>';
    }
    return rows.map(row => `
      <tr>
        <td><span class="mono">${escapeHtml(row.directive || 'unknown')}</span></td>
        <td>${formatCspValue(row.blocked_uri)}</td>
        <td>${formatCspValue(row.source_file)}</td>
        <td class="mono">${fmt(row.count || 0, 'integer')}</td>
        <td style="font-size:0.78rem;">${fmtDateTime(row.first_seen_at)}</td>
        <td style="font-size:0.78rem;">${fmtDateTime(row.last_seen_at)}</td>
      </tr>
    `).join('');
  }

  async function loadDataHealth() {
    const section = asyncSection.createAsyncSection({
      targetId: 'admin-data-health',
      loadingText: 'Loading data health',
      render: ({ runs, coverage, reasonCodes }) => `
        <div class="table-container" style="margin-bottom:16px;">
          <div class="table-header">
            <span class="table-title">Sync Truth</span>
            <button class="btn btn-sm" onclick="loadDataHealth()">Refresh</button>
          </div>
          <table>
            <thead>
              <tr>
                <th>Dataset</th>
                <th>Status</th>
                <th>Attempted</th>
                <th>Successful</th>
                <th>Coverage</th>
                <th>Attempted / Imported</th>
                <th>Changed / Skipped</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>${renderRunRows(runs)}</tbody>
          </table>
        </div>
        <div class="table-container">
          <div class="table-header">
            <span class="table-title">Warehouse Coverage</span>
            <span class="text-muted" style="font-size:0.75rem;">${reasonCodes.length} reason codes available</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Level</th>
                <th>First Date</th>
                <th>Latest Date</th>
                <th>Days</th>
                <th>Rows</th>
              </tr>
            </thead>
            <tbody>${renderCoverageRows(coverage)}</tbody>
          </table>
        </div>
      `,
    });
    section?.setLoading();
    try {
      const res = await apiGet('/admin/data-health');
      section?.setData({
        runs: res.data || [],
        coverage: res.warehouse_coverage || [],
        reasonCodes: res.reason_codes || [],
      });
    } catch (err) {
      section?.setError(err);
    }
  }

  async function loadCspViolations() {
    const section = asyncSection.createAsyncSection({
      targetId: 'admin-csp-violations',
      loadingText: 'Loading CSP reports',
      render: (summary) => `
        <div class="table-container">
          <div class="table-header">
            <span class="table-title">CSP Enforcement Readiness</span>
            <button class="btn btn-sm" data-csp-refresh>Refresh</button>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 12px 16px 16px;">
            <div class="kpi-card">
              <div class="kpi-label">Readiness</div>
              <div>${readinessBadge(summary.enforcement_readiness)}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Reports</div>
              <div class="kpi-value">${fmt(summary.total || 0, 'integer')}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">First-Party Blocking</div>
              <div class="kpi-value">${fmt(summary.first_party_blocking || 0, 'integer')}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Window</div>
              <div class="kpi-value">${fmt(summary.window_hours || 0, 'integer')}h</div>
            </div>
          </div>
          ${summary.enforcement_readiness?.reasons?.length ? `
            <div class="alert-banner alert-warning" style="margin: 0 16px 16px;">
              CSP remains report-only. Reason: ${summary.enforcement_readiness.reasons.map(escapeHtml).join(', ')}
            </div>
          ` : `
            <div class="alert-banner alert-info" style="margin: 0 16px 16px;">
              No first-party blocking reports found in this window. Keep observing before enforcing.
            </div>
          `}
          <table>
            <thead>
              <tr>
                <th>Directive</th>
                <th>Blocked URI</th>
                <th>Source</th>
                <th>Count</th>
                <th>First Seen</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>${renderCspRows(summary.rows || [])}</tbody>
          </table>
        </div>
      `,
    });
    section?.setLoading();
    try {
      const res = await apiGet('/admin/csp-violations?hours=168');
      section?.setData(res.data || {});
      document.querySelector('#admin-csp-violations [data-csp-refresh]')?.addEventListener('click', loadCspViolations);
    } catch (err) {
      section?.setError(err);
    }
  }

  window.loadDataHealth = loadDataHealth;
  window.loadCspViolations = loadCspViolations;
})();
