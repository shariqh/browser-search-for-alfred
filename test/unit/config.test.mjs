import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { enabledBrowsers } = require("../../workflow/lib/config.js");

test("an empty or missing value means every browser is on", () => {
  assert.deepEqual(enabledBrowsers(() => ""), { firefox: true, chrome: true, safari: true, brave: true, edge: true });
});

test('"0" turns only that browser off', () => {
  const env = { browser_chrome: "0" };
  assert.deepEqual(enabledBrowsers((name) => env[name] ?? ""), { firefox: true, chrome: false, safari: true, brave: true, edge: true });
});

test('"1" is on, and each checkbox is read from its own variable', () => {
  const env = { browser_firefox: "0", browser_chrome: "1", browser_safari: "0" };
  assert.deepEqual(enabledBrowsers((name) => env[name] ?? ""), { firefox: false, chrome: true, safari: false, brave: true, edge: true });
});

test("any value other than 0 counts as on", () => {
  assert.deepEqual(enabledBrowsers(() => "yes"), { firefox: true, chrome: true, safari: true, brave: true, edge: true });
});

test('"0" turns Brave and Edge off, each from its own variable', () => {
  const env = { browser_brave: "0" };
  assert.deepEqual(enabledBrowsers((name) => env[name] ?? ""), { firefox: true, chrome: true, safari: true, brave: false, edge: true });
  const env2 = { browser_edge: "0" };
  assert.deepEqual(enabledBrowsers((name) => env2[name] ?? ""), { firefox: true, chrome: true, safari: true, brave: true, edge: false });
});
