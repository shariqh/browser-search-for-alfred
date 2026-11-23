import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  tabItem,
  setupItem,
  firefoxSilentItem,
  scriptFilterOutput,
  orderBrowsers,
  isOpenableUrl,
  urlItem,
  urlItems,
  needsAccessItem,
  mergeHistory,
  bookmarksOutput,
  historyOutput,
} = require("../../workflow/lib/items.js");

const firefoxTab = {
  browser: "firefox",
  browserName: "Firefox",
  windowId: 7,
  tabId: 42,
  title: "Example Domain",
  url: "https://example.com/a-b?q=1",
};

test("tabItem builds the exact item for a normal Firefox tab", () => {
  assert.deepEqual(tabItem(firefoxTab, "/Applications/Firefox.app"), {
    title: "Example Domain",
    subtitle: "Firefox · https://example.com/a-b?q=1",
    arg: JSON.stringify({ action: "activate", browser: "firefox", windowId: 7, tabId: 42 }),
    match: "Example Domain example com a b q 1",
    icon: { type: "fileicon", path: "/Applications/Firefox.app" },
    text: { copy: "https://example.com/a-b?q=1", largetype: "Example Domain" },
  });
});

test("tabItem has no icon without an app path and never a uid", () => {
  const item = tabItem(firefoxTab, null);
  assert.equal("icon" in item, false);
  assert.equal("uid" in item, false);
});

test("an empty title falls back to the URL without its scheme", () => {
  const item = tabItem({ ...firefoxTab, title: "", url: "https://example.com/path" }, null);
  assert.equal(item.title, "example.com/path");
  assert.equal(item.text.largetype, "example.com/path");
  assert.equal(item.subtitle, "Firefox · https://example.com/path");
  assert.equal(item.match, "example.com/path example com path");
});

test("quotes, newlines, emoji and right-to-left text survive JSON and the arg", () => {
  const title = 'Q "x" \n 😀 עברית';
  const item = tabItem({ ...firefoxTab, title, url: 'https://example.com/"q"\n😀' }, "/Applications/Firefox.app");
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.equal(item.title, title);
  assert.deepEqual(JSON.parse(item.arg), { action: "activate", browser: "firefox", windowId: 7, tabId: 42 });
});

test("setupItem names the problem in plain words", () => {
  for (const problem of ["missing", "elsewhere", "stale"]) {
    const item = setupItem(problem);
    assert.equal(item.title, "Set up Firefox");
    assert.equal(item.arg, '{"action":"setup-firefox"}');
    assert.ok(item.subtitle.length > 10);
  }
  assert.notEqual(setupItem("missing").subtitle, setupItem("stale").subtitle);
  assert.notEqual(setupItem("elsewhere").subtitle, setupItem("stale").subtitle);
});

test("firefoxSilentItem is not actionable", () => {
  assert.deepEqual(firefoxSilentItem(), {
    title: "Firefox didn't answer",
    subtitle: "Install or turn on the Browser Search add-on in Firefox",
    valid: false,
  });
});

test("scriptFilterOutput turns off Alfred's knowledge ranking", () => {
  const items = [{ title: "x" }];
  assert.deepEqual(scriptFilterOutput(items), { skipknowledge: true, items });
});

const FIREFOX = "org.mozilla.firefox";
const CHROME = "com.google.Chrome";
const browsers = () => [
  { bundleId: FIREFOX, items: ["f"] },
  { bundleId: CHROME, items: ["c"] },
];

test("orderBrowsers puts Chrome first when Chrome is frontmost", () => {
  assert.deepEqual(orderBrowsers(CHROME, browsers()).map((b) => b.bundleId), [CHROME, FIREFOX]);
});

test("orderBrowsers keeps Firefox first when Firefox is frontmost", () => {
  assert.deepEqual(orderBrowsers(FIREFOX, browsers()).map((b) => b.bundleId), [FIREFOX, CHROME]);
});

test("orderBrowsers keeps [firefox, chrome] when Alfred, nothing or something else is frontmost", () => {
  for (const front of ["com.runningwithcrayons.Alfred", "", null, undefined, "com.apple.Safari"]) {
    assert.deepEqual(orderBrowsers(front, browsers()).map((b) => b.bundleId), [FIREFOX, CHROME]);
  }
});

test("orderBrowsers does not change the array it is given", () => {
  const input = browsers();
  orderBrowsers(CHROME, input);
  assert.deepEqual(input.map((b) => b.bundleId), [FIREFOX, CHROME]);
});

const SAFARI = "com.apple.Safari";

test("orderBrowsers works with three browsers in the default order [firefox, chrome, safari]", () => {
  const three = () => [
    { bundleId: FIREFOX, items: ["f"] },
    { bundleId: CHROME, items: ["c"] },
    { bundleId: SAFARI, items: ["s"] },
  ];
  assert.deepEqual(orderBrowsers(SAFARI, three()).map((b) => b.bundleId), [SAFARI, FIREFOX, CHROME]);
  assert.deepEqual(orderBrowsers(CHROME, three()).map((b) => b.bundleId), [CHROME, FIREFOX, SAFARI]);
  assert.deepEqual(orderBrowsers("com.runningwithcrayons.Alfred", three()).map((b) => b.bundleId), [FIREFOX, CHROME, SAFARI]);
});

test("isOpenableUrl allows only http, https and file, in any case", () => {
  for (const url of ["http://a.test", "https://a.test", "HTTPS://X.TEST", "file:///tmp/a", "FILE:///tmp/a"]) {
    assert.equal(isOpenableUrl(url), true, url);
  }
  for (const url of ["javascript:alert(1)", "place:sort=8", "chrome://settings", "data:text/html,x", "about:blank", "", " https://a.test", "ftp://a.test"]) {
    assert.equal(isOpenableUrl(url), false, url);
  }
  for (const url of [null, undefined, 42, {}]) assert.equal(isOpenableUrl(url), false);
});

const chromeEntry = {
  browser: "chrome",
  browserName: "Google Chrome",
  profile: "Work",
  title: "Example Domain",
  url: "https://example.com/a-b?q=1",
  lastVisitMs: 1000,
};

test("urlItem builds the exact item for a Chrome entry with a profile", () => {
  assert.deepEqual(urlItem(chromeEntry, "/Applications/Google Chrome.app"), {
    uid: "https://example.com/a-b?q=1",
    title: "Example Domain",
    subtitle: "Google Chrome (Work) · https://example.com/a-b?q=1",
    arg: JSON.stringify({ action: "open", browser: "chrome", url: "https://example.com/a-b?q=1" }),
    match: "Example Domain example com a b q 1",
    icon: { type: "fileicon", path: "/Applications/Google Chrome.app" },
    text: { copy: "https://example.com/a-b?q=1", largetype: "Example Domain" },
    mods: {
      cmd: {
        arg: JSON.stringify({ action: "open-default", url: "https://example.com/a-b?q=1" }),
        subtitle: "Open in your default browser",
      },
    },
  });
});

test("urlItem leaves the profile out of the subtitle when there is none", () => {
  for (const profile of [null, ""]) {
    const item = urlItem({ ...chromeEntry, profile }, null);
    assert.equal(item.subtitle, "Google Chrome · https://example.com/a-b?q=1");
  }
  assert.equal("icon" in urlItem(chromeEntry, null), false);
});

test("urlItem falls back to the URL without its scheme for an empty title", () => {
  const item = urlItem({ ...chromeEntry, title: "", url: "https://example.com/path" }, null);
  assert.equal(item.title, "example.com/path");
  assert.equal(item.text.largetype, "example.com/path");
  assert.equal(item.match, "example.com/path example com path");
  assert.equal(item.uid, "https://example.com/path");
});

test("urlItem survives JSON with quotes, newlines, emoji and right-to-left text", () => {
  const item = urlItem({ ...chromeEntry, title: 'Q "x" \n 😀 עברית', url: 'https://example.com/"q"\n😀' }, "/A.app");
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.deepEqual(JSON.parse(item.arg), { action: "open", browser: "chrome", url: 'https://example.com/"q"\n😀' });
});

test("urlItems keeps only openable URLs and keeps their order", () => {
  const entries = [
    { ...chromeEntry, url: "https://a.test/" },
    { ...chromeEntry, url: "javascript:alert(1)" },
    { ...chromeEntry, url: "place:sort=8" },
    { ...chromeEntry, url: "chrome://settings" },
    { ...chromeEntry, url: "data:text/html,x" },
    { ...chromeEntry, url: "file:///tmp/a" },
  ];
  assert.deepEqual(urlItems(entries, null).map((i) => i.uid), ["https://a.test/", "file:///tmp/a"]);
});

test("needsAccessItem points at Full Disk Access and has no uid", () => {
  assert.deepEqual(needsAccessItem("Safari"), {
    title: "Allow Alfred to read Safari's bookmarks and history",
    subtitle: "Press Return to open Full Disk Access in System Settings, then turn on Alfred",
    arg: '{"action":"open-privacy"}',
  });
});

test("mergeHistory cuts each list to the limit and merges newest first", () => {
  const first = Array.from({ length: 60 }, (_, i) => ({ url: `f${i}`, lastVisitMs: 10000 - i * 100 }));
  const second = [
    { url: "s0", lastVisitMs: 9950 },
    { url: "s1", lastVisitMs: 9000 },
    { url: "s2", lastVisitMs: 1 },
  ];
  const merged = mergeHistory([first, second], 50);
  assert.equal(merged.length, 53);
  assert.equal(merged.filter((e) => e.url.startsWith("f")).length, 50);
  assert.equal(merged.filter((e) => e.url.startsWith("s")).length, 3);
  assert.equal(merged.some((e) => e.url === "f50"), false);
  assert.deepEqual(merged.slice(0, 3).map((e) => e.url), ["f0", "s0", "f1"]);
  const times = merged.map((e) => e.lastVisitMs);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test("mergeHistory sorts an unsorted list before cutting it, counts a missing time as 0 and is stable", () => {
  const list = [{ url: "old", lastVisitMs: 1 }, { url: "new", lastVisitMs: 5 }, { url: "none" }];
  assert.deepEqual(mergeHistory([list], 2).map((e) => e.url), ["new", "old"]);
  const ties = [[{ url: "a1", lastVisitMs: 7 }, { url: "a2", lastVisitMs: 7 }], [{ url: "b1", lastVisitMs: 7 }]];
  assert.deepEqual(mergeHistory(ties, 50).map((e) => e.url), ["a1", "a2", "b1"]);
  assert.deepEqual(mergeHistory([], 50), []);
});

test("mergeHistory does not change the lists it is given", () => {
  const list = [{ url: "a", lastVisitMs: 1 }, { url: "b", lastVisitMs: 2 }];
  mergeHistory([list], 1);
  assert.deepEqual(list.map((e) => e.url), ["a", "b"]);
});

test("bookmarksOutput caches only when every item is a bookmark, and an empty list too", () => {
  const urls = urlItems([{ title: "A", url: "https://a.example.com/" }]);
  assert.deepEqual(bookmarksOutput(urls), { cache: { seconds: 300, loosereload: true }, items: urls });
  assert.deepEqual(bookmarksOutput([]), { cache: { seconds: 300, loosereload: true }, items: [] });
  for (const notice of [needsAccessItem("Safari"), setupItem("missing"), firefoxSilentItem()]) {
    const mixed = [...urls, notice];
    assert.deepEqual(bookmarksOutput(mixed), { items: mixed });
    assert.equal("cache" in bookmarksOutput([notice]), false);
  }
});

test("bookmarksOutput keeps the items as they are and historyOutput caches nothing", () => {
  const items = [{ title: "x", uid: "https://x.example.com/" }];
  assert.deepEqual(bookmarksOutput(items).items, items);
  assert.deepEqual(historyOutput(items), { items });
  assert.equal("skipknowledge" in bookmarksOutput(items), false);
  assert.equal("skipknowledge" in historyOutput(items), false);
});
