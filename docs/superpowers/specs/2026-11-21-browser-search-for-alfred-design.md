# Browser Search for Alfred: design

Status: draft for Shariq's review, 2026-11-21. Name picked 2026-11-22.

## Why this exists

Shariq uses Firefox Assistant (deanishe/alfred-firefox) on the MacBook Pro to search Firefox tabs, bookmarks and history from Alfred. Its helper is an Intel-only Go program: it runs on the MacBook Pro through Rosetta, does not run on the Air (no Rosetta), and stops working everywhere once macOS drops Rosetta. The project was last updated in 2023, and its Firefox add-on in 2021.

Instead of only replacing it, he wants one workflow where a single keyword searches every browser he chooses (Firefox, Chrome, Safari), and he wants it public: on GitHub, shared on the Alfred Forum, and eventually in the Alfred Gallery.

## Goals

1. One keyword each for open tabs, bookmarks and history, searching every browser ticked in the workflow's configuration and showing the results in one list.
2. Each result shows which browser it came from, and acting on it uses that browser: a tab is brought to the front, and a bookmark or history entry opens in that browser.
3. People pick the browsers to include with checkboxes in Alfred's Configure Workflow window.
4. It works on Apple Silicon without Rosetta, and on Intel Macs.
5. It is accepted into the Alfred Gallery: it follows the submission rules and style guide (https://alfred.app/submit/, https://alfred.app/submit/styleguide/).
6. It replaces Firefox Assistant on both of Shariq's Macs.

## Non-goals for v1

- Firefox Assistant's Firefox-only extras: downloads (`dl`), bookmarklets (`bml`), running JavaScript in pages, closing tabs to the left or right, and private windows. They can come later.
- Browsers other than Firefox, Safari, Chrome, Brave and Edge. Arc, Vivaldi and Orion can be added later; Arc needs its own AppleScript, as epilande's workflow shows.
- Syncing anything between Macs. Alfred's own preferences sync (iCloud) carries the workflow; each Mac's browser data stays on that Mac.

## Anti-goals (a failure even if it works)

- Compiled code in the workflow. Gallery workflows with compiled binaries get a banner saying their content can't be checked, and every release would need signing and notarising.
- Downloading or installing anything at runtime, auto-updating, or getting around Gatekeeper or quarantine. The Gallery forbids all of these.
- Sending browser data anywhere. Everything stays on the Mac; the workflow makes no network requests.
- Opening data that macOS protects to other programs on the same Mac without the person granting it. See "Privacy and the Firefox helper" below.
- Launching a browser that isn't running just because someone searched.

## Constraints

### Alfred Gallery (read 2026-11-21)

- Scripts are exempt from signing; compiled binaries must be signed and notarised. "The Alfred community expects to be able to audit a workflow's contents." (https://alfred.app/submit/)
- A workflow may rely on external software, but must never download or install it itself, and must not auto-update.
- Keywords should be user-configurable and at least three characters long.
- The main icon must be at least 256×256 pixels.
- The README follows the style guide: it starts with `## Usage`, and manual steps go under `## Setup`.
- Entry is by invitation: share the workflow on the Alfred Forum's "Share your workflows" board, and once it is "stable and trusted by a number of users", the Alfred team may invite a submission.
- The rules don't say whether a workflow may write a file outside its own folder (the Firefox registration file below), or ask for Full Disk Access. That gets asked on the forum during milestone 1 (Shariq posts; the builder drafts). Building doesn't wait for the answer (my call). If writing the registration file is not allowed, the "Set up Firefox" item becomes a manual step in the README's `## Setup`, which the style guide allows. If Full Disk Access isn't allowed, Safari bookmarks and history drop out of the Gallery version.

### Firefox

- Firefox doesn't show its tabs to other apps. An add-on has to read them and pass them to a helper program through native messaging (https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging).
- Firefox finds the helper through a registration file at `~/Library/Application Support/Mozilla/NativeMessagingHosts/<name>.json`, which names the helper's absolute path and the add-on IDs allowed to use it. When Firefox starts the helper, it passes two arguments: the registration file's path and the add-on's ID.
- Messages are a 4-byte little-endian length followed by UTF-8 JSON. A message from the helper to the add-on can be at most 1 MB; one from the add-on to the helper at most 4 GB.
- Release Firefox only installs add-ons signed by Mozilla, through addons.mozilla.org, whether listed there or self-distributed ("unlisted") (https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).
- On the MacBook Pro (macOS 27.3), a terminal can't read Firefox's profile folder ("Operation not permitted"). So Firefox bookmarks and history come through the add-on too, not from Firefox's database files.

### Safari and Chromium browsers

- Safari, Chrome, Brave and Edge can list their windows and tabs and switch tabs through AppleScript. epilande/alfred-browser-tabs (MIT) does this with JavaScript for Automation scripts and is a working reference.
- Safari's bookmarks and history are in a protected folder (`~/Library/Safari`). Reading them needs Full Disk Access for Alfred, which each person turns on themselves.
- Chrome's bookmarks file was readable from a terminal on the MacBook Pro. Chrome keeps its history database locked while it runs, so it has to be read from a copy or opened read-only without locking.
- The first time the workflow lists a browser's tabs, macOS asks once whether Alfred may control that browser. That prompt is the person's to answer.

### Runtime

- Shipped code uses only what macOS includes: JavaScript for Automation (`osascript -l JavaScript`), `/usr/bin/sqlite3`, `/usr/bin/plutil` and the shell. No Python (macOS no longer ships it), Node or Homebrew at runtime. Node is fine for development and tests.
- Shipped files stay readable: no minification or bundling into one opaque file.
- Alfred 5 or later, with the Powerpack (workflows need it). Alfred 4 is not supported (my call). Alfred provides `alfred_workflow_data` and `alfred_workflow_cache` (not created automatically), `alfred_preferences`, and the Script Filter JSON features used below: `cache`, `rerun`, `skipknowledge`, and per-item `match`, `uid`, `mods` and `variables` (https://www.alfredapp.com/help/workflows/inputs/script-filter/json/, https://www.alfredapp.com/help/workflows/script-environment-variables/).

## Approaches considered

1. **Scripts only (chosen, 2026-11-21).** Every part is a script macOS runs itself. Chromium and Safari go through AppleScript and their own files; Firefox goes through our own small add-on plus a helper script. No signing is needed, and the Gallery shows no banner. The cost is writing and maintaining the add-on, which Mozilla reviews.
2. **Fork Firefox Assistant (Go) and add Chrome and Safari.** It reuses the most working code and keeps every Firefox feature. But it is a compiled program: it needs signing and notarising on every release (Shariq has a developer account, so no new cost), and its Gallery page would carry the compiled-code banner.
3. **Contribute to epilande's Browser Tabs.** The least for us to maintain, but its maintainer decides the scope, and the result wouldn't be Shariq's own workflow.

Shariq picked 1. His Apple developer account remains a fallback: if a script can't do one job, a small signed helper fills only that gap.

### What the throwaway test proved (2026-11-21)

A JavaScript for Automation script works as Firefox's helper:

- With a stand-in for Firefox on the MacBook Pro, a request there and back took 3 to 7 ms, and about 60 ms including starting the calling script. 2,000 tabs (583 KB, with non-English text) arrived intact in 22 ms. Idle, the helper used 0% CPU and about 26 MB, and it exited when its input closed.
- On the Air (macOS 27.2.1, no Rosetta), real Firefox started the helper itself, and Firefox Assistant's add-on answered through it: 121 tabs in 26 ms, 93 bookmarks in 21 ms, a bookmark search in 15 ms, a history search in 19 ms.
- Requests reached the helper from a separate process through distributed notifications, even from an ssh session.
- Two bugs to avoid: the helper spun forever at end of input until the check was written as `data.isNil() || Number(data.length) === 0`, and turning a parameter of `0` into an empty value broke one command.
- Not tested live: switching to a tab, which uses the same channel.
- Not tested with real Firefox on the MacBook Pro. Native messaging doesn't read Firefox's profile folder, and Firefox on the MacBook Pro already starts Firefox Assistant's helper the same way, so I expect it to work there. Milestone 1 tests it on both Macs first. If it fails on either one, building stops and Shariq decides whether a small signed helper fills the gap (my call).

The test files were throwaway and are gone.

## Design

### Pieces

1. **The Alfred workflow:** script filters for the three keywords, the actions, the configuration and the setup items.
2. **Browser backends:** one module per browser family, each answering "list tabs", "search bookmarks", "search history", "show this tab" and "open this URL".
   - Chromium family (Chrome, Brave, Edge): AppleScript for tabs; the `Bookmarks` JSON file and the `History` database in each browser's profile folders.
   - Safari: AppleScript for tabs; `Bookmarks.plist` (through `plutil`) and `History.db` (through `sqlite3`), both needing Full Disk Access.
   - Firefox: requests to the helper, which passes them to the add-on.
3. **The Firefox helper:** a JavaScript for Automation script in the workflow folder that Firefox starts and keeps running while the add-on is connected. It relays requests from the workflow to the add-on and answers back.
4. **The Firefox add-on:** our own small WebExtension with only the permissions it needs: `tabs`, `bookmarks`, `history` and `nativeMessaging`. It answers list, search and activate requests, and nothing else (no running code in pages).

### Keywords and results

- Defaults: `tab` for open tabs, `bmk` for bookmarks, `hist` for history. All three can be changed in the configuration.
- One list per keyword, merging every enabled browser. Each item's subtitle names the browser and shows the URL, and its icon is that browser's own app icon, taken from the installed app (`icon.type: fileicon`), so no browser logos ship with the workflow.
- Enter on a tab brings that browser and tab to the front. Enter on a bookmark or history item opens it in the browser it came from. One modifier opens it in the default browser instead, and ⌘C copies the URL. The builder picks the modifier keys, following Alfred conventions.
- Tabs from a browser that isn't running are simply absent. No backend ever launches a browser.
- Bookmarks and history items get a stable `uid` (the URL), so Alfred learns what Shariq picks. Tab results use `skipknowledge`, because tab IDs change.
- "Brings the tab to the front" means: that tab becomes the active tab in its window, that window comes to the front, and the browser is activated. Raising a window that is in another Space or in full screen is best effort; macOS normally switches to it when the browser is activated (my call).
- Chromium profiles: every profile is read for bookmarks and history, and when a browser has more than one profile, the subtitle names the profile. Tabs come from every open window, whatever its profile. This adds no setting (my call).
- Matching and order (my call):
  - Tabs and bookmarks: each backend returns all its items, and Alfred does the matching through each item's `match` field (title and URL).
  - History is too large for that. Each backend searches by the typed query itself (SQL for Chromium and Safari, the add-on's history search for Firefox) and returns at most 50 items. The merged list is ordered by last visit, newest first.
  - Tabs are listed browser by browser, in each browser's window and tab order, with the frontmost browser first.

### Configuration

- Checkboxes for Firefox, Safari, Chrome, Brave and Edge, each defaulting to on only if that browser is installed. The builder chooses how to detect that, within Alfred's configuration options.
- The three keywords.
- No other settings in v1.

### Setup and permissions

- **Firefox:** the person installs our add-on from addons.mozilla.org, then chooses a "Set up Firefox" item in the workflow. That writes the registration file pointing at the helper inside the workflow folder. It is an explicit action, never silent, and the README's `## Setup` says what it writes and where. When Firefox is ticked but not set up, the `tab` results start with an item that says so and leads to the setup.
- **Safari bookmarks and history:** when Safari is ticked but Alfred lacks Full Disk Access, the results show one item explaining that and opening the right System Settings pane. Safari tabs work without it.
- **Automation prompts:** macOS asks once per browser. The README says to expect it.
- **Moving or reinstalling the workflow:** the registration file holds an absolute path into the workflow folder, which changes if Alfred's preferences move. Each request checks that the file still points at this workflow's helper, and offers the setup again if not.

### The Firefox helper protocol

- Between the add-on and the helper: native messaging framing. Each request is `{id, command, params}`, and each reply is `{id, payload}` or `{id, error}`, the same shape Firefox Assistant's add-on uses, so the test still applies.
- Between the workflow and the helper: the workflow writes a request file into a private folder (mode 700) under `alfred_workflow_cache` and posts a distributed notification carrying only the request ID. The helper reads the request from that folder, forwards it, writes the reply file there, and posts a notification that it's ready. Notifications never carry queries or browser data.
- The helper only reads and writes inside its own private folder. It never uses a path given in a request.
- If the helper isn't running (Firefox closed, or the add-on disconnected), the workflow gives up on Firefox after a short timeout and shows the other browsers' results. The builder sets the timeout. Firefox answered in about 20 ms in the test, so a few hundred milliseconds is generous.
- Replies stay under the 1 MB limit: tab lists are trimmed to the fields shown, and search results are capped.

### Privacy and the Firefox helper

macOS stops other programs from reading Firefox's profile folder. The helper hands Firefox's tabs, bookmarks and history to whoever asks through it, so it must not become a way around that protection. The private-folder design limits it to programs that can already read the person's Alfred cache folder. Sandboxed apps can't, and unsandboxed programs running as the same user could read most of the person's files anyway. The README says plainly what the add-on and helper can see, and that nothing leaves the Mac.

### Speed

- The whole list should appear in about 300 ms or less with all browsers ticked. Backends run concurrently, or in parallel processes where JavaScript for Automation can't, with a time budget each, so one slow browser doesn't hold up the others.
- Bookmark results can use Alfred's `cache` with `loosereload`, since bookmarks rarely change. Open tabs are never cached.

### Code layout and tests

- Logic that doesn't touch macOS (parsing bookmark files and history rows, merging and ranking, building Alfred JSON) is plain JavaScript that runs under both Node and JavaScript for Automation, and is tested with Node's `node:test` against fixture files (a sample Chrome `Bookmarks` file, sample Safari plists, sample add-on replies).
- The helper's framing and request handling get a test like the throwaway one: a stand-in for Firefox written in Node drives the real helper script on macOS.
- The builder decides how shared code reaches each script: JavaScript for Automation has no `require`, so the options are a build step that writes readable combined files, or loading a shared file at runtime.
- The add-on has its own tests for its request handler.
- CI runs on GitHub-hosted runners. It doesn't use the self-hosted runners on the MacBook Pro, which compete with Shariq's sessions for memory.
- A manual test list covers what CI can't: each browser on both Macs, the Full Disk Access and Automation prompts, Firefox closed or open, and a fresh install from the release file.

### Packaging and release

- The repository holds the workflow source, the add-on source and a build script that produces the `.alfredworkflow` file and the add-on package. Releases go on GitHub.
- MIT licence, matching both projects it learns from, with credit to epilande/alfred-browser-tabs (tab scripts) and deanishe/alfred-firefox (the add-on and helper design) in the README.
- A build log in `docs/build-log.md` for the blog post and video, as with MacMosh.

## Milestones

1. Firefox and Chrome tabs under one `tab` keyword, using our own add-on loaded temporarily in Firefox (about:debugging) on both Macs.
2. Bookmarks and history for Firefox, Chrome and Safari, and the browser checkboxes.
3. Safari tabs, Brave and Edge, the setup and permission items, the README in the Gallery style, and the icon.
4. Release: the add-on on addons.mozilla.org, the repository public, a GitHub release, and the forum post. Each of these is Shariq's to approve.
5. Replace Firefox Assistant on both Macs, then wait for a Gallery invitation.

## Decided with Shariq

- One keyword per kind of search across all browsers, with checkboxes to choose the browsers (2026-11-21).
- Public, aiming for the Alfred Gallery (2026-11-21).
- Scripts only (2026-11-21).
- The name: Browser Search for Alfred (2026-11-22).

## My calls, for Shariq to check

- v1 browsers: Firefox, Safari, Chrome, Brave and Edge. Arc, Vivaldi and Orion come later.
- Default keywords `tab`, `bmk` and `hist`, since the Gallery wants at least three characters.
- Firefox-only extras (`dl`, `bml`, running JavaScript in pages) are left out of v1.
- Our own add-on from the start, rather than shipping with Firefox Assistant's.
- Firefox setup is an explicit action, not done silently on first run.
- MIT licence, with credit to both source projects.
- Building doesn't wait for the forum's answer on the registration file and Full Disk Access; each has a fallback.
- Every Chromium profile is searched, with no profile setting.
- Alfred matches tabs and bookmarks itself; history is searched per browser, capped at 50 per browser, and merged newest first.
- If real Firefox can't start the script helper on either Mac, building stops and Shariq decides about a signed helper.
- Alfred 5 or later only.

## Left to the builder

- File layout, module boundaries, and how shared code reaches each script.
- The helper's private folder and file naming, the request timeout, and the cap on results.
- How Chrome's locked history database is read.
- The modifier keys for the alternative actions.
- How installed browsers are detected for the checkbox defaults.
- The exact native messaging name and add-on ID, under a namespace Shariq controls, for example `io.github.shariqh.browser_search_for_alfred`. Both are fixed in milestone 1 and never change after the add-on is on addons.mozilla.org: changing either would break every existing install.
