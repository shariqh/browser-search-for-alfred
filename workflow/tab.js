#!/usr/bin/osascript -l JavaScript
// Script Filter entry for the "tab" keyword: osascript -l JavaScript tab.js '<query>'
// Prints Alfred's Script Filter JSON with the open browser tabs.
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

// Firefox's request steps live in lib/firefox-source.js, shared with the other keywords. Chrome is listed
// between begin and finish, while Firefox answers. This returns the function that turns Firefox's list-tabs
// reply into items.
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

// Under BSA_TEST_CHANNEL tests must never send an Apple Event to a real Chrome. Instead the tabs come from the
// JSON file named by BSA_TEST_CHROME_TABS, shaped {windows: [{id, tabs: [{id, title, url}]}]}, and this builds
// an object with the interface chromium.js expects. Without the variable Chrome counts as not running.
function testChromeApp(jxa) {
  const file = jxa.envVar("BSA_TEST_CHROME_TABS");
  const text = file === "" ? null : jxa.readText(file);
  if (text === null) return null;
  const windows = JSON.parse(text).windows;
  const perWindow = (pick) => windows.map((w) => w.tabs.map(pick));
  return {
    running: () => true,
    windows: {
      id: () => windows.map((w) => w.id),
      tabs: {
        id: () => perWindow((t) => t.id),
        title: () => perWindow((t) => t.title),
        url: () => perWindow((t) => t.url),
      },
    },
  };
}

// Chrome's tabs, or [] when Chrome is not running or skipped. Chrome is only ever touched (an Apple Event, and
// possibly an Automation prompt) after macOS has said it is running, and it is never launched.
function chromeItems(items) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  // The real-Firefox gate sets BSA_SKIP_CHROME so that it never queries a real Chrome.
  if (jxa.envVar("BSA_SKIP_CHROME") === "1") return [];

  let app;
  if (jxa.channel() !== "") {
    app = testChromeApp(jxa);
  } else if (jxa.isRunning(constants.CHROME_BUNDLE_ID)) {
    // By bundle ID, like the isRunning check. A Chrome that quits in the few milliseconds between the two could
    // be relaunched by JXA; that window is accepted.
    app = Application(constants.CHROME_BUNDLE_ID);
  }
  if (!app) return [];

  const appPath = jxa.appPath(constants.CHROME_BUNDLE_ID);
  return loadLib("chromium")
    .listTabs(app, "Google Chrome")
    .map((tab) => items.tabItem(tab, appPath));
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

    // Send Firefox's request first, list Chrome while Firefox answers, then wait for Firefox.
    let begun = { items: [] };
    try {
      if (enabled.firefox) begun = loadLib("firefox-source").begin(WORKFLOW_DIR, "list-tabs", null);
    } catch (e) {
      begun = { items: [items.firefoxSilentItem()] };
    }

    let chrome = [];
    try {
      if (enabled.chrome) chrome = chromeItems(items);
    } catch (e) {
      // A Chrome failure must not hide Firefox's tabs; it just contributes no items.
    }

    let firefox;
    try {
      firefox = loadLib("firefox-source").finish(begun, firefoxTabItems(items));
    } catch (e) {
      // A Firefox failure must not hide other browsers' tabs; it looks like a request that got no answer.
      firefox = [items.firefoxSilentItem()];
    }

    let front = "";
    try {
      front = jxa.frontmostBundleId();
    } catch (e) {
      // An unknown frontmost app leaves the default order.
    }
    const ordered = items.orderBrowsers(front, [
      { bundleId: constants.FIREFOX_BUNDLE_ID, items: firefox },
      { bundleId: constants.CHROME_BUNDLE_ID, items: chrome },
    ]);
    const found = ordered.reduce((all, browser) => all.concat(browser.items), []);
    return JSON.stringify(items.scriptFilterOutput(found));
  } catch (e) {
    return errorOutput();
  }
}
