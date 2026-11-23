#!/usr/bin/osascript -l JavaScript
// Script Filter entry for the "tab" keyword: osascript -l JavaScript tab.js '<query>'
// Prints Alfred's Script Filter JSON with the open tabs of Firefox, Chrome, Safari, Brave and Edge.
ObjC.import("Foundation");

// The folder of this script. Alfred runs entries with the workflow folder as the current directory,
// but tests may run the script by absolute path, so find it from the arguments.
function workflowDir() {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).map(String);
  const script = args.find((arg) => /(^|\/)tab\.js$/.test(arg));
  const cwd = String(ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath));
  if (script === undefined) return cwd;
  const full = script.startsWith("/") ? script : `${cwd}/${script}`;
  return String(ObjC.unwrap($(full).stringByDeletingLastPathComponent));
}

const WORKFLOW_DIR = workflowDir();

function loadLib(name) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(
    `${WORKFLOW_DIR}/lib/${name}.js`,
    $.NSUTF8StringEncoding,
    $(),
  );
  return eval(ObjC.unwrap(text));
}

// Firefox's request steps live in lib/firefox-source.js, shared with the other keywords. The Apple Event browsers
// are listed between begin and finish, while Firefox answers. This returns the function that turns Firefox's
// list-tabs reply into items.
function firefoxTabItems(items) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const appPath = jxa.appPath(constants.FIREFOX_BUNDLE_ID);
  // An entry that is not an object, or has no numeric id and windowId, is skipped; the rest still show.
  const isTab = (t) => t !== null && typeof t === "object" && Number.isFinite(t.id) && Number.isFinite(t.windowId);
  return (payload) =>
    payload.filter(isTab).map((t) =>
      items.tabItem(
        { browser: "firefox", browserName: "Firefox", windowId: t.windowId, tabId: t.id, title: t.title || "", url: t.url || "" },
        appPath,
      ),
    );
}

// Under BSA_TEST_CHANNEL tests must never send an Apple Event to a real browser. Instead each Apple Event browser
// comes from the JSON file named by BSA_TEST_TABS_<KEY> (CHROME, SAFARI, BRAVE, EDGE), holding either
// {windows: [{id, mode?, tabs: [{id?, title, url}]}]} or {"denied": true}, and this builds an object with the
// interface its library (chromium.js or safari-tabs.js) reads. Without a file the browser counts as not running.
// A denied file makes every read fail with -1743, as a refused Automation does. A test-only delayMs makes every
// read take that long, but never longer than the per-call timeout it was given: a read that would wait longer
// fails with -1712 after the timeout, like a browser that does not answer.
function testBrowserApp(jxa, browser) {
  const file = jxa.envVar(`BSA_TEST_TABS_${browser.key.toUpperCase()}`);
  const text = file === "" ? null : jxa.readText(file);
  if (text === null) return null;
  const doc = JSON.parse(text);
  const fail = (message, errorNumber) => {
    const error = new Error(`${message} (${errorNumber})`);
    error.errorNumber = errorNumber;
    throw error;
  };
  const read = (pick) => (modifiers) => {
    if (doc.denied === true) fail("Not authorized to send Apple events", -1743);
    const delayMs = Number(doc.delayMs) || 0;
    const limitMs = modifiers && modifiers.timeout !== undefined ? modifiers.timeout * 1000 : Infinity;
    if (delayMs > 0) $.NSThread.sleepForTimeInterval(Math.min(delayMs, limitMs) / 1000);
    if (delayMs > limitMs) fail("AppleEvent timed out", -1712);
    return pick(doc.windows);
  };
  const perTab = (pick) => read((windows) => windows.map((w) => w.tabs.map(pick)));
  const tabs =
    browser.family === "safari"
      ? { name: perTab((t) => t.title), url: perTab((t) => t.url) }
      : { id: perTab((t) => t.id), title: perTab((t) => t.title), url: perTab((t) => t.url) };
  return {
    running: () => true,
    windows: {
      id: read((windows) => windows.map((w) => w.id)),
      mode: read((windows) => windows.map((w) => w.mode || "normal")),
      tabs,
    },
  };
}

// One Apple Event browser's items: its tabs, [automationItem] when macOS refused Automation of it, or [] when it is
// not running. A browser is only ever touched (an Apple Event, and possibly an Automation prompt) after macOS has
// said it is running, and it is never launched. deadlineMs is the deadline every Apple Event browser shares.
function appleEventItems(items, browser, deadlineMs) {
  const jxa = loadLib("jxa");
  let app = null;
  if (jxa.channel() !== "") {
    app = testBrowserApp(jxa, browser);
  } else if (jxa.isRunning(browser.bundleId)) {
    // By bundle ID, like the isRunning check. A browser that quits in the few milliseconds between the two could
    // be relaunched by JXA; that window is accepted.
    app = Application(browser.bundleId);
  }
  if (!app) return [];

  const options = { deadlineMs };
  const result =
    browser.family === "safari"
      ? loadLib("safari-tabs").listTabs(app, options)
      : loadLib("chromium").listTabs(app, browser, options);
  if (result.denied) return [items.automationItem(browser.name)];
  const appPath = jxa.appPath(browser.bundleId);
  return result.tabs.map((tab) => items.tabItem(tab, appPath));
}

// Alfred needs exactly one JSON document on stdout whatever happens, so nothing may escape run().
// This item is built by hand, without the libraries, because loading them may be what failed.
// It never carries the exception text, which could hold browser data.
function errorOutput() {
  return JSON.stringify({
    skipknowledge: true,
    items: [
      {
        title: "Browser Search hit an error",
        subtitle: "Reinstall the workflow, or report this at the project's GitHub page",
        valid: false,
      },
    ],
  });
}

function run() {
  try {
    const constants = loadLib("constants");
    const items = loadLib("items");
    const jxa = loadLib("jxa");

    // The Configure Workflow checkboxes: a browser that is switched off is not asked at all.
    const enabled = loadLib("config").enabledBrowsers(jxa.envVar);

    // Send Firefox's request first, list the Apple Event browsers while Firefox answers, then wait for Firefox.
    let begun = { items: [] };
    try {
      if (enabled.firefox) begun = loadLib("firefox-source").begin(WORKFLOW_DIR, "list-tabs", null);
    } catch (e) {
      begun = { items: [items.firefoxSilentItem()] };
    }

    // Chrome, Safari, Brave and Edge, in the registry's order, each only when ticked. They share one deadline,
    // so a browser that hangs cannot hold tab for longer than the budget. The real-Firefox gate sets
    // BSA_SKIP_APPLESCRIPT so that it never sends an Apple Event to a real browser.
    const registry = loadLib("browsers");
    const skipAppleEvents = jxa.envVar("BSA_SKIP_APPLESCRIPT") === "1";
    const deadlineMs = Date.now() + constants.TABS_BUDGET_MS;
    const found = {};
    for (const browser of registry.ALL) {
      if (browser.family === "firefox") continue;
      found[browser.key] = [];
      if (skipAppleEvents || !enabled[browser.key]) continue;
      try {
        found[browser.key] = appleEventItems(items, browser, deadlineMs);
      } catch (e) {
        // One browser's failure must not hide the others' tabs; it just contributes no items.
      }
    }

    try {
      found.firefox = loadLib("firefox-source").finish(begun, firefoxTabItems(items));
    } catch (e) {
      // A Firefox failure must not hide other browsers' tabs; it looks like a request that got no answer.
      found.firefox = [items.firefoxSilentItem()];
    }

    let front = "";
    try {
      front = jxa.frontmostBundleId();
    } catch (e) {
      // An unknown frontmost app leaves the default order.
    }
    const ordered = items.orderBrowsers(
      front,
      registry.ALL.map((browser) => ({ bundleId: browser.bundleId, items: found[browser.key] })),
    );
    return JSON.stringify(items.scriptFilterOutput(ordered.reduce((all, browser) => all.concat(browser.items), [])));
  } catch (e) {
    return errorOutput();
  }
}
