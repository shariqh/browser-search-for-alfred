(function () {
  // loadLib is defined by the entry script that loads this file.
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const items = loadLib("items");
  const registration = loadLib("registration");
  const firefoxClient = loadLib("firefox-client");

  // Firefox is asked in two steps so that other browsers can be read while Firefox answers.
  // begin returns {items} when there is nothing to wait for (a setup item, or Firefox is not running),
  // or {pending} after sending the request; finish turns that into items.
  // workflowDir is the folder holding firefox-helper.js, which is compared with the installed helper copy.
  function begin(workflowDir, command, params) {
    const home = jxa.home();

    const helperCopy = constants.helperInstallPath(home);
    const problem = registration.registrationProblem(
      jxa.readText(constants.registrationPath(home)),
      helperCopy,
      jxa.filesEqual(`${workflowDir}/firefox-helper.js`, helperCopy),
    );
    if (problem !== null) return { items: [items.setupItem(problem)] };

    // Tests say whether Firefox is running; otherwise ask macOS. Nothing here ever launches Firefox.
    const running =
      jxa.channel() !== ""
        ? jxa.envVar("BSA_TEST_FIREFOX_RUNNING") === "1"
        : jxa.isRunning(constants.FIREFOX_BUNDLE_ID);
    if (!running) return { items: [] };

    return { pending: firefoxClient.start(command, params) };
  }

  // Waits for what begin sent and returns the items. toItems turns the reply's array into items.
  // Never throws: a timeout, an error, a payload that is not an array or any failure while converting it
  // gives the "Firefox is not answering" item.
  function finish(begun, toItems) {
    if (begun.items !== undefined) return begun.items;
    try {
      const reply = firefoxClient.finish(begun.pending, constants.FIREFOX_TIMEOUT_MS);
      if (!reply.ok || !Array.isArray(reply.payload)) return [items.firefoxSilentItem()];
      return toItems(reply.payload);
    } catch (e) {
      return [items.firefoxSilentItem()];
    }
  }

  const api = { begin, finish };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
