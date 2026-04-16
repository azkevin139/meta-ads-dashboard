(function () {
  const asyncSection = window.AsyncSectionHelpers;

  async function loadAdminSessions() {
    const section = asyncSection.createAsyncSection({
      targetId: 'admin-sessions',
      loadingText: 'Loading sessions',
      emptyHtml: '<div class="empty-state"><div class="empty-state-text">No active sessions</div></div>',
      onError: () => '<div class="text-muted" style="padding: 20px;">Could not load sessions</div>',
      render: (sessions) => `<table>
            <thead><tr>
              <th>User</th>
              <th>IP</th>
              <th>Connected</th>
              <th>Expires</th>
            </tr></thead>
            <tbody>
              ${sessions.map(s => `
                <tr>
                  <td>
                    <div style="font-weight: 500; font-size: 0.85rem;">${s.name || '—'}</div>
                    <div class="text-muted" style="font-size: 0.72rem;">${s.email}</div>
                  </td>
                  <td class="mono" style="font-size: 0.75rem;">${s.ip_address || '—'}</td>
                  <td style="font-size: 0.78rem;">${fmtDateTime(s.created_at)}</td>
                  <td style="font-size: 0.78rem;">${fmtDateTime(s.expires_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>`,
    });
    section?.setLoading();
    try {
      const res = await apiGet('/admin/sessions');
      const sessions = res.data || [];
      if (!sessions.length) return section?.setEmpty();
      section?.setData(sessions);
    } catch (err) {
      section?.setError(err);
    }
  }

  window.loadAdminSessions = loadAdminSessions;
})();
