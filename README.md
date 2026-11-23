# Browser Search for Alfred

Search open tabs, bookmarks and history in Firefox, Safari, Chrome, Brave and Edge from one Alfred keyword.

Work in progress. The design is in [docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md](docs/superpowers/specs/2026-11-21-browser-search-for-alfred-design.md), and the build log is in [docs/build-log.md](docs/build-log.md).

## Credits

- [epilande/alfred-browser-tabs](https://github.com/epilande/alfred-browser-tabs) (MIT) for the JXA approach to listing and switching tabs.
- [deanishe/alfred-firefox](https://github.com/deanishe/alfred-firefox) (MIT) for the Firefox add-on and native helper design.

## Development

- `npm test` runs the unit tests. They run anywhere with Node 24.
- `npm run test:macos` runs the tests that need macOS (JXA, `sqlite3`, `plutil`).
