(function () {
  function createDateRangeState({ initialPreset, presets, todayStr, daysAgoStr }) {
    let preset = initialPreset;
    let range = resolvePreset(initialPreset);

    function resolvePreset(nextPreset) {
      const today = todayStr();
      switch (nextPreset) {
        case 'today':
          return { from: today, to: today };
        case 'yesterday':
          return { from: daysAgoStr(1), to: daysAgoStr(1) };
        case '7d':
          return { from: daysAgoStr(7), to: daysAgoStr(1) };
        case '14d':
          return { from: daysAgoStr(14), to: daysAgoStr(1) };
        case '30d':
          return { from: daysAgoStr(30), to: daysAgoStr(1) };
        default:
          return range;
      }
    }

    function setPreset(nextPreset) {
      preset = nextPreset;
      if (presets.includes(nextPreset) && nextPreset !== 'custom') {
        range = resolvePreset(nextPreset);
      }
      return getState();
    }

    function setCustom(from, to) {
      preset = 'custom';
      range = { from, to };
      return getState();
    }

    function getState() {
      return { preset, from: range.from, to: range.to };
    }

    function getLabel({ liveTodayLabel, yesterdayLabel }) {
      if (preset === 'today') return liveTodayLabel || 'Today';
      if (preset === 'yesterday') return yesterdayLabel ? yesterdayLabel(range.from) : `Yesterday (${range.from})`;
      if (range.from === range.to) return range.from;
      return `${range.from} → ${range.to}`;
    }

    return {
      getState,
      setPreset,
      setCustom,
      getLabel,
    };
  }

  window.PageFilterHelpers = {
    createDateRangeState,
  };
})();
