(function () {
  // Safari's tabs through its AppleScript dictionary. `app` is JXA's Application("Safari"), or anything shaped
  // like it. Nothing here launches Safari: the caller decides whether to touch the application at all.
  //
  // Safari's dictionary, read from the app with sdef: a window has `id` (an integer) and `index` (read/write)
  // and `current tab` (read/write); a tab has `name`, `URL` and `index`. Tabs have no ID, so a tab is named by its
  // position in its window, and nothing marks a private window.
  //
  // Tab lists are read with one Apple Event per property, each returning every window's values at once:
  // windows.id(), then windows.tabs.name() and windows.tabs.url(), which are arrays of arrays, one inner array
  // per window.

  // Every real call carries a per-call timeout counted down from one shared deadline (lib/ae-budget.js).
  const aeBudget = typeof loadLib === "function" ? loadLib("ae-budget") : require("./ae-budget.js");
  const { budget, isDenied } = aeBudget;

  // tab = {browser: "safari", browserName: "Safari", windowId, tabId, title, url}; every ID is a string and
  // tabId is the tab's position in its window, counting from 1.
  // Returns {tabs, denied}. tabs is [] when Safari is not running, when any read fails or runs out of time
  // (a browser that does not answer contributes no tabs), and when macOS refused Automation, which is the
  // only case with denied: true. A window whose name and URL arrays are missing or of different lengths is
  // skipped, because its tabs cannot be told apart reliably. options = {budgetSeconds, deadlineMs, now}
  // (see ae-budget.js; tests inject a clock).
  function listTabs(app, options) {
    if (!app.running()) return { tabs: [], denied: false };
    try {
      const { call } = budget(options);
      const windows = app.windows;
      const windowIds = call((...m) => windows.id(...m));
      const names = call((...m) => windows.tabs.name(...m));
      const urls = call((...m) => windows.tabs.url(...m));
      const tabs = [];
      for (let w = 0; w < windowIds.length; w++) {
        const windowNames = names[w];
        const windowUrls = urls[w];
        if (!Array.isArray(windowNames) || !Array.isArray(windowUrls) || windowNames.length !== windowUrls.length) continue;
        for (let t = 0; t < windowUrls.length; t++) {
          tabs.push({
            browser: "safari",
            browserName: "Safari",
            windowId: String(windowIds[w]),
            tabId: String(t + 1),
            title: String(windowNames[t] || ""),
            url: String(windowUrls[t] || ""),
          });
        }
      }
      return { tabs, denied: false };
    } catch (e) {
      return { tabs: [], denied: isDenied(e) };
    }
  }

  // Safari's window ID is an integer, and the list carries it as text.
  function windowSpecifier(app, windowId) {
    const id = String(windowId);
    return app.windows.byId(/^\d+$/.test(id) ? Number(id) : id);
  }

  // Selects the tab, puts its window in front, then raises Safari. The tab is the one at `tabPosition`
  // (counting from 1) when it still has `url`, otherwise the first tab in that window with `url`. If no tab in
  // the window has `url`, nothing is changed and the result is false, so a tab that moved or closed after the
  // list was shown is never replaced by a different page. Never throws; false also means the window has gone or
  // Safari did not answer in time.
  function activateTab(app, windowId, tabPosition, url, options) {
    try {
      const { call } = budget(options);
      const win = windowSpecifier(app, windowId);
      // Same normalisation as listTabs, so a tab listed with an empty URL matches its live (missing) one.
      const urls = call((...m) => win.tabs.url(...m)).map((u) => String(u || ""));
      const position = Number(tabPosition);
      let index = urls[position - 1] === url ? position - 1 : urls.indexOf(url);
      if (index < 0) return false;
      // JXA element indexes count from 0.
      win.currentTab = win.tabs[index];
      win.index = 1;
      call((...m) => app.activate(...m));
      return true;
    } catch (e) {
      return false;
    }
  }

  const api = { listTabs, activateTab };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
