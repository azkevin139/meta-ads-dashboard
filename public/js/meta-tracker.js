(function () {
  var script = document.currentScript || {};
  var endpoint = script.getAttribute && script.getAttribute('data-endpoint') || (window.location.origin + '/api/track/pageview');
  var metaAccountId = script.getAttribute && script.getAttribute('data-meta-account-id') || '';
  var accountId = script.getAttribute && script.getAttribute('data-account-id') || '';
  var cookieName = 'adcmd_client_id';

  function getCookie(name) {
    return document.cookie.split('; ').find(function (row) { return row.indexOf(name + '=') === 0; })?.split('=')[1] || '';
  }

  function setCookie(name, value) {
    var maxAge = 60 * 60 * 24 * 365;
    document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; max-age=' + maxAge + '; SameSite=Lax';
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
  }

  function qp(name) {
    return new URLSearchParams(window.location.search).get(name) || '';
  }

  var clientId = decodeURIComponent(getCookie(cookieName) || '');
  if (!clientId) {
    clientId = uuid();
    setCookie(cookieName, clientId);
  }

  var fbclid = qp('fbclid');
  var fbp = getCookie('_fbp');
  var fbc = getCookie('_fbc');
  if (fbclid && !fbc) {
    fbc = 'fb.1.' + Math.floor(Date.now() / 1000) + '.' + fbclid;
    setCookie('_fbc', fbc);
  }

  var payload = {
    client_id: clientId,
    account_id: accountId,
    meta_account_id: metaAccountId,
    page_url: window.location.href,
    referrer: document.referrer,
    fbclid: fbclid,
    fbp: fbp,
    fbc: fbc,
    utm_source: qp('utm_source'),
    utm_medium: qp('utm_medium'),
    utm_campaign: qp('utm_campaign'),
    utm_content: qp('utm_content'),
    utm_term: qp('utm_term'),
    campaign_id: qp('campaign_id') || qp('utm_campaign_id'),
    adset_id: qp('adset_id') || qp('utm_adset_id'),
    ad_id: qp('ad_id') || qp('utm_ad_id')
  };

  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
    credentials: 'omit'
  }).catch(function () {});

  window.adCommandTrack = function (eventName, data) {
    data = data || {};
    return fetch(endpoint.replace('/pageview', '/event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, payload, data, { event_name: eventName })),
      keepalive: true,
      credentials: 'omit'
    }).catch(function () {});
  };
})();
