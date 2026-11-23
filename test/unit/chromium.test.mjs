import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listTabs, activateTab } = require("../../workflow/lib/chromium.js");
const { tabItem } = require("../../workflow/lib/items.js");

// A stand-in shaped like JXA's Application("Google Chrome"). `data` is [{id, tabs: [{id, title, url}]}].
function fakeChrome(data, { running = true } = {}) {
  const calls = [];
  const windowObjects = new Map();
  const windows = {
    id: () => data.map((w) => w.id),
    tabs: {
      id: () => data.map((w) => w.tabs.map((t) => t.id)),
      title: () => data.map((w) => w.tabs.map((t) => t.title)),
      url: () => data.map((w) => w.tabs.map((t) => t.url)),
    },
    byId(id) {
      const found = data.find((w) => w.id === id);
      if (!found) {
        // A specifier for a window that is gone fails when it is first used.
        return {
          tabs: {
            id() {
              throw new Error("Can't get window");
            },
          },
        };
      }
      if (!windowObjects.has(id)) {
        const win = {
          tabs: { id: () => found.tabs.map((t) => t.id) },
          _activeTabIndex: 1,
          _index: 2,
        };
        Object.defineProperty(win, "activeTabIndex", {
          get: () => win._activeTabIndex,
          set(value) {
            calls.push(`activeTabIndex=${value}`);
            win._activeTabIndex = value;
          },
        });
        Object.defineProperty(win, "index", {
          get: () => win._index,
          set(value) {
            calls.push(`index=${value}`);
            win._index = value;
          },
        });
        windowObjects.set(id, win);
      }
      return windowObjects.get(id);
    },
  };
  const app = { running: () => running, activate: () => calls.push("activate") };
  Object.defineProperty(app, "windows", {
    get() {
      if (!running) throw new Error("windows must not be read when Chrome is not running");
      return windows;
    },
  });
  return { app, calls };
}

const twoWindows = () => [
  {
    id: "100",
    tabs: [
      { id: "1", title: "First", url: "https://example.com/one" },
      { id: "2", title: "Second", url: "https://example.org/two" },
    ],
  },
  { id: "200", tabs: [{ id: "3", title: "Third", url: "https://example.net/3" }] },
];

test("lists tabs with ids, titles and URLs across two windows", () => {
  const { app } = fakeChrome(twoWindows());
  assert.deepEqual(listTabs(app, "Google Chrome"), [
    { browser: "chrome", browserName: "Google Chrome", windowId: "100", tabId: "1", title: "First", url: "https://example.com/one" },
    { browser: "chrome", browserName: "Google Chrome", windowId: "100", tabId: "2", title: "Second", url: "https://example.org/two" },
    { browser: "chrome", browserName: "Google Chrome", windowId: "200", tabId: "3", title: "Third", url: "https://example.net/3" },
  ]);
});

test("window and tab IDs stay strings even when the dictionary hands back numbers", () => {
  const { app } = fakeChrome([{ id: 100, tabs: [{ id: 7, title: "T", url: "https://example.com/" }] }]);
  const [tab] = listTabs(app, "Google Chrome");
  assert.equal(tab.windowId, "100");
  assert.equal(tab.tabId, "7");
});

test("an empty title falls back to the URL without its scheme", () => {
  const { app } = fakeChrome([{ id: "1", tabs: [{ id: "2", title: "", url: "https://example.com/path" }] }]);
  const [tab] = listTabs(app, "Google Chrome");
  assert.equal(tab.title, "");
  assert.equal(tabItem(tab, null).title, "example.com/path");
});

test("a window with no tabs and a Chrome with no windows give no tabs", () => {
  assert.deepEqual(listTabs(fakeChrome([{ id: "1", tabs: [] }]).app, "Google Chrome"), []);
  assert.deepEqual(listTabs(fakeChrome([]).app, "Google Chrome"), []);
});

test("not running returns [] and never reads windows", () => {
  const { app } = fakeChrome(twoWindows(), { running: false });
  assert.deepEqual(listTabs(app, "Google Chrome"), []);
});

test("activates by id: sets activeTabIndex and index, then activates", () => {
  const { app, calls } = fakeChrome(twoWindows());
  assert.equal(activateTab(app, "100", "2"), true);
  assert.deepEqual(calls, ["activeTabIndex=2", "index=1", "activate"]);
});

test("a closed tab returns false and changes nothing", () => {
  const { app, calls } = fakeChrome(twoWindows());
  assert.equal(activateTab(app, "100", "99"), false);
  assert.deepEqual(calls, []);
});

test("a closed window returns false without throwing and changes nothing", () => {
  const { app, calls } = fakeChrome(twoWindows());
  assert.equal(activateTab(app, "999", "1"), false);
  assert.deepEqual(calls, []);
});

test("a tab moved to another window is not found by the old window", () => {
  const { app, calls } = fakeChrome(twoWindows());
  assert.equal(activateTab(app, "200", "1"), false);
  assert.deepEqual(calls, []);
});

test("a Chrome tab titled with quotes, a newline, emoji and Hebrew gives an arg that round-trips", () => {
  const title = 'Q "x" \n 😀 עברית';
  const { app } = fakeChrome([{ id: "100", tabs: [{ id: "5", title, url: 'https://example.com/"q"\n😀' }] }]);
  const [tab] = listTabs(app, "Google Chrome");
  const item = tabItem(tab, "/Applications/Google Chrome.app");
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.equal(item.title, title);
  assert.deepEqual(JSON.parse(item.arg), { action: "activate", browser: "chrome", windowId: "100", tabId: "5" });
});
