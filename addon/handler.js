(function () {
  // Answers one request from the native helper. Never throws: a failure
  // comes back as {id, error}.
  async function handleRequest(browser, request) {
    const id = request && request.id;
    const command = request && request.command;
    const params = (request && request.params) || {};
    try {
      if (command === "list-tabs") {
        const tabs = await browser.tabs.query({});
        const payload = tabs
          // Private browsing stays private: a tab in a private window never reaches Alfred.
          .filter((t) => t.id !== browser.tabs.TAB_ID_NONE && t.incognito !== true)
          .map((t) => ({
            id: t.id,
            windowId: t.windowId,
            index: t.index,
            title: t.title,
            url: t.url,
            active: t.active,
          }));
        return { id, payload };
      }
      if (command === "activate-tab") {
        // An ID that is missing or not an integer must never fall through to "the current tab".
        if (!Number.isInteger(params.tabId) || !Number.isInteger(params.windowId)) {
          return { id, error: "invalid params" };
        }
        await browser.tabs.update(params.tabId, { active: true });
        await browser.windows.update(params.windowId, { focused: true });
        return { id, payload: true };
      }
      return { id, error: "unknown command: " + command };
    } catch (e) {
      return { id, error: String((e && e.message) || e) };
    }
  }

  // 1 s, 2 s, 4 s, 8 s, then 10 s for every later attempt.
  function reconnectDelayMs(attempt) {
    return Math.min(1000 * Math.pow(2, attempt), 10000);
  }

  const api = { handleRequest, reconnectDelayMs };
  if (typeof module === "object" && module && module.exports) {
    module.exports = api;
  } else {
    globalThis.BrowserSearchHandler = api;
  }
  return api;
})();
