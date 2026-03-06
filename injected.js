// Runs in page context — intercepts fetch calls to the PoE trade API
(function () {
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');

    if (url.includes('/api/trade/fetch/') || url.includes('/api/trade2/fetch/')) {
      response.clone().json().then((data) => {
        window.postMessage({ __poe_analyzer: true, result: data.result }, '*');
      }).catch(() => {});
    }

    return response;
  };
})();
