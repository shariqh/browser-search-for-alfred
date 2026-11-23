#!/usr/bin/osascript -l JavaScript
// Script Filter entry for the "bmk" keyword: osascript -l JavaScript bmk.js '<query>'
// Prints Alfred's Script Filter JSON with every bookmark of Firefox, Chrome, Safari, Brave and Edge; Alfred filters them.
ObjC.import("Foundation");

// The folder of this script. Alfred runs entries with the workflow folder as the current directory,
// but tests may run the script by absolute path, so find it from the arguments.
function workflowDir() {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).map(String);
  const script = args.find((arg) => /(^|\/)bmk\.js$/.test(arg));
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

// Turns Firefox's list-bookmarks reply ([{title, url}]) into items. An entry that is not an object is skipped;
// urlItems drops any URL that is not openable.
function firefoxBookmarkItems(items) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const appPath = jxa.appPath(constants.FIREFOX_BUNDLE_ID);
  return (payload) =>
    items.urlItems(
      payload
        .filter((b) => b !== null && typeof b === "object")
        .map((b) => ({ browser: "firefox", browserName: "Firefox", profile: null, title: typeof b.title === "string" ? b.title : "", url: b.url })),
      appPath,
    );
}

// One Chromium browser's bookmarks from its files (browser is its entry in lib/browsers.js), every profile. A
// "denied" read of Local State or of any profile's Bookmarks means macOS keeps that browser's data from Alfred, so
// it gives one Allow item instead. A missing data folder, a missing or broken file contributes nothing, and the
// other profiles still show.
function chromiumItems(items, browser) {
  const jxa = loadLib("jxa");
  const files = loadLib("chromium-files");
  const dataDir = browser.dataDir(jxa.home());
  const denied = [items.needsAccessItem(browser.name)];

  const state = jxa.readFileResult(`${dataDir}/Local State`);
  if (!state.ok && state.reason === "denied") return denied;
  const profiles = files.profilesFromLocalState(state.ok ? state.text : null);

  const entries = [];
  for (const profile of profiles) {
    const read = jxa.readFileResult(`${dataDir}/${profile.dir}/Bookmarks`);
    if (!read.ok) {
      if (read.reason === "denied") return denied;
      continue;
    }
    // The profile's name shows only when there is more than one profile to tell apart.
    const name = profiles.length > 1 ? profile.name : null;
    for (const b of files.bookmarksFromJson(read.text)) {
      entries.push({ browser: browser.key, browserName: browser.name, profile: name, title: b.title, url: b.url });
    }
  }
  return items.urlItems(entries, jxa.appPath(browser.bundleId));
}

// Safari's bookmarks and Reading List from Bookmarks.plist: one Allow item when the read is denied, nothing when
// the file is missing or unreadable.
function safariItems(items) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const read = jxa.readPlistResult(constants.safariBookmarksPath(jxa.home()));
  if (!read.ok) return read.reason === "denied" ? [items.needsAccessItem("Safari")] : [];
  const entries = loadLib("safari-files")
    .bookmarksFromPlist(read.value)
    .map((b) => ({ browser: "safari", browserName: "Safari", profile: null, title: b.title, url: b.url }));
  return items.urlItems(entries, jxa.appPath(constants.SAFARI_BUNDLE_ID));
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

    // The Configure Workflow checkboxes: a browser that is switched off is not read at all.
    const enabled = loadLib("config").enabledBrowsers(jxa.envVar);

    // Send Firefox's request first, read the other browsers' files while Firefox answers, then wait for Firefox.
    let begun = { items: [] };
    try {
      if (enabled.firefox) begun = loadLib("firefox-source").begin(WORKFLOW_DIR, "list-bookmarks", null);
    } catch (e) {
      begun = { items: [items.firefoxSilentItem()] };
    }

    // A failure in one browser must not hide another's bookmarks; it just contributes no items.
    const registry = loadLib("browsers");
    const chromium = {};
    for (const browser of registry.chromium()) {
      chromium[browser.key] = [];
      try {
        if (enabled[browser.key]) chromium[browser.key] = chromiumItems(items, browser);
      } catch (e) {}
    }

    let safari = [];
    try {
      if (enabled.safari) safari = safariItems(items);
    } catch (e) {}

    let firefox;
    try {
      firefox = loadLib("firefox-source").finish(begun, firefoxBookmarkItems(items));
    } catch (e) {
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
      { bundleId: constants.CHROME_BUNDLE_ID, items: chromium.chrome },
      { bundleId: constants.SAFARI_BUNDLE_ID, items: safari },
      { bundleId: constants.BRAVE_BUNDLE_ID, items: chromium.brave },
      { bundleId: constants.EDGE_BUNDLE_ID, items: chromium.edge },
    ]);
    const found = ordered.reduce((all, browser) => all.concat(browser.items), []);
    return JSON.stringify(items.bookmarksOutput(found));
  } catch (e) {
    return errorOutput();
  }
}
