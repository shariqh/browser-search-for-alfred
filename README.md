# Browser Search for Alfred

Search open tabs, bookmarks and history in Firefox, Safari, Chrome, Brave and Edge from one Alfred keyword.

Work in progress. The design is in [docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md](docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md), and the build log is in [docs/build-log.md](docs/build-log.md).

## Usage

Three keywords, each searching the browsers ticked in Configure Workflow:

| Keyword | Searches | Browsers |
| --- | --- | --- |
| `tab` | Open tabs | Firefox, Google Chrome |
| `bmk` | Bookmarks | Firefox, Google Chrome, Safari |
| `hist` | History | Firefox, Google Chrome, Safari |

- Return on a tab brings it to the front. Return on a bookmark or history result opens it in the browser it came from. This may start that browser if it isn't running; searching never does.
- Command-Return opens a bookmark or history result in your default browser instead.
- Command-C copies the result's URL.
- Only `http`, `https` and `file` links are listed or opened. Bookmarks and history with other kinds of links (such as `javascript:` or `chrome://`) never appear.
- History shows up to 50 results per browser, newest first. For Chrome and Safari, matching ignores upper and lower case only for plain English letters; accented letters must match case exactly.
- Bookmarks are kept for 5 minutes and refreshed in the background, so a bookmark you just added may take a few minutes to show up. Notices such as "Allow Alfred to read ..." or "Set up Firefox" are never kept, so they go away as soon as the problem is fixed.
- Firefox bookmarks and history show only while Firefox is running, because they come through the add-on. Safari's and Chrome's are read from their files, so those browsers need not be running.

## Configuration

In Alfred, open the workflow and choose Configure Workflow (the `[x]` button):

- Three keyword fields, for tabs, bookmarks and history. The defaults are `tab`, `bmk` and `hist`.
- One checkbox per browser: Firefox, Google Chrome and Safari. Untick a browser to leave it out of every keyword. Safari has no tabs in `tab`; its checkbox applies to `bmk` and `hist`.

## Setup for bookmarks and history

Safari's bookmarks and history need Full Disk Access for Alfred. Chrome's may need it too, or macOS may ask whether Alfred can access data from other apps. When the workflow can't read a browser's data, it shows an "Allow Alfred to read ..." result for that browser. Press Return on it to open Full Disk Access in System Settings, switch on Alfred, then search again. Other browsers' results still show meanwhile.

## Credits

- [epilande/alfred-browser-tabs](https://github.com/epilande/alfred-browser-tabs) (MIT) for the JXA approach to listing and switching tabs.
- [deanishe/alfred-firefox](https://github.com/deanishe/alfred-firefox) (MIT) for the Firefox add-on and native helper design.

## Development

- `npm test` runs the unit tests. They run anywhere with Node 24.
- `npm run test:macos` runs the tests that need macOS. They use `osascript` (JXA), `plutil` and `unzip`, and `zip` through `scripts/build.sh`, which macOS includes. No browser needs to be installed: the tests use a fake Firefox and a fixture folder as `HOME`, and never touch your real `~/Library` or any running browser.
- `npm run check:firefox` is not part of the tests. It writes the real registration to `~/Library` (see below) and opens a separate Firefox window with a throwaway profile. Your own Firefox is left alone.

## Build

`bash scripts/build.sh` writes two files to `dist/`:

- `Browser-Search-for-Alfred.alfredworkflow`, the workflow to import into Alfred.
- `browser-search-for-alfred-addon.zip`, the Firefox add-on.

## Load the add-on temporarily

1. Unzip `dist/browser-search-for-alfred-addon.zip` into a folder.
2. In Firefox, open `about:debugging`, then choose This Firefox.
3. Choose Load Temporary Add-on... and pick `manifest.json` from the unzipped folder.

The add-on stays loaded until Firefox restarts; load it again after a restart.

## What Set up Firefox writes, and how to undo it

The first time you use `tab`, `bmk` or `hist` with Firefox, the workflow shows "Set up Firefox". Pressing Return writes two files, and nothing else outside the workflow:

1. A copy of the helper script: `~/Library/Application Support/io.github.shariqh.browser-search-for-alfred/firefox-helper.js`
2. The file that tells Firefox where the helper is: `~/Library/Application Support/Mozilla/NativeMessagingHosts/io.github.shariqh.browser_search_for_alfred.json`

To undo it, move both files to the Trash (Finder: Go > Go to Folder, paste each folder, drag the file to the Trash). Firefox then no longer knows about the helper, and the workflow offers "Set up Firefox" again. While it runs, the helper also keeps short-lived request files in `~/Library/Caches/io.github.shariqh.browser-search-for-alfred/firefox`; that folder is safe to move to the Trash too.

## If Chrome tabs don't show

The first time `tab` lists Chrome tabs, macOS asks whether Alfred may control Google Chrome. If you chose Don't Allow, or never saw the question, open System Settings > Privacy & Security > Automation, find Alfred, and switch on Google Chrome. Chrome tabs only show while Chrome is running; the workflow never starts it.

## What the add-on can see

The Firefox add-on asks for four permissions, and uses each for one job:

- `nativeMessaging`: to talk to the workflow's helper on your Mac.
- `tabs`: to list your open tabs and bring one to the front.
- `bookmarks`: to list your bookmarks.
- `history`: to search your history when you type after `hist`.

It only answers when the workflow asks. Nothing leaves your Mac: the add-on and helper make no network requests. Tabs in private windows are never listed, and Firefox doesn't keep history for them.
