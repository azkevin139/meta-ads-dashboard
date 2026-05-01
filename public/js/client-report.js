(function () {
  const allowedPresets = ['7d', '14d', '30d', '60d'];
  const queryPreset = new URLSearchParams(window.location.search).get('preset');
  const queryDays = new URLSearchParams(window.location.search).get('days');
  let activePreset = allowedPresets.includes(queryPreset) ? queryPreset : allowedPresets.includes(`${queryDays}d`) ? `${queryDays}d` : '7d';
  let activeCurrency = 'USD';

  const fmt = {
    money(value) {
      if (value === null || value === undefined) return '—';
      const n = Number(value);
      if (Number.isNaN(n)) return '—';
      try {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: activeCurrency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(n);
      } catch (_err) {
        return window.FormatHelpers.fmt(value, 'currency');
      }
    },
    int(value) { return window.FormatHelpers.fmt(value, 'integer'); },
    pct(value) { return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`; },
  };

  function escape(value) {
    return window.escapeHtml(value);
  }

  function tokenFromPath() {
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts[0] === 'report' ? parts[1] : '';
  }

  async function fetchReport(token) {
    const res = await fetch(`/api/public/reports/${encodeURIComponent(token)}/lead-summary?preset=${encodeURIComponent(activePreset)}`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Report unavailable');
    return json;
  }

  function num(value) {
    return Number(value) || 0;
  }

  function firstDefined() {
    for (let i = 0; i < arguments.length; i += 1) {
      if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
    }
    return null;
  }

  function rate(numerator, denominator) {
    const n = num(numerator);
    const d = num(denominator);
    return d ? `${((n / d) * 100).toFixed(1)}%` : null;
  }

  function deltaClass(value, inverse) {
    if (value === null || value === undefined || Number(value) === 0) return 'neutral';
    const positive = inverse ? Number(value) < 0 : Number(value) > 0;
    return positive ? 'up' : 'down';
  }

  function renderDelta(value, inverse) {
    if (value === null || value === undefined) return '<div class="kpi-sub">No previous data</div>';
    const v = Number(value) || 0;
    const icon = v > 0 ? '↑' : v < 0 ? '↓' : '—';
    return `<div class="kpi-delta ${deltaClass(v, inverse)}">${icon} ${Math.abs(v).toFixed(1)}% vs prev period</div>`;
  }

  function kpi(label, value, delta, inverseDelta, sub) {
    return `
      <div class="kpi-card">
        <div class="kpi-label">${escape(label)}</div>
        <div class="kpi-value">${value}</div>
        ${delta !== undefined ? renderDelta(delta, inverseDelta) : ''}
        ${sub ? `<div class="kpi-sub">${sub}</div>` : ''}
      </div>
    `;
  }

  function changePill(value, inverse) {
    if (value === null || value === undefined) return '<span class="change-pill flat">—</span>';
    const v = Number(value) || 0;
    const cls = deltaClass(v, inverse);
    const icon = v > 0 ? '↑' : v < 0 ? '↓' : '—';
    return `<span class="change-pill ${cls === 'neutral' ? 'flat' : cls}">${icon} ${Math.abs(v).toFixed(1)}%</span>`;
  }

  function widthFor(value, top) {
    if (!top) return 42;
    return Math.max(42, Math.min(100, (num(value) / num(top)) * 100));
  }

  function funnelBlock(label, value, cssClass, width, rateLabel) {
    return `
      <div class="funnel-step-row">
        <div class="funnel-block ${cssClass}" style="width:${width}%;">
          <div class="funnel-block-inner">
            <span class="funnel-block-label">${escape(label)}</span>
            <span class="funnel-block-right">
              <span class="funnel-block-val">${fmt.int(value)}</span>
              ${rateLabel ? `<span class="funnel-block-rate">${escape(rateLabel)}</span>` : ''}
            </span>
          </div>
        </div>
      </div>
      <div class="funnel-drop-row"><div class="funnel-drop-line"></div></div>
    `;
  }

  function renderFunnel({ badge, badgeClass, note, topValue, rows }) {
    return `
      <div class="funnel-header">
        <span class="funnel-source-badge ${badgeClass}">${escape(badge)}</span>
        <span class="funnel-total-note">${escape(note)}</span>
      </div>
      <div class="funnel-steps">
        ${rows.map((row) => row.handoff
          ? '<div class="funnel-handoff">GoHighLevel qualification</div>'
          : funnelBlock(row.label, row.value, row.cssClass, widthFor(row.value, row.top || topValue), row.rate)).join('')}
      </div>
    `;
  }

  function renderSpendBars(dailySpend) {
    const rows = Array.isArray(dailySpend) ? dailySpend : [];
    if (!rows.length) return '<div class="empty-panel">No daily spend data for this period.</div>';
    const max = Math.max(...rows.map((row) => num(row.spend)), 1);
    return `
      <div class="bar-chart" aria-label="Daily ad spend chart">
        ${rows.map((row) => {
          const height = Math.max(2, (num(row.spend) / max) * 100);
          return `<div class="bar" title="${escape(row.date)} · ${escape(fmt.money(row.spend))}" style="height:${height}%"></div>`;
        }).join('')}
      </div>
    `;
  }

  function renderQuality(quality, summary) {
    const total = firstDefined(quality.totalLeads, quality.total_leads, summary.total_leads);
    const qualified = firstDefined(quality.qualifiedLeads, quality.qualified_leads, summary.qualified_leads);
    const unqualified = firstDefined(quality.unqualifiedLeads, quality.unqualified_leads, summary.unqualified_leads);
    const engaged = firstDefined(summary.engaged_leads, quality.engagedLeads, quality.engaged_leads);
    const wonBooked = num(summary.won_count) + num(summary.booked_count);
    return `
      <div class="quality-card">
        <div class="quality-dot qualified"></div>
        <div class="quality-info"><div class="quality-name">Qualified leads</div><div class="quality-num">${fmt.int(qualified)}</div></div>
      </div>
      <div class="quality-card">
        <div class="quality-dot engaged"></div>
        <div class="quality-info"><div class="quality-name">Engaged leads</div><div class="quality-num">${fmt.int(engaged)}</div></div>
      </div>
      <div class="quality-card">
        <div class="quality-dot unqualified"></div>
        <div class="quality-info"><div class="quality-name">Unqualified</div><div class="quality-num">${fmt.int(unqualified)}</div></div>
      </div>
      <div class="quality-card">
        <div class="quality-dot" style="background:var(--green)"></div>
        <div class="quality-info"><div class="quality-name">Won / Booked</div><div class="quality-num">${fmt.int(wonBooked)}</div></div>
      </div>
      <div class="quality-card">
        <div class="quality-dot" style="background:var(--blue)"></div>
        <div class="quality-info"><div class="quality-name">Total leads</div><div class="quality-num">${fmt.int(total)}</div></div>
      </div>
    `;
  }

  function renderPipeline(pipeline) {
    if (!Array.isArray(pipeline) || !pipeline.length) {
      return '<div class="empty-panel">No pipeline data for this period.</div>';
    }
    return pipeline.map((row) => {
      const stage = String(row.stage || 'unknown');
      const cls = stage.includes('won') ? 'won' : stage.includes('lost') ? 'lost' : '';
      return `
        <div class="pipeline-stage ${cls}">
          <div class="pipeline-stage-name">${escape(stage.replace(/_/g, ' '))}</div>
          <div class="pipeline-stage-count">${fmt.int(row.count)}</div>
        </div>
      `;
    }).join('');
  }

  function renderComparison(summary, previous, deltas) {
    const rows = [
      ['Spend', fmt.money(summary.spend), fmt.money(previous.spend), deltas.spend, false],
      ['Impressions', fmt.int(summary.impressions), fmt.int(previous.impressions), deltas.impressions, false],
      ['Link clicks', fmt.int(summary.clicks), fmt.int(previous.clicks), deltas.clicks, false],
      ['Total leads', fmt.int(summary.total_leads), fmt.int(previous.total_leads), deltas.total_leads, false],
      ['Qualified leads', fmt.int(summary.qualified_leads), fmt.int(previous.qualified_leads), deltas.qualified_leads, false],
      ['CPL', fmt.money(summary.cpl), fmt.money(previous.cpl), deltas.cpl, true],
      ['Cost per qualified lead', fmt.money(summary.cost_per_qualified_lead), fmt.money(previous.cost_per_qualified_lead), deltas.cost_per_qualified_lead, true],
    ];
    return rows.map(([label, current, prev, delta, inverse]) => `
      <tr>
        <td>${escape(label)}</td>
        <td>${current}</td>
        <td>${prev}</td>
        <td>${changePill(delta, inverse)}</td>
      </tr>
    `).join('');
  }

  function renderCreatives(creatives) {
    if (!Array.isArray(creatives) || !creatives.length) {
      return '<tr><td colspan="8">No ad-level creative data for this period.</td></tr>';
    }
    return creatives.map((row, index) => `
      <tr>
        <td>
          <div class="creative-name"><span class="rank-badge">${index + 1}</span>${escape(row.creative_name || row.meta_ad_id || 'Unknown creative')}</div>
          <div class="creative-source">Meta ad name · ${escape(row.meta_ad_id || 'unmapped ad ID')}</div>
        </td>
        <td>${fmt.money(row.spend)}</td>
        <td>${fmt.int(row.clicks)}</td>
        <td>${fmt.int(row.total_leads)}</td>
        <td>${fmt.money(row.cpl)}</td>
        <td>${fmt.int(row.qualified_leads)}</td>
        <td>${fmt.int(row.booked_count)}</td>
        <td>${fmt.int(row.won_count)}</td>
      </tr>
    `).join('');
  }

  function creativeTitle(row) {
    return row ? escape(row.creative_name || row.meta_ad_id || 'Unknown visual') : 'Unavailable';
  }

  function renderWinner(label, row, metricLabel, metricValue) {
    if (!row) {
      return `
        <div class="creative-winner-card">
          <div class="creative-winner-label">${escape(label)}</div>
          <div class="creative-winner-name">Unavailable</div>
          <div class="creative-winner-metric">No covered ad-level data</div>
        </div>
      `;
    }
    return `
      <div class="creative-winner-card">
        <div class="creative-winner-label">${escape(label)}</div>
        <div class="creative-winner-name">${creativeTitle(row)}</div>
        <div class="creative-winner-metric">${escape(metricLabel)}: ${metricValue}</div>
      </div>
    `;
  }

  function renderCreativeLeaderboard(leaderboard) {
    const coverage = leaderboard?.coverage || {};
    if (!leaderboard?.available) {
      const reason = coverage.reason_code === 'lead_attribution_coverage_low'
        ? `Lead attribution coverage is ${fmt.pct((coverage.attributed_lead_rate || 0) / 100)}; minimum is ${coverage.minimum_attributed_lead_rate || 20}%.`
        : 'Ad-level Meta data is not available for this period.';
      return `
        <div class="section-label">Creative leaderboard</div>
        <div class="empty-panel">
          Creative leaderboard unavailable. ${escape(reason)}
        </div>
      `;
    }
    const winners = leaderboard.winners || {};
    const rows = leaderboard.rows || [];
    return `
      <div class="section-label">Creative leaderboard</div>
      <div class="creative-winner-grid">
        ${renderWinner('Most clicked visual', winners.most_clicked, 'Clicks', fmt.int(winners.most_clicked?.clicks))}
        ${renderWinner('Most lead-generating visual', winners.most_leads, 'Leads', fmt.int(winners.most_leads?.total_leads))}
        ${renderWinner('Most qualified-lead-generating visual', winners.most_qualified, 'Qualified leads', fmt.int(winners.most_qualified?.qualified_leads))}
      </div>
      <div class="table-scroll" style="margin-top:10px;">
        <table class="creative-table">
          <thead>
            <tr>
              <th>Visual</th>
              <th>Spend</th>
              <th>Clicks</th>
              <th>Leads</th>
              <th>CPL</th>
              <th>Qualified</th>
              <th>Cost / qualified</th>
            </tr>
          </thead>
          <tbody>${rows.map((row, index) => `
            <tr>
              <td>
                <div class="creative-name"><span class="rank-badge">${index + 1}</span>${creativeTitle(row)}</div>
                <div class="creative-source">Meta ad name · ${escape(row.meta_ad_id || 'unmapped ad ID')}</div>
              </td>
              <td>${fmt.money(row.spend)}</td>
              <td>${fmt.int(row.clicks)}</td>
              <td>${fmt.int(row.total_leads)}</td>
              <td>${fmt.money(row.cpl)}</td>
              <td>${fmt.int(row.qualified_leads)}</td>
              <td>${fmt.money(row.cost_per_qualified_lead)}</td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  }

  function renderDefinitions(definitions) {
    return Object.entries(definitions || {}).map(([key, value]) => `
      <div class="definition-item">
        <div class="definition-key">${escape(key.replace(/_/g, ' '))}</div>
        <div class="definition-value">${escape(value)}</div>
      </div>
    `).join('');
  }

  function render(payload) {
    const data = payload.data || {};
    const account = payload.account || {};
    const summary = data.summary || {};
    const previous = data.previous_summary || {};
    const deltas = data.deltas_pct || {};
    const meta = data.metaFunnel || data.meta_funnel || {};
    const website = data.websiteFunnel || data.website_funnel || {};
    const quality = data.leadQuality || data.lead_quality || {};
    const pipeline = data.pipeline || [];
    const creatives = data.creativePerformance || data.creative_performance || [];
    const creativeLeaderboard = data.creativeLeaderboard || data.creative_leaderboard || null;
    const dailySpend = data.dailySpend || data.daily_spend || [];
    const range = data.range || {};
    const updatedAt = new Date().toLocaleString('en-AE', { timeZone: data.timezone || 'Asia/Dubai', dateStyle: 'medium', timeStyle: 'short' });
    activeCurrency = account.currency || 'USD';

    const metaClicks = firstDefined(meta.linkClicks, meta.link_clicks, summary.clicks);
    const metaLeads = firstDefined(meta.metaFormLeads, meta.meta_form_leads, summary.meta_leads);
    const metaReach = firstDefined(meta.reach, summary.reach, meta.impressions, summary.impressions);
    const websiteVisits = firstDefined(website.visits, summary.visits);
    const websiteForms = firstDefined(website.formSubmissions, website.form_submissions, summary.website_leads);
    const metaQualified = firstDefined(meta.qualifiedLeads, meta.qualified_leads, summary.meta_qualified_leads, 0);
    const websiteQualified = firstDefined(website.qualifiedLeads, website.qualified_leads, summary.website_qualified_leads, 0);
    const metaBooked = firstDefined(meta.bookedCount, meta.booked_count, summary.meta_booked_count, 0);
    const websiteBooked = firstDefined(website.bookedCount, website.booked_count, summary.website_booked_count, 0);
    const metaWon = firstDefined(meta.wonCount, meta.won_count, summary.meta_won_count, 0);
    const websiteWon = firstDefined(website.wonCount, website.won_count, summary.website_won_count, 0);
    const wonBooked = num(summary.won_count) + num(summary.booked_count);

    document.getElementById('clientTitle').textContent = account.name || 'Campaign Report';
    document.getElementById('reportSubtitle').textContent = `${range.since || ''} to ${range.until || ''} · Dubai Time`;
    document.getElementById('lastUpdated').textContent = `Updated ${updatedAt}`;

    document.getElementById('mainContent').innerHTML = `
      <div class="section-label">Performance overview</div>
      <div class="kpi-grid">
        ${kpi('Spend', fmt.money(summary.spend), deltas.spend, false)}
        ${kpi('Impressions', fmt.int(summary.impressions), deltas.impressions, false)}
        ${kpi('Link clicks', fmt.int(summary.clicks), deltas.clicks, false)}
        ${kpi('Total leads', fmt.int(summary.total_leads), deltas.total_leads, false)}
        ${kpi('CPL', fmt.money(summary.cpl), deltas.cpl, true)}
        ${kpi(
          'Qualified leads',
          fmt.int(summary.qualified_leads),
          deltas.qualified_leads,
          false,
          summary.qualified_leads_stage !== undefined && summary.qualified_leads_stage !== summary.qualified_leads
            ? `Prior method: ${escape(fmt.int(summary.qualified_leads_stage))}`
            : null,
        )}
        ${kpi('Cost per QL', fmt.money(summary.cost_per_qualified_lead), deltas.cost_per_qualified_lead, true)}
        ${kpi('Won / Booked', fmt.int(wonBooked), deltas.booked_count, false)}
      </div>

      <div class="section-label">Daily spend</div>
      <div class="chart-card-full">
        <div class="chart-title">Ad spend over period</div>
        ${renderSpendBars(dailySpend)}
      </div>

      <div class="section-label">Acquisition funnels</div>
      <div class="funnels-row">
        <div class="funnel-card">
          ${renderFunnel({
            badge: 'Meta Ads',
            badgeClass: 'meta',
            note: `${fmt.int(metaLeads)} leads collected`,
            topValue: metaReach,
            rows: [
              { label: 'Reach', value: metaReach, cssClass: 'fs-reach' },
              { label: 'Link clicks', value: metaClicks, cssClass: 'fs-click', rate: rate(metaClicks, metaReach) },
              { label: 'Instant form submitted', value: metaLeads, cssClass: 'fs-form', rate: rate(metaLeads, metaClicks) },
              { handoff: true },
              { label: 'Qualified', value: metaQualified, cssClass: 'fs-qual', rate: rate(metaQualified, metaLeads) },
              { label: 'Appointment booked', value: metaBooked, cssClass: 'fs-appt', rate: rate(metaBooked, metaQualified) },
              { label: 'Won / Deal closed', value: metaWon, cssClass: 'fs-won', rate: rate(metaWon, metaBooked) },
            ],
          })}
        </div>
        <div class="funnel-card">
          ${renderFunnel({
            badge: 'Landing Page',
            badgeClass: 'lp',
            note: `${fmt.int(websiteForms)} forms submitted`,
            topValue: websiteVisits,
            rows: [
              { label: 'Landing page visits', value: websiteVisits, cssClass: 'fs-reach' },
              { label: 'Form submitted', value: websiteForms, cssClass: 'fs-form', rate: rate(websiteForms, websiteVisits) },
              { handoff: true },
              { label: 'Qualified', value: websiteQualified, cssClass: 'fs-qual', rate: rate(websiteQualified, websiteForms) },
              { label: 'Appointment booked', value: websiteBooked, cssClass: 'fs-appt', rate: rate(websiteBooked, websiteQualified) },
              { label: 'Won / Deal closed', value: websiteWon, cssClass: 'fs-won', rate: rate(websiteWon, websiteBooked) },
            ],
          })}
        </div>
      </div>

      <div class="section-label">Lead quality</div>
      <div class="quality-row">${renderQuality(quality, summary)}</div>

      <div class="section-label">Current pipeline status for leads acquired in this period</div>
      <div class="pipeline-grid">${renderPipeline(pipeline)}</div>

      ${renderCreativeLeaderboard(creativeLeaderboard || { available: Boolean(creatives.length), rows: creatives, winners: {} })}

      <div class="section-label">Period comparison</div>
      <div class="table-scroll">
        <table class="compare-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>This period</th>
              <th>Prev period</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>${renderComparison(summary, previous, deltas)}</tbody>
        </table>
      </div>

      <div class="section-label">Definitions</div>
      <div class="definitions-grid">${renderDefinitions(data.definitions)}</div>

      <div class="footer">
        <div class="footer-brand">E42 Agency</div>
        <div class="footer-note">Read-only report · Powered by Meta Ads &amp; GoHighLevel · Dubai time (GMT+4)</div>
      </div>
    `;
  }

  function setLoading() {
    document.getElementById('mainContent').innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        Pulling report data...
      </div>
    `;
    document.getElementById('errorBanner').style.display = 'none';
  }

  function setUnavailable(message) {
    document.getElementById('clientTitle').textContent = 'Report unavailable';
    document.getElementById('lastUpdated').textContent = '';
    const safe = /expired|revoked|invalid|unavailable/i.test(message || '')
      ? 'Report link unavailable. Ask your account manager for a new report link.'
      : message || 'Unable to load this report.';
    document.getElementById('mainContent').innerHTML = `<div class="empty-panel">${escape(safe)}</div>`;
  }

  async function load() {
    const token = tokenFromPath();
    if (!token) {
      setUnavailable('Invalid report link.');
      return;
    }
    setLoading();
    try {
      render(await fetchReport(token));
    } catch (err) {
      setUnavailable(err.message);
    }
  }

  function bindPresetButtons() {
    document.querySelectorAll('[data-preset]').forEach((button) => {
      button.classList.toggle('active', button.dataset.preset === activePreset);
      button.addEventListener('click', () => {
        activePreset = button.dataset.preset || '7d';
        document.querySelectorAll('[data-preset]').forEach((item) => item.classList.toggle('active', item === button));
        load();
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindPresetButtons();
    load();
  });
})();
