(function () {
  const API_BASE = '/api';

  async function request(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  window.ApiClient = {
    request,
  };
})();
