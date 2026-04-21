(function () {
  function createAdsBulk({ getPageState }) {
    let selection = null;

    function init(nextSelection) {
      selection = nextSelection;
    }

    async function bulkAdAction(action) {
      if (!selection || selection.size() === 0) return;
      if (!confirmAction(`${action === 'pause' ? 'Pause' : 'Resume'} ${selection.size()} ad(s)?`)) return;
      try {
        toast('Processing...', 'info');
        const res = await apiPost('/create/bulk-action', {
          entityIds: selection.getSelected(),
          entityType: 'ad',
          action,
        });
        toast(res.message, 'success');
        navigateTo('ads', getPageState());
      } catch (err) {
        toast(`Error: ${safeErrorMessage(err)}`, 'error');
      }
    }

    return { init, bulkAdAction };
  }

  window.AdsBulkHelpers = {
    createAdsBulk,
  };
})();
