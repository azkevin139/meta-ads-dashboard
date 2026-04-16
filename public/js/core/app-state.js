(function () {
  function createAppState() {
    let accountId = parseInt(localStorage.getItem('account_id') || '1', 10);
    let accountContext = null;
    let currentUser = null;
    let currentPage = 'overview';
    let pageState = {};

    return {
      getAccountId: () => accountId,
      setAccountId: (value) => {
        accountId = parseInt(value, 10) || 1;
        localStorage.setItem('account_id', String(accountId));
      },
      getAccountContext: () => accountContext,
      setAccountContext: (value) => { accountContext = value; },
      getCurrentUser: () => currentUser,
      setCurrentUser: (value) => { currentUser = value || null; },
      getCurrentPage: () => currentPage,
      setCurrentPage: (value) => { currentPage = value; },
      getPageState: () => pageState,
      setPageState: (value) => { pageState = value || {}; },
      resetPageState: () => { pageState = {}; },
    };
  }

  window.AppStateHelpers = {
    createAppState,
  };
})();
