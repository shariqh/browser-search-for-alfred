(function () {
  // Chrome (and other Chromium browsers) through their AppleScript dictionary. `app` is JXA's
  // Application("Google Chrome"), or anything shaped like it. Nothing here launches a browser:
  // the caller decides whether to touch the application at all.
  //
  // Tab lists are read with one Apple Event per property, each returning every window's values at once
  // (the approach of epilande/alfred-browser-tabs): windows.id(), then windows.tabs.id() / title() / url(),
  // which are arrays of arrays, one inner array per window. IDs are text in Chrome's dictionary.

  // Apple Events to a hung Chrome would otherwise wait for the default timeout (minutes), so every real call
  // carries a per-call timeout, counted down from one shared deadline.
  //
  // ASSUMPTION, source "JXA release notes: Passing Event Modifiers" (Apple, Release Notes for
  // JavaScript for Automation): event modifiers are passed as the last argument of a command or property
  // read, as in `doc.close({saving: "ask"}, {timeout: 20})`, and `timeout` is "the amount of time a script
  // allows for a single event to execute". The notes give no unit; seconds is assumed, as in AppleScript's
  // `with timeout`. Not proven against a real application here, because any live target raises an
  // Automation prompt. Whole seconds are used, never below 1, so a nearly spent budget does not round to 0;
  // the shared deadline therefore bounds the listing to about the budget plus at most one second per read.
  // Writes (activeTabIndex, index) are plain assignments, which cannot carry modifiers.
  const DEFAULT_BUDGET_SECONDS = 1;

  // Returns timeout() -> whole seconds for the next call, or throws once the budget is spent.
  function budget(options) {
    const seconds = options && options.budgetSeconds !== undefined ? options.budgetSeconds : DEFAULT_BUDGET_SECONDS;
    const now = (options && options.now) || Date.now;
    const deadline = now() + seconds * 1000;
    return function timeout() {
      const left = (deadline - now()) / 1000;
      if (left <= 0) throw new Error("Chrome did not answer in time");
      return Math.max(1, Math.floor(left));
    };
  }

  // tab = {browser: "chrome", browserName, windowId, tabId, title, url}; every ID is a string.
  // Returns [] when Chrome is not running, and also when any read fails or runs out of time: a Chrome that
  // does not answer contributes no tabs. options = {budgetSeconds, now} (tests inject a clock).
  function listTabs(app, browserName, options) {
    if (!app.running()) return [];
    try {
      const timeout = budget(options);
      const windows = app.windows;
      const windowIds = windows.id({ timeout: timeout() });
      const tabIds = windows.tabs.id({ timeout: timeout() });
      const titles = windows.tabs.title({ timeout: timeout() });
      const urls = windows.tabs.url({ timeout: timeout() });
      const tabs = [];
      for (let w = 0; w < windowIds.length; w++) {
        const ids = tabIds[w] || [];
        for (let t = 0; t < ids.length; t++) {
          tabs.push({
            browser: "chrome",
            browserName,
            windowId: String(windowIds[w]),
            tabId: String(ids[t]),
            title: String(titles[w][t] || ""),
            url: String(urls[w][t] || ""),
          });
        }
      }
      return tabs;
    } catch (e) {
      return [];
    }
  }

  // Selects the tab, puts its window in front, then raises Chrome. Returns false, changing nothing more
  // and never throwing, when the window or the tab has gone or Chrome does not answer in time.
  function activateTab(app, windowId, tabId, options) {
    try {
      const timeout = budget(options);
      const win = app.windows.byId(String(windowId));
      const index = win.tabs.id({ timeout: timeout() }).map(String).indexOf(String(tabId));
      if (index < 0) return false;
      win.activeTabIndex = index + 1;
      win.index = 1;
      app.activate({ timeout: timeout() });
      return true;
    } catch (e) {
      return false;
    }
  }

  const api = { listTabs, activateTab };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
