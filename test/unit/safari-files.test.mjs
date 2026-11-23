import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { bookmarksFromPlist, historySql, safariTimeToMs } = require("../../workflow/lib/safari-files.js");
const constants = require("../../workflow/lib/constants.js");
const { likeClause } = require("../../workflow/lib/sql.js");

// The shapes below are the ones Safari's importers in Chromium (safari_importer.mm) and Firefox
// (SafariProfileMigrator.sys.mjs) read from Bookmarks.plist.
const leaf = (title, url) => ({ WebBookmarkType: "WebBookmarkTypeLeaf", URLString: url, URIDictionary: { title } });
const list = (title, children, extra = {}) => ({ WebBookmarkType: "WebBookmarkTypeList", Title: title, Children: children, ...extra });

test("a leaf, a nested leaf and a Reading List leaf are bookmarks, in document order", () => {
  const root = list("", [
    list("BookmarksBar", [leaf("Bar page", "https://bar.example.com/"), list("Deep", [leaf("Nested", "https://nested.example.com/")])]),
    list("com.apple.ReadingList", [leaf("To read", "https://read.example.com/")]),
    leaf("Top level", "https://top.example.com/"),
  ]);
  assert.deepEqual(bookmarksFromPlist(root), [
    { title: "Bar page", url: "https://bar.example.com/" },
    { title: "Nested", url: "https://nested.example.com/" },
    { title: "To read", url: "https://read.example.com/" },
    { title: "Top level", url: "https://top.example.com/" },
  ]);
});

test("a folder with ShouldOmitFromUI is skipped with everything inside it", () => {
  const root = list("", [
    list("com.apple.WebKit.HistoryProxy", [leaf("Hidden", "https://hidden.example.com/")], { ShouldOmitFromUI: true }),
    list("Shown", [leaf("Visible", "https://visible.example.com/")], { ShouldOmitFromUI: false }),
  ]);
  assert.deepEqual(bookmarksFromPlist(root), [{ title: "Visible", url: "https://visible.example.com/" }]);
});

test("a leaf whose URLString is not a string is skipped, and a missing title is empty", () => {
  const root = list("", [
    { WebBookmarkType: "WebBookmarkTypeLeaf", URLString: 42, URIDictionary: { title: "Number" } },
    { WebBookmarkType: "WebBookmarkTypeLeaf", URIDictionary: { title: "No URL" } },
    { WebBookmarkType: "WebBookmarkTypeLeaf", URLString: "https://untitled.example.com/" },
  ]);
  assert.deepEqual(bookmarksFromPlist(root), [{ title: "", url: "https://untitled.example.com/" }]);
});

test("anything that is not a bookmarks tree gives an empty list", () => {
  for (const value of [null, undefined, "text", 7, [], {}, { Children: "no" }, { Children: [null, 3, "x"] }]) {
    assert.deepEqual(bookmarksFromPlist(value), []);
  }
});

test("historySql: one row per page with its latest visit of all, the words matched per visit against URL and title", () => {
  const where = likeClause("it's 50%", ["history_items.url", "history_visits.title"]);
  assert.equal(
    historySql("it's 50%", 50),
    "SELECT history_items.url AS url, history_visits.title AS title, MAX(history_visits.visit_time) AS t " +
      "FROM history_items JOIN history_visits ON history_visits.history_item = history_items.id " +
      "WHERE history_items.id IN (SELECT history_items.id FROM history_items " +
      `JOIN history_visits ON history_visits.history_item = history_items.id WHERE ${where}) ` +
      "GROUP BY history_items.id ORDER BY t DESC LIMIT 50",
  );
  assert.match(historySql("", constants.HISTORY_LIMIT), /WHERE 1\) GROUP BY/);
});

test("safariTimeToMs: seconds since 2001-01-01 UTC as Unix milliseconds", () => {
  assert.equal(safariTimeToMs(0), 978307200000);
  assert.equal(safariTimeToMs(1.5), 978307201500);
  assert.equal(safariTimeToMs("700000000.25"), 1678307200250);
});

test("the Safari file paths are under the person's Library", () => {
  assert.equal(constants.safariBookmarksPath("/Users/me"), "/Users/me/Library/Safari/Bookmarks.plist");
  assert.equal(constants.safariHistoryPath("/Users/me"), "/Users/me/Library/Safari/History.db");
});
