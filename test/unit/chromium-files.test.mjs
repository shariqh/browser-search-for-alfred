import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const { profilesFromLocalState, bookmarksFromJson, historySql, chromeTimeToMs } = require("../../workflow/lib/chromium-files.js");

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "chrome");
const fixture = (name) => readFileSync(path.join(fixtures, name), "utf8");

const localState = (infoCache) => JSON.stringify({ profile: { info_cache: infoCache } });
const url = (name, href) => ({ type: "url", name, url: href, date_added: "13300000000000000" });
const folder = (name, children) => ({ type: "folder", name, children });

test("profiles: Default first, the rest sorted by folder, and the folder name when the name is empty", () => {
  const text = localState({
    "Profile 2": { name: "Two" },
    "Profile 10": { name: "" },
    Default: { name: "Person 1" },
    "Profile 1": {},
  });
  assert.deepEqual(profilesFromLocalState(text), [
    { dir: "Default", name: "Person 1" },
    { dir: "Profile 1", name: "Profile 1" },
    { dir: "Profile 10", name: "Profile 10" },
    { dir: "Profile 2", name: "Two" },
  ]);
});

test("profiles: the fixture's Local State gives Default and Profile 1", () => {
  assert.deepEqual(profilesFromLocalState(fixture("Local State")), [
    { dir: "Default", name: "Person 1" },
    { dir: "Profile 1", name: "Work" },
  ]);
});

test("profiles: null, invalid JSON or no info_cache give Default alone", () => {
  const fallback = [{ dir: "Default", name: "Default" }];
  assert.deepEqual(profilesFromLocalState(null), fallback);
  assert.deepEqual(profilesFromLocalState("{not json"), fallback);
  assert.deepEqual(profilesFromLocalState("null"), fallback);
  assert.deepEqual(profilesFromLocalState(JSON.stringify({ profile: {} })), fallback);
  assert.deepEqual(profilesFromLocalState(localState({})), fallback);
});

test("profiles: a cache without Default lists only the folders it names", () => {
  assert.deepEqual(profilesFromLocalState(localState({ "Profile 3": { name: "Three" } })), [{ dir: "Profile 3", name: "Three" }]);
});

test("bookmarks: bar, other and synced in that order, depth first, folders three levels deep included", () => {
  assert.deepEqual(bookmarksFromJson(fixture("Default/Bookmarks")), [
    { title: "Bar One", url: "https://bar.example.com/one" },
    { title: 'Deep "quoted" 😀', url: "https://deep.example.com/three" },
    { title: "Script", url: "javascript:alert(1)" },
    { title: "Other One", url: "https://other.example.com/" },
    { title: "Mobile One", url: "https://mobile.example.com/" },
  ]);
});

test("bookmarks: a missing synced root is skipped", () => {
  assert.deepEqual(bookmarksFromJson(fixture("Profile 1/Bookmarks")), [{ title: "Work Wiki", url: "https://wiki.example.com/" }]);
});

test("bookmarks: the root order is fixed whatever order the file lists them in", () => {
  const text = JSON.stringify({
    roots: {
      synced: folder("Mobile", [url("S", "https://s.example/")]),
      other: folder("Other", [url("O", "https://o.example/")]),
      bookmark_bar: folder("Bar", [folder("F", [url("B", "https://b.example/")])]),
    },
  });
  assert.deepEqual(bookmarksFromJson(text).map((b) => b.title), ["B", "O", "S"]);
});

test("bookmarks: folders and nodes without a string url are not items; a missing name is an empty title", () => {
  const text = JSON.stringify({
    roots: {
      bookmark_bar: folder("Bar", [
        { type: "url", url: "https://untitled.example/" },
        { type: "url", name: "No URL" },
        { type: "folder", name: "Empty folder" },
        { type: "folder", name: "Odd children", children: "x" },
        null,
      ]),
    },
  });
  assert.deepEqual(bookmarksFromJson(text), [{ title: "", url: "https://untitled.example/" }]);
});

test("bookmarks: invalid JSON or no roots give an empty list", () => {
  assert.deepEqual(bookmarksFromJson("{not json"), []);
  assert.deepEqual(bookmarksFromJson("null"), []);
  assert.deepEqual(bookmarksFromJson("{}"), []);
  assert.deepEqual(bookmarksFromJson(null), []);
});

test("historySql selects visible rows newest first with the LIKE clause and the limit", () => {
  assert.equal(
    historySql("", 50),
    "SELECT url, title, last_visit_time AS t FROM urls WHERE hidden = 0 AND 1 ORDER BY last_visit_time DESC LIMIT 50",
  );
  assert.equal(
    historySql("it's", 7),
    "SELECT url, title, last_visit_time AS t FROM urls WHERE hidden = 0 AND " +
      "(url LIKE '%it''s%' ESCAPE '\\' OR title LIKE '%it''s%' ESCAPE '\\') ORDER BY last_visit_time DESC LIMIT 7",
  );
});

test("chromeTimeToMs turns microseconds since 1601 into Unix milliseconds", () => {
  assert.equal(chromeTimeToMs(13300000000000000), 1655526400000);
  assert.equal(chromeTimeToMs("13300000000000000"), 1655526400000);
  assert.equal(chromeTimeToMs(11644473600000000), 0);
});
