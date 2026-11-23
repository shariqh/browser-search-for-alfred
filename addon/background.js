// Keeps a connection to the native helper open and answers its requests.
// handler.js is loaded first and exposes globalThis.BrowserSearchHandler.
(function () {
  const { handleRequest, reconnectDelayMs } = globalThis.BrowserSearchHandler;
  let attempt = 0;

  function connect() {
    const port = browser.runtime.connectNative("io.github.shariqh.browser_search_for_alfred");
    port.onMessage.addListener(async (msg) => {
      attempt = 0;
      port.postMessage(await handleRequest(browser, msg));
    });
    port.onDisconnect.addListener(() => {
      const delay = reconnectDelayMs(attempt);
      attempt += 1;
      setTimeout(connect, delay);
    });
  }

  connect();
})();
