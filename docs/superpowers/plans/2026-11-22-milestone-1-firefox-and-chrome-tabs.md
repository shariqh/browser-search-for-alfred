# Milestone 1: Firefox and Chrome tabs under one keyword — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typing `tab` in Alfred lists every open tab in Firefox and Chrome in one list, and Enter brings the chosen tab to the front. Firefox tabs come through our own add-on, loaded temporarily.

**Architecture:** The Alfred workflow runs JavaScript for Automation (JXA) scripts through `/usr/bin/osascript`. Chrome tabs come from Chrome's AppleScript dictionary. Firefox tabs come from our WebExtension, which keeps a native-messaging port open to a JXA helper script. The workflow and the helper exchange request and reply files in a private folder, and wake each other with distributed notifications that carry only a request ID. Logic that doesn't touch macOS is plain JavaScript, tested under Node.

**Tech Stack:** JXA (`osascript -l JavaScript`), Firefox WebExtensions (Manifest V2), Alfred 5 Script Filter JSON, Node 24 `node:test` for development only, `web-ext` (dev dependency) for the real-Firefox check.

**Spec:** `docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md` (approved 2026-11-22). Milestone 1 is "Firefox and Chrome tabs under one `tab` keyword, using our own add-on loaded temporarily in Firefox (about:debugging) on both Macs."

## Global Constraints

- Shipped code uses only what macOS includes: JavaScript for Automation (`osascript -l JavaScript`), `/usr/bin/sqlite3`, `/usr/bin/plutil` and the shell. No Python, Node or Homebrew at runtime. Node is fine for development and tests.
- Shipped files stay readable: no minification or bundling into one opaque file.
- No compiled code, no network requests, no auto-update, nothing downloaded or installed at runtime.
- No backend ever launches a browser. Tabs from a browser that isn't running are simply absent.
- Alfred 5 or later, with the Powerpack.
- The add-on asks only for the permissions it needs. In milestone 1 that is `tabs` and `nativeMessaging`, and nothing runs code in pages.
- Notifications never carry queries or browser data. The helper reads and writes only inside its own private folder, and never uses a path given in a request.
- These IDs are fixed now and never change once the add-on is on addons.mozilla.org:
  - workflow bundle ID: `io.github.shariqh.browser-search-for-alfred`
  - native messaging name: `io.github.shariqh.browser_search_for_alfred`
  - add-on ID: `browser-search-for-alfred@shariqh.github.io`
- Keyword `tab` (at least three characters; the configuration comes in milestone 2).
- MIT licence. The README credits epilande/alfred-browser-tabs (the JXA tab approach) and deanishe/alfred-firefox (the add-on and helper design).
- CI runs on GitHub-hosted runners, never on the self-hosted runners on Shariq's MacBook Pro.
- Tests keep all state in a temporary folder: they set `HOME` to a fixture folder and `BSA_TEST_CHANNEL` to a unique value, and never touch the real `~/Library`.

### Decisions this plan makes on top of the spec

1. **The helper runs from a copy outside the workflow folder.** "Set up Firefox" copies `firefox-helper.js` to `~/Library/Application Support/io.github.shariqh.browser-search-for-alfred/firefox-helper.js` (mode 755), and the registration file points there. Alfred's preferences can live in iCloud Drive. Firefox would then start the helper from a path that differs per Mac, that iCloud can evict, that may lose the executable bit, and that macOS may protect from Firefox. The spec's check "the registration still points at this workflow's helper" becomes: the registration points at the copy, and the copy's bytes match the workflow's `firefox-helper.js`.
2. **The private folder is `$HOME/Library/Caches/io.github.shariqh.browser-search-for-alfred/firefox`** (mode 700). The helper is started by Firefox and never sees Alfred's `alfred_workflow_cache` variable, so both sides compute this path from `HOME`. That keeps the spec's intent: a private cache folder.
3. **The add-on uses Manifest V2 with a persistent background page.** MDN says that in Manifest V3 "Message ports cannot prevent an event page from shutting down", so the port to the helper, and with it the helper, would stop when the add-on idles. Whether addons.mozilla.org still accepts new Manifest V2 add-ons gets checked before milestone 4.
4. **The 1 MB limit only applies to messages from the helper to the add-on**, which are small requests. Tab lists travel the other way, where the limit is 4 GB, so they are not capped. They are trimmed to the fields shown.
5. **The helper is one self-contained file.** It loads nothing at runtime, so its copy works on its own.
6. **Firefox is brought to the front without Apple Events** (`NSRunningApplication`), so Firefox never triggers an "Alfred wants to control Firefox" prompt. Chrome is driven through AppleScript and triggers its prompt once, as the spec expects.

## Review Focus

1. Alfred's own panel is frontmost while `tab` runs. The tab list should still lead with the browser the person was last in, not fall back unpredictably. The ordering test is in Task 7.
2. Firefox is running but the add-on is missing or disabled. `tab` should still show Chrome tabs within the time budget, plus one item that says Firefox didn't answer, and must not hang. The test is in Task 5.
3. A tab closes between listing and Enter. Activation does nothing, throws nothing and launches nothing. The tests are in Tasks 3 and 7.
4. After a workflow update, the installed helper copy is out of date. `tab` should offer "Set up Firefox" again. The test is in Task 4.
5. Titles and URLs contain quotes, newlines, emoji or right-to-left text, or the title is empty. The output must be valid JSON, every `arg` must survive the trip back through Alfred, and an empty title falls back to the URL. The tests are in Tasks 5 and 7.

---

## File structure

```
workflow/                          # everything that ships in the .alfredworkflow
  info.plist                       # Alfred workflow definition (Task 8)
  tab.js                           # Script Filter for `tab` (Tasks 5, 7)
  act.js                           # Action: activate a tab, set up Firefox (Tasks 4, 5, 7)
  firefox-helper.js                # native-messaging helper, self-contained (Task 2)
  lib/constants.js                 # IDs, paths, notification names (Task 1)
  lib/jxa.js                       # JXA-only file, notification and app helpers (Task 2)
  lib/firefox-client.js            # JXA: send a request to the helper, wait for the reply (Task 2)
  lib/registration.js              # pure: registration file content and checks (Task 4)
  lib/items.js                     # pure: Alfred items, ordering, Script Filter output (Tasks 5, 7)
  lib/chromium.js                  # pure over an injected app object: list and activate tabs (Task 7)
addon/
  manifest.json                    # MV2, persistent background (Task 3)
  handler.js                       # pure request handler over an injected `browser` (Task 3)
  background.js                    # port, reconnect, dispatch to handler (Task 3)
scripts/build.sh                   # dist/*.alfredworkflow and dist/*-addon.zip (Task 8)
scripts/check-real-firefox.sh      # the milestone gate on the MacBook Pro (Task 6)
test/unit/*.test.mjs               # Node, any OS; CI runs these
test/macos/*.test.mjs              # Node driving osascript; skipped off macOS
test/fixtures/
.github/workflows/test.yml
```

**How shared code is loaded (applies to every task).** Every file in `workflow/lib/` and `addon/handler.js` is a plain script whose last statement is an immediately invoked function. The function returns the module's API and also assigns it to `module.exports` when `module` exists:

```js
(function () {
  // ...functions...
  const api = { /* exports */ };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
```

Node tests load these files with `createRequire(import.meta.url)`. JXA entry scripts load them with `loadLib(name)`, defined once in each entry. `loadLib` reads `<workflow dir>/lib/<name>.js` with `NSString.stringWithContentsOfFileEncodingError` and returns `eval(text)`. The workflow folder is the folder of the entry script. Alfred runs entries with the workflow folder as the current directory, so a relative path resolves against `NSFileManager.defaultManager.currentDirectoryPath`. `firefox-helper.js` loads nothing (decision 5).

---

### Task 1: Scaffold, constants and CI

**Files:**
- Create: `package.json`, `.gitignore`, `workflow/lib/constants.js`, `test/unit/constants.test.mjs`, `.github/workflows/test.yml`
- Modify: `README.md` (add a "Credits" section and "Development" commands)

**Interfaces:**
- Produces: `constants.js` exporting
  - `BUNDLE_ID = "io.github.shariqh.browser-search-for-alfred"`
  - `HOST_NAME = "io.github.shariqh.browser_search_for_alfred"`
  - `ADDON_ID = "browser-search-for-alfred@shariqh.github.io"`
  - `KEYWORD = "tab"`
  - `FIREFOX_BUNDLE_ID = "org.mozilla.firefox"`, `CHROME_BUNDLE_ID = "com.google.Chrome"`
  - `privateDir(home) -> string`: `${home}/Library/Caches/${BUNDLE_ID}/firefox`
  - `helperInstallPath(home) -> string`: `${home}/Library/Application Support/${BUNDLE_ID}/firefox-helper.js`
  - `registrationPath(home) -> string`: `${home}/Library/Application Support/Mozilla/NativeMessagingHosts/${HOST_NAME}.json`
  - `notificationName(kind, channel) -> string`, where `kind` is `"request"` or `"reply"`: `${BUNDLE_ID}.${kind}` with `.test.${channel}` appended when `channel` is a non-empty string
  - `FIREFOX_TIMEOUT_MS = 400`

- [ ] **Step 1: Write the failing test** `test/unit/constants.test.mjs`. It asserts:
  - each value above;
  - `HOST_NAME` matches `/^\w+(\.\w+)*$/`;
  - `ADDON_ID` matches `/^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/` and is at most 80 characters;
  - `privateDir("/h") === "/h/Library/Caches/io.github.shariqh.browser-search-for-alfred/firefox"`;
  - `notificationName("reply", "")` ends with `.reply`, and `notificationName("reply", "x1")` ends with `.reply.test.x1`.
- [ ] **Step 2: Run it.** `node --test test/unit` → FAIL (cannot find module).
- [ ] **Step 3: Implement `workflow/lib/constants.js`** in the shared-script shape, and `package.json`:
  - `"private": true`, `"license": "MIT"`, no runtime dependencies;
  - scripts `"test": "node --test test/unit"` and `"test:macos": "node --test test/macos"`;
  - `"engines": {"node": ">=24"}`.

  `.gitignore` covers `node_modules/` and `dist/`. `.github/workflows/test.yml` runs on push and pull request with `ubuntu-latest`: `actions/checkout` and `actions/setup-node` with `node-version: 24`, at the major versions their READMEs list as current, then `npm test`.
- [ ] **Step 4: Run it.** `npm test` → PASS.
- [ ] **Step 5: Commit** `Scaffold: constants, unit test runner and CI`.

### Task 2: The Firefox channel (helper and client)

**Files:**
- Create: `workflow/firefox-helper.js` (executable, first line `#!/usr/bin/osascript -l JavaScript`), `workflow/lib/jxa.js`, `workflow/lib/firefox-client.js`, `test/macos/helper.test.mjs`, `test/macos/fake-firefox.mjs` (test utility)

**Interfaces:**
- Consumes: `constants.js`.
- Produces:
  - `jxa.js`: `home() -> string` (from the `HOME` environment variable, falling back to `NSHomeDirectory()`), `channel() -> string` (`BSA_TEST_CHANNEL` or `""`), `readText(path) -> string|null`, `writeTextAtomic(path, text, mode)`, `ensureDir(path, mode)`, `remove(path)`, `fileExists(path) -> bool`, `postNotification(name, object)`, `waitFor(predicate, deadlineMs) -> bool` (runs the run loop in 20 ms slices), `isRunning(bundleId) -> bool`, `activateApp(bundleId) -> bool`, `appPath(bundleId) -> string|null`.
  - `firefox-client.js`: `request(command, params, timeoutMs) -> {ok: true, payload} | {ok: false, error: "timeout"|string}`.
- The helper's protocol:
  - From Firefox: 4-byte little-endian length plus UTF-8 JSON. The add-on sends replies `{id, payload}` or `{id, error}`, and the helper sends requests `{id, command, params}`.
  - From Alfred: the client writes `<privateDir>/<id>.request.json` containing `{id, command, params}`, then posts `notificationName("request")` with `object = id`. The helper reads only `<privateDir>/<id>.request.json`, where `id` must match `/^[A-Za-z0-9-]{1,64}$/`. It deletes the request file, forwards the request, writes `<privateDir>/<id>.reply.json`, and posts `notificationName("reply")` with `object = id`.
  - The client waits until the reply file exists or the deadline passes. The file is the source of truth; the notification only wakes the client. The client deletes its request and reply files either way.
  - Request IDs are `<pid>-<ms>-<random>`.

- [ ] **Step 1: Write the failing tests** in `test/macos/helper.test.mjs`. Skip the whole file unless `process.platform === "darwin"`. Each test:
  - makes a fixture `HOME` under `os.tmpdir()`;
  - sets `BSA_TEST_CHANNEL` to a unique value;
  - starts `fake-firefox.mjs`, which spawns `workflow/firefox-helper.js` the way Firefox does (the file executed directly, with two arguments: a manifest path and `ADDON_ID`) and answers its framed requests with scripted replies;
  - calls the client through a tiny JXA driver that loads `firefox-client.js` and prints `JSON.stringify(request(...))`.

  Tests:
  - `round trip: list-tabs returns the scripted payload` (payload deep-equals).
  - `2,000 tabs with non-ASCII titles arrive intact` (titles include `"✓ ünïcödé 日本 \"q\" \n"`).
  - `frames split across chunks and two frames in one chunk are both read` (fake Firefox writes one reply in three chunks, then two replies in one write).
  - `a parameter of 0 reaches Firefox as 0` (fake Firefox records `params`; regression for the spike bug).
  - `an error reply comes back as {ok:false, error}`.
  - `no helper running: request returns {ok:false, error:"timeout"} within 600 ms`.
  - `a request id with "../" is ignored and nothing is written outside the private folder` (post the notification with object `"../x"`; assert no new files outside `privateDir`).
  - `the helper exits 0 when stdin closes` (and doesn't spin: it exits within 2 s).
  - `the private folder is created with mode 700`.
- [ ] **Step 2: Run them.** `npm run test:macos` → FAIL.
- [ ] **Step 3: Implement** `jxa.js`, `firefox-client.js` and `firefox-helper.js`.
  - The helper reads stdin with `NSFileHandle.readInBackgroundAndNotify` and receives request notifications through an `ObjC.registerSubclass` observer on `NSDistributedNotificationCenter` with `NSNotificationSuspensionBehaviorDeliverImmediately`. It runs `NSRunLoop` until stdin reaches end of file.
  - Treat end of file as `data.isNil() || Number(data.length) === 0`. A plain `=== 0` check spun forever in the spike.
  - Send `params` exactly as received: never `params || {}`.
  - The helper duplicates the few constants it needs (bundle ID, notification names), because it loads nothing (decision 5). A unit test in Task 4 compares them with `constants.js`.
- [ ] **Step 4: Run them.** `npm run test:macos` → PASS, all 9.
- [ ] **Step 5: Commit** `Firefox channel: a JXA native-messaging helper and its client`.

### Task 3: The Firefox add-on

**Files:**
- Create: `addon/manifest.json`, `addon/handler.js`, `addon/background.js`, `test/unit/addon.test.mjs`

**Interfaces:**
- Consumes: nothing from earlier tasks. The add-on is standalone. `ADDON_ID` and `HOST_NAME` are written literally in it, and the test compares them with `constants.js`.
- Produces: `handler.js` exporting
  - `handleRequest(browser, request) -> Promise<{id, payload} | {id, error}>`
  - `reconnectDelayMs(attempt) -> number`
- Commands:
  - `list-tabs` returns `[{id, windowId, index, title, url, active}]` for every tab from `browser.tabs.query({})`, leaving out tabs whose `id` is `browser.tabs.TAB_ID_NONE`.
  - `activate-tab` with `params = {tabId, windowId}` calls `browser.tabs.update(tabId, {active: true})`, then `browser.windows.update(windowId, {focused: true})`, and returns `{id, payload: true}`.

- [ ] **Step 1: Write the failing tests** with a fake `browser` object that records calls:
  - `list-tabs keeps only the six fields and drops TAB_ID_NONE tabs`;
  - `activate-tab updates the tab, then focuses its window`;
  - `activate-tab on a closed tab returns {id, error} and doesn't throw` (the fake `tabs.update` rejects);
  - `an unknown command returns {id, error: "unknown command: x"}`;
  - `reconnectDelayMs` returns 1000, 2000, 4000, … and is capped at 60000 for attempts 0 to 10;
  - `manifest.json`:
    - `manifest_version` is 2 and `background.persistent` is `true`;
    - `background.scripts` is `["handler.js", "background.js"]`;
    - `permissions` deep-equals `["nativeMessaging", "tabs"]`;
    - `browser_specific_settings.gecko.id === ADDON_ID`;
    - `background.js` contains `connectNative("io.github.shariqh.browser_search_for_alfred")`.
- [ ] **Step 2: Run them.** `npm test` → FAIL.
- [ ] **Step 3: Implement.**
  - `background.js` connects at startup.
  - On `onDisconnect` it reconnects after `reconnectDelayMs(attempt)` and resets `attempt` once a message arrives.
  - It answers each incoming message with `port.postMessage(await handleRequest(browser, msg))`.
  - The manifest's `name` is "Browser Search for Alfred" and its `version` is "0.1.0".
- [ ] **Step 4: Run them.** `npm test` → PASS.
- [ ] **Step 5: Commit** `Firefox add-on: list and activate tabs over native messaging`.

### Task 4: Set up Firefox

**Files:**
- Create: `workflow/lib/registration.js`, `workflow/act.js` (the `setup-firefox` action only), `test/unit/registration.test.mjs`, `test/macos/setup.test.mjs`

**Interfaces:**
- Consumes: `constants.js`, `jxa.js`.
- Produces:
  - `registration.js`: `registrationManifest(helperPath) -> {name: HOST_NAME, description: "Browser Search for Alfred helper", path: helperPath, type: "stdio", allowed_extensions: [ADDON_ID]}`.
  - `registration.js`: `registrationProblem(manifestText | null, expectedHelperPath, helperCopyMatches) -> null | "missing" | "elsewhere" | "stale"`. It returns `"missing"` when there's no file or it isn't valid JSON, `"elsewhere"` when `path` differs or `allowed_extensions` lacks `ADDON_ID`, `"stale"` when the copy's bytes differ, and `null` otherwise.
  - `act.js`: `osascript -l JavaScript act.js '<json>'`. With `{"action":"setup-firefox"}`, it creates the folders, copies `firefox-helper.js` to `helperInstallPath(home)` with mode 755, writes `registrationPath(home)` atomically with mode 644 as the JSON of `registrationManifest(...)` (two-space indent, trailing newline), and prints nothing.

- [ ] **Step 1: Write the failing tests.**
  - Unit: the exact manifest object for `"/h/x.js"`, and each branch of `registrationProblem`, including invalid JSON.
  - Unit: the constants that `firefox-helper.js` duplicates equal `constants.js` (read the file as text and match the literals).
  - macOS, with a fixture `HOME`:
    - setup creates both files with modes 755 and 644, and the registration JSON equals `registrationManifest(helperInstallPath(home))`;
    - running it twice changes nothing;
    - a registration file with another `path` is replaced;
    - it never writes outside `HOME`.
- [ ] **Step 2: Run them.** `npm test && npm run test:macos` → FAIL.
- [ ] **Step 3: Implement** `registration.js` and the `setup-firefox` branch of `act.js`.
- [ ] **Step 4: Run them.** Both suites → PASS.
- [ ] **Step 5: Commit** `Set up Firefox: install the helper copy and register it`.

### Task 5: Firefox tabs in `tab`

**Files:**
- Create: `workflow/lib/items.js`, `workflow/tab.js`, `test/unit/items.test.mjs`, `test/macos/tab-firefox.test.mjs`
- Modify: `workflow/act.js` (add the `activate` action for Firefox)

**Interfaces:**
- Consumes: `constants.js`, `jxa.js`, `firefox-client.js`, `registration.js`.
- Produces:
  - `items.js`: `tabItem(tab, appPath) -> AlfredItem`. Here `tab = {browser: "firefox"|"chrome", browserName, windowId, tabId, title, url}`.
    - `title` is `tab.title` or, when empty, the URL without its scheme.
    - `subtitle` is `` `${browserName} · ${url}` ``.
    - `arg` is `JSON.stringify({action: "activate", browser, windowId, tabId})`.
    - `match` is `` `${title} ${url without scheme, non-word characters replaced by spaces}` ``.
    - `icon` is `{type: "fileicon", path: appPath}` when `appPath` is set.
    - `text` is `{copy: url, largetype: title}`.
    - There is no `uid`.
  - `items.js`: `setupItem(problem) -> AlfredItem`, titled "Set up Firefox", with `arg` `{"action":"setup-firefox"}` and a subtitle naming the problem in plain words.
  - `items.js`: `firefoxSilentItem() -> AlfredItem`, titled "Firefox didn't answer", with `valid: false` and the subtitle "Install or turn on the Browser Search add-on in Firefox".
  - `items.js`: `scriptFilterOutput(items) -> {skipknowledge: true, items}`.
  - `tab.js`: prints `JSON.stringify(scriptFilterOutput(...))`. For Firefox, it decides in this order:
    1. If `registrationProblem(...)` is not null, `setupItem` comes first and the Firefox request is skipped.
    2. Else, if Firefox isn't running, it adds nothing.
    3. Else it sends `request("list-tabs", null, FIREFOX_TIMEOUT_MS)`. On success it adds the tabs; on failure, `firefoxSilentItem`.
  - When `BSA_TEST_CHANNEL` is set, `tab.js` takes "is Firefox running" from `BSA_TEST_FIREFOX_RUNNING` (`"1"` or `"0"`) instead of asking macOS.
  - `act.js` with `{"action":"activate","browser":"firefox",...}` sends `request("activate-tab", {tabId, windowId}, FIREFOX_TIMEOUT_MS)`, then calls `activateApp(FIREFOX_BUNDLE_ID)`.

- [ ] **Step 1: Write the failing tests.**
  - Unit `items.test.mjs`:
    - the exact item for a normal Firefox tab;
    - an empty title falls back to the URL without its scheme;
    - for a title of `"Q \"x\" \n 😀 עברית"`, `JSON.parse(JSON.stringify(item))` round-trips and `JSON.parse(item.arg)` returns the four fields;
    - `scriptFilterOutput` has `skipknowledge: true`.
  - macOS `tab-firefox.test.mjs`, with fake Firefox, fixture `HOME`, setup already run and the running override set:
    - three scripted tabs give three items in tab order;
    - no registration puts "Set up Firefox" first;
    - a stale helper copy (one byte appended) puts "Set up Firefox" first;
    - Firefox running but no helper gives "Firefox didn't answer", and `tab.js` finishes in under 1,000 ms;
    - Firefox not running gives no Firefox items and no request file;
    - `act.js` activate sends `activate-tab` with the given IDs, as recorded by fake Firefox.
- [ ] **Step 2: Run them.** Both suites → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Both suites → PASS.
- [ ] **Step 5: Commit** `tab: list and activate Firefox tabs`.

### Task 6: Milestone gate — real Firefox starts the helper on the MacBook Pro

The spec says to test this first on both Macs, and to stop building if it fails. Here, real Firefox is checked on the MacBook Pro, without touching Shariq's own Firefox profile. The Air gets its check in Task 9, in his own Firefox.

**Files:**
- Create: `scripts/check-real-firefox.sh`
- Modify: `package.json` (add `web-ext` as a devDependency, pinned to the exact version `npm view web-ext version` reports at execution time, and a script `"check:firefox": "bash scripts/check-real-firefox.sh"`)

**Interfaces:**
- Consumes: Tasks 2 to 5.

- [ ] **Step 1: Write the script.**
  1. Run `act.js '{"action":"setup-firefox"}'` with the real `HOME`. This writes our own registration file, which has a different name from Firefox Assistant's, so nothing of his is replaced.
  2. Start `npx web-ext run --source-dir addon --firefox /Applications/Firefox.app --start-url https://example.com/` in the background. web-ext uses a fresh temporary profile. Check the flags against `npx web-ext run --help` for the pinned version first.
  3. Wait up to 30 s for `osascript -l JavaScript workflow/tab.js ""` to print an item whose subtitle contains `example.com`.
  4. Stop web-ext.
  5. Print `REAL FIREFOX: PASS` or `REAL FIREFOX: FAIL: <reason>`, and exit 0 or 1 to match.
- [ ] **Step 2: Run it on the MacBook Pro.** `npm run check:firefox` → expected `REAL FIREFOX: PASS`.
- [ ] **Step 3: If it fails, stop.** Don't start Task 7. Report the output to the coordinator. Shariq then decides whether a small signed helper fills the gap (spec, "What the throwaway test proved").
- [ ] **Step 4: Commit** `Check that real Firefox starts the helper`, and record the result line in `docs/build-log.md`.

### Task 7: Chrome tabs, merged with Firefox

**Files:**
- Create: `workflow/lib/chromium.js`, `test/unit/chromium.test.mjs`
- Modify: `workflow/lib/items.js` (add `orderBrowsers`), `workflow/tab.js`, `workflow/act.js`, `test/unit/items.test.mjs`

**Interfaces:**
- Consumes: `items.js` (`tabItem`), `jxa.js` (`isRunning`, `appPath`).
- Produces:
  - `chromium.js`: `listTabs(app, browserName) -> Tab[]` and `activateTab(app, windowId, tabId) -> bool`. `app` is an object shaped like JXA's `Application("Google Chrome")`:
    - `running()`;
    - `windows.id()` returns `string[]`;
    - `windows.tabs.id()`, `windows.tabs.title()` and `windows.tabs.url()` return `string[][]`;
    - `windows.byId(id)` returns a window with `tabs.id()`, a writable `activeTabIndex` (1-based) and a writable `index`;
    - `activate()`.
  - `listTabs` returns `[]` when `running()` is false, and never touches `windows` in that case.
  - `activateTab` finds the tab by ID, sets `activeTabIndex = i + 1` and `index = 1`, calls `activate()`, and returns `true`. When the window or tab is gone, it returns `false` without throwing.
  - `items.js`: `orderBrowsers(frontBundleId, browsers) -> browsers`. It moves the browser whose bundle ID equals `frontBundleId` to the front and otherwise keeps `[firefox, chrome]`. A `frontBundleId` that isn't a browser, such as Alfred's own `com.runningwithcrayons.Alfred`, leaves the order unchanged.
  - `tab.js` sends the Firefox request first, lists Chrome tabs while Firefox answers, then waits for the Firefox reply. Items come browser by browser, in `orderBrowsers` order.
  - `act.js` activates a Chrome tab with `activateTab(Application("Google Chrome"), windowId, tabId)` only when Chrome is running.

- [ ] **Step 1: Write the failing tests** with a fake `app`:
  - `lists tabs with ids, titles and URLs across two windows`;
  - `an empty title falls back to the URL without its scheme`;
  - `not running returns [] and never reads windows` (the fake's `windows` getter throws);
  - `activates by id: sets activeTabIndex and index, then activates`;
  - `a closed tab returns false and changes nothing`;
  - `orderBrowsers` puts Chrome first when Chrome is frontmost, and keeps `[firefox, chrome]` when Alfred is frontmost;
  - a Chrome tab titled `"Q \"x\" \n 😀 עברית"` gives an item whose `arg` round-trips through `JSON.parse`.
- [ ] **Step 2: Run them.** `npm test` → FAIL.
- [ ] **Step 3: Implement.** `windows.byId` is the JXA object-specifier form (`app.windows.byId(id)`). Read titles and URLs with one call each, as epilande's `list-tabs.js` does.
- [ ] **Step 4: Run them.** `npm test && npm run test:macos` → PASS, and the Task 5 tests still pass.
- [ ] **Step 5: Commit** `tab: Chrome tabs, merged with Firefox`.

### Task 8: Package the workflow and the add-on

**Files:**
- Create: `workflow/info.plist`, `scripts/build.sh`, `test/macos/build.test.mjs`
- Modify: `README.md` (how to build, and how to load the add-on temporarily)

**Interfaces:**
- Consumes: every file in `workflow/` and `addon/`.
- Produces:
  - `dist/Browser-Search-for-Alfred.alfredworkflow`: a zip of the contents of `workflow/`, with `firefox-helper.js` keeping mode 755.
  - `dist/browser-search-for-alfred-addon.zip`: a zip of the contents of `addon/`, with `manifest.json` at the root.

- [ ] **Step 1: Write the failing test** (`build.test.mjs`, macOS):
  - `bash scripts/build.sh` exits 0 and makes both files;
  - `plutil -lint workflow/info.plist` passes;
  - in the plist, `bundleid` equals `BUNDLE_ID`;
  - there is exactly one Script Filter, with `keyword` `tab`, whose script runs `osascript -l JavaScript ./tab.js`;
  - one Action Script runs `./act.js` and is connected from the Script Filter;
  - `unzip -Z` shows mode `-rwxr-xr-x` for `firefox-helper.js` in the workflow zip;
  - the add-on zip lists `manifest.json` at the root.
- [ ] **Step 2: Run it.** `npm run test:macos` → FAIL.
- [ ] **Step 3: Write `workflow/info.plist`.**
  - Use the structure of epilande/alfred-browser-tabs `src/info.plist` (MIT) as the reference for the keys.
  - The Script Filter: keyword `tab`, title "Search open tabs", `type` 0 (bash), script `/usr/bin/osascript -l JavaScript ./tab.js "$1"`, `scriptargtype` 1 (argv), `alfredfiltersresults` true, `alfredfiltersresultsmatchmode` 2, `argumenttype` 1, `withspace` true.
  - The Action Script: script `/usr/bin/osascript -l JavaScript ./act.js "$1"`, `type` 0, `scriptargtype` 1.
  - Metadata: `name` "Browser Search for Alfred", `version` "0.1.0", `createdby` "Shariq Hirani", `webaddress` the GitHub repo.
  - Running every script through `osascript` means Alfred never needs an executable bit on the entry scripts.

  Then write `scripts/build.sh`, using `/usr/bin/zip -r -X`.
- [ ] **Step 4: Run it.** `npm run test:macos` → PASS.
- [ ] **Step 5: Commit** `Package the workflow and the add-on`.

### Task 9: Try it in Shariq's own browsers (human check, the Air)

This task is run by the coordinator together with Shariq. Nothing is merged until it passes.

- [ ] **Step 1:** The coordinator copies both `dist/` files to the Air's `~/Downloads/` and sends Shariq these steps through Agent Inbox:
  1. Double-click `Browser-Search-for-Alfred.alfredworkflow` and import it. Alfred's sync carries it to the MacBook Pro.
  2. In Firefox, go to `about:debugging` → This Firefox → Load Temporary Add-on…, and choose `manifest.json` inside the unzipped add-on.
  3. In Alfred, type `tab`, choose "Set up Firefox", then type `tab` again.
  4. Pick a Firefox tab, then a Chrome tab, and check that each comes to the front. Answer the one-time "Alfred wants to control Google Chrome" prompt if it appears.
- [ ] **Step 2:** Record what happened in `docs/build-log.md`, including anything that surprised him, and commit `Milestone 1: tried on the Air`.
- [ ] **Step 3:** Draft the Alfred Forum question the spec asks for in milestone 1, and put it on an Agent Inbox row for Shariq to post himself. It asks whether a Gallery workflow may (1) write a Firefox native-messaging registration file and a helper copy outside its own folder, from an explicit "Set up Firefox" action, and (2) ask people to grant Alfred Full Disk Access for Safari bookmarks and history. The coordinator never posts it.

---

## Done when

- `npm test` passes on CI, and `npm test && npm run test:macos` passes on the MacBook Pro.
- `npm run check:firefox` printed `REAL FIREFOX: PASS` on the MacBook Pro.
- On the Air, `tab` listed his Firefox and Chrome tabs together, and Enter brought each kind to the front.
- `docs/build-log.md` has an entry for the gate and the try-out.
