(function () {
  function toast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(10px)';
      el.style.transition = 'all 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  function confirmAction(message) {
    return window.confirm(message);
  }

  function openDrawer(title, bodyHtml, footerHtml) {
    closeDrawer();
    const overlay = document.createElement('div');
    overlay.className = 'drawer-overlay';
    overlay.id = 'drawer-overlay';
    overlay.onclick = closeDrawer;
    document.body.appendChild(overlay);

    const drawer = document.createElement('div');
    drawer.className = 'drawer';
    drawer.id = 'drawer-panel';
    drawer.innerHTML = `
      <div class="drawer-header">
        <span class="drawer-title">${title}</span>
        <button class="drawer-close" onclick="closeDrawer()">✕ Close</button>
      </div>
      <div class="drawer-body" id="drawer-body">${bodyHtml}</div>
      ${footerHtml ? `<div class="drawer-footer">${footerHtml}</div>` : ''}
    `;
    drawer.onclick = (e) => e.stopPropagation();
    document.body.appendChild(drawer);
    requestAnimationFrame(() => { overlay.classList.add('open'); drawer.classList.add('open'); });
  }

  function closeDrawer() {
    const overlay = document.getElementById('drawer-overlay');
    const drawer = document.getElementById('drawer-panel');
    if (overlay) { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 250); }
    if (drawer) { drawer.classList.remove('open'); setTimeout(() => drawer.remove(), 300); }
  }

  function setDrawerBody(html) {
    const body = document.getElementById('drawer-body');
    if (body) body.innerHTML = html;
  }

  window.UiHelpers = {
    toast,
    confirmAction,
    openDrawer,
    closeDrawer,
    setDrawerBody,
  };
})();
