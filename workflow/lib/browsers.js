(function () {
  // The browsers this workflow knows, in the order their tabs are listed. Entry scripts loop over this
  // instead of naming each browser. family says how a browser is read: "firefox" through the add-on,
  // "chromium" with Chrome's Apple Events dictionary and profile files, "safari" with its own dictionary
  // and files. dataDir(home) is the folder holding its bookmarks and history, or null when it has none.
  const constants = typeof loadLib === "function" ? loadLib("constants") : require("./constants.js");

  const ALL = [
    {
      key: "firefox",
      name: "Firefox",
      bundleId: constants.FIREFOX_BUNDLE_ID,
      family: "firefox",
      dataDir: () => null,
    },
    {
      key: "chrome",
      name: "Google Chrome",
      bundleId: constants.CHROME_BUNDLE_ID,
      family: "chromium",
      dataDir: constants.chromeDataDir,
    },
    {
      key: "safari",
      name: "Safari",
      bundleId: constants.SAFARI_BUNDLE_ID,
      family: "safari",
      dataDir: (home) => `${home}/Library/Safari`,
    },
    {
      key: "brave",
      name: "Brave Browser",
      bundleId: constants.BRAVE_BUNDLE_ID,
      family: "chromium",
      dataDir: constants.braveDataDir,
    },
    {
      key: "edge",
      name: "Microsoft Edge",
      bundleId: constants.EDGE_BUNDLE_ID,
      family: "chromium",
      dataDir: constants.edgeDataDir,
    },
  ];

  function byKey(key) {
    return ALL.find((b) => b.key === key);
  }

  function chromium() {
    return ALL.filter((b) => b.family === "chromium");
  }

  function defaultOrder() {
    return ALL.map((b) => b.key);
  }

  const api = { ALL, byKey, chromium, defaultOrder };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
