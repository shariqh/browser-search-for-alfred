# Browser Search for Alfred

Search open tabs, bookmarks and history in Firefox, Safari, Chrome, Brave and Edge from one Alfred keyword.

Work in progress. The design is in [docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md](docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md), and the build log is in [docs/build-log.md](docs/build-log.md).

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

The first time you use `tab` with Firefox, the workflow shows "Set up Firefox". Pressing Return writes two files, and nothing else outside the workflow:

1. A copy of the helper script: `~/Library/Application Support/io.github.shariqh.browser-search-for-alfred/firefox-helper.js`
2. The file that tells Firefox where the helper is: `~/Library/Application Support/Mozilla/NativeMessagingHosts/io.github.shariqh.browser_search_for_alfred.json`

To undo it, move both files to the Trash (Finder: Go > Go to Folder, paste each folder, drag the file to the Trash). Firefox then no longer knows about the helper, and `tab` offers "Set up Firefox" again. While it runs, the helper also keeps short-lived request files in `~/Library/Caches/io.github.shariqh.browser-search-for-alfred/firefox`; that folder is safe to move to the Trash too.

## If Chrome tabs don't show

The first time `tab` lists Chrome tabs, macOS asks whether Alfred may control Google Chrome. If you chose Don't Allow, or never saw the question, open System Settings > Privacy & Security > Automation, find Alfred, and switch on Google Chrome. Chrome tabs only show while Chrome is running; the workflow never starts it.
