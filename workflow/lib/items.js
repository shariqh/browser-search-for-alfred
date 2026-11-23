(function () {
  // "https://example.com/a" -> "example.com/a". Only "scheme://" is removed, so "about:blank" stays whole.
  function withoutScheme(url) {
    return String(url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  }

  // What Alfred matches on: the title, then the address without its scheme and with punctuation as spaces.
  function matchText(title, url) {
    return `${title} ${withoutScheme(url).replace(/\W/g, " ")}`;
  }

  // Same rule as isOpenableUrl in addon/handler.js, which loads nothing at runtime.
  function isOpenableUrl(url) {
    return typeof url === "string" && /^(https?|file):/i.test(url);
  }

  // tab = {browser: "firefox"|"chrome", browserName, windowId, tabId, title, url}
  function tabItem(tab, appPath) {
    const title = tab.title ? tab.title : withoutScheme(tab.url);
    const item = {
      title,
      subtitle: `${tab.browserName} · ${tab.url}`,
      // The arg travels through Alfred as one string and comes back to act.js, so it is JSON.
      arg: JSON.stringify({ action: "activate", browser: tab.browser, windowId: tab.windowId, tabId: tab.tabId }),
      match: matchText(title, tab.url),
      text: { copy: tab.url, largetype: title },
    };
    if (appPath) item.icon = { type: "fileicon", path: appPath };
    return item;
  }

  // entry = {browser: "firefox"|"chrome"|"safari", browserName, profile: string|null, title, url, lastVisitMs?}
  function urlItem(entry, appPath) {
    const title = entry.title ? entry.title : withoutScheme(entry.url);
    const profile = entry.profile ? ` (${entry.profile})` : "";
    const item = {
      uid: entry.url,
      title,
      subtitle: `${entry.browserName}${profile} · ${entry.url}`,
      arg: JSON.stringify({ action: "open", browser: entry.browser, url: entry.url }),
      match: matchText(title, entry.url),
      text: { copy: entry.url, largetype: title },
      mods: {
        cmd: { arg: JSON.stringify({ action: "open-default", url: entry.url }), subtitle: "Open in your default browser" },
      },
    };
    if (appPath) item.icon = { type: "fileicon", path: appPath };
    return item;
  }

  function urlItems(entries, appPath) {
    return entries.filter((entry) => isOpenableUrl(entry.url)).map((entry) => urlItem(entry, appPath));
  }

  function needsAccessItem(browserName) {
    return {
      title: `Allow Alfred to read ${browserName}'s bookmarks and history`,
      subtitle: "Press Return to open Full Disk Access in System Settings, then turn on Alfred",
      arg: JSON.stringify({ action: "open-privacy" }),
    };
  }

  // Explains missing results when a browser's history query ran out of time ("timeout") or failed ("error"). It
  // cannot be chosen.
  function historyProblemItem(browserName, reason) {
    if (reason === "timeout") {
      return { title: `${browserName}'s history took too long`, subtitle: "Try again, or type a longer search", valid: false };
    }
    return { title: `Couldn't read ${browserName}'s history`, subtitle: "Try again in a moment", valid: false };
  }

  // lists = one array of entries per browser. Each is cut to its newest `limit`, then all are merged newest first.
  // Array.prototype.sort is stable, so entries with the same time keep their list order.
  function mergeHistory(lists, limit) {
    const newestFirst = (a, b) => (b.lastVisitMs || 0) - (a.lastVisitMs || 0);
    const cut = lists.map((list) => list.slice().sort(newestFirst).slice(0, limit));
    return [].concat(...cut).sort(newestFirst);
  }

  const SETUP_SUBTITLES = {
    missing: "Firefox doesn't know about Browser Search yet. Press Return to connect it",
    elsewhere: "Firefox is connected to a different copy of this workflow. Press Return to connect this one",
    stale: "The workflow was updated. Press Return to update Firefox's helper",
  };

  function setupItem(problem) {
    return {
      title: "Set up Firefox",
      subtitle: SETUP_SUBTITLES[problem] || SETUP_SUBTITLES.missing,
      arg: JSON.stringify({ action: "setup-firefox" }),
    };
  }

  function firefoxSilentItem() {
    return {
      title: "Firefox didn't answer",
      subtitle: "Install or turn on the Browser Search add-on in Firefox",
      valid: false,
    };
  }

  function scriptFilterOutput(items) {
    return { skipknowledge: true, items };
  }

  // Bookmark results all carry a uid; notice items (setup, "didn't answer", Allow) never do. Notices are not
  // cached, so they go away as soon as the problem does. An empty list may be cached.
  function bookmarksOutput(items) {
    if (!items.every((item) => typeof item.uid === "string")) return { items };
    return { cache: { seconds: 300, loosereload: true }, items };
  }

  function historyOutput(items) {
    return { items };
  }

  // browsers = [{bundleId, items}] in the default order [firefox, chrome, safari]. The browser that is frontmost
  // moves to the front; any other frontmost app (Alfred's own panel, say) leaves the order alone.
  function orderBrowsers(frontBundleId, browsers) {
    const front = browsers.filter((b) => b.bundleId === frontBundleId);
    const rest = browsers.filter((b) => b.bundleId !== frontBundleId);
    return front.concat(rest);
  }

  const api = {
    tabItem,
    setupItem,
    firefoxSilentItem,
    scriptFilterOutput,
    orderBrowsers,
    isOpenableUrl,
    urlItem,
    urlItems,
    needsAccessItem,
    historyProblemItem,
    mergeHistory,
    bookmarksOutput,
    historyOutput,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
