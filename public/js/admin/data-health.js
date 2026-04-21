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

  window.loadDataHealth = loadDataHealth;
})();
