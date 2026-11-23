(function () {
  // Chrome and the other Chromium browsers (Brave, Edge) through their AppleScript dictionary. `app` is JXA's
  // Application("Google Chrome"), or anything shaped like it. Nothing here launches a browser:
  // the caller decides whether to touch the application at all.
  //
  // Tab lists are read with one Apple Event per property, each returning every window's values at once
  // (the approach of epilande/alfred-browser-tabs): windows.id(), then windows.tabs.id() / title() / url(),
  // which are arrays of arrays, one inner array per window, and finally windows.id() again to prove no
  // window came or went in between. IDs are text in Chrome's dictionary.

  // Every real call carries a per-call timeout counted down from one shared deadline (lib/ae-budget.js).
  const aeBudget = typeof loadLib === "function" ? loadLib("ae-budget") : require("./ae-budget.js");
  const { budget, isDenied } = aeBudget;

  function sameList(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (String(a[i]) !== String(b[i])) return false;
    return true;
  }

  // `browser` is a registry entry from lib/browsers.js (any family "chromium" browser).
  // tab = {browser: browser.key, browserName: browser.name, windowId, tabId, title, url}; every ID is a string.
  // Returns {tabs, denied}. tabs is [] when the browser is not running, when any read fails or runs out of
  // time (a browser that does not answer contributes no tabs), and when macOS refused Automation, which is
  // the only case with denied: true. Incognito windows are never listed. options = {budgetSeconds,
  // deadlineMs, now} (see ae-budget.js; tests inject a clock).
  function listTabs(app, browser, options) {
    if (!app.running()) return { tabs: [], denied: false };
    try {
      const { call } = budget(options);
      const windows = app.windows;
      const windowIds = call((...m) => windows.id(...m));
      const modes = call((...m) => windows.mode(...m));
      const tabIds = call((...m) => windows.tabs.id(...m));
      const titles = call((...m) => windows.tabs.title(...m));
      const urls = call((...m) => windows.tabs.url(...m));
      // The reads above are separate Apple Events, so a window can open or close between them, which shifts
      // every later array against the modes and would pair a private window's tabs with "normal". Read the
      // window list once more: unless it is the same list in the same order, and every per-window array has
      // one entry per window, nothing is listed.
      const windowIdsAfter = call((...m) => windows.id(...m));
      if (!sameList(windowIds, windowIdsAfter)) return { tabs: [], denied: false };
      for (const list of [modes, tabIds, titles, urls]) {
        if (!Array.isArray(list) || list.length !== windowIds.length) return { tabs: [], denied: false };
      }
      const tabs = [];
      for (let w = 0; w < windowIds.length; w++) {
        // Only a window that says "normal" is listed; incognito and anything unexpected are skipped.
        if (String(modes[w]) !== "normal") continue;
        const ids = tabIds[w] || [];
        for (let t = 0; t < ids.length; t++) {
          tabs.push({
            browser: browser.key,
            browserName: browser.name,
            windowId: String(windowIds[w]),
            tabId: String(ids[t]),
            title: String(titles[w][t] || ""),
            url: String(urls[w][t] || ""),
          });
        }
      }
      return { tabs, denied: false };
    } catch (e) {
      return { tabs: [], denied: isDenied(e) };
    }
  }

  // Selects the tab, puts its window in front, then raises Chrome. Returns false, changing nothing more
  // and never throwing, when the window or the tab has gone or Chrome does not answer in time.
  function activateTab(app, windowId, tabId, options) {
    try {
      const { call } = budget(options);
      const win = app.windows.byId(String(windowId));
      const index = call((...m) => win.tabs.id(...m)).map(String).indexOf(String(tabId));
      if (index < 0) return false;
      win.activeTabIndex = index + 1;
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
