/* ═══════════════════════════════════════════════════════════
   Admin Dashboard
   ═══════════════════════════════════════════════════════════ */

async function loadAdmin(container) {
  if (!currentUser || currentUser.role !== 'admin') {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-text">Admin access required</div></div>';
    return;
  }

  container.innerHTML = `
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

  await Promise.all([loadAdminUsers(), loadAdminSessions()]);
}

async function loadAdminUsers() {
  try {
    const res = await apiGet('/admin/users');
    const users = res.data || [];

    document.getElementById('admin-users').innerHTML = users.length === 0
      ? '<div class="empty-state"><div class="empty-state-text">No users yet</div></div>'
      : `<table>
          <thead><tr>
            <th>User</th>
            <th>Role</th>
            <th>Status</th>
            <th>Last Login</th>
            <th>API</th>
            <th>Actions</th>
          </tr></thead>
          <tbody>
            ${users.map(u => `
              <tr>
                <td>
                  <div style="font-weight: 500; font-size: 0.85rem;">${u.name || '—'}</div>
                  <div class="text-muted" style="font-size: 0.72rem;">${u.email}</div>
                </td>
                <td><span class="badge badge-${u.role === 'admin' ? 'critical' : u.role === 'operator' ? 'active' : 'low'}">${u.role}</span></td>
                <td>${u.is_active ? '<span class="text-green">Active</span>' : '<span class="text-red">Disabled</span>'}</td>
                <td style="font-size: 0.78rem;">${u.last_login ? fmtDateTime(u.last_login) : 'Never'}</td>
                <td>${u.has_meta_token ? '<span class="text-green">✓</span>' : '<span class="text-muted">—</span>'}</td>
                <td>
                  <div class="btn-group">
                    <button class="btn btn-sm" onclick="openEditUserDrawer(${u.id}, '${(u.name || '').replace(/'/g, "\\'")}', '${u.email}', '${u.role}', ${u.is_active})">Edit</button>
                    ${u.id !== currentUser.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUserConfirm(${u.id}, '${u.email}')">Del</button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
  } catch (err) {
    document.getElementById('admin-users').innerHTML = `<div class="alert-banner alert-critical">Error: ${err.message}</div>`;
  }
}

async function loadAdminSessions() {
  try {
    const res = await apiGet('/admin/sessions');
    const sessions = res.data || [];

    document.getElementById('admin-sessions').innerHTML = sessions.length === 0
      ? '<div class="empty-state"><div class="empty-state-text">No active sessions</div></div>'
      : `<table>
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
        </table>`;
  } catch (err) {
    document.getElementById('admin-sessions').innerHTML = `<div class="text-muted" style="padding: 20px;">Could not load sessions</div>`;
  }
}

function openAddUserDrawer() {
  openDrawer('Add User', `
    <div class="form-group">
      <label class="form-label">Name</label>
      <input id="new-user-name" class="form-input" type="text" placeholder="Full Name" />
    </div>
    <div class="form-group">
      <label class="form-label">Email</label>
      <input id="new-user-email" class="form-input" type="email" placeholder="email@example.com" />
    </div>
    <div class="form-group">
      <label class="form-label">Password</label>
      <input id="new-user-password" class="form-input" type="password" placeholder="Min 6 characters" />
    </div>
    <div class="form-group">
      <label class="form-label">Role</label>
      <select id="new-user-role" class="form-select">
        <option value="viewer">Viewer — read only</option>
        <option value="operator">Operator — can edit ads</option>
        <option value="admin">Admin — full access</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Meta API Token (optional)</label>
      <input id="new-user-token" class="form-input" type="text" placeholder="User's own Meta token" />
    </div>
    <div style="display: flex; gap: 8px; margin-top: 16px;">
      <button class="btn btn-primary" onclick="addUser()">Create User</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>
  `);
}

async function addUser() {
  const name = document.getElementById('new-user-name').value;
  const email = document.getElementById('new-user-email').value;
  const password = document.getElementById('new-user-password').value;
  const role = document.getElementById('new-user-role').value;

  if (!email || !password) { toast('Email and password required', 'error'); return; }

  try {
    await apiPost('/auth/register', { email, password, name });
    // If role isn't viewer, update it
    if (role !== 'viewer') {
      const users = (await apiGet('/admin/users')).data;
      const newUser = users.find(u => u.email === email.toLowerCase());
      if (newUser) await apiPost(`/admin/users/${newUser.id}`, { role });
    }
    toast('User created', 'success');
    closeDrawer();
    loadAdminUsers();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

function openEditUserDrawer(userId, name, email, role, isActive) {
  openDrawer('Edit User', `
    <div style="margin-bottom: 16px;">
      <div style="font-weight: 600;">${name || email}</div>
      <div class="text-muted" style="font-size: 0.78rem;">${email}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input id="edit-user-name" class="form-input" type="text" value="${name}" />
    </div>
    <div class="form-group">
      <label class="form-label">Role</label>
      <select id="edit-user-role" class="form-select">
        <option value="viewer" ${role === 'viewer' ? 'selected' : ''}>Viewer</option>
        <option value="operator" ${role === 'operator' ? 'selected' : ''}>Operator</option>
        <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">Status</label>
      <select id="edit-user-active" class="form-select">
        <option value="true" ${isActive ? 'selected' : ''}>Active</option>
        <option value="false" ${!isActive ? 'selected' : ''}>Disabled</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">New Password (leave empty to keep)</label>
      <input id="edit-user-password" class="form-input" type="password" placeholder="New password" />
    </div>
    <div class="form-group">
      <label class="form-label">Meta API Token</label>
      <input id="edit-user-token" class="form-input" type="text" placeholder="User's Meta token" />
    </div>
    <div style="display: flex; gap: 8px; margin-top: 16px;">
      <button class="btn btn-primary" onclick="saveUserEdit(${userId})">Save</button>
      <button class="btn" onclick="closeDrawer()">Cancel</button>
    </div>
  `);
}

async function saveUserEdit(userId) {
  const updates = {
    name: document.getElementById('edit-user-name').value,
    role: document.getElementById('edit-user-role').value,
    is_active: document.getElementById('edit-user-active').value === 'true',
  };
  const pw = document.getElementById('edit-user-password').value;
  if (pw) updates.password = pw;
  const token = document.getElementById('edit-user-token').value;
  if (token) updates.meta_token = token;

  try {
    await apiPost(`/admin/users/${userId}`, updates);
    toast('User updated', 'success');
    closeDrawer();
    loadAdminUsers();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}

async function deleteUserConfirm(userId, email) {
  if (!confirmAction(`Delete user "${email}"? This cannot be undone.`)) return;
  try {
    await apiDelete(`/admin/users/${userId}`);
    toast('User deleted', 'success');
    loadAdminUsers();
  } catch (err) {
    toast(`Error: ${err.message}`, 'error');
  }
}
