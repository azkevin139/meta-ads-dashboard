(function () {
  function createAsyncSection({ targetId, loadingText = 'Loading', emptyHtml = '', render, onError }) {
    const target = document.getElementById(targetId);
    if (!target) return null;

    return {
      setLoading() {
        target.innerHTML = `<div class="loading">${loadingText}</div>`;
      },
      setEmpty() {
        target.innerHTML = emptyHtml;
      },
      setError(err) {
        if (typeof onError === 'function') {
          target.innerHTML = onError(err);
          return;
        }
        target.innerHTML = `<div class="alert-banner alert-critical">Error: ${safeErrorMessage(err)}</div>`;
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
