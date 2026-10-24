(() => {
  if (window.__xMediaBridgeInstalled) return;
  window.__xMediaBridgeInstalled = true;
  const emit = (payload) => window.dispatchEvent(new CustomEvent('x-media-timeline', { detail: payload }));
  const isTimelineResponse = (url) => /\/i\/api\/graphql\//.test(String(url || ''));
  const inspect = async (response, url) => {
    if (!isTimelineResponse(url)) return;
    const type = response.headers?.get?.('content-type') ?? '';
    if (!type.includes('json')) return;
    try { emit(await response.clone().json()); } catch { /* Ignore non-JSON or opaque response bodies. */ }
  };
  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    inspect(response, typeof args[0] === 'string' ? args[0] : args[0]?.url);
    return response;
  };
  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (...args) {
    this.addEventListener('load', () => {
      if (!isTimelineResponse(this.responseURL)) return;
      const type = this.getResponseHeader('content-type') ?? '';
      if (!type.includes('json') || typeof this.responseText !== 'string') return;
      try { emit(JSON.parse(this.responseText)); } catch { /* Ignore non-JSON responses. */ }
    });
    return originalOpen.apply(this, args);
  };
})();
