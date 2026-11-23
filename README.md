# Browser Search for Alfred

Search open tabs, bookmarks and history in Firefox, Safari, Chrome, Brave and Edge from one Alfred keyword.

Work in progress. The design is in [docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md](docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md), and the build log is in [docs/build-log.md](docs/build-log.md).

## Credits

- [epilande/alfred-browser-tabs](https://github.com/epilande/alfred-browser-tabs) (MIT) for the JXA approach to listing and switching tabs.
- [deanishe/alfred-firefox](https://github.com/deanishe/alfred-firefox) (MIT) for the Firefox add-on and native helper design.

## Development

- `npm test` runs the unit tests. They run anywhere with Node 24.
- `npm run test:macos` runs the tests that need macOS (JXA, `sqlite3`, `plutil`).

## Build

`bash scripts/build.sh` writes two files to `dist/`:

- `Browser-Search-for-Alfred.alfredworkflow`, the workflow to import into Alfred.
- `browser-search-for-alfred-addon.zip`, the Firefox add-on.

## Load the add-on temporarily

1. Unzip `dist/browser-search-for-alfred-addon.zip` into a folder.
2. In Firefox, open `about:debugging`, then choose This Firefox.
3. Choose Load Temporary Add-on... and pick `manifest.json` from the unzipped folder.

The add-on stays loaded until Firefox restarts; load it again after a restart.
