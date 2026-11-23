import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listTabs: listTabsRaw, activateTab } = require("../../workflow/lib/chromium.js");
const browsers = require("../../workflow/lib/browsers.js");
const { tabItem } = require("../../workflow/lib/items.js");

const chrome = browsers.byKey("chrome");
const readNames = ["windows.id", "windows.mode", "tabs.id", "tabs.title", "tabs.url"];
// Most tests only want the tab array; the result shape has its own tests.
const listTabs = (app, browser, options) => listTabsRaw(app, browser, options).tabs;

// A stand-in shaped like JXA's Application("Google Chrome"). `data` is [{id, mode?, tabs: [{id, title, url}]}];
// mode defaults to "normal".
// Every read and command records the arguments it receives in `args`, keyed by name. `failOn` names a call
// (for example "tabs.title") that throws the way a timed-out Apple Event does.
// `rejectArgs` makes every call that is given an argument throw a TypeError, as JXA would if it refused the
// modifier shape; the same call with no argument works. `errorNumber` is the number `failOn` throws with.
function fakeChrome(data, { running = true, failOn = null, errorNumber = -1712, rejectArgs = false, onCall = () => {} } = {}) {
  const calls = [];
  const args = {};
  const call = (name, received, value) => {
    (args[name] = args[name] || []).push(received);
    onCall(name);
    if (rejectArgs && received.length > 0) throw new TypeError("Wrong number of arguments");
    if (failOn === name) throw Object.assign(new Error("Apple event failed."), { errorNumber });
    return value();
  };
  const windowObjects = new Map();
  const windows = {
    id: (...a) => call("windows.id", a, () => data.map((w) => w.id)),
    mode: (...a) => call("windows.mode", a, () => data.map((w) => w.mode || "normal")),
    tabs: {
      id: (...a) => call("tabs.id", a, () => data.map((w) => w.tabs.map((t) => t.id))),
      title: (...a) => call("tabs.title", a, () => data.map((w) => w.tabs.map((t) => t.title))),
      url: (...a) => call("tabs.url", a, () => data.map((w) => w.tabs.map((t) => t.url))),
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
          tabs: { id: (...a) => call("window.tabs.id", a, () => found.tabs.map((t) => t.id)) },
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
  const app = {
    running: () => running,
    activate: (...a) =>
      call("activate", a, () => {
        calls.push("activate");
      }),
  };
  Object.defineProperty(app, "windows", {
    get() {
      if (!running) throw new Error("windows must not be read when Chrome is not running");
      return windows;
    },
  });
  return { app, calls, args };
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
  assert.deepEqual(listTabs(app, chrome), [
    { browser: "chrome", browserName: "Google Chrome", windowId: "100", tabId: "1", title: "First", url: "https://example.com/one" },
    { browser: "chrome", browserName: "Google Chrome", windowId: "100", tabId: "2", title: "Second", url: "https://example.org/two" },
    { browser: "chrome", browserName: "Google Chrome", windowId: "200", tabId: "3", title: "Third", url: "https://example.net/3" },
  ]);
});

test("window and tab IDs stay strings even when the dictionary hands back numbers", () => {
  const { app } = fakeChrome([{ id: 100, tabs: [{ id: 7, title: "T", url: "https://example.com/" }] }]);
  const [tab] = listTabs(app, chrome);
  assert.equal(tab.windowId, "100");
  assert.equal(tab.tabId, "7");
});

test("an empty title falls back to the URL without its scheme", () => {
  const { app } = fakeChrome([{ id: "1", tabs: [{ id: "2", title: "", url: "https://example.com/path" }] }]);
  const [tab] = listTabs(app, chrome);
  assert.equal(tab.title, "");
  assert.equal(tabItem(tab, null).title, "example.com/path");
});

test("a window with no tabs and a Chrome with no windows give no tabs", () => {
  assert.deepEqual(listTabs(fakeChrome([{ id: "1", tabs: [] }]).app, chrome), []);
  assert.deepEqual(listTabs(fakeChrome([]).app, chrome), []);
});

test("not running returns [] and never reads windows", () => {
  const { app } = fakeChrome(twoWindows(), { running: false });
  assert.deepEqual(listTabs(app, chrome), []);
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
  const [tab] = listTabs(app, chrome);
  const item = tabItem(tab, "/Applications/Google Chrome.app");
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item);
  assert.equal(item.title, title);
  assert.deepEqual(JSON.parse(item.arg), { action: "activate", browser: "chrome", windowId: "100", tabId: "5" });
});

// A clock that moves forward by `stepMs` each time it is read, so budgets are deterministic.
function steppingClock(stepMs) {
  let t = 1_000_000;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

const modifierOf = (received) => {
  assert.equal(received.length, 1, "one modifier object and nothing else");
  assert.equal(typeof received[0], "object");
  return received[0].timeout;
};

test("every read passes a modifier object with a positive whole-second timeout", () => {
  const { app, args } = fakeChrome(twoWindows());
  assert.equal(listTabs(app, chrome).length, 3);
  assert.deepEqual(Object.keys(args), readNames);
  for (const received of Object.values(args)) {
    const timeout = modifierOf(received[0]);
    assert.ok(Number.isInteger(timeout) && timeout >= 1, `timeout ${timeout}`);
  }
});

test("timeouts count down from one shared budget and never exceed what is left", () => {
  const { app, args } = fakeChrome(twoWindows());
  // The clock moves 1.5 s each time it is read, so 8.5, 7, 5.5, 4 and 2.5 s are left at the five reads.
  listTabs(app, chrome, { budgetSeconds: 10, now: steppingClock(1500) });
  const timeouts = readNames.map((name) => modifierOf(args[name][0]));
  assert.deepEqual(timeouts, [8, 7, 5, 4, 2]);
});

test("the timeout is never less than one second", () => {
  const { app, args } = fakeChrome(twoWindows());
  // 2.6, 2, 1.4, 0.8 and 0.2 s are left at the five reads: the last ones still get a whole second.
  listTabs(app, chrome, { budgetSeconds: 3.2, now: steppingClock(600) });
  const timeouts = readNames.map((name) => modifierOf(args[name][0]));
  assert.deepEqual(timeouts, [2, 2, 1, 1, 1]);
});

test("a spent budget stops listing before the next read", () => {
  const { app, args } = fakeChrome(twoWindows());
  // 0.4 s are left at the first read, nothing at the second.
  assert.deepEqual(listTabs(app, chrome, { budgetSeconds: 1, now: steppingClock(600) }), []);
  assert.deepEqual(Object.keys(args), ["windows.id"], "one read happened, the rest were skipped");
});

test("a read that times out gives [] and does not throw, whichever read it is", () => {
  for (const failOn of readNames) {
    const { app } = fakeChrome(twoWindows(), { failOn });
    assert.deepEqual(listTabs(app, chrome), [], failOn);
  }
});

test("activateTab passes timeout modifiers and shares one budget", () => {
  const { app, args } = fakeChrome(twoWindows());
  assert.equal(activateTab(app, "100", "2", { budgetSeconds: 10, now: steppingClock(1500) }), true);
  assert.equal(modifierOf(args["window.tabs.id"][0]), 8);
  assert.equal(modifierOf(args["activate"][0]), 7);
});

test("activateTab with the default budget uses a positive timeout on both calls", () => {
  const { app, args } = fakeChrome(twoWindows());
  assert.equal(activateTab(app, "100", "2"), true);
  for (const name of ["window.tabs.id", "activate"]) assert.ok(modifierOf(args[name][0]) >= 1, name);
});

test("activateTab returns false and changes nothing when reading the window's tabs times out", () => {
  const { app, calls } = fakeChrome(twoWindows(), { failOn: "window.tabs.id" });
  assert.equal(activateTab(app, "100", "2"), false);
  assert.deepEqual(calls, []);
});

test("activateTab returns false when raising Chrome times out", () => {
  const { app } = fakeChrome(twoWindows(), { failOn: "activate" });
  assert.equal(activateTab(app, "100", "2"), false);
});

test("a timeout (-1712) is not retried", () => {
  const { app, args } = fakeChrome(twoWindows(), { failOn: "windows.id" });
  assert.deepEqual(listTabs(app, chrome), []);
  assert.equal(args["windows.id"].length, 1);
});

test("a fake that refuses any argument still lists tabs, by retrying each read without one", () => {
  const { app, args } = fakeChrome(twoWindows(), { rejectArgs: true });
  assert.equal(listTabs(app, chrome).length, 3);
  for (const name of readNames) {
    assert.equal(args[name].length, 2, name);
    assert.equal(modifierOf(args[name][0]) >= 1, true);
    assert.deepEqual(args[name][1], []);
  }
});

test("a fake that refuses any argument still activates", () => {
  const { app, calls, args } = fakeChrome(twoWindows(), { rejectArgs: true });
  assert.equal(activateTab(app, "100", "2"), true);
  assert.deepEqual(calls, ["activeTabIndex=2", "index=1", "activate"]);
  assert.deepEqual(args["window.tabs.id"][1], []);
  assert.deepEqual(args["activate"][1], []);
});

test("Automation denied (-1743) on any read gives no tabs and denied: true, without a retry", () => {
  for (const failOn of readNames) {
    const { app, args } = fakeChrome(twoWindows(), { failOn, errorNumber: -1743 });
    assert.deepEqual(listTabsRaw(app, chrome), { tabs: [], denied: true }, failOn);
    assert.equal(args[failOn].length, 1, `${failOn} was not retried`);
  }
});

test("denied is still reported when the plain retry would have thrown something else", () => {
  // The first (modified) call is refused with -1743; the call without a modifier would fail differently.
  // Retrying would hide the refusal, so it must not happen.
  const { app } = fakeChrome(twoWindows(), { failOn: "windows.id", errorNumber: -1743 });
  assert.equal(listTabsRaw(app, chrome).denied, true);
});

test("a timeout or another error gives {tabs: [], denied: false}", () => {
  for (const errorNumber of [-1712, -600]) {
    const { app } = fakeChrome(twoWindows(), { failOn: "tabs.title", errorNumber });
    assert.deepEqual(listTabsRaw(app, chrome), { tabs: [], denied: false }, String(errorNumber));
  }
});

test("a browser that is not running gives {tabs: [], denied: false}", () => {
  const { app } = fakeChrome(twoWindows(), { running: false });
  assert.deepEqual(listTabsRaw(app, chrome), { tabs: [], denied: false });
});

test("incognito windows are skipped and only the normal window's tabs come back", () => {
  const data = [
    { id: "100", mode: "normal", tabs: [{ id: "1", title: "Public", url: "https://example.com/public" }] },
    { id: "200", mode: "incognito", tabs: [{ id: "2", title: "Private", url: "https://example.com/private" }] },
  ];
  const { app } = fakeChrome(data);
  const result = listTabsRaw(app, chrome);
  assert.equal(result.denied, false);
  assert.deepEqual(result.tabs, [
    { browser: "chrome", browserName: "Google Chrome", windowId: "100", tabId: "1", title: "Public", url: "https://example.com/public" },
  ]);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("a normal window after an incognito one keeps its own tabs", () => {
  const data = [
    { id: "1", mode: "incognito", tabs: [{ id: "10", title: "Private", url: "https://example.com/p" }] },
    { id: "2", mode: "normal", tabs: [{ id: "20", title: "Public", url: "https://example.com/q" }] },
  ];
  const { app } = fakeChrome(data);
  assert.deepEqual(listTabs(app, chrome).map((t) => t.tabId), ["20"]);
});

test("a window whose mode is anything but \"normal\" contributes no tabs", () => {
  for (const odd of ["Incognito", "private", "", undefined, null, 1]) {
    const data = [
      { id: "1", tabs: [{ id: "10", title: "Odd", url: "https://example.com/odd" }] },
      { id: "2", tabs: [{ id: "20", title: "Public", url: "https://example.com/public" }] },
    ];
    const { app } = fakeChrome(data);
    app.windows.mode = () => [odd, "normal"];
    assert.deepEqual(listTabs(app, chrome).map((t) => t.tabId), ["20"], String(odd));
  }
});

test("a mode list that does not line up with the windows gives no tabs rather than guessing", () => {
  const { app } = fakeChrome(twoWindows());
  app.windows.mode = () => ["normal"];
  assert.deepEqual(listTabsRaw(app, chrome), { tabs: [], denied: false });
});

test("browser and browserName come from the registry entry passed in", () => {
  for (const key of ["brave", "edge"]) {
    const entry = browsers.byKey(key);
    const { app } = fakeChrome(twoWindows());
    const { tabs } = listTabsRaw(app, entry);
    assert.equal(tabs.length, 3);
    for (const tab of tabs) {
      assert.equal(tab.browser, key);
      assert.equal(tab.browserName, entry.name);
    }
  }
});

test("a deadlineMs in the past makes no Apple Event and gives {tabs: [], denied: false}", () => {
  const { app, args } = fakeChrome(twoWindows());
  const result = listTabsRaw(app, chrome, { deadlineMs: 500, now: () => 1_000 });
  assert.deepEqual(result, { tabs: [], denied: false });
  assert.deepEqual(args, {});
});

test("a deadlineMs in the future shares one deadline across the reads", () => {
  const { app, args } = fakeChrome(twoWindows());
  const result = listTabsRaw(app, chrome, { deadlineMs: 1_000_000 + 10_000, now: steppingClock(1500) });
  assert.equal(result.tabs.length, 3);
  // The clock is not read when the budget is made: 10 s are left at the first read, 8.5 at the second.
  assert.equal(modifierOf(args["windows.id"][0]), 10);
  assert.equal(modifierOf(args["windows.mode"][0]), 8);
});

test("Automation denied (-1743) gives false from activateTab without throwing", () => {
  for (const failOn of ["window.tabs.id", "activate"]) {
    const { app } = fakeChrome(twoWindows(), { failOn, errorNumber: -1743 });
    assert.equal(activateTab(app, "100", "2"), false, failOn);
  }
});

test("a non-timeout error is not retried once the budget is spent", () => {
  const { app, args } = fakeChrome(twoWindows(), { failOn: "windows.id", errorNumber: -1743 });
  // The clock jumps past the deadline while the first read runs.
  assert.deepEqual(listTabs(app, chrome, { budgetSeconds: 1, now: steppingClock(600) }), []);
  assert.equal(args["windows.id"].length, 1);
});
