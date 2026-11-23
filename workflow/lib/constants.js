(function () {
  const BUNDLE_ID = "io.github.shariqh.browser-search-for-alfred";
  const HOST_NAME = "io.github.shariqh.browser_search_for_alfred";
  const ADDON_ID = "browser-search-for-alfred@shariqh.github.io";

  function privateDir(home) {
    return `${home}/Library/Caches/${BUNDLE_ID}/firefox`;
  }

  function helperInstallPath(home) {
    return `${home}/Library/Application Support/${BUNDLE_ID}/firefox-helper.js`;
  }

  function registrationPath(home) {
    return `${home}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json`;
  }

  function chromeDataDir(home) {
    return `${home}/Library/Application Support/Google/Chrome`;
  }

  function safariBookmarksPath(home) {
    return `${home}/Library/Safari/Bookmarks.plist`;
  }

  function safariHistoryPath(home) {
    return `${home}/Library/Safari/History.db`;
  }

  // kind is "request" or "reply"; channel is only set by tests.
  function notificationName(kind, channel) {
    const base = `${BUNDLE_ID}.${kind}`;
    return typeof channel === "string" && channel !== "" ? `${base}.test.${channel}` : base;
  }

  const api = {
    BUNDLE_ID,
    HOST_NAME,
    ADDON_ID,
    KEYWORD: "tab",
    FIREFOX_BUNDLE_ID: "org.mozilla.firefox",
    CHROME_BUNDLE_ID: "com.google.Chrome",
    SAFARI_BUNDLE_ID: "com.apple.Safari",
    FIREFOX_TIMEOUT_MS: 400,
    // History: each browser returns at most this many rows, and sqlite3 gets this long to answer.
    HISTORY_LIMIT: 50,
    SQLITE_TIMEOUT_MS: 400,
    privateDir,
    helperInstallPath,
    registrationPath,
    chromeDataDir,
    safariBookmarksPath,
    safariHistoryPath,
    notificationName,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
