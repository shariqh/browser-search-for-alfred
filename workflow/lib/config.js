(function () {
  // Which browsers the Configure Workflow checkboxes leave on. Alfred passes each checkbox to scripts as an
  // environment variable: "1" when ticked, "0" when not. "0" is off; anything else, an empty or missing value
  // included, is on, so a workflow that was never configured searches every browser.
  // envVar is (name) => string, jxa.envVar under JXA.
  function enabledBrowsers(envVar) {
    const on = (name) => envVar(name) !== "0";
    return {
      firefox: on("browser_firefox"),
      chrome: on("browser_chrome"),
      safari: on("browser_safari"),
      brave: on("browser_brave"),
      edge: on("browser_edge"),
    };
  }

  const api = { enabledBrowsers };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
