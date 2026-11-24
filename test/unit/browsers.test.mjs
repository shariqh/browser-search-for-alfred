import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const browsers = require("../../workflow/lib/browsers.js");

test("the registry lists the five browsers in the default order", () => {
  const rows = browsers.ALL.map((b) => [b.key, b.name, b.bundleId, b.family]);
  assert.deepEqual(rows, [
    ["firefox", "Firefox", "org.mozilla.firefox", "firefox"],
    ["chrome", "Google Chrome", "com.google.Chrome", "chromium"],
    ["safari", "Safari", "com.apple.Safari", "safari"],
    ["brave", "Brave Browser", "com.brave.Browser", "chromium"],
    ["edge", "Microsoft Edge", "com.microsoft.edgemac", "chromium"],
  ]);
});

test("data folders come from HOME; Firefox has none", () => {
  const dirs = Object.fromEntries(browsers.ALL.map((b) => [b.key, b.dataDir("/h")]));
  assert.deepEqual(dirs, {
    firefox: null,
    chrome: "/h/Library/Application Support/Google/Chrome",
    safari: "/h/Library/Safari",
    brave: "/h/Library/Application Support/BraveSoftware/Brave-Browser",
    edge: "/h/Library/Application Support/Microsoft Edge",
  });
});

test("byKey finds an entry, and is undefined for an unknown key", () => {
  assert.equal(browsers.byKey("brave").name, "Brave Browser");
  assert.equal(browsers.byKey("opera"), undefined);
});

test("chromium() returns Chrome, Brave and Edge", () => {
  assert.deepEqual(browsers.chromium().map((b) => b.key), ["chrome", "brave", "edge"]);
});

test("defaultOrder() returns the keys in order", () => {
  assert.deepEqual(browsers.defaultOrder(), ["firefox", "chrome", "safari", "brave", "edge"]);
});
