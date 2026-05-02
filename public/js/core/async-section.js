(function () {
  function createAsyncSection({ targetId, loadingText = 'Loading', emptyHtml = '', render, onError }) {
    const target = document.getElementById(targetId);
    if (!target) return null;

    return {
      setLoading() {
        target.innerHTML = window.UXPatterns?.loadingState
          ? window.UXPatterns.loadingState(loadingText)
          : `<div class="loading">${loadingText}</div>`;
      },
      setEmpty() {
        target.innerHTML = emptyHtml;
      },
      setError(err) {
        if (typeof onError === 'function') {
          target.innerHTML = onError(err);
          return;
        }
        target.innerHTML = window.UXPatterns?.errorState
          ? window.UXPatterns.errorState({
              title: 'Unable to load this section',
              message: safeErrorMessage(err),
              nextStep: 'Refresh the page or retry the action.',
            })
          : `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
      },
      setData(data) {
        target.innerHTML = render(data);
      },
    };
  }

  window.AsyncSectionHelpers = {
    createAsyncSection,
  };
})();
