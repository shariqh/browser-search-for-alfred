#!/usr/bin/osascript -l JavaScript
// Script Filter entry for the "hist" keyword: osascript -l JavaScript hist.js '<query>'
// Prints Alfred's Script Filter JSON with the history of Firefox, Chrome and Safari matching every typed word,
// newest first. Each browser searches by itself; Alfred does not filter these results.
ObjC.import("Foundation");

// The folder of this script. Alfred runs entries with the workflow folder as the current directory,
// but tests may run the script by absolute path, so find it from the arguments.
function workflowDir() {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).map(String);
  const script = args.find((arg) => /(^|\/)hist\.js$/.test(arg));
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

// The Firefox helper and add-on refuse a query longer than this many characters.
const FIREFOX_QUERY_MAX = 512;

// The query cut to FIREFOX_QUERY_MAX characters, without leaving half of an emoji's surrogate pair at the end.
function firefoxQuery(query) {
  const cut = query.slice(0, FIREFOX_QUERY_MAX);
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

// Firefox's search-history reply ([{title, url, lastVisitTime}]) as entries. An entry that is not an object is skipped.
function firefoxEntries(payload) {
  return payload
    .filter((h) => h !== null && typeof h === "object")
    .map((h) => ({
      browser: "firefox",
      browserName: "Firefox",
      profile: null,
      title: typeof h.title === "string" ? h.title : "",
      url: h.url,
      lastVisitMs: Number(h.lastVisitTime) || 0,
    }));
}

// Starts one sqlite3 per Chrome profile's History. Returns {denied: true} when macOS keeps Chrome's data from
// Alfred (Local State or any profile's History is "denied"), else {queries: [{profile, handle}]}. A profile with
// no History is skipped.
function startChrome(query) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const files = loadLib("chromium-files");
  const sqlite = loadLib("sqlite");
  const dataDir = constants.chromeDataDir(jxa.home());

  const state = jxa.readFileResult(`${dataDir}/Local State`);
  if (!state.ok && state.reason === "denied") return { denied: true };
  const profiles = files.profilesFromLocalState(state.ok ? state.text : null);

  // Every History is checked before any sqlite3 starts, so a denied one starts nothing.
  const readable = [];
  for (const profile of profiles) {
    const access = jxa.accessResult(`${dataDir}/${profile.dir}/History`);
    if (access === "denied") return { denied: true };
    if (access === "ok") readable.push(profile);
  }
  const sql = files.historySql(query, constants.HISTORY_LIMIT);
  return {
    queries: readable.map((profile) => ({
      // The profile's name shows only when there is more than one profile to tell apart.
      profile: profiles.length > 1 ? profile.name : null,
      handle: sqlite.start(`${dataDir}/${profile.dir}/History`, sql),
    })),
  };
}

// Chrome's entries from the queries startChrome started. A query that failed or timed out gives nothing.
function finishChrome(queries, deadlineMs) {
  const files = loadLib("chromium-files");
  const sqlite = loadLib("sqlite");
  const entries = [];
  for (const query of queries) {
    const result = sqlite.finish(query.handle, deadlineMs);
    if (!result.ok) continue;
    for (const row of result.rows) {
      entries.push({
        browser: "chrome",
        browserName: "Google Chrome",
        profile: query.profile,
        title: typeof row.title === "string" ? row.title : "",
        url: row.url,
        lastVisitMs: files.chromeTimeToMs(row.t),
      });
    }
  }
  return entries;
}

// Starts sqlite3 on Safari's History.db once macOS says it can be read. {denied: true}, {handle: null} when the
// file is missing or unreadable, or {handle}.
function startSafari(query) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const path = constants.safariHistoryPath(jxa.home());
  const access = jxa.accessResult(path);
  if (access === "denied") return { denied: true };
  if (access !== "ok") return { handle: null };
  return { handle: loadLib("sqlite").start(path, loadLib("safari-files").historySql(query, constants.HISTORY_LIMIT)) };
}

function finishSafari(handle, deadlineMs) {
  if (handle === null) return [];
  const result = loadLib("sqlite").finish(handle, deadlineMs);
  if (!result.ok) return [];
  const files = loadLib("safari-files");
  return result.rows.map((row) => ({
    browser: "safari",
    browserName: "Safari",
    profile: null,
    title: typeof row.title === "string" ? row.title : "",
    url: row.url,
    lastVisitMs: files.safariTimeToMs(row.t),
  }));
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

function run(argv) {
  try {
    // One deadline for every sqlite3, taken before anything starts.
    const constants = loadLib("constants");
    const deadlineMs = Date.now() + constants.SQLITE_TIMEOUT_MS;
    const items = loadLib("items");
    const jxa = loadLib("jxa");

    // NUL characters cannot travel in a process argument, so they are removed before the query is used anywhere.
    // An empty query lists the most recent history.
    const query = String(argv[0] || "").replace(/\u0000/g, "").trim();

    // The Configure Workflow checkboxes: a browser that is switched off is not read at all.
    const enabled = loadLib("config").enabledBrowsers(jxa.envVar);

    // Setup, "not answering" and Allow items, which come before the results.
    const notices = { firefox: [], chrome: [], safari: [] };
    const lists = { firefox: [], chrome: [], safari: [] };

    // Ask Firefox first, start sqlite3 for Chrome and Safari while it answers, then collect them all.
    let begun = { items: [] };
    try {
      if (enabled.firefox) {
        begun = loadLib("firefox-source").begin(WORKFLOW_DIR, "search-history", {
          query: firefoxQuery(query),
          maxResults: constants.HISTORY_LIMIT,
        });
      }
    } catch (e) {
      begun = { items: [items.firefoxSilentItem()] };
    }

    // A failure in one browser must not hide another's history; it just contributes no items.
    let chrome = { queries: [] };
    try {
      if (enabled.chrome) chrome = startChrome(query);
    } catch (e) {}

    let safari = { handle: null };
    try {
      if (enabled.safari) safari = startSafari(query);
    } catch (e) {}

    try {
      if (chrome.denied) notices.chrome = [items.needsAccessItem("Google Chrome")];
      else lists.chrome = finishChrome(chrome.queries, deadlineMs);
    } catch (e) {}

    try {
      if (safari.denied) notices.safari = [items.needsAccessItem("Safari")];
      else lists.safari = finishSafari(safari.handle, deadlineMs);
    } catch (e) {}

    // Firefox has its own timeout, counted from when its request was sent. The reply becomes entries here, and
    // finish returns only a setup or "not answering" item.
    try {
      notices.firefox = loadLib("firefox-source").finish(begun, (payload) => {
        lists.firefox = firefoxEntries(payload);
        return [];
      });
    } catch (e) {
      notices.firefox = [items.firefoxSilentItem()];
    }

    const appPaths = {
      firefox: jxa.appPath(constants.FIREFOX_BUNDLE_ID),
      chrome: jxa.appPath(constants.CHROME_BUNDLE_ID),
      safari: jxa.appPath(constants.SAFARI_BUNDLE_ID),
    };
    // Unopenable URLs go before the merge, so they never take one of a browser's places.
    const openable = (list) => list.filter((entry) => items.isOpenableUrl(entry.url));
    const merged = items.mergeHistory(
      [openable(lists.firefox), openable(lists.chrome), openable(lists.safari)],
      constants.HISTORY_LIMIT,
    );
    const found = notices.firefox
      .concat(notices.chrome, notices.safari)
      .concat(merged.map((entry) => items.urlItem(entry, appPaths[entry.browser])));
    return JSON.stringify(items.historyOutput(found));
  } catch (e) {
    return errorOutput();
  }
}
