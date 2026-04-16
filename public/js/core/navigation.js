(function () {
  function createNavigation({ getPages, getPageState, setPageState, setCurrentPage }) {
    function navigateTo(page, state = {}) {
      setCurrentPage(page);
      setPageState({ ...getPageState(), ...state });

      document.querySelectorAll('.nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.page === page);
      });
      document.querySelectorAll('.mobile-nav-item').forEach((el) => {
        el.classList.toggle('active', el.dataset.page === page);
      });

      const pageConfig = getPages()[page];
      if (pageConfig) {
        document.getElementById('page-title').textContent = pageConfig.title;
      }

      const body = document.getElementById('page-body');
      body.innerHTML = '<div class="loading">Loading</div>';

      if (pageConfig && pageConfig.load) {
        const fn = typeof pageConfig.load === 'string' ? window[pageConfig.load] : pageConfig.load;
        if (fn) fn(body);
      }

      history.pushState({ page, ...state }, '', `#${page}`);
    }

    function bindNavHandlers() {
      document.querySelectorAll('.nav-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          navigateTo(el.dataset.page);
        });
      });
      document.querySelectorAll('.mobile-nav-item').forEach((el) => {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          navigateTo(el.dataset.page);
        });
      });
      window.addEventListener('popstate', (e) => {
        if (e.state && e.state.page) navigateTo(e.state.page, e.state);
      });
    }

    return {
      navigateTo,
      bindNavHandlers,
    };
  }

  window.NavigationHelpers = {
    createNavigation,
  };
})();
