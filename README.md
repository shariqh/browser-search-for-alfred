# Browser Search for Alfred

Search open tabs, bookmarks and history in Firefox, Chrome, Safari, Brave and Edge from Alfred.

<!-- user -->

## Setup

1. Firefox only: install the [Browser Search add-on](https://addons.mozilla.org/firefox/addon/browser-search-for-alfred/) in Firefox (Firefox 140 or later). Then press <kbd>↩</kbd> on "Set up Firefox", which the workflow shows the first time you search with Firefox ticked.
2. For bookmarks and history in Safari, Chrome, Brave and Edge: press <kbd>↩</kbd> on "Allow Alfred to read ... bookmarks and history". It opens Full Disk Access in System Settings. Turn on Alfred, then search again.
3. For tabs in Safari, Chrome, Brave and Edge: macOS asks once whether Alfred may control the browser. Choose OK. If you chose Don't Allow, press <kbd>↩</kbd> on "Allow Alfred to control ..." and turn on the browser under Alfred in Privacy & Security > Automation.

## Usage

Get the workflow from the [latest release](https://github.com/shariqh/browser-search-for-alfred/releases/latest), and open the downloaded file to import it into Alfred.

Search the tabs open in your running browsers, except private windows in Firefox, Chrome, Brave and Edge, via the `tab` keyword.

* <kbd>↩</kbd> Bring the tab to the front.

Firefox, Chrome, Brave and Edge never list private or incognito windows. Safari doesn't tell Alfred which windows are private, so tabs in its private windows are listed.

Search your bookmarks via the `bmk` keyword.

* <kbd>↩</kbd> Open in the browser it came from.
* <kbd>⌘</kbd><kbd>↩</kbd> Open in your default browser.
* <kbd>⌘</kbd><kbd>C</kbd> Copy the URL.

Search your history, newest first, with up to 50 results per browser, via the `hist` keyword.

* <kbd>↩</kbd> Open in the browser it came from.
* <kbd>⌘</kbd><kbd>↩</kbd> Open in your default browser.
* <kbd>⌘</kbd><kbd>C</kbd> Copy the URL.

Firefox bookmarks and history show only while Firefox is running. Searching never starts a browser, but opening a bookmark or history result may.

Change the keywords, and tick or untick Firefox, Google Chrome, Safari, Brave Browser and Microsoft Edge, in the Workflow’s Configuration.

<!-- developer -->

The text between the `<!-- user -->` and `<!-- developer -->` lines is the workflow's README in Alfred; keep it identical to the `readme` in `workflow/info.plist` (the build test checks). The design is in [docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md](docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md), and the build log is in [docs/build-log.md](docs/build-log.md).

Other facts: bookmarks and history list and open only `http`, `https` and `file` links; tabs are not filtered by link type. For Chrome, Brave, Edge and Safari history, matching ignores upper and lower case only for plain English letters. Bookmarks are cached for 5 minutes and refreshed in the background. Notices such as "Allow Alfred to read ..." or "Set up Firefox" are never cached.

## Development

- `npm test` runs the unit tests. They run anywhere with Node 24.
- `npm run test:macos` runs the tests that need macOS. They use `osascript` (JXA), `plutil` and `unzip`, and `zip` through `scripts/build.sh`, which macOS includes. No browser needs to be installed: the tests use a fake Firefox and a fixture folder as `HOME`, and never touch your real `~/Library` or any running browser.
- `npm run lint:addon` runs `web-ext lint` on the add-on and must report 0 errors. Its one warning, `KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION`, is expected: the add-on is desktop-only (it needs the macOS native helper), so do not "fix" it by adding `gecko_android`, which would offer the add-on on Android.
- `npm run check:firefox` is not part of the tests. It writes the real registration to `~/Library` (see below) and opens a separate Firefox window with a throwaway profile. Your own Firefox is left alone. It sets `BSA_SKIP_APPLESCRIPT=1`, which makes `tab` skip Safari, Chrome, Brave and Edge, so no Apple Event goes to a real browser.
- Under `BSA_TEST_CHANNEL`, every browser that is driven by Apple Events (Safari, Chrome, Brave, Edge) is replaced by a fake built from `BSA_TEST_TABS_<KEY>`. Never run the entry scripts without it and a fixture `HOME`.

## Build

`bash scripts/build.sh` writes two files to `dist/`:

- `Browser-Search-for-Alfred.alfredworkflow`, the workflow to import into Alfred.
- `browser-search-for-alfred-addon.zip`, the Firefox add-on.

## Test unreleased changes: load the add-on temporarily

The released add-on comes from Mozilla's add-on site. To try a change before it is released, build it and load it by hand:

1. Unzip `dist/browser-search-for-alfred-addon.zip` into a folder.
2. In Firefox, open `about:debugging`, then choose This Firefox.
3. Choose Load Temporary Add-on... and pick `manifest.json` from the unzipped folder.

The add-on stays loaded until Firefox restarts; load it again after a restart.

## What Set up Firefox writes, and how to undo it

The first time you use `tab`, `bmk` or `hist` with Firefox, the workflow shows "Set up Firefox". Pressing Return writes two files, and nothing else outside the workflow:

1. A copy of the helper script: `~/Library/Application Support/io.github.shariqh.browser-search-for-alfred/firefox-helper.js`
2. The file that tells Firefox where the helper is: `~/Library/Application Support/Mozilla/NativeMessagingHosts/io.github.shariqh.browser_search_for_alfred.json`

To undo it, move both files to the Trash (Finder: Go > Go to Folder, paste each folder, drag the file to the Trash). Firefox then no longer knows about the helper, and the workflow offers "Set up Firefox" again. While it runs, the helper also keeps short-lived request files in `~/Library/Caches/io.github.shariqh.browser-search-for-alfred/firefox`; that folder is safe to move to the Trash too.

## What the add-on can see

The Firefox add-on asks for four permissions, and uses each for one job:

- `nativeMessaging`: to talk to the workflow's helper on your Mac.
- `tabs`: to list your open tabs and bring one to the front.
- `bookmarks`: to list your bookmarks.
- `history`: to search your history when you type after `hist`.

It only answers when the workflow asks. Nothing leaves your Mac: the add-on and helper make no network requests. Tabs in private windows are never listed, and Firefox doesn't keep history for them.

## Credits

- [epilande/alfred-browser-tabs](https://github.com/epilande/alfred-browser-tabs) (MIT) for the JXA approach to listing and switching tabs.
- [deanishe/alfred-firefox](https://github.com/deanishe/alfred-firefox) (MIT) for the Firefox add-on and native helper design.
