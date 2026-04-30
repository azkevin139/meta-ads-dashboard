async function loadReports(container) {
  container.innerHTML = `
    <div class="report-shell">
      <div class="report-header">
        <div>
          <div class="intel-eyebrow">Client Reporting</div>
          <div class="report-title">Lead Generation Report</div>
          <div class="report-subtitle">Read-only reporting across Meta acquisition, website lead capture, and GoHighLevel pipeline outcomes.</div>
        </div>
        <div class="report-controls">
          <button class="btn btn-sm" data-report-preset="today">Today</button>
          <button class="btn btn-sm" data-report-preset="yesterday">Yesterday</button>
          <button class="btn btn-sm btn-primary" data-report-preset="7d">7d</button>
          <button class="btn btn-sm" data-report-preset="14d">14d</button>
          <button class="btn btn-sm" data-report-preset="30d">30d</button>
          <button class="btn btn-sm" data-report-preset="60d">60d</button>
          <button class="btn btn-sm" data-report-preset="this_month">This month</button>
        </div>
      </div>
      <div id="report-body"><div class="loading">Loading report</div></div>
      <div id="report-link-admin"></div>
    </div>
  `;

  container.querySelectorAll('[data-report-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      container.querySelectorAll('[data-report-preset]').forEach((el) => el.classList.remove('btn-primary'));
      button.classList.add('btn-primary');
      loadLeadReport(button.dataset.reportPreset);
    });
  });

  await loadLeadReport('7d');
  await loadReportLinks();
}

async function loadLeadReport(preset) {
  const body = document.getElementById('report-body');
  if (!body) return;
  body.innerHTML = '<div class="loading">Loading report</div>';
  try {
    const accountId = window.DashboardApp?.getAccountId?.();
    const query = new URLSearchParams({ preset });
    if (accountId) query.set('accountId', accountId);
    const result = await apiGet(`/reports/lead-summary?${query.toString()}`);
    renderLeadReport(body, result);
  } catch (err) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state-title">Report failed to load</div><div class="empty-state-text">${escapeHtml(err.message)}</div></div>`;
  }
}

function deltaText(value) {
  if (value === null || value === undefined) return '<span class="text-muted">new</span>';
  const n = Number(value) || 0;
  const cls = n > 0 ? 'metric-good' : n < 0 ? 'metric-bad' : 'text-muted';
  const sign = n > 0 ? '+' : '';
  return `<span class="${cls}">${sign}${fmt(n, 'decimal')}%</span>`;
}

function reportKpi(label, value, format, delta, note) {
  return `
    <div class="report-kpi">
      <div class="kpi-label">${escapeHtml(label)}</div>
      <div class="report-kpi-value">${fmt(value, format)}</div>
      <div class="report-kpi-note">${deltaText(delta)} vs prior period${note ? ` · ${escapeHtml(note)}` : ''}</div>
    </div>
  `;
}

function funnelStep(label, value, note) {
  return `
    <div class="report-funnel-step">
      <div>
        <div class="report-funnel-label">${escapeHtml(label)}</div>
        ${note ? `<div class="report-funnel-note">${escapeHtml(note)}</div>` : ''}
      </div>
      <div class="report-funnel-value">${fmt(value, 'integer')}</div>
    </div>
  `;
}

function renderLeadReport(container, result) {
  const data = result.data || {};
  const s = data.summary || {};
  const d = data.deltas_pct || {};
  const meta = data.meta_funnel || {};
  const website = data.website_funnel || {};
  const quality = data.lead_quality || {};
  const pipeline = data.pipeline || [];
  const health = data.health || [];
  const range = data.range || {};
  const account = result.account || {};

  container.innerHTML = `
    <div class="report-range-row">
      <div><strong>${escapeHtml(account.name || 'Selected account')}</strong></div>
      <div class="text-muted">${escapeHtml(range.since || '')} to ${escapeHtml(range.until || '')} · ${escapeHtml(data.timezone || 'Asia/Dubai')}</div>
    </div>

    <div class="report-kpi-grid">
      ${reportKpi('Spend', s.spend, 'currency', d.spend)}
      ${reportKpi('Impressions', s.impressions, 'integer', d.impressions)}
      ${reportKpi('Link clicks', s.clicks, 'integer', d.clicks)}
      ${reportKpi('Total leads', s.total_leads, 'integer', d.total_leads)}
      ${reportKpi('CPL', s.cpl, 'currency', d.cpl)}
      ${reportKpi('Qualified leads', s.qualified_leads, 'integer', d.qualified_leads)}
      ${reportKpi('Cost / qualified', s.cost_per_qualified_lead, 'currency', d.cost_per_qualified_lead)}
      ${reportKpi('Won / booked', (s.won_count || 0) + (s.booked_count || 0), 'integer', d.won_count)}
    </div>

    <div class="report-grid-two">
      <section class="report-card">
        <div class="report-card-title">Meta Lead Form Funnel</div>
        ${funnelStep('Impressions', meta.impressions)}
        ${funnelStep('Reach', meta.reach)}
        ${funnelStep('Link clicks', meta.link_clicks)}
        ${funnelStep('Meta form leads', meta.meta_form_leads, 'Native instant form submissions')}
        ${funnelStep('Qualified leads', meta.qualified_leads)}
        ${funnelStep('Won / booked', (meta.won_count || 0) + (meta.booked_count || 0))}
      </section>

      <section class="report-card">
        <div class="report-card-title">Website Funnel</div>
        ${funnelStep('Visits', website.visits)}
        ${funnelStep('Pageviews', website.pageviews)}
        ${funnelStep('Website form submissions', website.form_submissions)}
        ${funnelStep('Qualified leads', website.qualified_leads)}
        ${funnelStep('Won / booked', (website.won_count || 0) + (website.booked_count || 0))}
      </section>
    </div>

    <div class="report-grid-two">
      <section class="report-card">
        <div class="report-card-title">Lead Quality</div>
        <div class="report-quality-grid">
          ${reportKpi('Qualified rate', quality.qualified_rate, 'percent', null)}
          ${reportKpi('Qualified', quality.qualified_leads, 'integer', null)}
          ${reportKpi('Unqualified', quality.unqualified_leads, 'integer', null)}
          ${reportKpi('Lead score', quality.lead_score === null ? 0 : quality.lead_score, 'integer', null, quality.lead_score_status || 'unmapped')}
        </div>
      </section>

      <section class="report-card">
        <div class="report-card-title">Pipeline Stages</div>
        <div class="report-stage-list">
          ${pipeline.length ? pipeline.map(row => `
            <div class="report-stage-row">
              <span>${escapeHtml(String(row.stage || 'unknown').replace(/_/g, ' '))}</span>
              <strong>${fmt(row.count, 'integer')}</strong>
            </div>
          `).join('') : '<div class="text-muted">No pipeline data in this period.</div>'}
        </div>
      </section>
    </div>

    <section class="report-card">
      <div class="report-card-title">Reporting Definitions</div>
      <div class="report-definitions">
        ${Object.entries(data.definitions || {}).map(([key, value]) => `
          <div><strong>${escapeHtml(key.replace(/_/g, ' '))}</strong><br><span class="text-muted">${escapeHtml(value)}</span></div>
        `).join('')}
      </div>
    </section>

    <section class="report-card">
      <div class="report-card-title">Data Freshness</div>
      <div class="report-health-list">
        ${health.length ? health.map(row => `
          <div class="report-health-row">
            <span>${escapeHtml(row.source)} / ${escapeHtml(row.dataset)}</span>
            <span class="badge badge-${row.status === 'success' ? 'active' : row.status === 'partial' ? 'warning' : 'critical'}">${escapeHtml(row.status)}</span>
            <span class="text-muted">${row.reason_code ? escapeHtml(row.reason_code) : 'ok'}</span>
          </div>
        `).join('') : '<div class="text-muted">No sync health records found.</div>'}
      </div>
    </section>
  `;
}

async function loadReportLinks() {
  const wrap = document.getElementById('report-link-admin');
  if (!wrap) return;
  if (!window.currentUser || !['admin', 'operator'].includes(window.currentUser.role)) {
    wrap.innerHTML = '';
    return;
  }
  try {
    const accountId = window.DashboardApp?.getAccountId?.();
    const query = new URLSearchParams();
    if (accountId) query.set('accountId', accountId);
    const res = await apiGet(`/reports/links?${query.toString()}`);
    const rows = res.data || [];
    wrap.innerHTML = `
      <section class="report-card">
        <div class="table-header">
          <span class="table-title">Client Report Links</span>
          <button class="btn btn-sm" onclick="createClientReportLink()">Create Link</button>
        </div>
        <div class="report-health-list">
          ${rows.length ? rows.map((row) => `
            <div class="report-health-row">
              <span>
                <strong>${escapeHtml(row.name || `Report link #${row.id}`)}</strong>
                <span class="text-muted"> · ${row.expires_at ? `expires ${fmtDate(row.expires_at)}` : 'no expiration'}</span>
              </span>
              <span class="badge badge-${row.is_active ? 'active' : 'critical'}">${row.is_active ? 'active' : 'inactive'}</span>
              ${row.is_active ? `<button class="btn btn-sm" onclick="revokeClientReportLink(${row.id})">Revoke</button>` : '<span></span>'}
            </div>
          `).join('') : '<div class="text-muted">No client report links yet.</div>'}
        </div>
      </section>
    `;
  } catch (err) {
    wrap.innerHTML = `<section class="report-card"><div class="text-muted">Report link management unavailable: ${escapeHtml(err.message)}</div></section>`;
  }
}

async function createClientReportLink() {
  const name = prompt('Report link name');
  if (name === null) return;
  const accountId = window.DashboardApp?.getAccountId?.();
  try {
    const payload = { name: name.trim() || 'Client report link' };
    const query = new URLSearchParams();
    if (accountId) query.set('accountId', accountId);
    const res = await apiPost(`/reports/links?${query.toString()}`, payload);
    const path = res.data?.url_path || '';
    await loadReportLinks();
    if (path) {
      prompt('Client report link', `${window.location.origin}${path}`);
    }
  } catch (err) {
    toast(`Report link failed: ${err.message}`, 'error');
  }
}

async function revokeClientReportLink(id) {
  if (!confirm('Revoke this client report link?')) return;
  const accountId = window.DashboardApp?.getAccountId?.();
  const query = new URLSearchParams();
  if (accountId) query.set('accountId', accountId);
  try {
    await apiPost(`/reports/links/${id}/revoke?${query.toString()}`, {});
    await loadReportLinks();
  } catch (err) {
    toast(`Revoke failed: ${err.message}`, 'error');
  }
}
