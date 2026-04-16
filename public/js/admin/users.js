(function () {
  const dashboardApp = window.DashboardApp;
  const asyncSection = window.AsyncSectionHelpers;

  async function loadAdminUsers() {
    const section = asyncSection.createAsyncSection({
      targetId: 'admin-users',
      loadingText: 'Loading users',
      emptyHtml: '<div class="empty-state"><div class="empty-state-text">No users yet</div></div>',
      render: (users) => `<table>
            <thead><tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
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
                  <td>
                    <div class="btn-group">
                      <button class="btn btn-sm" onclick="openEditUserDrawer(${u.id}, '${(u.name || '').replace(/'/g, "\\'")}', '${u.email}', '${u.role}', ${u.is_active})">Edit</button>
                      ${u.id !== dashboardApp.getCurrentUser()?.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUserConfirm(${u.id}, '${u.email}')">Del</button>` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>`,
    });
    section?.setLoading();
    try {
      const res = await apiGet('/admin/users');
      const users = res.data || [];
      if (!users.length) return section?.setEmpty();
      section?.setData(users);
    } catch (err) {
      section?.setError(err);
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
        <input id="new-user-password" class="form-input" type="password" placeholder="Min 10 characters" />
      </div>
      <div class="form-group">
        <label class="form-label">Role</label>
        <select id="new-user-role" class="form-select">
          <option value="viewer">Viewer — read only</option>
          <option value="operator">Operator — can edit ads</option>
          <option value="admin">Admin — full access</option>
        </select>
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
    if (!email || !password) {
      toast('Email and password required', 'error');
      return;
    }
    try {
      await apiPost('/admin/users', { email, password, name, role });
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

  Object.assign(window, {
    loadAdminUsers,
    openAddUserDrawer,
    addUser,
    openEditUserDrawer,
    saveUserEdit,
    deleteUserConfirm,
  });
})();
