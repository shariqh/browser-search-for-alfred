# Build log

Notes for the blog post and video. Newest entries at the bottom.

## 2026-11-21: why, and the first test

- Firefox Assistant's helper is Intel-only, so it doesn't run on the MacBook Air (no Rosetta) and will stop on the MacBook Pro once macOS drops Rosetta.
- Shariq asked for one keyword across Firefox, Chrome and Safari, with a choice of browsers, and aimed it at the Alfred Gallery.
- The Gallery shows a banner on workflows with compiled code and accepts scripts without signing, so we went scripts-only.
- The risky part was whether a JavaScript for Automation script could act as Firefox's native messaging helper. A throwaway test said yes: real Firefox on the Air started the script, and the add-on returned 121 tabs in 26 ms.

## 2026-11-22: name

- Named "Browser Search for Alfred".

## 2026-11-22: real Firefox starts the helper on the MacBook Pro

`npm run check:firefox` printed `REAL FIREFOX: PASS` (macOS 27.3, Firefox 160.0.1, web-ext 10.8.0). The script ran "Set up Firefox" against the real home folder, then used web-ext to start a separate Firefox with a fresh temporary profile (web-ext passes `-no-remote`, so Shariq's own Firefox was never touched), with our add-on loaded as a temporary add-on and `https://example.com/` as the start page. On the first poll that succeeded, `tab.js` returned an item whose subtitle contained `example.com`, and `pgrep` showed Firefox had started `firefox-helper.js` from the installed copy. After the run, web-ext's Firefox and the helper were both gone, and only our own registration file had been added to the NativeMessagingHosts folder. This is the first time a real Firefox, not a stand-in, ran the JXA helper in this project, so the gate is open for the Chrome work.
