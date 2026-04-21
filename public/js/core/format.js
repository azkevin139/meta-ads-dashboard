(function () {
  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function safeErrorMessage(err) {
    return escapeHtml(err && err.message ? err.message : 'Unexpected error');
  }

  function fmt(value, type = 'number') {
    if (value === null || value === undefined) return '—';
    const n = parseFloat(value);
    if (isNaN(n)) return value;
    switch (type) {
      case 'currency': return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      case 'percent': return n.toFixed(2) + '%';
      case 'decimal': return n.toFixed(2);
      case 'integer': return Math.round(n).toLocaleString('en-US');
      case 'compact':
        if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return Math.round(n).toLocaleString('en-US');
      default: return n.toLocaleString('en-US');
    }
  }

  function fmtDelta(value) {
    if (value === null || value === undefined || value === 0) return { text: '0%', cls: 'flat' };
    const n = parseFloat(value);
    const arrow = n > 0 ? '↑' : '↓';
    return { text: `${arrow} ${Math.abs(n)}%`, cls: n > 0 ? 'up' : 'down' };
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  function fmtDateTime(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function fmtBudget(cents) {
    if (!cents) return '—';
    return '$' + (cents / 100).toFixed(2);
  }

  window.FormatHelpers = {
    escapeHtml,
    safeErrorMessage,
    fmt,
    fmtDelta,
    fmtDate,
    fmtDateTime,
    fmtBudget,
  };
  window.escapeHtml = escapeHtml;
  window.safeErrorMessage = safeErrorMessage;
})();
