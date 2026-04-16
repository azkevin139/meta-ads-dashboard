(function () {
  function createBulkSelection({ checkboxSelector, barId, countId }) {
    let selected = new Set();

    function sync() {
      selected.clear();
      document.querySelectorAll(`${checkboxSelector}:checked`).forEach((el) => selected.add(el.value));
      render();
    }

    function render() {
      const bar = document.getElementById(barId);
      const count = document.getElementById(countId);
      if (!bar || !count) return;
      if (selected.size > 0) {
        bar.style.display = 'flex';
        count.textContent = `${selected.size} selected`;
      } else {
        bar.style.display = 'none';
      }
    }

    function toggleAll(ids, checked) {
      document.querySelectorAll(checkboxSelector).forEach((el) => { el.checked = checked; });
      selected = checked ? new Set(ids.map(String)) : new Set();
      render();
    }

    function clear() {
      selected.clear();
      document.querySelectorAll(checkboxSelector).forEach((el) => { el.checked = false; });
      render();
    }

    return {
      sync,
      clear,
      toggleAll,
      getSelected: () => Array.from(selected),
      size: () => selected.size,
    };
  }

  window.BulkSelectionHelpers = {
    createBulkSelection,
  };
})();
