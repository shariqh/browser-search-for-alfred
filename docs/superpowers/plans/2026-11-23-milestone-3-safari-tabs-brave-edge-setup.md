# Milestone 3: Safari tabs, Brave and Edge, setup items, Gallery README and icon. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `tab` lists Safari, Brave and Edge tabs as well as Firefox's and Chrome's, and `bmk` and `hist` cover Brave and Edge. A browser that refuses Alfred's Apple Events gets a clear "Allow" item. Private and incognito windows stay out. The README follows the Alfred Gallery style, and the workflow gets its icon.

**Architecture:**
- A small browser registry, `lib/browsers.js`, names the five browsers once: key, display name, bundle ID, family and data folder. The entry scripts loop over it instead of naming Chrome.
- The Chromium tab code serves Chrome, Brave and Edge. A new `lib/safari-tabs.js` handles Safari's different dictionary.
- Both share one Apple Event time budget, now in `lib/ae-budget.js`. Brave's and Edge's bookmarks and history reuse the Chrome file code, pointed at their own data folders.

**Tech Stack:** JavaScript for Automation (JXA) and Apple Events, `/usr/bin/sqlite3`, `/usr/bin/open` and `qlmanage` (development only, to render the icon), plus Node 24's `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md`, milestone 3: "Safari tabs, Brave and Edge, the setup and permission items, the README in the Gallery style, and the icon". The plans for milestones 1 and 2 and their rulings are in `docs/superpowers/plans/`. Their leftovers are in issue #2 and aren't part of this plan.

## Global Constraints

- **Shipped code** uses only what macOS includes: JXA, `/usr/bin/sqlite3`, `/usr/bin/open` and the shell. Nothing runs at runtime from Python, Node or Homebrew, and files stay readable. No network requests.
- **Launching:** searching never launches a browser. A browser's tabs are listed only while macOS says it is running. Enter on a bookmark or history item may start its browser.
- **Fixed IDs stay unchanged:** `BUNDLE_ID`, `HOST_NAME` and `ADDON_ID`, the keywords `tab`, `bmk` and `hist`, and the variables `{var:keyword_tabs}`, `{var:keyword_bookmarks}` and `{var:keyword_history}`.
- **Browsers in the registry, in this default order:**

  | Key | Display name | Bundle ID | Data folder |
  |---|---|---|---|
  | `firefox` | "Firefox" | `org.mozilla.firefox` | via the add-on |
  | `chrome` | "Google Chrome" | `com.google.Chrome` | `~/Library/Application Support/Google/Chrome` |
  | `safari` | "Safari" | `com.apple.Safari` | `~/Library/Safari` |
  | `brave` | "Brave Browser" | `com.brave.Browser` | `~/Library/Application Support/BraveSoftware/Brave-Browser` |
  | `edge` | "Microsoft Edge" | `com.microsoft.edgemac` | `~/Library/Application Support/Microsoft Edge` |

  The sources: Brave's bundle ID is `MAC_BUNDLE_ID` in brave/brave-core's `app/theme/brave/BRANDING`. Edge's bundle ID (its `quit:` entry) and both data folders (their `zap:` entries) come from the Homebrew casks `microsoft-edge` and `brave-browser`.
- **Apple Events:** Brave and Edge use Chrome's dictionary. The source is epilande/alfred-browser-tabs, which drives Chrome, Brave and Edge with the same JXA calls.
  - Chrome's dictionary, read from the app: a window has `id`, `index` (rw), `mode` ("normal" | "incognito") and `active tab index` (rw), and a tab has `id`, `title` and `URL`.
  - Safari's dictionary: a window has `id`, `index` and `current tab` (rw), and a tab has `name`, `URL` and `index`. Tabs have no ID, and nothing marks a private window.
  - Error codes, from the macOS SDK's `AE.framework/Headers/AppleEvents.h`: `errAEEventNotPermitted = -1743` means Automation was refused. The existing code already treats -1712 as a timeout.
- **Private browsing stays private:** a Chromium window whose `mode` is "incognito" is never listed. Firefox's private tabs are already left out.
- **Item shapes:**
  - Tab items keep `skipknowledge` and carry no `uid`.
  - Bookmark and history items keep `uid` set to the URL.
  - Icons are each browser's app icon (`fileicon`).
  - Tabs are listed browser by browser in the default order, with the frontmost browser first.
- **Tests:**
  - Tests never touch a real browser or real browser data. Every path comes from `jxa.home()`.
  - Under `BSA_TEST_CHANNEL`, every Apple Event browser is replaced by a fake built from `BSA_TEST_TABS_<KEY>`, and every action is logged to `$HOME/activated-apps.log`.
  - `BSA_SKIP_APPLESCRIPT=1` makes `tab` skip every Apple Event browser. The real-Firefox gate sets it.
- **Test commands:** `npm test` and `npm run test:macos`. Both must pass at the end of every task.
- **Alfred Gallery** (alfred.app/submit and /submit/styleguide, read 2026-11-23):
  - The icon is at least 256×256 px.
  - The README starts with `## Usage`, and `## Setup` goes above it only for extra manual steps. Each task's text ends with "via the `KEYWORD` keyword".
  - Modifiers are listed below in the form `* <kbd>⌘</kbd><kbd>↩</kbd> ACTION`.
  - Configuration is described as the "Workflow’s Configuration".
  - Images use `![ALT](images/NAME.png)`.

## Review Focus

1. **An incognito Chrome, Brave or Edge window is never listed.** A fake with one normal and one incognito window yields only the normal window's tabs. Pinned in Task 2.
2. **Automation refused (-1743) for one browser gives exactly one "Allow Alfred to control …" item for it,** and every other browser's tabs still show. Pinned in Task 4.
3. **A browser that hangs can't hold `tab` for longer than the shared budget,** and the browsers after it are skipped rather than waited on. Pinned in Task 2, using an injected clock, and in Task 4.
4. **A Safari tab that moved or closed after the list was shown:** Enter finds it by URL in the same window, or does nothing. It never selects a different page. Pinned in Task 3.
5. **Brave or Edge not installed, or its data folder missing:** it contributes nothing and shows no "Allow" item. Pinned in Task 5.

---

### Task 1: The browser registry, and checkboxes for Brave and Edge

**Files:**
- Create: `workflow/lib/browsers.js`, `test/unit/browsers.test.mjs`
- Modify: `workflow/lib/constants.js`, `workflow/lib/config.js`, `workflow/info.plist`, `test/unit/config.test.mjs`, `test/macos/build.test.mjs`

**Interfaces:**
- `constants.js` gains:
  - `BRAVE_BUNDLE_ID: "com.brave.Browser"` and `EDGE_BUNDLE_ID: "com.microsoft.edgemac"`;
  - `braveDataDir(home)` and `edgeDataDir(home)`, with the folders from the Global Constraints table.
- `browsers.js` produces `ALL`, an array in the default order. Each entry is `{key, name, bundleId, family: "firefox"|"chromium"|"safari", dataDir: (home) => string | null}`.
  - Firefox's `dataDir` returns null.
  - Safari's returns `${home}/Library/Safari`.
- `browsers.js` also produces `byKey(key) -> entry | undefined`, `chromium() -> entry[]` (Chrome, Brave, Edge) and `defaultOrder() -> string[]`.
- How `browsers.js` loads `constants`: `typeof loadLib === "function" ? loadLib("constants") : require("./constants.js")`. The same file must work under Node and under JXA.
- `config.enabledBrowsers` also returns `brave` and `edge`, from `browser_brave` and `browser_edge`. As before, "0" means off.

- [ ] **Step 1: Write the failing tests.**
  - `browsers.test.mjs` checks the five entries exactly as in the table, in order, and that `chromium()` returns their keys `["chrome", "brave", "edge"]`.
  - `config.test.mjs` checks that Brave and Edge default to on and that "0" turns each off.
  - `build.test.mjs` checks that `userconfigurationconfig` gains two checkboxes after `browser_safari`: `browser_brave` with text "Brave Browser" and `browser_edge` with text "Microsoft Edge". Both have label "", `default: true` and `required: false`.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement it.** Keep `info.plist` as XML, and `plutil -lint` must pass.
- [ ] **Step 4: Run all tests.** Expected: they pass.
- [ ] **Step 5: Commit.** `git commit -m "Browser registry; Brave and Edge checkboxes"`

### Task 2: Chromium tabs for any Chromium browser, without incognito, with "denied" reported

**Files:**
- Create: `workflow/lib/ae-budget.js`, `test/unit/ae-budget.test.mjs`
- Modify: `workflow/lib/chromium.js`, `workflow/tab.js` (call site only), `test/unit/chromium.test.mjs`

**Interfaces:**
- `ae-budget.js` takes over the `budget(options)` function from `chromium.js` unchanged, and adds:
  - `options.deadlineMs`, an absolute time in milliseconds, which wins over `budgetSeconds`;
  - `isDenied(error) -> boolean`, true when `error.errorNumber === -1743` or the message contains "(-1743)".
- `chromium.listTabs(app, browser, options) -> {tabs: Tab[], denied: boolean}`. `browser` is a registry entry, and the tab shape is `Tab = {browser: browser.key, browserName: browser.name, windowId, tabId, title, url}`.
  - It reads `windows.mode()` along with `id`, `tabs.id`, `tabs.title` and `tabs.url`, all through the same budget, and skips every window whose mode is "incognito".
  - A denied error gives `{tabs: [], denied: true}`. Any other error, or running out of time, gives `{tabs: [], denied: false}`.
- `chromium.activateTab` is unchanged.

- [ ] **Step 1: Write the failing tests.**
  - With a fake app holding windows `[{mode: "normal"}, {mode: "incognito"}]`, only the normal window's tabs come back.
  - A fake that throws an error with `errorNumber: -1743` gives `denied: true`.
  - With `deadlineMs` already in the past, no Apple Event is made and the result is `{tabs: [], denied: false}`.
  - The existing `listTabs` tests change to the new return shape, and `browserName` and `browser` come from the entry passed in.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement it.** `tab.js` passes `browsers.byKey("chrome")` and takes `.tabs`, so nothing else changes yet.
- [ ] **Step 4: Run all tests.** Expected: they pass.
- [ ] **Step 5: Commit.** `git commit -m "Chromium tabs: any Chromium browser, no incognito, report denied Automation"`

### Task 3: Safari tabs

**Files:**
- Create: `workflow/lib/safari-tabs.js`, `test/unit/safari-tabs.test.mjs`

**Interfaces:**
- `safariTabs.listTabs(app, options) -> {tabs: Tab[], denied: boolean}`.
  - It reads `windows.id()`, `windows.tabs.name()` and `windows.tabs.url()` through `ae-budget`.
  - Tab objects have `browser: "safari"`, `browserName: "Safari"`, `windowId` (a string) and `tabId: String(position)`, where the position starts at 1.
  - A window whose tab arrays are missing or of unequal length is skipped.
  - Denied and timeout are handled as in Task 2.
- `safariTabs.activateTab(app, windowId, tabPosition, url, options) -> boolean`.
  - It picks the tab at `tabPosition` when its URL still equals `url`, and otherwise the first tab in that window with that URL.
  - If no tab in the window has that URL, it changes nothing and returns false.
  - Otherwise it sets `window.currentTab` to that tab, sets `window.index` to 1, calls `app.activate()`, and returns true.
  - It never throws.

- [ ] **Step 1: Write the failing tests, with fake apps.**
  - Two windows of tabs list in order.
  - A window with mismatched arrays is skipped.
  - A denied error is reported.
  - `activateTab` selects the right tab when it moved: the URL is now at position 3, not 2.
  - It returns false and selects nothing when the URL is gone (Review Focus 4).
  - It returns false when the window has gone.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run all tests.** Expected: they pass.
- [ ] **Step 5: Commit.** `git commit -m "Safari tabs: list and bring forward"`

### Task 4: `tab` lists every browser; "Allow Alfred to control" items; activation for all

**Files:**
- Modify:
  - `workflow/tab.js`, `workflow/act.js`, `workflow/lib/items.js`, `workflow/lib/constants.js` (`TABS_BUDGET_MS`)
  - `scripts/check-real-firefox.sh` (switch `BSA_SKIP_CHROME` to `BSA_SKIP_APPLESCRIPT`)
  - `test/unit/items.test.mjs`, `test/macos/tab-chrome.test.mjs`
- Create: `test/macos/tab-browsers.test.mjs`

**Interfaces:**
- `items.tabItem`'s `arg` gains `url`, giving `{action: "activate", browser, windowId, tabId, url}`. Everything else stays the same.
- `items.automationItem(browserName)`:
  - `title`: `` `Allow Alfred to control ${browserName}` ``
  - `subtitle`: `` `Press Return, then turn on ${browserName} under Alfred in Privacy & Security → Automation` ``
  - `arg`: `JSON.stringify({action: "open-automation"})`
  - no `uid`.
- `tab.js`:
  1. Firefox works as now.
  2. It lists the Apple Event browsers in the order Chrome, Safari, Brave, Edge, each only when it is ticked and running. They share one `deadlineMs` of `Date.now() + TABS_BUDGET_MS`, where `TABS_BUDGET_MS` is 1500 and lives in `constants`.
  3. A denied browser gives `[automationItem(name)]` instead of tabs.
  4. The output is ordered with `orderBrowsers(front, …)` over all five, in the registry's default order.
- Under the channel, `BSA_TEST_TABS_<KEY>` (`CHROME`, `SAFARI`, `BRAVE`, `EDGE`) names a JSON file holding either `{windows: [{id, mode?, tabs: [{id?, title, url}]}]}` or `{"denied": true}`. It replaces `BSA_TEST_CHROME_TABS`. A browser with no file counts as not running.
- `act.js activate`:
  - `firefox` works as now.
  - `chrome`, `brave` and `edge` use `chromium.activateTab(Application(<bundle id>), …)`, and only while that browser is running.
  - `safari` uses `safariTabs.activateTab(…, url)`.
  - Under the channel it logs `<key> <windowId> <tabId>`.
  - An unknown key throws.
- New action `open-automation`: it runs `/usr/bin/open "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"` and logs `open-automation`.
  - The `Privacy_Automation` anchor isn't listed in macOS 27.3's privacy pane index, so the subtitle spells out the path. The try-out checks where it lands.

- [ ] **Step 1: Write the failing tests** (macOS, fixture HOME, fake Firefox):
  - Tabs from Firefox, Chrome, Safari, Brave and Edge all appear, with the frontmost browser first. For example, with `BSA_TEST_FRONTMOST=com.brave.Browser`, Brave comes first.
  - An incognito window in the Chrome fake is absent.
  - Review Focus 2: Safari `{"denied": true}` gives exactly one "Allow Alfred to control Safari" item, and the other four browsers' tabs still show.
  - Unticking `browser_edge` drops Edge.
  - `act.js activate` logs `safari 7 2`, `brave 3 11` and `edge 4 12` for the matching args.
  - `open-automation` logs `open-automation`.
  - The existing Chrome tests move to `BSA_TEST_TABS_CHROME`.
  - The unit tests cover `automationItem` and the new `url` in `tabItem`'s arg.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run all tests.** Expected: they pass.
- [ ] **Step 5: Commit.** `git commit -m "tab: Safari, Brave and Edge; Allow items for refused Automation"`

### Task 5: Brave's and Edge's bookmarks and history

**Files:**
- Modify: `workflow/bmk.js`, `workflow/hist.js`, `workflow/act.js` (the `open` bundle IDs come from the registry), `test/macos/bookmarks.test.mjs`, `test/macos/history.test.mjs`

**Interfaces:**
- In `bmk.js` and `hist.js`, the Chrome-only functions take a Chromium registry entry and use its `dataDir`, `key` and `name`. The scripts loop over the ticked entries of `browsers.chromium()`.
- Each Chromium browser keeps its own entries, its own "Allow Alfred to read …" item, its own history problem item, and its own place in `orderBrowsers` or `mergeHistory`. The profile name shows when that browser has more than one profile.
- A data folder that doesn't exist means "missing": nothing is listed and no item is shown.
- `act.js open` accepts `brave` and `edge`.

- [ ] **Step 1: Write the failing tests.**
  - Fixture Brave and Edge data folders, copied from the Chrome fixtures with different titles, give Brave and Edge bookmarks with subtitles "Brave Browser · …" and "Microsoft Edge · …".
  - `hist` merges Brave's and Edge's history newest first, at most 50 per browser.
  - A chmod-000 Edge `Bookmarks` gives "Allow Alfred to read Microsoft Edge's bookmarks and history", and the rest still show.
  - Review Focus 5: no Brave folder means no Brave items and no Allow item.
  - `open` with `brave` logs `open com.brave.Browser <url>`.
- [ ] **Step 2: Run them.** Expected: they fail.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run all tests.** Expected: they pass.
- [ ] **Step 5: Commit.** `git commit -m "bmk and hist: Brave and Edge"`

### Task 6: The README in the Gallery style

**Files:**
- Modify: `README.md`, `workflow/info.plist` (`readme`), `test/macos/build.test.mjs`

**Interfaces:**
- The user part of `README.md` runs from the top to the line `<!-- developer -->`. The developer sections (Development, Build, Load the add-on temporarily, What Set up Firefox writes, Credits) follow that line.
- `info.plist`'s `readme` is exactly that user part. The build test checks the two are identical, so they can't drift.

- [ ] **Step 1: Write the user part, following the style guide in the Global Constraints.**
  - Put `## Setup` first:
    1. Firefox: load the add-on, then press Return on "Set up Firefox".
    2. Full Disk Access for Alfred, for Safari's (and maybe Chromium browsers') bookmarks and history.
    3. The Automation question each browser asks once.
  - `## Usage` follows. Its three tasks end with "via the `tab` keyword", "via the `bmk` keyword" and "via the `hist` keyword". Each has its `* <kbd>…</kbd> ACTION` list:
    - Return on tabs;
    - Return, ⌘↩ and ⌘C on bookmarks and history.
  - Then one line about the Workflow’s Configuration: browser checkboxes and keywords.
  - Leave out the images; see Ruling 7 below.
- [ ] **Step 2: Add a build test** that the user part equals `info.plist`'s `readme`, and that it starts with `## Setup` followed by `## Usage`. Watch it fail, then make it pass.
- [ ] **Step 3: Run all tests and commit.** `git commit -m "README in the Alfred Gallery style"`

### Task 7: The icon (Shariq picks)

**Files:**
- Create: `assets/icon-candidates/{a,b,c}.svg`, `scripts/render-icon.sh`, then the chosen `assets/icon.svg` and `workflow/icon.png`
- Modify: `test/macos/build.test.mjs`

- [ ] **Step 1: Draw three candidate icons.** Each is a plain SVG, 512×512 with transparent corners, showing searching across tabs, for example a magnifier over a strip of tabs. None may use a browser's logo, colours or trademark shapes.
- [ ] **Step 2: Write `scripts/render-icon.sh <svg> <png>`.** It renders an SVG to a 512×512 PNG with `qlmanage -t -s 512 -o <tmp>` and moves the result into place. `qlmanage` ships with macOS and is used only at development time. Render the three candidates into `assets/icon-candidates/`.
- [ ] **Step 3: Shariq picks a candidate.** The coordinator asks him in Agent Inbox, giving the three PNG paths, and the other tasks carry on meanwhile.
- [ ] **Step 4: Install his pick.** Copy it to `assets/icon.svg` and render it to `workflow/icon.png`. The build test checks that the workflow zip contains `icon.png` at 512×512 with an alpha channel, read with `sips`. Move the unchosen candidates to the Trash.
- [ ] **Step 5: Run all tests and commit.** `git commit -m "Workflow icon"`

### Task 8: Version 0.3.0, build and the real-Firefox gate

**Files:**
- Modify: `workflow/info.plist` (`version` 0.3.0), `test/macos/build.test.mjs`, `docs/build-log.md`

- [ ] **Step 1: Update the build test** to version 0.3.0. It lists every workflow file, including `lib/browsers.js`, `lib/ae-budget.js`, `lib/safari-tabs.js` and `icon.png`. The add-on is unchanged and stays 0.2.0.
- [ ] **Step 2: Run it and build.** `npm test && npm run test:macos && bash scripts/build.sh`. Expected: everything passes and the build succeeds.
- [ ] **Step 3: The coordinator runs the gate.** `npm run check:firefox` with `BSA_SKIP_APPLESCRIPT=1` must print `REAL FIREFOX: PASS`.
- [ ] **Step 4: Commit.** `git commit -m "Milestone 3: version 0.3.0"`

### Task 9: Try it in Shariq's own browsers (human check, the Air)

- [ ] **Step 1: The coordinator puts the files and steps in place.** It copies the build to the Air's Downloads and puts these steps on an inbox row:
  1. Import the workflow.
  2. Check that `tab` shows Safari tabs, and that Chrome incognito tabs no longer show.
  3. Open a Safari private window, and say whether its tabs appear.
  4. Check that Enter brings a Safari tab forward.
  5. Check that Configure Workflow shows five checkboxes.
  6. Check that the new icon shows in Alfred.
  7. Brave and Edge are optional: only if he chooses to install them.
- [ ] **Step 2: Record the result** in `docs/build-log.md`.

## Rulings in this plan, for Shariq to check

1. **Brave and Edge aren't installed on the MacBook Pro.** Their IDs and folders come from Brave's own source code and Homebrew's cask files. Their Apple Event calls follow epilande's workflow, which uses the same calls as for Chrome. The tests cover them with stand-ins. Trying them for real is up to you, and only if you choose to install them.
2. **Milestone 1 lists Chrome's incognito tabs.** Chrome's dictionary marks incognito windows, so Chrome, Brave and Edge now leave them out.
3. **Safari's dictionary has no "private window" marker.** The try-out checks whether private tabs show up. If they do, I'll ask you what to do rather than guess.
4. **Safari tabs have no ID.** A tab is found by its window and position, double-checked by its URL. If it moved, Enter finds it by URL. If it's gone, Enter does nothing.
5. **All Apple Event browsers share one 1.5-second budget,** so one frozen browser can't stack its delay onto the others.
6. **The "Allow Alfred to control …" item** opens Privacy & Security and spells out the path in its subtitle. macOS 27.3 has no confirmed direct link to the Automation list.
7. **Gallery screenshots wait for milestone 4.** They need tidy, non-personal data in each browser, and they belong with the release.
8. **The icon:** three candidates are drawn during the build, and you pick one.
9. **Versions:** the add-on doesn't change, so it stays at 0.2.0. The workflow becomes 0.3.0.
