(function () {
  function createApiRuntime({ apiClient, cooldown, onUnauthorized }) {
    function getAuthHeaders() {
      return { 'Content-Type': 'application/json' };
    }

    function isMetaHeavyPath(path) {
      return path.startsWith('/meta') ||
        path.startsWith('/intelligence') ||
        path.startsWith('/create') ||
        path.startsWith('/actions') ||
        path.startsWith('/ai/run');
    }

    async function api(path, options = {}) {
      const cooldownRemaining = cooldown.remaining();
      if (cooldownRemaining > 0 && isMetaHeavyPath(path)) {
        cooldown.render();
        throw new Error(`Meta cooldown active. Try again in ${cooldown.format(cooldownRemaining)}.`);
      }

      const { res, data } = await apiClient.request(path, {
        credentials: 'same-origin',
        headers: getAuthHeaders(),
        ...options,
      });

      if (res.status === 401) {
        onUnauthorized();
        throw new Error('Session expired — please login again');
      }

      if (!res.ok) {
        const message = data.error || `API error ${res.status}`;
        const lower = String(message).toLowerCase();
        if (res.status === 429 || lower.includes('user request limit reached')) {
          cooldown.start(data.retry_after_seconds || 900, message);
        }
        throw new Error(message);
      }

      return data;
    }

    return {
      api,
      apiGet: (path) => api(path),
      apiPost: (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) }),
      apiDelete: (path) => api(path, { method: 'DELETE' }),
      isMetaHeavyPath,
    };
  }

  window.ApiRuntimeHelpers = {
    createApiRuntime,
  };
})();
