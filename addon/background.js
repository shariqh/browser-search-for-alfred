// Keeps a connection to the native helper open and answers its requests.
// handler.js is loaded first and exposes globalThis.BrowserSearchHandler.
(function () {
  const { handleRequest, reconnectDelayMs } = globalThis.BrowserSearchHandler;
  let attempt = 0;
  let port = null; // the one live port, or null
  let retryScheduled = false;

  // At most one retry is waiting at a time, so reconnecting never stops and never doubles up.
  function scheduleReconnect() {
    if (retryScheduled) return;
    retryScheduled = true;
    const delay = reconnectDelayMs(attempt);
    attempt += 1;
    setTimeout(() => {
      retryScheduled = false;
      connect();
    }, delay);
  }

  function connect() {
    if (port !== null) return;
    let current;
    try {
      current = browser.runtime.connectNative("io.github.shariqh.browser_search_for_alfred");
      port = current;
      current.onMessage.addListener(async (msg) => {
        attempt = 0;
        const reply = await handleRequest(browser, msg);
        try {
          current.postMessage(reply);
        } catch (e) {
          // The port disconnected while the request was handled; the helper is gone and nobody waits for this.
        }
      });
      current.onDisconnect.addListener(() => {
        if (port === current) port = null;
        else return; // a late report about a port that is no longer the live one
        scheduleReconnect();
      });
    } catch (e) {
      if (port !== null) {
        try {
          port.disconnect();
        } catch (ignored) {
          // Already gone.
        }
      }
      port = null;
      scheduleReconnect();
    }
  }

  connect();
})();
