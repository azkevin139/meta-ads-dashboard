window.HeaderStatusHelpers = (() => {
  function createHeaderStatus({ apiGet, getAccountId }) {
    async function updateAIBadge() {
      try {
        const res = await apiGet(`/ai/recommendations?accountId=${getAccountId()}&status=pending`);
        const count = (res.data || []).length;
        const badge = document.getElementById('ai-badge');
        const badgeMobile = document.getElementById('ai-badge-mobile');
        if (badge) {
          badge.textContent = count;
          badge.style.display = count > 0 ? 'inline' : 'none';
        }
        if (badgeMobile) {
          badgeMobile.textContent = count;
          badgeMobile.style.display = count > 0 ? 'inline' : 'none';
        }
      } catch (e) {
        // keep header status best-effort
      }
    }

    function updateClock() {
      const el = document.getElementById('header-time');
      if (el) {
        el.textContent = new Date().toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }

    function start() {
      updateClock();
      updateAIBadge();
      setInterval(updateClock, 30000);
      setInterval(updateAIBadge, 60000);
    }

    return { updateAIBadge, updateClock, start };
  }

  return { createHeaderStatus };
})();
