# Build log

Notes for the blog post and video. Newest entries at the bottom.

## 2026-11-21: why, and the first test

- Firefox Assistant's helper is Intel-only, so it doesn't run on the MacBook Air (no Rosetta) and will stop on the MacBook Pro once macOS drops Rosetta.
- Shariq asked for one keyword across Firefox, Chrome and Safari, with a choice of browsers, and aimed it at the Alfred Gallery.
- The Gallery shows a banner on workflows with compiled code and accepts scripts without signing, so we went scripts-only.
- The risky part was whether a JavaScript for Automation script could act as Firefox's native messaging helper. A throwaway test said yes: real Firefox on the Air started the script, and the add-on returned 121 tabs in 26 ms.

## 2026-11-22: name

- Named "Browser Search for Alfred".
