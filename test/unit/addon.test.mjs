import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { handleRequest, reconnectDelayMs } = require("../../addon/handler.js");
const constants = require("../../workflow/lib/constants.js");
const manifest = JSON.parse(readFileSync(new URL("../../addon/manifest.json", import.meta.url), "utf8"));
const backgroundSource = readFileSync(new URL("../../addon/background.js", import.meta.url), "utf8");

function fakeBrowser({ tabs = [], updateFails = false, tree = [], history = [] } = {}) {
  const calls = [];
  return {
    calls,
    tabs: {
      TAB_ID_NONE: -1,
      query: async (q) => { calls.push(["tabs.query", q]); return tabs; },
      update: async (id, props) => {
        calls.push(["tabs.update", id, props]);
        if (updateFails) throw new Error("No tab with id");
        return {};
      },
    },
    windows: {
      update: async (id, props) => { calls.push(["windows.update", id, props]); return {}; },
    },
    bookmarks: {
      getTree: async () => { calls.push(["bookmarks.getTree"]); return tree; },
    },
    history: {
      search: async (q) => { calls.push(["history.search", q]); return history; },
    },
  };
}

test("list-tabs keeps only the six fields and drops TAB_ID_NONE tabs", async () => {
  const b = fakeBrowser({
    tabs: [
      { id: 1, windowId: 2, index: 0, title: "A", url: "https://a", active: true, favIconUrl: "x", pinned: true },
      { id: -1, windowId: 2, index: 1, title: "gone", url: "https://g", active: false },
      { id: 3, windowId: 2, index: 2, title: "C", url: "https://c", active: false, cookieStoreId: "y" },
    ],
  });
  const r = await handleRequest(b, { id: "r1", command: "list-tabs", params: {} });
  assert.deepEqual(r, {
    id: "r1",
    payload: [
      { id: 1, windowId: 2, index: 0, title: "A", url: "https://a", active: true },
      { id: 3, windowId: 2, index: 2, title: "C", url: "https://c", active: false },
    ],
  });
  assert.deepEqual(b.calls, [["tabs.query", {}]]);
});

test("activate-tab updates the tab, then focuses its window", async () => {
  const b = fakeBrowser();
  const r = await handleRequest(b, { id: "r2", command: "activate-tab", params: { tabId: 5, windowId: 9 } });
  assert.deepEqual(r, { id: "r2", payload: true });
  assert.deepEqual(b.calls, [
    ["tabs.update", 5, { active: true }],
    ["windows.update", 9, { focused: true }],
  ]);
});

test("activate-tab on a closed tab returns {id, error} and doesn't throw", async () => {
  const b = fakeBrowser({ updateFails: true });
  const r = await handleRequest(b, { id: "r3", command: "activate-tab", params: { tabId: 5, windowId: 9 } });
  assert.equal(r.id, "r3");
  assert.equal(typeof r.error, "string");
  assert.ok(r.error.length > 0);
  assert.equal("payload" in r, false);
  assert.equal(b.calls.some((c) => c[0] === "windows.update"), false);
});

test("an unknown command returns {id, error: \"unknown command: x\"}", async () => {
  const r = await handleRequest(fakeBrowser(), { id: "r4", command: "x", params: {} });
  assert.deepEqual(r, { id: "r4", error: "unknown command: x" });
});

test("reconnectDelayMs doubles from 1000 and caps at 10000", () => {
  const got = Array.from({ length: 8 }, (_, i) => reconnectDelayMs(i));
  assert.deepEqual(got, [1000, 2000, 4000, 8000, 10000, 10000, 10000, 10000]);
});

test("manifest.json", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.name, "Browser Search for Alfred");
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.background.persistent, true);
  assert.deepEqual(manifest.background.scripts, ["handler.js", "background.js"]);
  assert.deepEqual(manifest.permissions, ["nativeMessaging", "tabs", "bookmarks", "history"]);
  assert.equal(manifest.description, "Lists this browser's tabs, bookmarks and history for Alfred, and brings a tab to the front.");
  assert.equal(manifest.browser_specific_settings.gecko.id, constants.ADDON_ID);
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["browsingActivity"] });
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "140.0");
  assert.equal(manifest.browser_specific_settings.gecko_android, undefined);
});

test("background.js connects to the native host by its fixed name", () => {
  assert.ok(backgroundSource.includes(`connectNative("${constants.HOST_NAME}")`));
  assert.ok(backgroundSource.includes('connectNative("io.github.shariqh.browser_search_for_alfred")'));
});

test("activate-tab without integer tabId and windowId returns {id, error: \"invalid params\"} and activates nothing", async () => {
  const bad = [
    undefined,
    {},
    { tabId: 5 },
    { windowId: 9 },
    { tabId: "5", windowId: 9 },
    { tabId: 5, windowId: "9" },
    { tabId: 5.5, windowId: 9 },
    { tabId: null, windowId: 9 },
    { tabId: 5, windowId: undefined },
    { tabId: NaN, windowId: 9 },
    { tabId: true, windowId: 9 },
  ];
  for (const params of bad) {
    const b = fakeBrowser();
    const r = await handleRequest(b, { id: "p", command: "activate-tab", params });
    assert.deepEqual(r, { id: "p", error: "invalid params" }, JSON.stringify(params));
    assert.deepEqual(b.calls, [], "no tab or window was touched");
  }
});

test("activate-tab accepts 0 as a tab or window ID", async () => {
  const b = fakeBrowser();
  const r = await handleRequest(b, { id: "z", command: "activate-tab", params: { tabId: 0, windowId: 0 } });
  assert.deepEqual(r, { id: "z", payload: true });
  assert.equal(b.calls.length, 2);
});

test("list-tabs leaves out tabs in private windows", async () => {
  const b = fakeBrowser({
    tabs: [
      { id: 1, windowId: 2, index: 0, title: "A", url: "https://a", active: true, incognito: false },
      { id: 2, windowId: 3, index: 0, title: "Secret", url: "https://secret", active: true, incognito: true },
      { id: 3, windowId: 2, index: 1, title: "C", url: "https://c", active: false },
    ],
  });
  const r = await handleRequest(b, { id: "r5", command: "list-tabs", params: {} });
  assert.deepEqual(
    r.payload.map((t) => t.id),
    [1, 3],
  );
  assert.equal(JSON.stringify(r).includes("secret"), false);
});

test("list-bookmarks returns every openable bookmark, depth first, and ignores params", async () => {
  const tree = [
    {
      id: "root",
      title: "",
      type: "folder",
      children: [
        {
          id: "menu",
          title: "Menu",
          type: "folder",
          children: [
            { id: "1", title: "Example", url: "https://example.com/", type: "bookmark", dateAdded: 5 },
            { id: "sep", title: "", url: "data:", type: "separator" },
            {
              id: "sub",
              title: "Sub",
              type: "folder",
              url: "https://folder.example/",
              children: [{ id: "2", title: "Local", url: "FILE:///tmp/a.html" }],
            },
          ],
        },
        { id: "3", title: "Query", url: "place:type=6&sort=14", type: "bookmark" },
        { id: "4", title: "Script", url: "javascript:alert(1)", type: "bookmark" },
        { id: "5", title: "Plain", url: "HTTP://plain.example/", type: "bookmark" },
        { id: "6", title: "No URL", type: "bookmark" },
      ],
    },
  ];
  const b = fakeBrowser({ tree });
  const r = await handleRequest(b, { id: "b1", command: "list-bookmarks", params: { x: 1 } });
  assert.deepEqual(r, {
    id: "b1",
    payload: [
      { title: "Example", url: "https://example.com/" },
      { title: "Local", url: "FILE:///tmp/a.html" },
      { title: "Plain", url: "HTTP://plain.example/" },
    ],
  });
  assert.deepEqual(b.calls, [["bookmarks.getTree"]]);
});

test("list-bookmarks leaves out every URL that is not http, https or file", async () => {
  const urls = ["place:x", "javascript:alert(1)", "chrome://settings", "data:text/html,hi", "about:blank", "ftp://x/", "https:", "//x"];
  const tree = [{ id: "r", type: "folder", children: urls.map((url, i) => ({ id: String(i), title: "t", url, type: "bookmark" })) }];
  const r = await handleRequest(fakeBrowser({ tree }), { id: "b2", command: "list-bookmarks" });
  assert.deepEqual(r.payload, [{ title: "t", url: "https:" }]);
});

test("search-history searches everything by the typed words and keeps only openable URLs", async () => {
  const history = [
    { id: "1", url: "https://a.example/", title: "A", lastVisitTime: 1700000000000, visitCount: 3 },
    { id: "2", url: "javascript:1", title: "Bad", lastVisitTime: 5 },
    { id: "3", url: "file:///tmp/x", title: "Local", lastVisitTime: 4 },
    { id: "4", url: "about:home", title: "Home", lastVisitTime: 3 },
  ];
  const b = fakeBrowser({ history });
  const r = await handleRequest(b, { id: "h1", command: "search-history", params: { query: "a b", maxResults: 50 } });
  assert.deepEqual(r, {
    id: "h1",
    payload: [
      { title: "A", url: "https://a.example/", lastVisitTime: 1700000000000 },
      { title: "Local", url: "file:///tmp/x", lastVisitTime: 4 },
    ],
  });
  assert.deepEqual(b.calls, [["history.search", { text: "a b", startTime: 0, maxResults: 50 }]]);
});

test("search-history accepts an empty query and the limits 1 and 50, and 512 characters", async () => {
  for (const params of [
    { query: "", maxResults: 1 },
    { query: "x".repeat(512), maxResults: 50 },
  ]) {
    const b = fakeBrowser();
    const r = await handleRequest(b, { id: "h2", command: "search-history", params });
    assert.deepEqual(r, { id: "h2", payload: [] });
    assert.equal(b.calls.length, 1);
  }
});

test("search-history with bad params returns {id, error: \"invalid params\"} and makes no call", async () => {
  const bad = [
    undefined,
    null,
    {},
    { query: "a" },
    { maxResults: 5 },
    { query: "a", maxResults: 0 },
    { query: "a", maxResults: 51 },
    { query: "a", maxResults: -1 },
    { query: "a", maxResults: "5" },
    { query: "a", maxResults: 2.5 },
    { query: "a", maxResults: NaN },
    { query: "a", maxResults: null },
    { query: 5, maxResults: 5 },
    { query: null, maxResults: 5 },
    { query: ["a"], maxResults: 5 },
    { query: "x".repeat(513), maxResults: 5 },
  ];
  for (const params of bad) {
    const b = fakeBrowser();
    const r = await handleRequest(b, { id: "p", command: "search-history", params });
    assert.deepEqual(r, { id: "p", error: "invalid params" }, JSON.stringify(params));
    assert.deepEqual(b.calls, [], "history was not searched");
  }
});
