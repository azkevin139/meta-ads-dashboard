(function () {
  const state = {
    currentUser: null,
  };

  function getCurrentUser() {
    return state.currentUser;
  }

  function setCurrentUser(user) {
    state.currentUser = user || null;
  }

  function clearCurrentUser() {
    state.currentUser = null;
  }

  window.SessionState = {
    getCurrentUser,
    setCurrentUser,
    clearCurrentUser,
  };
})();
