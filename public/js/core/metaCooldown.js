(function () {
  const META_COOLDOWN_KEY = 'meta_cooldown_until';
  const META_COOLDOWN_MESSAGE_KEY = 'meta_cooldown_message';
  let timer = null;

  function remaining() {
    const until = parseInt(localStorage.getItem(META_COOLDOWN_KEY) || '0', 10);
    if (!until) return 0;
    return Math.max(0, Math.ceil((until - Date.now()) / 1000));
  }

  function format(seconds) {
    const s = Math.max(0, Math.ceil(seconds || 0));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }

  function clear() {
    localStorage.removeItem(META_COOLDOWN_KEY);
    localStorage.removeItem(META_COOLDOWN_MESSAGE_KEY);
    const el = document.getElementById('meta-cooldown-banner');
    if (el) el.remove();
    if (timer) clearInterval(timer);
    timer = null;
  }

  function render() {
    const seconds = remaining();
    if (seconds <= 0) {
      clear();
      return;
    }

    let el = document.getElementById('meta-cooldown-banner');
    if (!el) {
      el = document.createElement('div');
      el.id = 'meta-cooldown-banner';
      el.className = 'meta-cooldown-banner';
      document.body.appendChild(el);
    }

    const message = localStorage.getItem(META_COOLDOWN_MESSAGE_KEY) || 'Meta user request limit reached';
    el.innerHTML = `
      <div>
        <strong>Meta cooldown active</strong>
        <span>${message}. Retrying Meta calls in <span class="mono">${format(seconds)}</span>.</span>
      </div>
      <button class="btn btn-sm" onclick="clearMetaCooldown()">Clear</button>
    `;

    if (!timer) timer = setInterval(render, 1000);
  }

  function start(seconds = 900, message = 'Meta user request limit reached') {
    const wait = Math.max(60, parseInt(seconds, 10) || 900);
    localStorage.setItem(META_COOLDOWN_KEY, String(Date.now() + wait * 1000));
    localStorage.setItem(META_COOLDOWN_MESSAGE_KEY, message);
    render();
  }

  window.MetaCooldown = {
    remaining,
    format,
    clear,
    render,
    start,
  };
})();
