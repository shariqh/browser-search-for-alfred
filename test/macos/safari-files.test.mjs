import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

// Every file here lives under a temp HOME whose path holds a space and a `#`; nothing reads the real ~/Library/Safari.
const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
const here = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.join(here, "..", "..", "workflow");
const driver = path.join(here, "files-driver.js");
const SQLITE = "/usr/bin/sqlite3";

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-safari-files-")));
  const home = path.join(root, "home dir #1");
  mkdirSync(path.join(home, "Library", "Safari"), { recursive: true });
  return { root, home, bookmarks: constants.safariBookmarksPath(home), history: constants.safariHistoryPath(home) };
}

async function drive(fx, args) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", driver, workflowDir, ...args], {
    env: { ...process.env, HOME: fx.home },
  });
  return JSON.parse(stdout);
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const str = (s) => `<string>${esc(s)}</string>`;
const leaf = (title, url) =>
  `<dict><key>URIDictionary</key><dict><key>title</key>${str(title)}</dict><key>URLString</key>${str(url)}` +
  `<key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string><key>ReadingListNonSync</key><dict><key>Data</key><data>AQID</data>` +
  `<key>Added</key><date>2022-01-02T03:04:05Z</date></dict></dict>`;
const list = (title, children, omit = false) =>
  `<dict><key>Title</key>${str(title)}<key>WebBookmarkType</key><string>WebBookmarkTypeList</string>` +
  (omit ? "<key>ShouldOmitFromUI</key><true/>" : "") +
  `<key>Children</key><array>${children.join("")}</array></dict>`;

// Safari's Bookmarks.plist is a binary plist with data and date values in it: write it as XML and convert it.
async function makeBookmarks(fx) {
  const root = list("", [
    list("BookmarksBar", [leaf('Bar "quoted" 😀', "https://bar.example.com/a b"), list("Deep", [leaf("Nested <b>", "https://nested.example.com/")])]),
    list("BookmarksMenu", []),
    list("com.apple.ReadingList", [leaf("To read", "https://read.example.com/")]),
    list("com.apple.WebKit.HistoryProxy", [leaf("Hidden", "https://hidden.example.com/")], true),
  ]);
  const xml = path.join(fx.root, "Bookmarks.xml");
  writeFileSync(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${root}</plist>\n`,
  );
  await execFileAsync("/usr/bin/plutil", ["-convert", "binary1", xml, "-o", fx.bookmarks]);
}

const bookmarks = [
  { title: 'Bar "quoted" 😀', url: "https://bar.example.com/a b" },
  { title: "Nested <b>", url: "https://nested.example.com/" },
  { title: "To read", url: "https://read.example.com/" },
];

// Safari times are seconds since 2001-01-01 UTC.
const T = 700000000;
async function makeHistory(fx) {
  await execFileAsync(SQLITE, [
    fx.history,
    "CREATE TABLE history_items(id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE);\n" +
      "CREATE TABLE history_visits(id INTEGER PRIMARY KEY AUTOINCREMENT, history_item INTEGER NOT NULL, visit_time REAL NOT NULL, title TEXT);\n" +
      "INSERT INTO history_items(id, url) VALUES (1, 'https://page.example.com/'), (2, 'https://quote.example.com/it''s'), (3, 'https://other.example.com/');\n" +
      `INSERT INTO history_visits(history_item, visit_time, title) VALUES
        (1, ${T}, 'Page, first title'), (1, ${T + 20}, 'Page, latest title'), (1, ${T + 10}, 'Page, middle title'),
        (2, ${T + 5}, 'It''s 50% off_now 😀'),
        (3, ${T + 30}, 'Other "page"');`,
  ]);
}

const newestFirst = [
  { url: "https://other.example.com/", title: 'Other "page"', t: T + 30 },
  { url: "https://page.example.com/", title: "Page, latest title", t: T + 20 },
  { url: "https://quote.example.com/it's", title: "It's 50% off_now 😀", t: T + 5 },
];

test("a binary Bookmarks.plist with data and date values is read back, in a HOME with a space and a #", { skip: !darwin }, async () => {
  const fx = fixture();
  assert.match(fx.home, / .*#/);
  await makeBookmarks(fx);
  const out = await drive(fx, ["plist", fx.bookmarks]);
  assert.equal(out.result.ok, true);
  assert.deepEqual(out.bookmarks, bookmarks);
});

test("readPlistResult: denied for a chmod-000 file, missing for no file, error for a file that is not a plist", { skip: !darwin }, async () => {
  const fx = fixture();
  await makeBookmarks(fx);
  chmodSync(fx.bookmarks, 0o000);
  try {
    assert.deepEqual((await drive(fx, ["plist", fx.bookmarks])).result, { ok: false, reason: "denied" });
  } finally {
    chmodSync(fx.bookmarks, 0o600);
  }
  assert.deepEqual((await drive(fx, ["plist", path.join(fx.home, "Library", "Safari", "Nope.plist")])).result, { ok: false, reason: "missing" });
  const junk = path.join(fx.root, "junk.plist");
  writeFileSync(junk, "this is not a plist");
  assert.deepEqual((await drive(fx, ["plist", junk])).result, { ok: false, reason: "error" });
});

test("accessResult: ok for a readable file, denied for a chmod-000 file, missing for no file", { skip: !darwin }, async () => {
  const fx = fixture();
  await makeHistory(fx);
  assert.equal(await drive(fx, ["access", fx.history]), "ok");
  chmodSync(fx.history, 0o000);
  try {
    assert.equal(await drive(fx, ["access", fx.history]), "denied");
  } finally {
    chmodSync(fx.history, 0o600);
  }
  assert.equal(await drive(fx, ["access", path.join(fx.home, "Library", "Safari", "Nope.db")]), "missing");
});

test("history: one row per page with its latest visit's title and time, newest first", { skip: !darwin }, async () => {
  const fx = fixture();
  await makeHistory(fx);
  const out = await drive(fx, ["safari-history", fx.history, "", "2000"]);
  assert.deepEqual(out.result, { ok: true, rows: newestFirst });
  assert.deepEqual(out.after, []);
});

test("history words match the URL or the title literally, every word required", { skip: !darwin }, async () => {
  const fx = fixture();
  await makeHistory(fx);
  const quoted = await drive(fx, ["safari-history", fx.history, "it's 50% off_", "2000"]);
  assert.deepEqual(quoted.result, { ok: true, rows: [newestFirst[2]] });
  const byUrl = await drive(fx, ["safari-history", fx.history, "page.example latest", "2000"]);
  assert.deepEqual(byUrl.result, { ok: true, rows: [newestFirst[1]] });
  const none = await drive(fx, ["safari-history", fx.history, "50_ nothing-here", "2000"]);
  assert.deepEqual(none.result, { ok: true, rows: [] });
});
