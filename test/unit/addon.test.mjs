import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { handleRequest, reconnectDelayMs } = require("../../addon/handler.js");
const constants = require("../../workflow/lib/constants.js");
const manifest = JSON.parse(readFileSync(new URL("../../addon/manifest.json", import.meta.url), "utf8"));
const backgroundSource = readFileSync(new URL("../../addon/background.js", import.meta.url), "utf8");

function fakeBrowser({ tabs = [], updateFails = false } = {}) {
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

test("reconnectDelayMs doubles from 1000 and caps at 60000", () => {
  const got = Array.from({ length: 11 }, (_, i) => reconnectDelayMs(i));
  assert.deepEqual(got, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000, 60000]);
});

test("manifest.json", () => {
  assert.equal(manifest.manifest_version, 2);
  assert.equal(manifest.name, "Browser Search for Alfred");
  assert.equal(manifest.version, "0.1.0");
  assert.equal(manifest.background.persistent, true);
  assert.deepEqual(manifest.background.scripts, ["handler.js", "background.js"]);
  assert.deepEqual(manifest.permissions, ["nativeMessaging", "tabs"]);
  assert.equal(manifest.browser_specific_settings.gecko.id, constants.ADDON_ID);
});

test("background.js connects to the native host by its fixed name", () => {
  assert.ok(backgroundSource.includes(`connectNative("${constants.HOST_NAME}")`));
  assert.ok(backgroundSource.includes('connectNative("io.github.shariqh.browser_search_for_alfred")'));
});
