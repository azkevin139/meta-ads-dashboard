(function () {
  const state = {
    currentUser: null,
    csrfToken: null,
  };

  function getCurrentUser() {
    return state.currentUser;
  }

  function setCurrentUser(user) {
    state.currentUser = user || null;
  }

  function getCsrfToken() {
    return state.csrfToken;
  }

  function setCsrfToken(token) {
    state.csrfToken = token || null;
  }

  function clearCurrentUser() {
    state.currentUser = null;
    state.csrfToken = null;
  }

  window.SessionState = {
    getCurrentUser,
    setCurrentUser,
    getCsrfToken,
    setCsrfToken,
    clearCurrentUser,
  };
})();
