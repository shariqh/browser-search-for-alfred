import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const c = require("../../workflow/lib/constants.js");

test("fixed identifiers", () => {
  assert.equal(c.BUNDLE_ID, "io.github.shariqh.browser-search-for-alfred");
  assert.equal(c.HOST_NAME, "io.github.shariqh.browser_search_for_alfred");
  assert.equal(c.ADDON_ID, "browser-search-for-alfred@shariqh.github.io");
  assert.equal(c.KEYWORD, "tab");
  assert.equal(c.FIREFOX_BUNDLE_ID, "org.mozilla.firefox");
  assert.equal(c.CHROME_BUNDLE_ID, "com.google.Chrome");
  assert.equal(c.FIREFOX_TIMEOUT_MS, 400);
});

test("HOST_NAME and ADDON_ID satisfy Firefox's rules", () => {
  assert.match(c.HOST_NAME, /^\w+(\.\w+)*$/);
  assert.match(c.ADDON_ID, /^[a-zA-Z0-9-._]*@[a-zA-Z0-9-._]+$/);
  assert.ok(c.ADDON_ID.length <= 80);
});

test("paths derive from HOME", () => {
  assert.equal(c.privateDir("/h"), "/h/Library/Caches/io.github.shariqh.browser-search-for-alfred/firefox");
  assert.equal(c.helperInstallPath("/h"), "/h/Library/Application Support/io.github.shariqh.browser-search-for-alfred/firefox-helper.js");
  assert.equal(c.registrationPath("/h"), "/h/Library/Application Support/Mozilla/NativeMessagingHosts/io.github.shariqh.browser_search_for_alfred.json");
});

test("notificationName adds the test channel only when given", () => {
  assert.equal(c.notificationName("request", ""), "io.github.shariqh.browser-search-for-alfred.request");
  assert.ok(c.notificationName("reply", "").endsWith(".reply"));
  assert.ok(c.notificationName("reply", "x1").endsWith(".reply.test.x1"));
});

test("Chrome's data folder, the history limits and Safari's bundle ID", () => {
  assert.equal(c.chromeDataDir("/h"), "/h/Library/Application Support/Google/Chrome");
  assert.equal(c.HISTORY_LIMIT, 50);
  assert.equal(c.SQLITE_TIMEOUT_MS, 400);
  assert.equal(c.SAFARI_BUNDLE_ID, "com.apple.Safari");
});
