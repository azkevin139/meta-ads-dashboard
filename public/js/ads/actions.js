(function () {
  function createAdsActions({ getPageState }) {
    async function pauseAd(metaId, name) {
      if (!confirmAction(`Pause "${name}"?`)) return;
      try {
        await apiPost('/actions/pause', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId });
        toast(`Paused: ${name}`, 'success');
        navigateTo('ads', getPageState());
      } catch (err) {
        toast(`Error: ${safeErrorMessage(err)}`, 'error');
      }
    }

    async function resumeAd(metaId, name) {
      if (!confirmAction(`Resume "${name}"?`)) return;
      try {
        await apiPost('/actions/resume', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId });
        toast(`Resumed: ${name}`, 'success');
        navigateTo('ads', getPageState());
      } catch (err) {
        toast(`Error: ${safeErrorMessage(err)}`, 'error');
      }
    }

    async function duplicateAd(metaId, name) {
      if (!confirmAction(`Duplicate "${name}"?`)) return;
      try {
        await apiPost('/actions/duplicate', { accountId: ACCOUNT_ID, entityType: 'ad', metaEntityId: metaId });
        toast(`Duplicated: ${name}`, 'success');
      } catch (err) {
        toast(`Error: ${safeErrorMessage(err)}`, 'error');
      }
    }

    return {
      pauseAd,
      resumeAd,
      duplicateAd,
    };
  }

  window.AdsActionHelpers = {
    createAdsActions,
  };
})();
