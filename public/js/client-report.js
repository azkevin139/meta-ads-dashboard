(function () {
  let preset = '7d';

  function tokenFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts[0] === 'report' ? parts[1] : '';
  }

  async function fetchReport(token) {
    const res = await fetch(`/api/public/reports/${encodeURIComponent(token)}/lead-summary?preset=${encodeURIComponent(preset)}`, {
      headers: { Accept: 'application/json' },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Report unavailable');
    return json;
  }

  function fmtSafe(value, type) {
    return window.FormatHelpers.fmt(value, type);
  }

  function kpi(label, value, type) {
    return `
      <div class="report-kpi">
        <div class="kpi-label">${escapeHtml(label)}</div>
        <div class="report-kpi-value">${fmtSafe(value, type)}</div>
      </div>
    `;
  }

  function step(label, value) {
    return `
      <div class="report-funnel-step">
        <div class="report-funnel-label">${escapeHtml(label)}</div>
        <div class="report-funnel-value">${fmtSafe(value, 'integer')}</div>
      </div>
    `;
  }

  function render(root, payload) {
    const data = payload.data || {};
    const summary = data.summary || {};
    const meta = data.metaFunnel || data.meta_funnel || {};
    const website = data.websiteFunnel || data.website_funnel || {};
    const quality = data.leadQuality || data.lead_quality || {};
    const pipeline = data.pipeline || [];
    const freshness = data.freshness || data.health || [];
    const range = data.range || {};
    const account = payload.account || {};

    root.innerHTML = `
      <div class="report-shell client-report-shell">
        <div class="report-header">
          <div>
            <div class="intel-eyebrow">Lead Generation Report</div>
            <div class="report-title">${escapeHtml(account.name || 'Client report')}</div>
            <div class="report-subtitle">${escapeHtml(range.since || '')} to ${escapeHtml(range.until || '')} · ${escapeHtml(data.timezone || 'Asia/Dubai')}</div>
          </div>
          <div class="report-controls">
            ${['today', 'yesterday', '7d', '14d', '30d', 'this_month'].map((item) => `
              <button class="btn btn-sm ${preset === item ? 'btn-primary' : ''}" data-client-report-preset="${item}">${item.replace('_', ' ')}</button>
            `).join('')}
          </div>
        </div>

        <div class="report-kpi-grid">
          ${kpi('Spend', summary.spend, 'currency')}
          ${kpi('Impressions', summary.impressions, 'integer')}
          ${kpi('Link clicks', summary.clicks, 'integer')}
          ${kpi('Total leads', summary.total_leads, 'integer')}
          ${kpi('CPL', summary.cpl, 'currency')}
          ${kpi('Qualified leads', summary.qualified_leads, 'integer')}
          ${kpi('Cost / qualified', summary.cost_per_qualified_lead, 'currency')}
          ${kpi('Won / booked', (summary.won_count || 0) + (summary.booked_count || 0), 'integer')}
        </div>

        <div class="report-grid-two">
          <section class="report-card">
            <div class="report-card-title">Meta Lead Form Funnel</div>
            ${step('Impressions', meta.impressions)}
            ${step('Reach', meta.reach)}
            ${step('Link clicks', meta.linkClicks || meta.link_clicks)}
            ${step('Meta form leads', meta.metaFormLeads || meta.meta_form_leads)}
            ${step('Qualified leads', meta.qualifiedLeads || meta.qualified_leads)}
            ${step('Won / booked', (meta.wonCount || meta.won_count || 0) + (meta.bookedCount || meta.booked_count || 0))}
          </section>

          <section class="report-card">
            <div class="report-card-title">Website Funnel</div>
            ${step('Visits', website.visits)}
            ${step('Pageviews', website.pageviews)}
            ${step('Website form submissions', website.formSubmissions || website.form_submissions)}
            ${step('Qualified leads', website.qualifiedLeads || website.qualified_leads)}
            ${step('Won / booked', (website.wonCount || website.won_count || 0) + (website.bookedCount || website.booked_count || 0))}
          </section>
        </div>

        <div class="report-grid-two">
          <section class="report-card">
            <div class="report-card-title">Lead Quality</div>
            <div class="report-quality-grid">
              ${kpi('Qualified rate', quality.qualifiedRate || quality.qualified_rate, 'percent')}
              ${kpi('Qualified', quality.qualifiedLeads || quality.qualified_leads, 'integer')}
              ${kpi('Unqualified', quality.unqualifiedLeads || quality.unqualified_leads, 'integer')}
              ${kpi('Lead score', quality.leadScore || quality.lead_score || 0, 'integer')}
            </div>
          </section>

          <section class="report-card">
            <div class="report-card-title">Pipeline Stages</div>
            ${pipeline.length ? pipeline.map((row) => `
              <div class="report-stage-row">
                <span>${escapeHtml(String(row.stage || 'unknown').replace(/_/g, ' '))}</span>
                <strong>${fmtSafe(row.count, 'integer')}</strong>
              </div>
            `).join('') : '<div class="text-muted">No pipeline data in this period.</div>'}
          </section>
        </div>

        <section class="report-card">
          <div class="report-card-title">Definitions</div>
          <div class="report-definitions">
            ${Object.entries(data.definitions || {}).map(([key, value]) => `
              <div><strong>${escapeHtml(key.replace(/_/g, ' '))}</strong><br><span class="text-muted">${escapeHtml(value)}</span></div>
            `).join('')}
          </div>
        </section>

        <section class="report-card">
          <div class="report-card-title">Data Freshness</div>
          ${freshness.length ? freshness.map((row) => `
            <div class="report-health-row">
              <span>${escapeHtml(row.source)} / ${escapeHtml(row.dataset)}</span>
              <span class="badge badge-${row.status === 'success' ? 'active' : row.status === 'partial' ? 'warning' : 'critical'}">${escapeHtml(row.status)}</span>
            </div>
          `).join('') : '<div class="text-muted">No sync health records found.</div>'}
        </section>
      </div>
    `;

    root.querySelectorAll('[data-client-report-preset]').forEach((button) => {
      button.addEventListener('click', () => {
        preset = button.dataset.clientReportPreset;
        load();
      });
    });
  }

  async function load() {
    const root = document.getElementById('client-report-root');
    const token = tokenFromPath();
    if (!token) {
      root.innerHTML = '<div class="empty-state"><div class="empty-state-title">Invalid report link</div></div>';
      return;
    }
    root.innerHTML = '<div class="loading">Loading report</div>';
    try {
      render(root, await fetchReport(token));
    } catch (err) {
      root.innerHTML = `<div class="empty-state"><div class="empty-state-title">Report unavailable</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
