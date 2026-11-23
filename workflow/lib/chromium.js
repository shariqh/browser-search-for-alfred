(function () {
  // Chrome (and other Chromium browsers) through their AppleScript dictionary. `app` is JXA's
  // Application("Google Chrome"), or anything shaped like it. Nothing here launches a browser:
  // the caller decides whether to touch the application at all.
  //
  // Tab lists are read with one Apple Event per property, each returning every window's values at once
  // (the approach of epilande/alfred-browser-tabs): windows.id(), then windows.tabs.id() / title() / url(),
  // which are arrays of arrays, one inner array per window. IDs are text in Chrome's dictionary.

  // tab = {browser: "chrome", browserName, windowId, tabId, title, url}; every ID is a string.
  function listTabs(app, browserName) {
    if (!app.running()) return [];
    const windows = app.windows;
    const windowIds = windows.id();
    const tabIds = windows.tabs.id();
    const titles = windows.tabs.title();
    const urls = windows.tabs.url();
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
  }

  // Selects the tab, puts its window in front, then raises Chrome. Returns false, changing nothing and
  // never throwing, when the window or the tab has gone.
  function activateTab(app, windowId, tabId) {
    try {
      const win = app.windows.byId(String(windowId));
      const index = win.tabs.id().map(String).indexOf(String(tabId));
      if (index < 0) return false;
      win.activeTabIndex = index + 1;
      win.index = 1;
      app.activate();
      return true;
    } catch (e) {
      return false;
    }
  }

  const api = { listTabs, activateTab };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
