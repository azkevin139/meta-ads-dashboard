(function () {
  function createAuthUi({ sessionState, onLoginSuccess }) {
    function showLogin() {
      document.getElementById('app-layout').style.display = 'none';
      document.getElementById('login-screen').style.display = 'flex';
      document.getElementById('login-screen').innerHTML = `
        <div class="login-card">
          <div class="login-logo"><span class="dot" style="width:10px; height:10px; background:var(--green); border-radius:50%; display:inline-block;"></span> Ad Command</div>
          <div class="login-subtitle">Sign in to your dashboard</div>
          <div id="login-error"></div>
          <div id="login-form">
            <input id="login-email" class="form-input" type="email" placeholder="Email" autocomplete="email" style="margin-bottom: 12px;" />
            <input id="login-password" class="form-input" type="password" placeholder="Password" autocomplete="current-password" style="margin-bottom: 16px;" />
            <button class="btn btn-primary" style="width: 100%; padding: 12px; font-size: 0.9rem;" id="login-submit-btn">Sign In</button>
            <div style="text-align: center; margin-top: 14px;">
              <span class="text-muted" style="font-size: 0.8rem;">No account?</span>
              <span style="font-size: 0.8rem; margin-left: 4px;">Contact an admin</span>
            </div>
          </div>
        </div>
      `;
      const password = document.getElementById('login-password');
      const submit = document.getElementById('login-submit-btn');
      if (password) {
        password.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') handleLogin();
        });
      }
      if (submit) submit.addEventListener('click', handleLogin);
    }

    async function handleLogin() {
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const errorDiv = document.getElementById('login-error');
      errorDiv.innerHTML = '';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        sessionState.setCurrentUser(data.user);
        await onLoginSuccess(data.user);
      } catch (err) {
        errorDiv.innerHTML = `<div class="alert-banner alert-critical" style="margin-bottom:12px; font-size:0.82rem;">${err.message}</div>`;
      }
    }

    return {
      showLogin,
      handleLogin,
    };
  }

  window.AuthUiHelpers = {
    createAuthUi,
  };
})();
