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
    FIREFOX_TIMEOUT_MS: 400,
    privateDir,
    helperInstallPath,
    registrationPath,
    notificationName,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
