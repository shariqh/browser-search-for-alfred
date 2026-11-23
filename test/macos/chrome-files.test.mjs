import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, statSync, lutimesSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";

// Every file here lives under a temp HOME whose path holds a space and a `#`; nothing reads the real ~/Library.
const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
const here = path.dirname(fileURLToPath(import.meta.url));
const workflowDir = path.join(here, "..", "..", "workflow");
const driver = path.join(here, "chrome-files-driver.js");
const chromeFixtures = path.join(here, "..", "fixtures", "chrome");
const SQLITE = "/usr/bin/sqlite3";

function fixture({ chrome = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-chrome-files-")));
  const home = path.join(root, "home dir #1");
  mkdirSync(home);
  const dataDir = constants.chromeDataDir(home);
  if (chrome) cpSync(chromeFixtures, dataDir, { recursive: true });
  return { root, home, dataDir, sqliteDir: path.join(home, "Library", "Caches", constants.BUNDLE_ID, "sqlite") };
}

async function drive(fx, args) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", driver, workflowDir, ...args], {
    env: { ...process.env, HOME: fx.home },
  });
  return JSON.parse(stdout);
}

// Chrome times are microseconds since 1601; these are a few days in 2022, newest last here.
const T = 13300000000000000;
const visits = [
  { url: "https://old.example.com/", title: "Old page", t: T, hidden: 0 },
  { url: "https://hidden.example.com/", title: "Hidden redirect", t: T + 3_000_000, hidden: 1 },
  { url: "https://quote.example.com/it's", title: "It's 50% off_now", t: T + 2_000_000, hidden: 0 },
  { url: "https://new.example.com/", title: 'Newest "page" 😀', t: T + 4_000_000, hidden: 0 },
];

// A History file with Chromium's urls table (url_database.cc).
async function makeHistory(fx, profile = "Default") {
  const dir = path.join(fx.dataDir, profile);
  mkdirSync(dir, { recursive: true });
  const db = path.join(dir, "History");
  const quote = (s) => `'${s.replace(/'/g, "''")}'`;
  const inserts = visits
    .map((v) => `INSERT INTO urls(url, title, last_visit_time, hidden) VALUES (${quote(v.url)}, ${quote(v.title)}, ${v.t}, ${v.hidden});`)
    .join("\n");
  await execFileAsync(SQLITE, [
    db,
    "CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, " +
      "typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);\n" +
      inserts,
  ]);
  return db;
}

const visible = visits.filter((v) => v.hidden === 0).sort((a, b) => b.t - a.t).map(({ url, title, t }) => ({ url, title, t }));

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== "ESRCH";
  }
}

test("both profiles' bookmarks are read from a HOME whose path has a space and a #", { skip: !darwin }, async () => {
  const fx = fixture();
  assert.match(fx.home, / .*#/);
  const out = await drive(fx, ["bookmarks"]);
  assert.deepEqual(out.profiles, [
    { dir: "Default", name: "Person 1" },
    { dir: "Profile 1", name: "Work" },
  ]);
  assert.deepEqual(out.reads, { Default: "ok", "Profile 1": "ok" });
  assert.equal(out.bookmarks.Default.length, 5);
  assert.deepEqual(out.bookmarks.Default[1], { title: 'Deep "quoted" 😀', url: "https://deep.example.com/three" });
  assert.deepEqual(out.bookmarks["Profile 1"], [{ title: "Work Wiki", url: "https://wiki.example.com/" }]);
});

test("readFileResult: text when readable, denied for a chmod-000 file, missing for no file", { skip: !darwin }, async () => {
  const fx = fixture();
  const file = path.join(fx.dataDir, "Default", "Bookmarks");
  assert.deepEqual(await drive(fx, ["read", file]), { ok: true, text: readFileSync(file, "utf8") });
  chmodSync(file, 0o000);
  try {
    assert.deepEqual(await drive(fx, ["read", file]), { ok: false, reason: "denied" });
  } finally {
    chmodSync(file, 0o600);
  }
  assert.deepEqual(await drive(fx, ["read", path.join(fx.dataDir, "Profile 9", "Bookmarks")]), { ok: false, reason: "missing" });
});

test("a denied Bookmarks file in one profile leaves the other profile's bookmarks", { skip: !darwin }, async () => {
  const fx = fixture();
  const file = path.join(fx.dataDir, "Default", "Bookmarks");
  chmodSync(file, 0o000);
  try {
    const out = await drive(fx, ["bookmarks"]);
    assert.deepEqual(out.reads, { Default: "denied", "Profile 1": "ok" });
    assert.deepEqual(out.bookmarks["Profile 1"], [{ title: "Work Wiki", url: "https://wiki.example.com/" }]);
  } finally {
    chmodSync(file, 0o600);
  }
});

test("invalid JSON in one profile's Bookmarks leaves the other profile's bookmarks", { skip: !darwin }, async () => {
  const fx = fixture();
  writeFileSync(path.join(fx.dataDir, "Profile 1", "Bookmarks"), '{"roots": {"bookmark_bar": ');
  const out = await drive(fx, ["bookmarks"]);
  assert.deepEqual(out.bookmarks["Profile 1"], []);
  assert.equal(out.bookmarks.Default.length, 5);
});

test("with no Local State the Default profile is still read", { skip: !darwin }, async () => {
  const fx = fixture();
  renameSync(path.join(fx.dataDir, "Local State"), path.join(fx.root, "Local State.moved"));
  const out = await drive(fx, ["bookmarks"]);
  assert.deepEqual(out.profiles, [{ dir: "Default", name: "Default" }]);
  assert.equal(out.bookmarks.Default.length, 5);
});

test("history rows come back newest first without hidden rows, through a private output file that is removed", { skip: !darwin }, async () => {
  const fx = fixture();
  const db = await makeHistory(fx);
  const out = await drive(fx, ["history", db, "", String(constants.SQLITE_TIMEOUT_MS * 5)]);
  assert.deepEqual(out.result, { ok: true, rows: visible });
  assert.equal(out.during.length, 1);
  assert.equal(out.during[0].mode, 0o600);
  assert.equal(out.dirMode.mode, 0o700);
  assert.equal(statSync(fx.sqliteDir).mode & 0o777, 0o700);
  assert.deepEqual(out.after, []);
});

test("history words match literally, and no match gives an empty list", { skip: !darwin }, async () => {
  const fx = fixture();
  const db = await makeHistory(fx);
  const quoted = await drive(fx, ["history", db, "it's 50% off_", "2000"]);
  assert.deepEqual(quoted.result, { ok: true, rows: [visible[1]] });
  const none = await drive(fx, ["history", db, "50_ nothing-here", "2000"]);
  assert.deepEqual(none.result, { ok: true, rows: [] });
  assert.deepEqual(none.after, []);
});

test("a missing History or bad SQL is an error, and the output file is still removed", { skip: !darwin }, async () => {
  const fx = fixture();
  const missing = await drive(fx, ["history", path.join(fx.dataDir, "Profile 1", "History"), "", "2000"]);
  assert.deepEqual(missing.result, { ok: false, reason: "error" });
  assert.deepEqual(missing.after, []);
  const db = await makeHistory(fx);
  const bad = await drive(fx, ["sql", db, "SELECT nope FROM nowhere", "2000"]);
  assert.deepEqual(bad.result, { ok: false, reason: "error" });
  assert.deepEqual(bad.after, []);
});

test("start removes output files older than 60 seconds left by a killed run, and leaves younger ones", { skip: !darwin }, async () => {
  const fx = fixture();
  const db = await makeHistory(fx);
  mkdirSync(fx.sqliteDir, { recursive: true, mode: 0o700 });
  const old = path.join(fx.sqliteDir, "1-1-0-old.json");
  const fresh = path.join(fx.sqliteDir, "2-2-0-fresh.json");
  writeFileSync(old, '[{"url":"https://left.example/"}]', { mode: 0o600 });
  writeFileSync(fresh, "", { mode: 0o600 });
  // An old file outside the folder, and an old link to it inside: only regular files are swept, never followed.
  const outside = path.join(fx.root, "outside.json");
  const link = path.join(fx.sqliteDir, "3-3-0-link.json");
  writeFileSync(outside, "keep");
  symlinkSync(outside, link);
  const past = new Date(Date.now() - 120_000);
  for (const file of [old, outside]) utimesSync(file, past, past);
  lutimesSync(link, past, past);
  const out = await drive(fx, ["history", db, "", "2000"]);
  assert.deepEqual(out.result, { ok: true, rows: visible });
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(readFileSync(outside, "utf8"), "keep");
  assert.equal(lstatSync(link).isSymbolicLink(), true);
  assert.deepEqual(out.after.map((f) => f.name).sort(), ["2-2-0-fresh.json", "3-3-0-link.json"]);
});

// Review Focus 2: Chrome holds an exclusive lock on History while it runs.
test("an exclusive lock on History stops a plain read but not the immutable one", { skip: !darwin }, async () => {
  const fx = fixture();
  const db = await makeHistory(fx);
  const holder = spawn(SQLITE, [db], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((resolve) => holder.on("exit", resolve));
  try {
    let output = "";
    const locked = new Promise((resolve, reject) => {
      holder.stdout.on("data", (chunk) => {
        output += chunk;
        if (/^1$/m.test(output)) resolve();
      });
      holder.on("exit", () => reject(new Error(`lock holder exited early: ${output}`)));
    });
    holder.stdin.write("PRAGMA journal_mode=DELETE;\nPRAGMA locking_mode=EXCLUSIVE;\nBEGIN EXCLUSIVE;\nSELECT 1;\n");
    await locked;
    await assert.rejects(execFileAsync(SQLITE, ["-readonly", "-json", db, "SELECT url FROM urls"]), (e) => {
      assert.match(e.stderr, /database is locked/);
      return true;
    });
    const out = await drive(fx, ["history", db, "", "2000"]);
    assert.deepEqual(out.result, { ok: true, rows: visible });
  } finally {
    holder.stdin.end();
    await exited;
  }
});

test("sqlite3 that outlives its deadline is terminated, gives timeout, and its output file is removed", { skip: !darwin }, async () => {
  const fx = fixture();
  const db = await makeHistory(fx);
  const slow = "WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 5000000000) SELECT count(*) FROM c";
  const out = await drive(fx, ["sql", db, slow, "300"]);
  assert.deepEqual(out.result, { ok: false, reason: "timeout" });
  assert.ok(out.elapsedMs < 1500, `took ${out.elapsedMs} ms`);
  assert.deepEqual(out.after, []);
  assert.equal(alive(out.pid), false);
});

test("startProcess/finishProcess: stdout to a private file, exit status, and termination at the deadline", { skip: !darwin }, async () => {
  const fx = fixture({ chrome: false });
  const outFile = path.join(fx.root, "echo out.txt");
  const echo = await drive(fx, ["process", "2000", outFile, "/bin/echo", "hello", "two words"]);
  assert.deepEqual(echo.result, { exited: true, status: 0 });
  assert.equal(readFileSync(outFile, "utf8"), "hello two words\n");
  assert.equal(statSync(outFile).mode & 0o777, 0o600);

  assert.deepEqual((await drive(fx, ["process", "2000", "", "/usr/bin/false"])).result, { exited: true, status: 1 });
  assert.deepEqual((await drive(fx, ["process", "2000", "", "/nonexistent/tool"])).result, { exited: true, status: null });

  const sleeper = await drive(fx, ["process", "200", "", "/bin/sleep", "30"]);
  assert.deepEqual(sleeper.result, { exited: false, status: null });
  assert.ok(sleeper.elapsedMs < 1500, `took ${sleeper.elapsedMs} ms`);
  assert.equal(alive(sleeper.pid), false);

  // A process that ignores SIGTERM is killed. Perl is only the test's stand-in for a stubborn process.
  const stubborn = await drive(fx, ["process", "200", "", "/usr/bin/perl", "-e", '$SIG{TERM} = "IGNORE"; sleep 30']);
  assert.deepEqual(stubborn.result, { exited: false, status: null });
  assert.ok(stubborn.elapsedMs < 1500, `took ${stubborn.elapsedMs} ms`);
  assert.equal(alive(stubborn.pid), false);
});
