(function () {
  const API_BASE = '/api';
  const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const csrfToken = window.SessionState && window.SessionState.getCsrfToken
      ? window.SessionState.getCsrfToken()
      : null;
    const res = await fetch(`${API_BASE}${path}`, {
      credentials: 'same-origin',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(csrfToken && MUTATING.has(method) ? { 'x-csrf-token': csrfToken } : {}),
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
