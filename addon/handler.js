(function () {
  // These two limits are repeated in workflow/firefox-helper.js, which loads nothing at runtime.
  const QUERY_MAX_CHARS = 512;
  const HISTORY_MAX_RESULTS = 50;

  // Only these kinds of address are ever listed; place:, javascript:, data: and the like never are.
  function isOpenableUrl(url) {
    return typeof url === "string" && /^(https?|file):/i.test(url);
  }

  function validHistoryParams(params) {
    return (
      typeof params.query === "string" &&
      params.query.length <= QUERY_MAX_CHARS &&
      Number.isInteger(params.maxResults) &&
      params.maxResults >= 1 &&
      params.maxResults <= HISTORY_MAX_RESULTS
    );
  }

  // Every bookmark with an openable URL, depth first. Folders and separators are skipped, but their
  // children are not.
  function collectBookmarks(node, out) {
    if (!node) return;
    if (node.type !== "folder" && node.type !== "separator" && isOpenableUrl(node.url)) {
      out.push({ title: node.title, url: node.url });
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) collectBookmarks(child, out);
    }
  }

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
      if (command === "list-bookmarks") {
        const payload = [];
        for (const root of await browser.bookmarks.getTree()) collectBookmarks(root, payload);
        return { id, payload };
      }
      if (command === "search-history") {
        if (!validHistoryParams(params)) return { id, error: "invalid params" };
        // startTime: 0, because Firefox searches only the last 24 hours without it.
        const items = await browser.history.search({ text: params.query, startTime: 0, maxResults: params.maxResults });
        const payload = items
          .filter((item) => isOpenableUrl(item.url))
          .map((item) => ({ title: item.title, url: item.url, lastVisitTime: item.lastVisitTime }));
        return { id, payload };
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
