(function () {
  function createLayoutHelpers({ escapeHtml }) {
    function renderAccountSwitcher(accountContext, switchActiveAccount) {
      const actions = document.querySelector('.page-actions');
      if (!actions) return;
      let wrap = document.getElementById('account-switcher-wrap');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'account-switcher-wrap';
        actions.insertBefore(wrap, actions.firstChild);
      }
      const accounts = accountContext?.data || [];
      const active = accountContext?.active || null;
      if (!accounts.length) {
        wrap.innerHTML = active ? `<span class="account-chip">${escapeHtml(active.label || active.name || active.meta_account_id || 'Meta account')}</span>` : '';
        return;
      }
      wrap.innerHTML = `
        <select id="account-switcher" class="form-select account-switcher">
          ${accounts.map((a) => `<option value="${a.id}" ${String(a.id) === String(active?.id) ? 'selected' : ''}>${escapeHtml(a.label || a.name || a.meta_account_id)}</option>`).join('')}
        </select>
      `;
      const select = document.getElementById('account-switcher');
      if (select) select.onchange = () => switchActiveAccount(select.value);
    }

    function applyUserLayout(currentUser) {
      const adminNav = document.getElementById('nav-admin');
      const adminNavMobile = document.getElementById('nav-admin-mobile');
      if (adminNav) adminNav.style.display = currentUser.role === 'admin' ? '' : 'none';
      if (adminNavMobile) adminNavMobile.style.display = currentUser.role === 'admin' ? '' : 'none';

      const userInfo = document.getElementById('user-info');
      if (userInfo) userInfo.textContent = currentUser.name || currentUser.email;
    }

    return {
      renderAccountSwitcher,
      applyUserLayout,
    };
  }

  window.LayoutHelpers = {
    createLayoutHelpers,
  };
})();
