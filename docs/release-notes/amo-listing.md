# AMO listing text for Browser Search for Alfred 1.0.0

Copy each field into the addons.mozilla.org Developer Hub when submitting. Choose "On this site" (listed).

## Name

Browser Search for Alfred

## Summary (at most 250 characters)

Companion add-on for the Browser Search for Alfred workflow on macOS: lets Alfred search your Firefox tabs, bookmarks and history, and bring a tab to the front. Needs the workflow; does nothing on its own. Nothing leaves your Mac.

## Description

Browser Search for Alfred is an Alfred workflow for macOS that searches open tabs, bookmarks and history across Firefox, Chrome, Safari, Brave and Edge from one keyword each (`tab`, `bmk`, `hist`).

This add-on is the Firefox half. Firefox doesn't let other apps read its tabs, so the add-on answers the workflow's requests through Firefox's native messaging:

- It lists open tabs (private windows are never included) and brings a chosen tab to the front.
- It lists bookmarks and searches history when you use the workflow's `bmk` and `hist` keywords.

It talks only to the workflow's own helper on your Mac (native host `io.github.shariqh.browser_search_for_alfred`), which the workflow installs when you choose "Set up Firefox". It makes no network requests and sends nothing off your Mac.

You need Alfred 5 with the Powerpack and the workflow from https://github.com/shariqh/browser-search-for-alfred/releases/latest. The source code, plain JavaScript with no build step, is at https://github.com/shariqh/browser-search-for-alfred.

## Categories

Tabs; Search Tools (choose the closest ones AMO offers).

## License

MIT License

## Homepage and support

- Homepage: https://github.com/shariqh/browser-search-for-alfred
- Support site: https://github.com/shariqh/browser-search-for-alfred/issues

## Notes to reviewer

- Purpose: companion to an Alfred (macOS launcher) workflow. The add-on answers four commands from its native host only: `list-tabs`, `activate-tab`, `list-bookmarks` and `search-history`. Anything else is refused (`addon/handler.js`).
- Native host: `io.github.shariqh.browser_search_for_alfred`. The host is a JavaScript for Automation script (`workflow/firefox-helper.js`) that the Alfred workflow copies into `~/Library/Application Support/io.github.shariqh.browser-search-for-alfred/` and registers when the user chooses "Set up Firefox". It relays requests between the Alfred workflow and this add-on through a private folder on the same Mac. It makes no network requests.
- Data declaration: `browsingActivity` and `bookmarksInfo`, because tab URLs, history and the bookmark tree are passed to the native host (on the same Mac) to answer the user's searches. Private-window tabs are filtered out before anything is sent.
- Source: plain, unminified JavaScript with no build step; the uploaded zip is the `addon/` folder as-is. Repository: https://github.com/shariqh/browser-search-for-alfred (1.0.0 is the head of pull request 5 at the time of submission).
- Testing it requires macOS, Alfred 5 with the Powerpack, and the workflow. Without the workflow the add-on just keeps trying to reach its native host every 10 seconds and does nothing else.
- `web-ext lint` reports one expected warning, KEY_FIREFOX_ANDROID_UNSUPPORTED_BY_MIN_VERSION. The add-on is desktop-only on purpose (native messaging isn't available on Android), so it has no `gecko_android` key.
