#!/usr/bin/osascript -l JavaScript
// Script Filter entry for the "hist" keyword: osascript -l JavaScript hist.js '<query>'
// Prints Alfred's Script Filter JSON with the history of Firefox, Chrome, Safari, Brave and Edge matching every typed word,
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

// Starts one sqlite3 per profile's History for one Chromium browser (browser is its entry in lib/browsers.js).
// Returns {denied: true} when macOS keeps that browser's data from Alfred (Local State or any profile's History is
// "denied"), else {queries: [{profile, handle}]}. A profile with no History, or a browser with no data folder, is
// skipped.
function startChromium(browser, query) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const files = loadLib("chromium-files");
  const sqlite = loadLib("sqlite");
  const dataDir = browser.dataDir(jxa.home());

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

// One Chromium browser's entries from the queries startChromium started: {entries, problem}. A query that failed or
// timed out gives nothing, and problem is the reason of the first one that did ("timeout" or "error"), else null.
function finishChromium(browser, queries, deadlineMs) {
  const files = loadLib("chromium-files");
  const sqlite = loadLib("sqlite");
  const entries = [];
  let problem = null;
  for (const query of queries) {
    const result = sqlite.finish(query.handle, deadlineMs);
    if (!result.ok) {
      if (problem === null) problem = result.reason;
      continue;
    }
    for (const row of result.rows) {
      entries.push({
        browser: browser.key,
        browserName: browser.name,
        profile: query.profile,
        title: typeof row.title === "string" ? row.title : "",
        url: row.url,
        lastVisitMs: files.chromeTimeToMs(row.t),
      });
    }
  }
  return { entries, problem };
}

// Starts sqlite3 on Safari's History.db once macOS says it can be read. {denied: true}, {handle: null} when the
// file is missing or unreadable, or {handle, path, sql}. Safari keeps History.db open in WAL mode, so it is read
// with mode=ro, which also sees the visits still in History.db-wal.
function startSafari(query) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const path = constants.safariHistoryPath(jxa.home());
  const access = jxa.accessResult(path);
  if (access === "denied") return { denied: true };
  if (access !== "ok") return { handle: null };
  const sql = loadLib("safari-files").historySql(query, constants.HISTORY_LIMIT);
  return { handle: loadLib("sqlite").start(path, sql, "ro"), path, sql };
}

// Safari's entries from the query startSafari started: {entries, problem}. When that read fails (an exclusive lock on
// History.db, say), the immutable read is tried once, within the same deadline; a timeout is not retried. A failure
// gives no entries, and problem is its reason ("timeout" or "error"), else null.
function finishSafari(safari, deadlineMs) {
  if (safari.handle === null) return { entries: [], problem: null };
  const sqlite = loadLib("sqlite");
  let result = sqlite.finish(safari.handle, deadlineMs);
  if (!result.ok && result.reason === "error") result = sqlite.finish(sqlite.start(safari.path, safari.sql), deadlineMs);
  if (!result.ok) return { entries: [], problem: result.reason };
  const files = loadLib("safari-files");
  const entries = result.rows.map((row) => ({
    browser: "safari",
    browserName: "Safari",
    profile: null,
    title: typeof row.title === "string" ? row.title : "",
    url: row.url,
    lastVisitMs: files.safariTimeToMs(row.t),
  }));
  return { entries, problem: null };
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

    // Setup, "not answering", Allow and history-problem items, which come before the results.
    const notices = { firefox: [], chrome: [], safari: [], brave: [], edge: [] };
    const lists = { firefox: [], chrome: [], safari: [], brave: [], edge: [] };

    // Ask Firefox first, start sqlite3 for the other browsers while it answers, then collect them all.
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
    const registry = loadLib("browsers");
    const chromium = {};
    for (const browser of registry.chromium()) {
      chromium[browser.key] = { queries: [] };
      try {
        if (enabled[browser.key]) chromium[browser.key] = startChromium(browser, query);
      } catch (e) {}
    }

    let safari = { handle: null };
    try {
      if (enabled.safari) safari = startSafari(query);
    } catch (e) {}

    try {
      if (safari.denied) {
        notices.safari = [items.needsAccessItem("Safari")];
      } else {
        const finished = finishSafari(safari, deadlineMs);
        lists.safari = finished.entries;
        if (finished.problem) notices.safari = [items.historyProblemItem("Safari", finished.problem)];
      }
    } catch (e) {}

    for (const browser of registry.chromium()) {
      try {
        const started = chromium[browser.key];
        if (started.denied) {
          notices[browser.key] = [items.needsAccessItem(browser.name)];
        } else {
          const finished = finishChromium(browser, started.queries, deadlineMs);
          lists[browser.key] = finished.entries;
          if (finished.problem) notices[browser.key] = [items.historyProblemItem(browser.name, finished.problem)];
        }
      } catch (e) {}
    }

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
      brave: jxa.appPath(constants.BRAVE_BUNDLE_ID),
      edge: jxa.appPath(constants.EDGE_BUNDLE_ID),
    };
    // Unopenable URLs go before the merge, so they never take one of a browser's places.
    const openable = (list) => list.filter((entry) => items.isOpenableUrl(entry.url));
    const merged = items.mergeHistory(
      [openable(lists.firefox), openable(lists.chrome), openable(lists.safari), openable(lists.brave), openable(lists.edge)],
      constants.HISTORY_LIMIT,
    );
    const found = notices.firefox
      .concat(notices.chrome, notices.safari, notices.brave, notices.edge)
      .concat(merged.map((entry) => items.urlItem(entry, appPaths[entry.browser])));
    return JSON.stringify(items.historyOutput(found));
  } catch (e) {
    return errorOutput();
  }
}
