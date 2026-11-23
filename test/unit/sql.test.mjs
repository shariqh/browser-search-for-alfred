import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { splitTerms, likeClause, immutableUri, readOnlyUri, sqliteArgs } = require("../../workflow/lib/sql.js");

test("splitTerms splits on any whitespace, drops empty strings and keeps the first 10", () => {
  assert.deepEqual(splitTerms("  a  b\tc\nd "), ["a", "b", "c", "d"]);
  assert.deepEqual(splitTerms(""), []);
  assert.deepEqual(splitTerms("   "), []);
  assert.deepEqual(splitTerms("1 2 3 4 5 6 7 8 9 10 11 12"), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
});

test("likeClause is 1 when there are no terms", () => {
  assert.equal(likeClause("", ["url", "title"]), "1");
  assert.equal(likeClause("  \t ", ["url", "title"]), "1");
});

test("likeClause builds one group per term, joined with AND", () => {
  assert.equal(
    likeClause("foo bar", ["url", "title"]),
    "(url LIKE '%foo%' ESCAPE '\\' OR title LIKE '%foo%' ESCAPE '\\') AND (url LIKE '%bar%' ESCAPE '\\' OR title LIKE '%bar%' ESCAPE '\\')",
  );
});

test("likeClause escapes %, _ and backslash with a backslash and doubles quotes", () => {
  assert.equal(
    likeClause("50% it's", ["url", "title"]),
    "(url LIKE '%50\\%%' ESCAPE '\\' OR title LIKE '%50\\%%' ESCAPE '\\') AND (url LIKE '%it''s%' ESCAPE '\\' OR title LIKE '%it''s%' ESCAPE '\\')",
  );
  assert.equal(likeClause("a_b", ["t"]), "(t LIKE '%a\\_b%' ESCAPE '\\')");
  assert.equal(likeClause("a\\b", ["t"]), "(t LIKE '%a\\\\b%' ESCAPE '\\')");
});

test("likeClause leaves double quotes and emoji alone, and an injection attempt stays inside the literals", () => {
  assert.equal(likeClause('say "hi"', ["t"]), "(t LIKE '%say%' ESCAPE '\\') AND (t LIKE '%\"hi\"%' ESCAPE '\\')");
  assert.equal(likeClause("😀", ["t"]), "(t LIKE '%😀%' ESCAPE '\\')");
  assert.equal(likeClause("x'; DROP TABLE urls;--", ["t"]), "(t LIKE '%x'';%' ESCAPE '\\') AND (t LIKE '%DROP%' ESCAPE '\\') AND (t LIKE '%TABLE%' ESCAPE '\\') AND (t LIKE '%urls;--%' ESCAPE '\\')");
});

test("likeClause uses at most 10 terms", () => {
  const clause = likeClause("1 2 3 4 5 6 7 8 9 10 11 12", ["t"]);
  assert.equal(clause.split(" AND ").length, 10);
  assert.equal(clause.includes("'%11%'"), false);
});

test("immutableUri percent-encodes each path part and keeps the slashes", () => {
  assert.equal(immutableUri("/a b/c#d?.db"), "file:/a%20b/c%23d%3F.db?immutable=1");
  assert.equal(immutableUri("/Users/x/History"), "file:/Users/x/History?immutable=1");
});

test("readOnlyUri percent-encodes each path part the same way and asks for mode=ro", () => {
  assert.equal(readOnlyUri("/a b/c#d?.db"), "file:/a%20b/c%23d%3F.db?mode=ro");
  assert.equal(readOnlyUri("/Users/x/Library/Safari/History.db"), "file:/Users/x/Library/Safari/History.db?mode=ro");
});

test("sqliteArgs starts sqlite3 with -init /dev/null, so the person's ~/.sqliterc never changes the output", () => {
  // sqlite3 finds ~/.sqliterc through the user database, not $HOME, so only -init keeps it out; a `.print` or
  // `.timer on` there would break the JSON.
  assert.deepEqual(sqliteArgs("file:/a%20b/H?immutable=1", "SELECT 1"), [
    "-init",
    "/dev/null",
    "-readonly",
    "-json",
    "file:/a%20b/H?immutable=1",
    "SELECT 1",
  ]);
});
