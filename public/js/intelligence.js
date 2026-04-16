/* ═══════════════════════════════════════════════════════════
   Decision Center — Meta-token intelligence
   ═══════════════════════════════════════════════════════════ */

let intelPreset = 'yesterday';
let intelDateFrom = daysAgoStr(1);
let intelDateTo = daysAgoStr(1);
let intelBreakdown = 'publisher_platform';

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
      <div class="table-header"><span class="table-title">Audience Segments</span><span class="badge badge-active">RETARGETING</span></div>
      <div id="intel-audience-segments"><div class="loading">Loading audience segments</div></div>
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

  await Promise.all([
    loadDecisionQueues(),
    loadAudienceSegments(),
    loadFunnel(),
    loadBreakdowns(),
    loadCreativeLibrary(),
    loadTrueRoas(),
    loadAudienceHealth(),
    loadJourneys(),
  ]);
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
    const freshness = document.getElementById('intel-freshness');
    if (freshness) {
      freshness.innerHTML = paging && paging.truncated
        ? `<div class="alert-banner alert-warning">Meta returned more data than the safety page limit. Results may be partial.</div>`
        : `<div class="text-muted" style="font-size:0.78rem; text-align:right;">${intelDateFrom === intelDateTo ? intelDateFrom : `${intelDateFrom} to ${intelDateTo}`} · live Meta data</div>`;
    }
    const order = ['Kill Waste', 'Scale Winners', 'Refresh Creative', 'Needs Tracking Review', 'Watch Closely', 'Needs More Data'];
    el.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:14px;">
        ${order.map(q => queueCard(q, queues[q] || [])).join('')}
      </div>
    `;
  } catch (err) {
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
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
              ${escapeHtml(segment.name)}
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

async function pushSegmentToMeta(segmentKey, segmentName) {
  try {
    toast('Uploading to Meta…', 'info');
    const result = await apiPost('/intelligence/audience-push', { segmentKey, segmentName });
    toast(`Uploaded ${result.uploaded || 0} identifier(s) to Meta audience ${result.meta_audience_id}`, 'success');
    loadAudienceSegments();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function toggleAutoRefresh(pushId, currentlyOn) {
  try {
    await apiPost(`/intelligence/audience-push/${pushId}/auto-refresh`, { enabled: !currentlyOn, hours: 24 });
    toast(`Auto-refresh ${!currentlyOn ? 'enabled' : 'disabled'}`, 'success');
    loadAudienceSegments();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

async function openContactDrawer(clientId) {
  if (!clientId) return;
  openDrawer('Contact Journey', '<div class="loading">Loading journey</div>');
  try {
    const res = await apiGet(`/intelligence/contact?clientId=${encodeURIComponent(clientId)}`);
    renderContactDrawer(res.data);
  } catch (err) {
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
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
    el.innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
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
    setDrawerBody(`<div class="alert-banner alert-critical">Error: ${err.message}</div>`);
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
    toast(`Error: ${err.message}`, 'error');
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
