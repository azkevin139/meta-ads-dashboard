(function () {
  function safeJson(obj) {
    return JSON.stringify(obj).replace(/</g, '\\u003c');
  }

  function blankToUndefined(value) {
    return value === '' ? undefined : parseFloat(value);
  }

  function tagsToArray(value) {
    return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  function toLocalDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function localDateTimeToIso(value) {
    return value ? new Date(value).toISOString() : null;
  }

  function csvStrings(value) {
    return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  function csvNumbers(value) {
    return csvStrings(value).map((v) => parseInt(v, 10)).filter(Boolean);
  }

  function parseJsonArray(value) {
    try {
      const parsed = JSON.parse(value || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  window.EditorUtils = {
    safeJson,
    blankToUndefined,
    tagsToArray,
    toLocalDateTime,
    localDateTimeToIso,
    csvStrings,
    csvNumbers,
    parseJsonArray,
  };
})();
