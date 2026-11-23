# Milestone 2: bookmarks, history and the browser checkboxes. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bmk` and `hist` search Firefox, Chrome and Safari bookmarks and history in one list each. Enter opens the result in the browser it came from. Checkboxes in Alfred's Configure Workflow window choose the browsers, and text fields there set the three keywords.

**Architecture:** Two new Script Filter entries, `bmk.js` and `hist.js`, sit beside `tab.js`. They use the same loader pattern and run the browsers concurrently. Firefox goes through the add-on, which gains two commands, so the helper's allow-list grows. Chrome's and Safari's files are read inside the script: JSON and plist through Foundation, and history through `/usr/bin/sqlite3` on an `immutable=1` URI, so a running browser's lock doesn't block the read. File parsing, SQL building, merging and item building are plain JavaScript tested under Node. The macOS parts are tested against fixture files in a fixture HOME.

**Tech Stack:** JavaScript for Automation, `/usr/bin/sqlite3` 3.54 (`-readonly -json`), `/usr/bin/open`, WebExtension MV2 (`bookmarks`, `history`), Node 24 `node:test` for tests only.

**Spec:** `docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md` (milestone 2: "Bookmarks and history for Firefox, Chrome and Safari, and the browser checkboxes"). Milestone 1's plan and its rulings are in `docs/superpowers/plans/2026-11-22-milestone-1-firefox-and-chrome-tabs.md`. Leftovers from it are in issue #2 and are not part of this plan.

## Global Constraints

- Shipped code uses only what macOS includes: JavaScript for Automation, `/usr/bin/sqlite3`, `/usr/bin/open` and the shell. No Python, Node or Homebrew at runtime. Files stay readable: no bundling or minification.
- No network requests. Searching never launches a browser. Enter on a bookmark or history item is an explicit action and may start its browser.
- Fixed IDs stay unchanged: `BUNDLE_ID` `io.github.shariqh.browser-search-for-alfred`, `HOST_NAME` `io.github.shariqh.browser_search_for_alfred`, `ADDON_ID` `browser-search-for-alfred@shariqh.github.io`.
- Keywords default to `tab`, `bmk` and `hist`, set through `{var:keyword_tabs}`, `{var:keyword_bookmarks}` and `{var:keyword_history}`.
- Tabs and bookmarks: each backend returns everything, and Alfred matches on the item's `match` (title and URL). History: each backend searches by the typed words itself, returns at most `HISTORY_LIMIT` = 50, and the merged list is newest first.
- Bookmark and history items carry `uid` = the URL. Tab items keep `skipknowledge: true` and no `uid`.
- Item icons are the browser's own app icon (`icon.type: "fileicon"`). With more than one Chrome profile, the subtitle names the profile.
- Enter opens the URL in its source browser, ⌘↩ opens it in the default browser, and ⌘C copies it (`text.copy`).
- Only `http:`, `https:` and `file:` URLs are ever listed or opened (`isOpenableUrl`).
- Private browsing stays private: no private-window data is listed (milestone 1 ruling, kept).
- Tests never touch a real browser or real browser data. Every path comes from `jxa.home()`, so a fixture HOME holds every file. `tab.js`, `bmk.js`, `hist.js` and `act.js` run only with `BSA_TEST_CHANNEL` and a fixture HOME. Under the channel, every `act.js` action that would open or activate something logs a line to `$HOME/activated-apps.log` instead.
- Test commands: `npm test` (unit, Node) and `npm run test:macos` (osascript). Both must pass at the end of every task.
- macOS error codes, verified on macOS 27.3: a read denied by privacy protection gives NSCocoaErrorDomain 257 (POSIX 1), a missing file 260 (POSIX 2), and a chmod-000 file 257 (POSIX 13). Without Full Disk Access, Chrome's data folder (`kTCCServiceSystemPolicyAppDataDetailed`) and `~/Library/Safari` both give 257.
- Firefox `history.search` searches only the last 24 hours unless given `startTime`, so always pass `startTime: 0` (MDN). Its `text` is split at spaces, and every word must match the URL or the title.
- File formats: Chrome's from Chromium source (`bookmark_codec.cc`, `url_database.cc`, `time.h`, `pref_names.h`, `profile_attributes_entry.cc`), and Safari's from the Safari importers in Chromium (`safari_importer.mm`) and Firefox (`SafariProfileMigrator.sys.mjs`). Chrome times are microseconds since 1601-01-01 UTC (Unix ms = µs / 1000 − 11644473600000). Safari `visit_time` is seconds since 2001-01-01 UTC (Unix ms = (s + 978307200) × 1000).

## Review Focus

1. A history query containing `'`, `%`, `_`, `\`, `"` or emoji matches literally: no SQL error and no injection. Pinned in Task 4 (SQL builder) and Task 7 (`hist.js` with `50% it's`).
2. Chrome running: Chrome holds an exclusive lock on `History`, and the search still returns results. Pinned in Task 5, with a lock held by a background `sqlite3`.
3. Chrome's or Safari's data is unreadable (denied): one clear "Allow" item for that browser, and every other browser's results still show. Pinned in Task 7, with chmod-000 fixtures.
4. Bookmarks with `javascript:`, `place:`, `chrome://` or `data:` URLs never appear and are never opened. Pinned in Task 4 (`isOpenableUrl`), Task 2 (add-on) and Task 7 (`act.js` refuses them).
5. One broken profile (invalid `Bookmarks` JSON, no `Local State`, no `History`) is skipped, and the rest still show. Pinned in Task 5.

---

### Task 1: Configuration — checkboxes and keyword fields

**Files:**
- Create: `workflow/lib/config.js`, `test/unit/config.test.mjs`
- Modify: `workflow/info.plist` (`userconfigurationconfig`, the `tab` Script Filter's `keyword`), `workflow/tab.js` (honour the Firefox and Chrome checkboxes), `test/macos/build.test.mjs`, `test/macos/tab-chrome.test.mjs`

**Interfaces:**
- Produces: `config.enabledBrowsers(envVar: (name) => string) -> {firefox: boolean, chrome: boolean, safari: boolean}`. It reads `browser_firefox`, `browser_chrome` and `browser_safari`. `"0"` means off, and anything else, an empty or missing value included, means on.

- [ ] **Step 1: Write the failing tests.** In `config.test.mjs`: `enabledBrowsers(() => "")` gives all three true; `{browser_chrome: "0"}` turns only chrome off; `"1"` is true. In `build.test.mjs`: `userconfigurationconfig` equals exactly these six entries, in order:
  - textfields `keyword_tabs` (label "Tabs keyword", default `tab`), `keyword_bookmarks` ("Bookmarks keyword", `bmk`) and `keyword_history` ("History keyword", `hist`), each with `config: {default, placeholder: "", required: true, trim: true}`;
  - checkboxes `browser_firefox`, `browser_chrome` and `browser_safari`, each with `label` "" except the first ("Browsers"), and `config: {default: true, required: false, text: "Firefox" | "Google Chrome" | "Safari"}`.

  The `tab` Script Filter's keyword is `{var:keyword_tabs}`. In `tab-chrome.test.mjs`: with `browser_chrome: "0"` in the environment, no Chrome item appears; with `browser_firefox: "0"`, no Firefox item and no "Set up Firefox" item appear.
- [ ] **Step 2: Run them.** `npm test && npm run test:macos`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** Create `config.js` in the same module pattern as `constants.js`. Edit `info.plist` by hand (keep it XML, then `plutil -lint`). In `tab.js`, skip `firefoxBegin` or `chromeItems` when that browser is off.
- [ ] **Step 4: Run all tests.** Expected: everything passes.
- [ ] **Step 5: Commit.** `git commit -m "Configuration: browser checkboxes and keyword fields"`

Ruling (carried from the plan's author): every checkbox defaults to on. Alfred's defaults are static, so "on only if installed" isn't possible. A browser that isn't installed contributes nothing anyway, because its app path and data are absent. Brave's and Edge's checkboxes arrive with their backends in milestone 3.

### Task 2: Firefox add-on and helper — bookmarks and history commands

**Files:**
- Modify: `addon/handler.js`, `addon/manifest.json`, `workflow/firefox-helper.js`, `test/unit/addon.test.mjs`, `test/macos/helper.test.mjs`

**Interfaces:**
- Produces two add-on commands:
  - `list-bookmarks` (params ignored) → `payload: [{title: string, url: string}]`: every node from `browser.bookmarks.getTree()` that has a `url` and a `type` other than `"folder"` and `"separator"`, depth first, keeping only `http:`, `https:` and `file:` URLs.
  - `search-history` with params `{query: string, maxResults: integer}` → `payload: [{title, url, lastVisitTime}]` from `browser.history.search({text: query, startTime: 0, maxResults})`, again only openable URLs.
- Validation, in both the add-on and the helper:
  - `query` must be a string of at most `QUERY_MAX_CHARS` = 512 characters;
  - `maxResults` must be an integer from 1 to 50;
  - anything else gets `{id, error: "invalid params"}`, and the helper doesn't forward it.
- The helper's `ALLOWED_COMMANDS` becomes `["list-tabs", "activate-tab", "list-bookmarks", "search-history"]`. For `list-tabs` and `list-bookmarks` it forwards `params: null`.

- [ ] **Step 1: Write the failing tests.**
  - `addon.test.mjs`, with a fake `browser`:
    - a tree with a folder, a separator, an `http` bookmark, a `place:` and a `javascript:` bookmark gives exactly the `http` one;
    - `search-history {query: "a b", maxResults: 50}` calls `history.search` with `{text: "a b", startTime: 0, maxResults: 50}`;
    - `maxResults` of 0, 51, `"5"` or 2.5, and a query that isn't a string or is longer than 512 characters, each give `invalid params` and make no call.
  - `helper.test.mjs`, with the fake Firefox:
    - both new commands are forwarded;
    - `search-history` with `maxResults: 51` gets the `invalid params` reply file, and the fake Firefox receives nothing;
    - `list-bookmarks` with params `{x: 1}` reaches Firefox with `params: null`.
  - The manifest test: permissions are exactly `["nativeMessaging", "tabs", "bookmarks", "history"]`, and the version is `0.2.0`.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement** the two handler branches and the helper's allow-list and validation. In the manifest, set `description` to "Lists this browser's tabs, bookmarks and history for Alfred, and brings a tab to the front."
- [ ] **Step 4: Run all tests.** Expected: everything passes.
- [ ] **Step 5: Commit.** `git commit -m "Firefox add-on and helper: bookmarks and history commands"`

### Task 3: Firefox source shared by all three keywords

**Files:**
- Create: `workflow/lib/firefox-source.js`
- Modify: `workflow/tab.js` (use it), `test/macos/tab-firefox.test.mjs` (only if a test name moves)

**Interfaces:**
- Consumes: `firefox-client.start/finish`, `registration.registrationProblem`, `items.setupItem` and `items.firefoxSilentItem` (milestone 1).
- Produces:
  - `firefoxSource.begin(workflowDir: string, command: string, params: object|null) -> {items: Item[]} | {pending}`. It returns the setup item when Firefox isn't registered, `{items: []}` when Firefox isn't running (`BSA_TEST_FIREFOX_RUNNING` under the channel), and otherwise sends the request.
  - `firefoxSource.finish(begun, toItems: (payload: Array) => Item[]) -> Item[]`. It returns `begun.items` when there is nothing to wait for, `[firefoxSilentItem()]` on a timeout, an error or a payload that isn't an array, and `toItems(payload)` otherwise. It never throws.

- [ ] **Step 1:** Move `firefoxBegin` and `firefoxFinish` out of `tab.js` into `firefox-source.js`, which takes `loadLib` from the entry script, like `firefox-client.js` does. The list-tabs mapping stays in `tab.js` as the `toItems` it passes.
- [ ] **Step 2: Run all tests.** Expected: every existing `tab-firefox` test passes unchanged. That is the proof of this refactor.
- [ ] **Step 3: Commit.** `git commit -m "Share the Firefox request steps between keywords"`

### Task 4: URL items, history merging and the SQL builder

**Files:**
- Create: `workflow/lib/sql.js`, `test/unit/sql.test.mjs`
- Modify: `workflow/lib/items.js`, `test/unit/items.test.mjs`

**Interfaces:**
- Produces in `items.js`:
  - `isOpenableUrl(url) -> boolean`: true only for `http:`, `https:` and `file:`, case-insensitive.
  - `urlItem(entry, appPath) -> Item`, where `entry = {browser: "firefox"|"chrome"|"safari", browserName, profile: string|null, title, url, lastVisitMs?: number}`. The item is:
    - `uid: url`;
    - `title`: the entry's title, or `withoutScheme(url)` when the title is empty;
    - `subtitle`: `` `${browserName}${profile ? ` (${profile})` : ""} · ${url}` ``;
    - `arg: JSON.stringify({action: "open", browser, url})`;
    - `match`: built as in `tabItem`;
    - `text: {copy: url, largetype: title}`;
    - `mods: {cmd: {arg: JSON.stringify({action: "open-default", url}), subtitle: "Open in your default browser"}}`;
    - `icon` as in `tabItem`.
  - `urlItems(entries, appPath) -> Item[]`: keeps only openable URLs, then maps them with `urlItem`.
  - `needsAccessItem(browserName) -> Item`:
    - `title` is `` `Allow Alfred to read ${browserName}'s bookmarks and history` ``;
    - `subtitle` is "Press Return to open Full Disk Access in System Settings, then turn on Alfred";
    - `arg` is `JSON.stringify({action: "open-privacy"})`;
    - it has no `uid`.
  - `mergeHistory(lists: Entry[][], limit: number) -> Entry[]`: each list is sorted newest first and cut to `limit`, then everything is merged newest first. The sort is stable, and an entry without `lastVisitMs` counts as 0.
  - `bookmarksOutput(items) -> {cache: {seconds: 300, loosereload: true}, items}` and `historyOutput(items) -> {items}`. Neither sets `skipknowledge`.
  - `orderBrowsers` is unchanged and is now called with three browsers, in the default order `[firefox, chrome, safari]`.
- Produces in `sql.js`:
  - `splitTerms(query) -> string[]`: split on whitespace, drop empty strings, keep the first 10.
  - `likeClause(query, columns: string[]) -> string`:
    - `"1"` when there are no terms;
    - otherwise one `(<col> LIKE '%<term>%' ESCAPE '\' OR …)` group per term, joined with ` AND `;
    - in each term, `\`, `%` and `_` are escaped with `\`, and `'` is doubled.
  - `immutableUri(path) -> string`: `"file:" + path.split("/").map(encodeURIComponent).join("/") + "?immutable=1"`.

- [ ] **Step 1: Write the failing tests.** Exact expected strings, among them:
  - `likeClause("50% it's", ["url", "title"])` is `(url LIKE '%50\%%' ESCAPE '\' OR title LIKE '%50\%%' ESCAPE '\') AND (url LIKE '%it''s%' ESCAPE '\' OR title LIKE '%it''s%' ESCAPE '\')`;
  - `immutableUri("/a b/c#d?.db")` is `file:/a%20b/c%23d%3F.db?immutable=1`;
  - `isOpenableUrl` is false for `javascript:alert(1)`, `place:sort=8`, `chrome://settings`, `data:text/html,x` and `about:blank`, and true for `HTTPS://X.TEST` and `file:///tmp/a`;
  - `mergeHistory` with lists of 60 and 3 entries and limit 50 keeps 50 from the first and all 3 from the second, interleaved by `lastVisitMs`;
  - `urlItem` with a `profile` shows it in the subtitle, and without one doesn't.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests.** Expected: everything passes.
- [ ] **Step 5: Commit.** `git commit -m "URL items, history merging and the SQL builder"`

### Task 5: Chrome's files — profiles, bookmarks and history

**Files:**
- Create: `workflow/lib/chromium-files.js`, `workflow/lib/sqlite.js`, `test/unit/chromium-files.test.mjs`, `test/macos/chrome-files.test.mjs`, `test/fixtures/chrome/` (a `Local State` and two `Bookmarks` files; `History` is created by the test)
- Modify: `workflow/lib/jxa.js`, `workflow/lib/constants.js`

**Interfaces:**
- Produces in `constants.js`:
  - `chromeDataDir(home)` → `${home}/Library/Application Support/Google/Chrome`;
  - `HISTORY_LIMIT: 50` and `SQLITE_TIMEOUT_MS: 400`;
  - `SAFARI_BUNDLE_ID: "com.apple.Safari"`.
- Produces in `jxa.js`:
  - `readFileResult(path) -> {ok: true, text} | {ok: false, reason: "missing"|"denied"|"error"}`. Code 257 gives `"denied"`, and 4 or 260 give `"missing"`.
  - `startProcess(executable, args: string[], stdoutPath: string|null) -> handle` and `finishProcess(handle, deadlineMs) -> {exited: boolean, status: number|null}`. Both use NSTask and never a shell. When the deadline passes, the task is terminated and `exited` is false.
- Produces in `sqlite.js` (JXA; it uses `loadLib`):
  - `start(dbPath, sql) -> handle`: runs `/usr/bin/sqlite3 -readonly -json <immutableUri(dbPath)> <sql>`, with stdout going to a fresh file in `${home}/Library/Caches/${BUNDLE_ID}/sqlite` (folder 700, file 600).
  - `finish(handle, deadlineMs) -> {ok: true, rows: object[]} | {ok: false, reason: "timeout"|"error"}`. Empty output means `rows: []`, and the output file is removed whatever happens.
- Produces in `chromium-files.js` (pure):
  - `profilesFromLocalState(text|null) -> [{dir, name}]`: from `profile.info_cache`; the name is `entry.name`, or `dir` when that is empty. `Default` comes first, then the rest sorted by `dir`. A null or invalid `text` gives `[{dir: "Default", name: "Default"}]`.
  - `bookmarksFromJson(text) -> [{title, url}]`: walks `roots.bookmark_bar`, `roots.other` and `roots.synced` in that order, depth first, keeping nodes of `type: "url"`. Invalid JSON gives `[]`.
  - `historySql(query, limit) -> string`: `SELECT url, title, last_visit_time AS t FROM urls WHERE hidden = 0 AND <likeClause(query, ["url", "title"])> ORDER BY last_visit_time DESC LIMIT <limit>`.
  - `chromeTimeToMs(value) -> number`.

- [ ] **Step 1: Write the failing unit tests.**
  - The profile order and the fallback name.
  - Folders nested three levels deep.
  - A `synced` root that is missing.
  - `chromeTimeToMs(13300000000000000)` is `1655526400000`.
- [ ] **Step 2: Write the failing macOS tests** against a fixture HOME:
  - two profiles' bookmarks are read;
  - `readFileResult` on a chmod-000 `Bookmarks` gives `"denied"`, and on a missing one gives `"missing"`;
  - the test creates a `History` with Chromium's `urls` schema, `CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)`, and `sqlite.start/finish` returns rows newest first, leaving out `hidden = 1` rows;
  - Review Focus 2: a background `/usr/bin/sqlite3` holding `PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE;` on that `History` doesn't stop the read;
  - Review Focus 5: invalid JSON in one profile's `Bookmarks` and a missing `Local State` both still return the other files' results;
  - a `HOME` path containing a space and a `#` works.
- [ ] **Step 3: Run them.** Expected: they fail.
- [ ] **Step 4: Implement.** A process that outlives its deadline is terminated, and its output file is still removed.
- [ ] **Step 5: Run all tests.** Expected: everything passes.
- [ ] **Step 6: Commit.** `git commit -m "Chrome: profiles, bookmarks and history from its files"`

### Task 6: Safari's files — bookmarks and history

**Files:**
- Create: `workflow/lib/safari-files.js`, `test/unit/safari-files.test.mjs`, `test/macos/safari-files.test.mjs`
- Modify: `workflow/lib/jxa.js`, `workflow/lib/constants.js`

**Interfaces:**
- Produces in `constants.js`: `safariBookmarksPath(home)` → `${home}/Library/Safari/Bookmarks.plist`, and `safariHistoryPath(home)` → `${home}/Library/Safari/History.db`.
- Produces in `jxa.js`:
  - `readPlistResult(path) -> {ok: true, value} | {ok: false, reason}`, using `NSDictionary.dictionaryWithContentsOfURLError` and `ObjC.deepUnwrap`, with the same reasons as `readFileResult`.
  - `accessResult(path) -> "ok"|"missing"|"denied"|"error"`, using `NSFileHandle.fileHandleForReadingFromURLError`, which closes the handle.
- Produces in `safari-files.js` (pure):
  - `bookmarksFromPlist(root) -> [{title, url}]`: walks `Children`. A dict with `WebBookmarkType` `"WebBookmarkTypeLeaf"` and a string `URLString` is a bookmark, with its title from `URIDictionary.title`. Folders with `ShouldOmitFromUI === true` are skipped. Reading List items (folder `Title` `"com.apple.ReadingList"`) are included.
  - `historySql(query, limit)`: `SELECT history_items.url AS url, history_visits.title AS title, MAX(history_visits.visit_time) AS t FROM history_items JOIN history_visits ON history_visits.history_item = history_items.id WHERE <likeClause(query, ["history_items.url", "history_visits.title"])> GROUP BY history_items.id ORDER BY t DESC LIMIT <limit>`.
  - `safariTimeToMs(seconds) -> number`.

- [ ] **Step 1: Write the failing unit tests.**
  - A leaf, a nested leaf, a Reading List leaf, an omitted folder and a leaf whose `URLString` isn't a string.
  - `safariTimeToMs(0)` is `978307200000`.
- [ ] **Step 2: Write the failing macOS tests.**
  - The test writes a binary `Bookmarks.plist` into the fixture HOME, converting a JSON file with `plutil -convert binary1`, and `readPlistResult` reads it back.
  - The test creates a `History.db` with `history_items(id, url)` and `history_visits(id, history_item, visit_time, title)`. The query returns one row per page, carrying its latest visit's title and time.
  - chmod-000 files give `"denied"` from both `readPlistResult` and `accessResult`.
- [ ] **Step 3: Run them.** Expected: they fail.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run all tests.** Expected: everything passes.
- [ ] **Step 6: Commit.** `git commit -m "Safari: bookmarks and history from its files"`

Ruling: Safari's plist is read with Foundation inside the script rather than through `plutil`. It handles binary plists and data values, and saves a process. It stays within "only what macOS includes".

### Task 7: The `bmk` and `hist` keywords and the open actions

**Files:**
- Create: `workflow/bmk.js`, `workflow/hist.js`, `test/macos/bookmarks.test.mjs`, `test/macos/history.test.mjs`
- Modify: `workflow/act.js`, `workflow/info.plist`, `test/macos/build.test.mjs` (the new `open` action tests go in `bookmarks.test.mjs`)

**Interfaces:**
- Consumes everything from Tasks 1 to 6.
- Each entry script follows `tab.js`: its own `workflowDir()` matching its file name, `loadLib`, `run()` printing exactly one JSON document, and the same hand-built `errorOutput()`.
- `bmk.js`:
  1. starts Firefox `list-bookmarks` (when ticked);
  2. reads Chrome's profiles and bookmarks, then Safari's plist (each when ticked);
  3. finishes Firefox.
  - A browser whose read gave `"denied"` contributes `[needsAccessItem(name)]` instead of entries. Chrome counts as denied when reading `Local State` or any profile's file gives `"denied"`; the same rule applies in `hist.js`, which checks each Chrome `History` with `accessResult` before starting `sqlite3` on it.
  - `"missing"` contributes nothing.
  - The browsers are ordered with `orderBrowsers(front, [firefox, chrome, safari])`, and the output is `bookmarksOutput`.
  - The profile name shows only when Chrome has more than one profile.
- `hist.js`:
  1. starts Firefox `search-history {query: argv[0], maxResults: 50}`;
  2. starts one `sqlite.start` per Chrome profile `History`, then Safari's after `accessResult` says `"ok"`;
  3. finishes them all against one deadline, `Date.now() + SQLITE_TIMEOUT_MS`, taken at the start.
  - Firefox finishes against its own `FIREFOX_TIMEOUT_MS`, as now.
  - Times are converted to `lastVisitMs`, and the lists are merged with `mergeHistory(lists, HISTORY_LIMIT)`.
  - "Allow" and setup items come first, and the output is `historyOutput`.
  - A query that is empty after trimming lists the most recent history.
- `act.js` gains three actions; each refuses a URL for which `isOpenableUrl` is false:
  - `open {browser, url}` runs `/usr/bin/open -b <bundle id> <url>`, with the bundle id from `{firefox, chrome, safari}`, and logs `open <bundle id> <url>` under the channel.
  - `open-default {url}` runs `/usr/bin/open <url>`, and logs `open-default <url>`.
  - `open-privacy` runs `/usr/bin/open "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"`, and logs `open-privacy`. The `Privacy_AllFiles` anchor exists in macOS 27.3's `SecurityPrivacyExtension.appex` `TCCServiceList.plist`. That the URL opens the right pane is checked in the try-out.
- `info.plist`:
  - Script Filter `572B2677-9448-4E32-8DDD-FB5620821F8E`: keyword `{var:keyword_bookmarks}`, title "Search bookmarks", script `/usr/bin/osascript -l JavaScript ./bmk.js "$1"`. The rest of its config is copied from the `tab` Script Filter.
  - Script Filter `37DBBC3C-BA3C-4F05-B920-DCEC8AC4BA52`: keyword `{var:keyword_history}`, title "Search history", script `./hist.js`, with:
    - `alfredfiltersresults` false, `argumenttype` 1, `argumenttreatemptyqueryasnil` false, `argumenttrimmode` 0;
    - `queuemode` 1, `queuedelaycustom` 3, `queuedelayimmediatelyinitially` true, `queuedelaymode` 0;
    - `runningsubtext` "Searching history…", `withspace` true.
  - Both connect to the existing Action Script `9BF9759C-CA14-401E-B046-511C2C64CE3A` twice: with `modifiers` 0, and with `modifiers` 1048576 (⌘).
  - Each new object gets a `uidata` entry, placed to the right of `tab`.

- [ ] **Step 1: Write the failing macOS tests.** Each builds a fixture HOME with Chrome (two profiles) and Safari fixtures, plus the fake Firefox.
  - `bmk` lists all three browsers' bookmarks, ordered with the frontmost browser first.
  - Unticking `browser_safari` drops Safari.
  - Review Focus 3: a chmod-000 Safari `Bookmarks.plist` gives exactly one "Allow Alfred to read Safari's bookmarks and history" item, and Chrome's and Firefox's bookmarks still show. The same holds for a chmod-000 Chrome profile.
  - `hist "50% it's"` matches only the fixture entry containing that text.
  - The merged history is newest first across browsers, at most 50 per browser.
  - An empty query returns the most recent history.
  - A fake Firefox that never answers still leaves Chrome's and Safari's history within 1 second.
  - `act.js` with `open` logs the right line for each browser.
  - Review Focus 4: `open` with a `javascript:` URL logs nothing and exits non-zero.
  - The build test checks the two new objects and four new connections as specified.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run all tests.** Expected: everything passes.
- [ ] **Step 5: Commit.** `git commit -m "bmk and hist keywords, and opening results in their browser"`

### Task 8: Version, build, README and the real-Firefox gate

**Files:**
- Modify: `workflow/info.plist` (`version` `0.2.0`), `README.md`, `docs/build-log.md`, `test/macos/build.test.mjs`

- [ ] **Step 1:** In `build.test.mjs`, the version is `0.2.0`. Both zips contain `bmk.js`, `hist.js` and every new `lib/` file, and the add-on zip's manifest has the four permissions.
- [ ] **Step 2: Update the README.**
  - Usage gets the three keywords and ⌘↩.
  - Configuration gets the checkboxes and keyword fields.
  - Setup says Safari's bookmarks and history need Full Disk Access for Alfred, and that Chrome's may need it too, or macOS's "access data from other apps" prompt.
  - "What the add-on can see" now covers bookmarks and history.
- [ ] **Step 3: Run all tests, then the build.** `npm test && npm run test:macos && bash scripts/build.sh`. Expected: everything passes, and both files are built.
- [ ] **Step 4: Run the gate (the coordinator does this, not a worker).** `npm run check:firefox` must print `REAL FIREFOX: PASS` with the new add-on and helper.
- [ ] **Step 5: Commit.** `git commit -m "Milestone 2: version 0.2.0, README, build"`

### Task 9: Try it in Shariq's own browsers (human check, the Air)

Run by the coordinator together with Shariq. Nothing here is automated.

- [ ] **Step 1: The steps go on an inbox row.** The coordinator copies both `dist/` files to the Air's Downloads folder over ssh, then puts these steps on the row:
  1. Import the workflow (it replaces 0.1.0).
  2. In Alfred, type `tab` and choose "Set up Firefox", because the helper changed.
  3. In about:debugging, click Reload on the add-on, or load the new `manifest.json`.
  4. Try `bmk` and `hist` with each browser.
  5. Answer any macOS prompt about Chrome's data, then check "Allow" opens the Full Disk Access pane.
  6. Untick a browser in Configure Workflow and change a keyword.
- [ ] **Step 2: Record what happened** in `docs/build-log.md`, especially whether Chrome's files gave a prompt, needed Full Disk Access, or just worked.

## Rulings in this plan, for Shariq to check

1. **Chrome's bookmarks and history need a permission on macOS 27.3.** The design said Chrome's bookmarks file could be read freely. On the MacBook Pro it can't now: macOS guards Chrome's data folder with its "access data from other apps" protection. So Chrome gets the same "Allow" item as Safari, and the try-out shows whether macOS asks or Full Disk Access is needed.
2. **Size limits run the other way from the design's assumption.** The add-on can send the helper up to 4 GB, and only the helper's messages to the add-on are capped at 1 MB (MDN). So bookmark lists aren't trimmed to 1 MB; the helper's own 64 MB cap stays.
3. **Every browser checkbox starts on**, because Alfred can't set defaults by what's installed. A browser that isn't installed shows nothing anyway. Brave and Edge get their checkboxes in milestone 3, with their support.
4. **The keyword fields come now**, since they sit in the same Configure Workflow window as the checkboxes.
5. **⌘↩ opens in your default browser**, and ⌘C copies the URL.
6. **Bookmarks are cached for 5 minutes**, with Alfred refreshing them in the background, so `bmk` opens instantly.
7. **Firefox bookmarks and history show only while Firefox is running**, because they come through the add-on.
8. **Safari's Reading List counts as bookmarks.** History shows one entry per page, with its latest visit.
