/* ═══════════════════════════════════════════════════════════
   Admin Dashboard
   ═══════════════════════════════════════════════════════════ */

const dashboardApp = window.DashboardApp;

async function loadAdmin(container) {
  const currentUser = dashboardApp.getCurrentUser();
  if (!currentUser || currentUser.role !== 'admin') {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-text">Admin access required</div></div>';
    return;
  }

  container.innerHTML = `
    <div class="table-container" style="margin-bottom: 20px;">
      <div class="table-header">
        <span class="table-title">Meta Accounts</span>
        <button class="btn btn-sm btn-primary" onclick="openAddAccountDrawer()">+ Add Account</button>
      </div>
      <div id="admin-accounts"><div class="loading">Loading accounts</div></div>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;" class="admin-grid">
      <div class="table-container">
        <div class="table-header">
          <span class="table-title">Users</span>
          <button class="btn btn-sm btn-primary" onclick="openAddUserDrawer()">+ Add User</button>
        </div>
        <div id="admin-users"><div class="loading">Loading users</div></div>
      </div>
      <div class="table-container">
        <div class="table-header">
          <span class="table-title">Active Sessions</span>
        </div>
        <div id="admin-sessions"><div class="loading">Loading sessions</div></div>
      </div>
    </div>
  `;

  await Promise.all([loadAdminAccounts(), loadAdminUsers(), loadAdminSessions()]);
}
