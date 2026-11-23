import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { tabItem, setupItem, firefoxSilentItem, scriptFilterOutput } = require("../../workflow/lib/items.js");

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
