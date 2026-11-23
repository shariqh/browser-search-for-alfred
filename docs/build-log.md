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

## 2026-11-23: first try-out on the MacBook Air

Shariq imported the workflow on the Air, ran "Set up Firefox", loaded the add-on as a temporary add-on, and searched his own Firefox and Chrome tabs from Alfred. His report: "works great", with nothing flagged as surprising. This was the first run in his real browsers and from inside Alfred. It was also the only check for three things the tests can't reach: the Chrome time limit against a real Chrome, the last-used browser's tabs coming first while Alfred is open, and bringing a Firefox tab forward from Alfred. His report covers them as a whole rather than step by step.

One snag on the way: the two files were first sent as chat attachments, which he couldn't find on the Air. Copying them straight into the Air's Downloads folder over ssh fixed it. The README's install steps will need to say where people get the files once there's a release.

## 2026-11-23: milestone 2, bookmarks and history

- Added `bmk` and `hist` for Firefox (through the add-on), Chrome (its files) and Safari (its files), a checkbox per browser and a keyword field per search, and Return / Command-Return actions. Version 0.2.0 for both the workflow and the add-on.
- Safari's and Chrome's data are protected by macOS: Safari's needs Full Disk Access for Alfred, and Chrome's may need it or the "access data from other apps" question. The workflow shows one "Allow Alfred to read ..." result when it is denied.
- The real-Firefox check passed with the new add-on and helper (`REAL FIREFOX: PASS`, Firefox 160.0.1). It covers tabs only, so real-Firefox bookmarks and history are first tried on the Air.
- Found on the way: Chrome's own data folder is now protected by macOS 27.3 too (`kTCCServiceSystemPolicyAppDataDetailed`), which the design didn't expect. Chrome's history is read with SQLite's `immutable=1` because Chrome keeps an exclusive lock on it, and Safari's with a normal read-only open so pages still in its write-ahead log show.
- The reviews caught real bugs before the try-out:
  - Safari history showed an old title when the search matched an older visit.
  - ⌘↩ on a `file:` link would have opened the file in its own app, which could run a `.command` script.
  - The bookmark cache kept notices such as "Set up Firefox" for 5 minutes.
  - A person's `~/.sqliterc` could silently empty history.
  - A slow or failing history read made that browser vanish without a word.
- Tests: 114 unit and 96 macOS.

## 2026-11-23: milestone 2 try-out on the MacBook Air

Shariq updated the workflow on the Air, swapped in the 0.2.0 add-on, ran "Set up Firefox" again, and went through `bmk`, `hist`, Return, ⌘Return and the browser checkboxes with his own Firefox, Chrome and Safari. His report: "all worked as expected." That covers the parts the tests can't reach: real-Firefox bookmarks and history, how macOS treats Alfred reading Chrome's and Safari's data, the Full Disk Access link, and a just-visited Safari page showing up in `hist`. He didn't say which permission path Chrome took (a macOS question, Full Disk Access, or nothing), so that stays unrecorded.

## 2026-11-23: milestone 3, more browsers

- Added Safari tabs, Brave and Edge (tabs, bookmarks and history), a checkbox for each of the five browsers, Allow items that explain a missing macOS permission, the Gallery-style README and the icon. Version 0.3.0 for the workflow; the add-on is unchanged at 0.2.0.
- Fixed on the way: incognito and private windows are now left out of Firefox, Chrome, Brave and Edge tabs.
- Safari doesn't tell Alfred which windows are private, so whether its private windows are listed stays unknown until the try-out.
- Brave and Edge are tested only against fixtures, not real browsers, until the try-out.
- The real-Firefox gate (`npm run check:firefox`) result is recorded by the controller.
