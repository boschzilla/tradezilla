// Runs in MAIN world (page context) — no chrome APIs available here.
(function () {
  if (window.__poe_analyzer_injected) return;
  window.__poe_analyzer_injected = true;

  function handleResponse(url, getJson) {
    if (url.includes('/api/trade/fetch/') || url.includes('/api/trade2/fetch/')) {
      getJson().then((data) => {
        window.postMessage({ __poe_analyzer: true, result: data.result }, '*');
      }).catch(() => {});
    }
  }

  // ── Intercept fetch ──────────────────────────────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
    handleResponse(url, () => response.clone().json());
    return response;
  };

  // ── Intercept XMLHttpRequest ─────────────────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  function PatchedXHR() {
    const xhr = new OrigXHR();
    let _url = '';

    const origOpen = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      _url = url;
      return origOpen(method, url, ...rest);
    };

    xhr.addEventListener('load', function () {
      handleResponse(_url, () => {
        try { return Promise.resolve(JSON.parse(xhr.responseText)); }
        catch (e) { return Promise.reject(e); }
      });
    });

    return xhr;
  }
  PatchedXHR.prototype = OrigXHR.prototype;
  window.XMLHttpRequest = PatchedXHR;

})();
