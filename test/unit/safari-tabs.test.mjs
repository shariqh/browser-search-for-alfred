import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { listTabs, activateTab } = require("../../workflow/lib/safari-tabs.js");

// A clock that moves forward by `stepMs` each time it is read.
function steppingClock(stepMs, start = 1_000_000) {
  let t = start;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

// A stand-in shaped like JXA's Application("Safari"). `data` is [{id (a number, as in Safari), miniaturized?, tabs: [{name, url}]}].
// Reads record the arguments they receive in `args`. `failOn` names a read ("windows.id", "tabs.name",
// "tabs.url", "window.tabs.url", "window.miniaturized") that throws with `errorNumber`. `breakArrays` lets a test hand back
// custom per-window arrays for the name and url reads.
function fakeSafari(data, { running = true, failOn = null, errorNumber = -1712, names = null, urls = null } = {}) {
  const calls = [];
  const args = {};
  const call = (name, received, value) => {
    (args[name] = args[name] || []).push(received);
    if (failOn === name) throw Object.assign(new Error("Apple event failed."), { errorNumber });
    return value();
  };
  const windowObjects = new Map();
  const windows = {
    id: (...a) => call("windows.id", a, () => data.map((w) => w.id)),
    tabs: {
      name: (...a) => call("tabs.name", a, () => names || data.map((w) => w.tabs.map((t) => t.name))),
      url: (...a) => call("tabs.url", a, () => urls || data.map((w) => w.tabs.map((t) => t.url))),
    },
    byId(id) {
      // Safari's window id is an integer, so a text id does not match.
      const found = data.find((w) => w.id === id);
      if (!found) {
        return {
          tabs: {
            url() {
              throw new Error("Can't get window");
            },
          },
        };
      }
      if (!windowObjects.has(id)) {
        const tabsFn = found.tabs.map((t, i) => ({ position: i + 1, url: t.url }));
        const tabs = new Proxy(
          { url: (...a) => call("window.tabs.url", a, () => found.tabs.map((t) => t.url)) },
          { get: (target, key) => (key in target ? target[key] : tabsFn[Number(key)]) }
        );
        const win = { tabs, _index: 2, _currentTab: null };
        Object.defineProperty(win, "currentTab", {
          get: () => win._currentTab,
          set(value) {
            calls.push(`currentTab=${value.position}`);
            win._currentTab = value;
          },
        });
        // Like JXA: win.miniaturized() reads (an Apple Event), win.miniaturized = false writes.
        Object.defineProperty(win, "miniaturized", {
          get: () => (...a) => call("window.miniaturized", a, () => Boolean(found.miniaturized)),
          set(value) {
            calls.push(`miniaturized=${value}`);
            found.miniaturized = value;
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
    windows,
  };
  return { app, calls, args };
}

const twoWindows = [
  {
    id: 11,
    tabs: [
      { name: "Alpha", url: "https://a.example/" },
      { name: "Beta", url: "https://b.example/" },
    ],
  },
  { id: 22, tabs: [{ name: "Gamma", url: "https://g.example/" }] },
];

test("lists two windows' tabs in order, with 1-based positions and text window IDs", () => {
  const { app } = fakeSafari(twoWindows);
  assert.deepEqual(listTabs(app), {
    tabs: [
      { browser: "safari", browserName: "Safari", windowId: "11", tabId: "1", title: "Alpha", url: "https://a.example/" },
      { browser: "safari", browserName: "Safari", windowId: "11", tabId: "2", title: "Beta", url: "https://b.example/" },
      { browser: "safari", browserName: "Safari", windowId: "22", tabId: "1", title: "Gamma", url: "https://g.example/" },
    ],
    denied: false,
  });
});

test("lists nothing, and reads nothing, when Safari is not running", () => {
  const { app, args } = fakeSafari(twoWindows, { running: false });
  assert.deepEqual(listTabs(app), { tabs: [], denied: false });
  assert.deepEqual(args, {});
});

test("every read carries a timeout modifier", () => {
  const { app, args } = fakeSafari(twoWindows);
  listTabs(app, { budgetSeconds: 5 });
  for (const name of ["windows.id", "tabs.name", "tabs.url"]) {
    assert.equal(args[name].length, 1);
    assert.equal(typeof args[name][0][0].timeout, "number");
  }
});

test("a window whose tab arrays are missing or of unequal length is skipped", () => {
  const { app } = fakeSafari(twoWindows, {
    names: [["Alpha"], ["Gamma"]],
    urls: [["https://a.example/", "https://b.example/"], ["https://g.example/"]],
  });
  assert.deepEqual(
    listTabs(app).tabs.map((t) => t.title),
    ["Gamma"]
  );
  const missing = fakeSafari(twoWindows, { names: [undefined, ["Gamma"]] });
  assert.deepEqual(
    listTabs(missing.app).tabs.map((t) => t.title),
    ["Gamma"]
  );
});

test("a refused Automation (-1743) is reported as denied, with no tabs", () => {
  const { app } = fakeSafari(twoWindows, { failOn: "tabs.name", errorNumber: -1743 });
  assert.deepEqual(listTabs(app), { tabs: [], denied: true });
});

test("a timeout or any other failure lists nothing and is not denied", () => {
  for (const errorNumber of [-1712, -600]) {
    const { app } = fakeSafari(twoWindows, { failOn: "windows.id", errorNumber });
    assert.deepEqual(listTabs(app), { tabs: [], denied: false });
  }
});

test("a spent budget lists nothing without reading", () => {
  const { app, args } = fakeSafari(twoWindows);
  const now = steppingClock(1000);
  assert.deepEqual(listTabs(app, { deadlineMs: 999_000, now }), { tabs: [], denied: false });
  assert.deepEqual(args, {});
});

test("activateTab selects the tab at the position when its URL is still there", () => {
  const { app, calls } = fakeSafari(twoWindows);
  assert.equal(activateTab(app, "11", "2", "https://b.example/"), true);
  assert.deepEqual(calls, ["currentTab=2", "index=1", "activate"]);
});

test("activateTab restores a minimised window before it raises it", () => {
  const data = [{ id: 11, miniaturized: true, tabs: [{ name: "Alpha", url: "https://a.example/" }, { name: "Beta", url: "https://b.example/" }] }];
  const { app, calls } = fakeSafari(data);
  assert.equal(activateTab(app, "11", "2", "https://b.example/"), true);
  assert.deepEqual(calls, ["miniaturized=false", "currentTab=2", "index=1", "activate"]);
  assert.equal(data[0].miniaturized, false);
});

test("activateTab leaves a minimised window minimised when its tab is gone", () => {
  const data = [{ id: 11, miniaturized: true, tabs: [{ name: "Alpha", url: "https://a.example/" }] }];
  const { app, calls } = fakeSafari(data);
  assert.equal(activateTab(app, "11", "1", "https://closed.example/"), false);
  assert.deepEqual(calls, []);
  assert.equal(data[0].miniaturized, true);
});

test("activateTab reads the minimised state with a timeout, and a timeout there changes nothing", () => {
  const { app, args } = fakeSafari(twoWindows);
  activateTab(app, "11", "1", "https://a.example/", { budgetSeconds: 5 });
  assert.equal(typeof args["window.miniaturized"][0][0].timeout, "number");
  const slow = fakeSafari(twoWindows, { failOn: "window.miniaturized" });
  assert.equal(activateTab(slow.app, "11", "1", "https://a.example/"), false);
  assert.deepEqual(slow.calls, []);
});

test("activateTab still activates when the window will not say whether it is minimised", () => {
  const { app, calls } = fakeSafari(twoWindows, { failOn: "window.miniaturized", errorNumber: -10000 });
  assert.equal(activateTab(app, "11", "1", "https://a.example/"), true);
  assert.deepEqual(calls, ["currentTab=1", "index=1", "activate"]);
});

test("activateTab finds a tab that moved, by its URL in the same window", () => {
  const moved = [
    {
      id: 11,
      tabs: [
        { name: "A", url: "https://a.example/" },
        { name: "New", url: "https://new.example/" },
        { name: "B", url: "https://b.example/" },
      ],
    },
  ];
  const { app, calls } = fakeSafari(moved);
  // The list showed https://b.example/ at position 2; it is now at 3.
  assert.equal(activateTab(app, "11", "2", "https://b.example/"), true);
  assert.deepEqual(calls, ["currentTab=3", "index=1", "activate"]);
});

test("activateTab picks the first tab with the URL when the position no longer matches", () => {
  const dup = [
    {
      id: 11,
      tabs: [
        { name: "x", url: "https://same.example/" },
        { name: "y", url: "https://other.example/" },
        { name: "z", url: "https://same.example/" },
      ],
    },
  ];
  const { app, calls } = fakeSafari(dup);
  assert.equal(activateTab(app, "11", "2", "https://same.example/"), true);
  assert.deepEqual(calls, ["currentTab=1", "index=1", "activate"]);
});

test("activateTab changes nothing and returns false when the URL is gone", () => {
  const { app, calls } = fakeSafari(twoWindows);
  assert.equal(activateTab(app, "11", "2", "https://closed.example/"), false);
  assert.deepEqual(calls, []);
});

test("activateTab never selects a tab from another window", () => {
  const { app, calls } = fakeSafari(twoWindows);
  assert.equal(activateTab(app, "11", "1", "https://g.example/"), false);
  assert.deepEqual(calls, []);
});

test("activateTab returns false when the window has gone", () => {
  const { app, calls } = fakeSafari(twoWindows);
  assert.equal(activateTab(app, "99", "1", "https://a.example/"), false);
  assert.deepEqual(calls, []);
});

test("activateTab returns false, without throwing, when the read times out or is refused", () => {
  for (const errorNumber of [-1712, -1743]) {
    const { app, calls } = fakeSafari(twoWindows, { failOn: "window.tabs.url", errorNumber });
    assert.equal(activateTab(app, "11", "1", "https://a.example/"), false);
    assert.deepEqual(calls, []);
  }
});

test("activateTab reads with a timeout modifier and returns false for a spent budget", () => {
  const { app, args } = fakeSafari(twoWindows);
  activateTab(app, "11", "1", "https://a.example/", { budgetSeconds: 5 });
  assert.equal(typeof args["window.tabs.url"][0][0].timeout, "number");
  const spent = fakeSafari(twoWindows);
  assert.equal(activateTab(spent.app, "11", "1", "https://a.example/", { deadlineMs: 1, now: () => 2 }), false);
  assert.deepEqual(spent.calls, []);
});

test("activateTab activates a tab that has no URL, as listTabs lists it with an empty one", () => {
  for (const missing of [null, undefined]) {
    const data = [{ id: 11, tabs: [{ name: "Start Page", url: missing }, { name: "Docs", url: "https://d.example/" }] }];
    const { app, calls } = fakeSafari(data);
    const blank = listTabs(app).tabs[0];
    assert.equal(blank.url, "");
    assert.equal(activateTab(app, blank.windowId, blank.tabId, blank.url), true, String(missing));
    assert.deepEqual(calls, ["currentTab=1", "index=1", "activate"]);
  }
});
