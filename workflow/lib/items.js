(function () {
  // "https://example.com/a" -> "example.com/a". Only "scheme://" is removed, so "about:blank" stays whole.
  function withoutScheme(url) {
    return String(url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  }

  // tab = {browser: "firefox"|"chrome", browserName, windowId, tabId, title, url}
  function tabItem(tab, appPath) {
    const title = tab.title ? tab.title : withoutScheme(tab.url);
    const item = {
      title,
      subtitle: `${tab.browserName} · ${tab.url}`,
      // The arg travels through Alfred as one string and comes back to act.js, so it is JSON.
      arg: JSON.stringify({ action: "activate", browser: tab.browser, windowId: tab.windowId, tabId: tab.tabId }),
      match: `${title} ${withoutScheme(tab.url).replace(/\W/g, " ")}`,
      text: { copy: tab.url, largetype: title },
    };
    if (appPath) item.icon = { type: "fileicon", path: appPath };
    return item;
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

  const api = { tabItem, setupItem, firefoxSilentItem, scriptFilterOutput };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
