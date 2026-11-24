# Milestone 4: Release. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Browser Search for Alfred gets its first public release: the Firefox add-on on addons.mozilla.org (AMO), the workflow as a GitHub release, Gallery-style screenshots in the README, and a post on the Alfred Forum. It ships with the fixes from issue #2 that people would notice in the first week.

**Architecture:**
- Tasks 1 to 5 are code and docs, built on a branch with the usual reviews.
- Tasks 6 to 9 are release steps. Each is Shariq's to do or approve: the Mozilla account and submission, the screenshots, publishing the GitHub release, and the forum post.
- Nothing is published without his OK in Agent Inbox.

**Tech Stack:**
- The existing JXA workflow and its MV2 add-on.
- `web-ext` 10.8.0 (development only) for `lint`.
- A GitHub Actions macOS runner.
- `gh release`.

**Spec:** `docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md`, milestone 4: "Release: the add-on on addons.mozilla.org, the repository public, a GitHub release, and the forum post. Each of these is Shariq's to approve." The repository went public on 2026-11-23. Issue #2 lists the open leftovers.

## Global Constraints

- **Everything from milestones 1 to 3 still holds:**
  - scripts only, nothing at runtime outside macOS's own tools, no network, no launching a browser by searching;
  - tests never touch real browsers or real data, and the entry scripts run only under `BSA_TEST_CHANNEL` with a fixture HOME;
  - the fixed IDs and keywords.
- **Mozilla, read 2026-11-24 on extensionworkshop.com and blog.mozilla.org/addons:**
  - New extensions must declare `browser_specific_settings.gecko.data_collection_permissions`; Mozilla requires this since 2025-11-03, and without it the add-on isn't signed. Firefox's built-in consent for it needs Firefox 140 or later on desktop.
  - The policies "apply to any data sent to the native application as well".
  - MV2 is still supported, with "no plans to deprecate MV2".
  - Source code needs uploading only when it is minified or bundled, and ours isn't.
  - Both listed and unlisted add-ons are signed through AMO.
  - API keys are created at https://addons.mozilla.org/developers/addon/api/key/.
- **Alfred:**
  - The Post Notification object has type `alfred.workflow.output.notification`, with config keys `title`, `text`, `onlyshowifquerypopulated`, `lastpathcomponent` and `removeextension`. Source: Alfred 5's own bundled palette example, "Palette Getting Started 2 - 3-notification.json".
  - Gallery screenshots show the Alfred window only, without wallpaper and without other workflows' results, using realistic data. They are referenced as `![ALT](images/NAME.png)`.
- **GitHub:**
  - `macos-latest` is currently macOS 26 on arm64.
  - Standard hosted runners are "free and unlimited" for public repositories (docs.github.com, GitHub-hosted runners).
- **Versions:** the release is 1.0.0 for both the workflow and the add-on (Ruling 3).
- **Asks:** every step that publishes, creates an account or key, or uploads to Mozilla or GitHub is a blocked Agent Inbox row with options. It is done only after Shariq answers.

## Review Focus

1. **The add-on passes `web-ext lint` with no errors,** including the new `data_collection_permissions` key. Without that, AMO's validator rejects the upload. Pinned in Task 1.
2. **Pressing Return on "Set up Firefox" posts one notification saying it worked, or what went wrong.** No other action posts anything, so Alfred never shows an empty notification. Pinned in Task 2.
3. **Return on a tab in a minimised window brings that window back** in Chrome, Brave, Edge and Safari. Pinned in Task 2 with fakes.
4. **The macOS CI job runs both suites on GitHub,** and nothing in them needs a real browser or a person at the keyboard. This is pinned by the PR's own CI run in Task 3.
5. **The README's install links point at the real places:** the AMO listing and the latest GitHub release. The README and `info.plist`'s readme stay identical. Pinned in Task 4, and the links are rechecked in Task 7.

---

### Task 1: The add-on, ready for AMO

**Files:** `addon/manifest.json`, `package.json` (`"lint:addon": "web-ext lint --source-dir addon"`), `test/unit/addon.test.mjs` or `test/macos/build.test.mjs` (the manifest assertions)

- [ ] **Step 1: Write the failing tests.** The manifest has:
  - `version` "1.0.0";
  - `browser_specific_settings.gecko.data_collection_permissions` equal to `{"required": ["browsingActivity"]}` (Ruling 2);
  - `browser_specific_settings.gecko.strict_min_version` "140.0";
  - the same ID, permissions and MV2 background page as before.
- [ ] **Step 2: Implement it.** Then run `npm run lint:addon`. Expected: 0 errors. Paste any warnings into the report; each must be understood and either fixed or explained.
- [ ] **Step 3: Run all tests and commit.** `git commit -m "Add-on 1.0.0: data collection declaration for AMO"`

### Task 2: Fixes people would notice in the first week (from issue #2)

**Files:** `workflow/act.js`, `workflow/info.plist`, `workflow/lib/chromium.js`, `workflow/lib/safari-tabs.js`, and the matching unit and macOS tests

**Interfaces:**
- `act.js setup-firefox` prints exactly one line to stdout:
  - "Firefox is set up. If Firefox was open, reload the Browser Search add-on." on success;
  - "Couldn't set up Firefox: <short reason>" when anything throws, where the reason is the error message with no file paths.
  - It exits 0 either way.
- Every other action prints nothing.
- `info.plist` gains a Post Notification object connected from the Action Script:
  - `title` "Browser Search";
  - `text` "{query}";
  - `onlyshowifquerypopulated` true;
  - `lastpathcomponent` false and `removeextension` false.
  - It gets a new UID and a `uidata` position to the right of the Action Script.
- `act.js activate` for Firefox checks `jxa.isRunning(FIREFOX_BUNDLE_ID)` (under the channel, `BSA_TEST_FIREFOX_RUNNING`) before sending the request, and does nothing when Firefox isn't running.
- `chromium.activateTab` sets `win.minimized = false` when the window is minimised, before raising it. `safariTabs.activateTab` does the same with `win.miniaturized`.

- [ ] **Step 1: Write the failing tests.**
  - Setup prints the success line in a fixture HOME. It prints the "Couldn't" line when the helper copy can't be written: make the folder read-only, and restore it in `finally`.
  - `activate` for a non-running Firefox returns at once and posts no request.
  - A minimised fake window is un-minimised, in both libraries.
  - The build test checks the notification object and its connection.
- [ ] **Step 2: Implement it, then run all tests.**
- [ ] **Step 3: Commit.** `git commit -m "Setup notification, no wait for a closed Firefox, restore minimised windows"`

### Task 3: CI on macOS, read-only token

**Files:** `.github/workflows/test.yml`

- [ ] **Step 1: Add the jobs.** Add top-level `permissions: contents: read`. Keep the Ubuntu job (`npm test`), and add a `macos` job on `macos-latest` with Node 24 that runs `npm test` and `npm run test:macos`.
- [ ] **Step 2: Commit.** `git commit -m "CI: macOS job, read-only token"`. The proof is the PR's own CI run: both jobs must pass, and the controller reads the result.

### Task 4: README for the release

**Files:** `README.md`, `workflow/info.plist` (`readme`), `test/macos/build.test.mjs`

**Interfaces:**
- `README.md` starts with `# Browser Search for Alfred`, a one-line description, then the line `<!-- user -->`. The user part runs from `<!-- user -->` to `<!-- developer -->`, and the build test compares that span with `info.plist`'s readme.
- Setup step 1 links the add-on at `https://addons.mozilla.org/firefox/addon/browser-search-for-alfred/`. This is the slug AMO derives from the name; Task 7 rechecks it once the listing exists.
- Usage begins with where to download the workflow: `https://github.com/shariqh/browser-search-for-alfred/releases/latest`.
- The "Load the add-on temporarily" section moves to the developer part, as the way to test unreleased changes.

- [ ] **Step 1: Update the build test first** for the new span and the two links, and watch it fail.
- [ ] **Step 2: Edit the README and the readme together.**
- [ ] **Step 3: Run all tests and commit.** `git commit -m "README for 1.0.0: install links, title above the user part"`

### Task 5: Version 1.0.0, release notes, gate

**Files:** `workflow/info.plist` (`version` "1.0.0"), `docs/release-notes/1.0.0.md`, `docs/build-log.md`, `test/macos/build.test.mjs`

- [ ] **Step 1: Bump and build.** Set the build test to 1.0.0 for both the workflow and the add-on, then build with `bash scripts/build.sh`.
- [ ] **Step 2: Write `docs/release-notes/1.0.0.md`.** It covers what the workflow does, the five browsers and three keywords, how to install (the add-on from AMO and the workflow from the release), what the add-on can see, and known limits:
  - Safari's private tabs are listed;
  - Firefox data shows only while Firefox runs;
  - Brave and Edge haven't been tried on real browsers yet.
  
  Run the unslop pass on it.
- [ ] **Step 3: The controller runs the real-Firefox gate.**
- [ ] **Step 4: Commit.** `git commit -m "1.0.0"`

### Task 6: Submit the add-on to AMO (Shariq)

- [ ] **Step 1: The coordinator prepares the files.** It writes `docs/release-notes/amo-listing.md`, which holds:
  - the AMO summary (at most 250 characters) and description;
  - categories, license MIT, and the homepage and support links to the GitHub repo;
  - Notes to reviewer: the add-on talks only to its own native helper `io.github.shariqh.browser_search_for_alfred`, which is installed by the Alfred workflow's "Set up Firefox". The source is plain JavaScript with no build step, here: <repo link at the 1.0.0 commit>. Nothing leaves the Mac.
  
  It also puts the add-on zip on the Air.
- [ ] **Step 2: Shariq submits it (inbox row, task).**
  1. Create or sign in to a Mozilla account.
  2. At the AMO Developer Hub, submit the zip "On this site" (listed, Ruling 1).
  3. Paste the listing text.
  4. Tell the coordinator the listing URL.
  
  The coordinator never handles his password or API keys.
- [ ] **Step 3: Note the listing.** When it is approved and live, the coordinator records the URL. If the slug differs from `browser-search-for-alfred`, it fixes the README link through a small follow-up commit and review.

### Task 7: Screenshots (Shariq captures, the coordinator adds them)

- [ ] **Step 1: The coordinator puts the staging steps on an inbox row.**
  1. Open a few public pages about Alfred in each browser.
  2. Bookmark two.
  3. Type `tab alfred`, `bmk alfred` and `hist alfred`, so only those results show.
  4. Capture each Alfred window with ⌘⇧4 then Space.
  5. Save them as tab.png, bmk.png and hist.png in ~/Downloads/browser-search-screenshots.
- [ ] **Step 2: The coordinator adds them.** It copies them to `images/`, adds one `![…](images/…png)` line under each Usage task, as the style guide requires, and keeps README and readme equal. It also rechecks the AMO link.
  
  This goes through a small reviewed commit on the branch. Then the PR merges after Shariq approves it on its inbox row.

### Task 8: GitHub release 1.0.0 (Shariq approves)

- [ ] **Step 1: Ask before publishing.** After the merge, the coordinator asks on an inbox row before publishing.
- [ ] **Step 2: Publish.** On approval it runs `gh release create v1.0.0 dist/Browser-Search-for-Alfred.alfredworkflow --title "Browser Search for Alfred 1.0.0" --notes-file docs/release-notes/1.0.0.md` from main at the merge commit, then checks that the download works.

### Task 9: Forum post and switching over (Shariq)

- [ ] **Step 1: The coordinator drafts the post.** It writes the "Share your workflows" post, covering what the workflow does, links to the release and AMO, and the two Gallery questions from the earlier draft, and puts it on the existing forum row. Shariq posts it.
- [ ] **Step 2: Shariq switches the Air over.**
  1. Remove the temporary add-on.
  2. Install from AMO.
  3. Import the 1.0.0 workflow from the release.
  4. Check `tab`, `bmk` and `hist`.
- [ ] **Step 3: The coordinator records it.** It adds the result to the build log and closes the milestone.

## Rulings in this plan, for Shariq to check

1. **Listed on AMO.** The add-on gets a public AMO page, so installing it is one click from the README, and Firefox updates it. The other way is "unlisted": Mozilla signs a file that people download from the GitHub release and install by hand. Listed add-ons may get a human review, since ours uses native messaging.
2. **Declare "browsing activity".** Mozilla's docs don't say whether handing data to a helper on the same Mac counts as data collection. Their policies do say they cover data sent to a native app, so the honest declaration is "browsing activity". Firefox then shows that line when the add-on is installed. The other way is to declare "none" and explain in the listing that nothing leaves the Mac, which risks the reviewer disagreeing.
3. **Version 1.0.0 for both** the workflow and the add-on, marking the first public release.
4. **Firefox 140 or later is required,** because Firefox's built-in consent for the data declaration starts there (Mozilla's data-consent page). Your Firefox is 160.
5. **Only the fixes people would notice ship from issue #2:**
   - the "Set up Firefox" notification;
   - no wait for a closed Firefox;
   - minimised windows;
   - CI on macOS.
   
   The rest stays in #2, including the rare Chrome window-swap case.
6. **Screenshots use pages about Alfred,** with searches that show only those results, so none of your own tabs or history appear.
7. **You do the Mozilla parts yourself:** the account, the submission, any API keys. I prepare the files and text, and never handle your password or keys.
