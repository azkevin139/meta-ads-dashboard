(function () {
  var script = document.currentScript || {};
  var endpoint = script.getAttribute && script.getAttribute('data-endpoint') || (window.location.origin + '/api/track/pageview');
  var eventEndpoint = endpoint.replace(/\/pageview(?:\?.*)?$/, '/event');
  var metaAccountId = script.getAttribute && script.getAttribute('data-meta-account-id') || '';
  var accountId = script.getAttribute && script.getAttribute('data-account-id') || '';
  var debug = script.getAttribute && script.getAttribute('data-debug') === 'true';
  var clientCookie = 'adcmd_client_id';
  var lastUrl = null;

  function log() {
    if (!debug || !window.console || !window.console.log) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[meta-tracker]');
    window.console.log.apply(window.console, args);
  }

  function getCookie(name) {
    var row = document.cookie.split('; ').find(function (item) { return item.indexOf(name + '=') === 0; });
    return row ? row.split('=').slice(1).join('=') : '';
  }

  function setCookie(name, value) {
    var maxAge = 60 * 60 * 24 * 365;
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function qp(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || '';
    } catch (err) {
      return '';
    }
  }

  function getClientId() {
    var existing = decodeURIComponent(getCookie(clientCookie) || '');
    if (existing) return existing;
    var id = uuid();
    setCookie(clientCookie, id);
    return id;
  }

  function getFbc() {
    var fbclid = qp('fbclid');
    var current = decodeURIComponent(getCookie('_fbc') || '');
    if (current) return current;
    if (!fbclid) return '';
    var derived = 'fb.1.' + Date.now() + '.' + fbclid;
    setCookie('_fbc', derived);
    return derived;
  }

  function buildPayload(extra) {
    return Object.assign({
      client_id: getClientId(),
      account_id: accountId,
      meta_account_id: metaAccountId,
      page_url: window.location.href,
      page_title: document.title || '',
      referrer: document.referrer || '',
      fbclid: qp('fbclid'),
      fbp: decodeURIComponent(getCookie('_fbp') || ''),
      fbc: getFbc(),
      utm_source: qp('utm_source'),
      utm_medium: qp('utm_medium'),
      utm_campaign: qp('utm_campaign'),
      utm_content: qp('utm_content'),
      utm_term: qp('utm_term'),
      campaign_id: qp('campaign_id') || qp('utm_campaign_id'),
      adset_id: qp('adset_id') || qp('utm_adset_id'),
      ad_id: qp('ad_id') || qp('utm_ad_id')
    }, extra || {});
  }

  function postJson(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      credentials: 'omit'
    }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res;
    });
  }

  function beacon(url, payload) {
    try {
      if (!navigator.sendBeacon) return false;
      return navigator.sendBeacon(url, new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    } catch (err) {
      log('sendBeacon error', err);
      return false;
    }
  }

  function send(url, payload, options) {
    options = options || {};
    if (!metaAccountId) {
      log('missing data-meta-account-id');
      return Promise.resolve(false);
    }

    return postJson(url, payload).then(function () {
      log('sent', payload.event_name || 'PageView', payload.page_url || '');
      return true;
    }).catch(function (err) {
      log('fetch failed', err && err.message ? err.message : err);
      if (options.retry !== false) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            postJson(url, payload).then(function () {
              log('retry succeeded', payload.event_name || 'PageView', payload.page_url || '');
              resolve(true);
            }).catch(function (retryErr) {
              log('retry failed', retryErr && retryErr.message ? retryErr.message : retryErr);
              var ok = beacon(url, payload);
              log('sendBeacon fallback', ok ? 'ok' : 'failed');
              resolve(ok);
            });
          }, 1200);
        });
      }
      var ok = beacon(url, payload);
      log('sendBeacon fallback', ok ? 'ok' : 'failed');
      return ok;
    });
  }

  function trackPageView() {
    var url = window.location.href;
    if (url === lastUrl) return;
    lastUrl = url;
    send(endpoint, buildPayload({ event_name: 'PageView' }));
  }

  var originalPushState = history.pushState;
  history.pushState = function () {
    originalPushState.apply(history, arguments);
    setTimeout(trackPageView, 0);
  };

  var originalReplaceState = history.replaceState;
  history.replaceState = function () {
    originalReplaceState.apply(history, arguments);
    setTimeout(trackPageView, 0);
  };

  window.addEventListener('popstate', trackPageView);
  window.addEventListener('load', trackPageView);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(trackPageView, 0);
  }

  window.adCommandTrack = function (eventName, data) {
    if (!eventName) {
      log('missing event name');
      return Promise.resolve(false);
    }
    return send(eventEndpoint, buildPayload(Object.assign({}, data || {}, { event_name: eventName })), { retry: true });
  };
})();
