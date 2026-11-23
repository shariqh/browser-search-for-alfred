import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import { startFakeFirefox, workflowDir } from "./fake-firefox.mjs";

// Every browser file here lives under a temp HOME, and hist.js runs only with BSA_TEST_CHANNEL, so nothing reads
// real browser data.
const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const sql = require("../../workflow/lib/sql.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
const here = path.dirname(fileURLToPath(import.meta.url));
const chromeFixtures = path.join(here, "..", "fixtures", "chrome");
const SQLITE = "/usr/bin/sqlite3";
let counter = 0;

// Every visit is given in Unix milliseconds and stored in the browser's own time format.
const U = 1700000000000;
const chromeTime = (ms) => String((BigInt(ms) + 11644473600000n) * 1000n);
const safariTime = (ms) => String(ms / 1000 - 978307200);
const quote = (s) => `'${s.replace(/'/g, "''")}'`;

// rows = [{url, title, ms}]. Chromium's urls table (url_database.cc).
async function makeChromeHistory(fx, profile, rows) {
  const dir = path.join(fx.chromeDir, profile);
  mkdirSync(dir, { recursive: true });
  const inserts = rows
    .map((r) => `INSERT INTO urls(url, title, last_visit_time, hidden) VALUES (${quote(r.url)}, ${quote(r.title)}, ${chromeTime(r.ms)}, 0);`)
    .join("\n");
  await execFileAsync(SQLITE, [
    path.join(dir, "History"),
    "CREATE TABLE urls(id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, " +
      "typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL);\n" +
      inserts,
  ]);
}

// Safari's history_items and history_visits tables, one visit per page.
async function makeSafariHistory(fx, rows) {
  const inserts = rows
    .map(
      (r, i) =>
        `INSERT INTO history_items(id, url) VALUES (${i + 1}, ${quote(r.url)});\n` +
        `INSERT INTO history_visits(history_item, visit_time, title) VALUES (${i + 1}, ${safariTime(r.ms)}, ${quote(r.title)});`,
    )
    .join("\n");
  await execFileAsync(SQLITE, [
    constants.safariHistoryPath(fx.home),
    "CREATE TABLE history_items(id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE);\n" +
      "CREATE TABLE history_visits(id INTEGER PRIMARY KEY AUTOINCREMENT, history_item INTEGER NOT NULL, visit_time REAL NOT NULL, title TEXT);\n" +
      inserts,
  ]);
}

const chromeDefault = [
  { url: "https://chrome.example.com/its", title: "It's 50% off", ms: U + 1000 },
  { url: "https://chrome.example.com/50x", title: "50 its", ms: U + 5000 },
];
const chromeWork = [{ url: "https://work.example.com/", title: "Work page", ms: U + 3000 }];
const safari = [
  { url: "https://safari.example.com/sale", title: "Sale: it's 50% today", ms: U + 2000 },
  { url: "https://safari.example.com/x", title: "it s 50 percent", ms: U + 6000 },
];
const firefox = [
  { url: "https://firefox.example.com/q", title: "Quote it's 50% here", lastVisitTime: U + 4000 },
  { url: "https://firefox.example.com/r", title: "Recent", lastVisitTime: U + 7000 },
  { url: "place:sort=8", title: "Not a page", lastVisitTime: U + 8000 },
];

// A HOME with Chrome's two profiles (Local State from test/fixtures/chrome) and Safari's history.
async function fixture({ chrome = [chromeDefault, chromeWork], safariRows = safari } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-hist-")));
  const home = path.join(root, "home dir");
  mkdirSync(path.join(home, "Library", "Safari"), { recursive: true });
  const fx = {
    root,
    home,
    chromeDir: constants.chromeDataDir(home),
    channel: `h${process.pid}-${Date.now()}-${counter++}`,
    privateDir: constants.privateDir(home),
  };
  cpSync(chromeFixtures, fx.chromeDir, { recursive: true });
  await makeChromeHistory(fx, "Default", chrome[0]);
  await makeChromeHistory(fx, "Profile 1", chrome[1]);
  await makeSafariHistory(fx, safariRows);
  return fx;
}

// Always async: the same Node process plays Firefox, and a blocking call would stop it answering.
async function osascript(fx, script, arg, env = {}) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", path.join(workflowDir, script), arg], {
    env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel, BSA_TEST_FIREFOX_RUNNING: "1", ...env },
  });
  return stdout;
}

const setupFirefox = (fx) => osascript(fx, "act.js", JSON.stringify({ action: "setup-firefox" }));

async function hist(fx, query, env = {}) {
  const started = Date.now();
  const output = JSON.parse(await osascript(fx, "hist.js", query, env));
  return { output, elapsedMs: Date.now() - started };
}

// Plays Firefox's history.search: every word must be in the URL or the title, newest first, at most maxResults.
function searchingFirefox(entries) {
  return (message, ff) => {
    const words = message.params.query.toLowerCase().split(" ").filter(Boolean);
    const found = entries
      .filter((e) => words.every((w) => e.url.toLowerCase().includes(w) || e.title.toLowerCase().includes(w)))
      .sort((a, b) => b.lastVisitTime - a.lastVisitTime)
      .slice(0, message.params.maxResults);
    ff.send({ id: message.id, payload: found });
  };
}

async function withFirefox(fx, handler, body) {
  const ff = startFakeFirefox({ home: fx.home, channel: fx.channel, handler });
  try {
    await ff.ready(fx.privateDir);
    await body(ff);
  } finally {
    await ff.stop();
  }
}

const urls = (output) => output.items.map((item) => item.uid);
const ALLOW_CHROME = "Allow Alfred to read Google Chrome's bookmarks and history";
const ALLOW_SAFARI = "Allow Alfred to read Safari's bookmarks and history";

test("hist \"50% it's\" matches only the entry holding that text in each browser, newest first", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, searchingFirefox(firefox), async (ff) => {
    const { output } = await hist(fx, "50% it's");
    assert.deepEqual(Object.keys(output), ["items"]);
    assert.deepEqual(urls(output), ["https://firefox.example.com/q", "https://safari.example.com/sale", "https://chrome.example.com/its"]);
    assert.deepEqual(
      output.items.map((item) => item.subtitle),
      [
        "Firefox · https://firefox.example.com/q",
        "Safari · https://safari.example.com/sale",
        "Google Chrome (Person 1) · https://chrome.example.com/its",
      ],
    );
    assert.deepEqual(JSON.parse(output.items[2].arg), { action: "open", browser: "chrome", url: "https://chrome.example.com/its" });
    assert.equal(ff.received.length, 1);
    assert.equal(ff.received[0].command, "search-history");
    assert.deepEqual(ff.received[0].params, { query: "50% it's", maxResults: 50 });
  });
});

test("an empty query lists the most recent history, merged newest first across browsers", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, searchingFirefox(firefox), async (ff) => {
    const { output } = await hist(fx, "   ");
    assert.deepEqual(urls(output), [
      "https://firefox.example.com/r",
      "https://safari.example.com/x",
      "https://chrome.example.com/50x",
      "https://firefox.example.com/q",
      "https://work.example.com/",
      "https://safari.example.com/sale",
      "https://chrome.example.com/its",
    ]);
    assert.equal(output.items[4].subtitle, "Google Chrome (Work) · https://work.example.com/");
    assert.deepEqual(ff.received[0].params, { query: "", maxResults: 50 });
  });
});

test("each browser gives at most 50, Chrome's newest 50 across its profiles", { skip: !darwin }, async () => {
  const many = (prefix, offset) => Array.from({ length: 60 }, (_, i) => ({ url: `https://${prefix}.example.com/${i}`, title: `${prefix} ${i}`, ms: U + i * 10 + offset }));
  const work = many("work", 5);
  const personal = many("personal", 0);
  const fx = await fixture({ chrome: [personal, work], safariRows: many("safari", 3) });
  const firefoxMany = many("firefox", 7).map((r) => ({ url: r.url, title: r.title, lastVisitTime: r.ms }));
  await setupFirefox(fx);
  await withFirefox(fx, searchingFirefox(firefoxMany), async () => {
    const { output } = await hist(fx, "");
    const count = (name) => output.items.filter((item) => item.subtitle.startsWith(name)).length;
    assert.equal(count("Firefox"), 50);
    assert.equal(count("Safari"), 50);
    assert.equal(count("Google Chrome"), 50);
    const chromeNewest = personal
      .concat(work)
      .sort((a, b) => b.ms - a.ms)
      .slice(0, 50)
      .map((r) => r.url);
    assert.deepEqual(
      output.items.filter((item) => item.subtitle.startsWith("Google Chrome")).map((item) => item.uid),
      chromeNewest,
    );
    // Newest first overall: the URL's index carries the time order within each browser, and the offsets between them.
    const all = [...firefoxMany.map((r) => ({ url: r.url, ms: r.lastVisitTime })), ...many("safari", 3), ...personal, ...work];
    const timeOf = new Map(all.map((r) => [r.url, r.ms]));
    const times = output.items.map((item) => timeOf.get(item.uid));
    assert.deepEqual(times, times.slice().sort((a, b) => b - a));
  });
});

test("Firefox's query is cut to 512 characters", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, searchingFirefox(firefox), async (ff) => {
    await hist(fx, "a".repeat(600));
    assert.equal(ff.received.length, 1);
    assert.equal(ff.received[0].params.query, "a".repeat(512));
  });
});

test("a Firefox that never answers still leaves Chrome's and Safari's history within 1 second", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, () => {}, async () => {
    const { output, elapsedMs } = await hist(fx, "");
    assert.equal(output.items[0].title, "Firefox didn't answer");
    assert.deepEqual(urls(output).slice(1), [
      "https://safari.example.com/x",
      "https://chrome.example.com/50x",
      "https://work.example.com/",
      "https://safari.example.com/sale",
      "https://chrome.example.com/its",
    ]);
    assert.ok(elapsedMs < 1000, `took ${elapsedMs} ms`);
  });
});

test("denied Chrome and Safari history give their Allow items first, and Firefox's history still shows", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  const chromeHistory = path.join(fx.chromeDir, "Profile 1", "History");
  const safariHistory = constants.safariHistoryPath(fx.home);
  chmodSync(chromeHistory, 0o000);
  chmodSync(safariHistory, 0o000);
  try {
    await withFirefox(fx, searchingFirefox(firefox), async () => {
      const { output } = await hist(fx, "");
      assert.deepEqual(
        output.items.map((item) => item.title),
        [ALLOW_CHROME, ALLOW_SAFARI, "Recent", "Quote it's 50% here"],
      );
      assert.deepEqual(JSON.parse(output.items[0].arg), { action: "open-privacy" });
    });
  } finally {
    chmodSync(chromeHistory, 0o600);
    chmodSync(safariHistory, 0o600);
  }
});

test("Firefox not set up puts its setup item first; unticked browsers are not read", { skip: !darwin }, async () => {
  const fx = await fixture();
  const { output } = await hist(fx, "", { browser_chrome: "0" });
  assert.equal(output.items[0].title, "Set up Firefox");
  assert.deepEqual(urls(output).slice(1), ["https://safari.example.com/x", "https://safari.example.com/sale"]);
});

// A background /usr/bin/sqlite3 on `db` that runs `statements` and keeps its connection open until release().
// `ready` resolves once the statements have run. Nothing here can hang: the holder is killed after 10 s.
function holdOpen(db, statements) {
  const holder = spawn(SQLITE, ["-init", "/dev/null", "-batch", db], { stdio: ["pipe", "pipe", "pipe"] });
  const exited = new Promise((resolve) => holder.on("exit", resolve));
  const killer = setTimeout(() => holder.kill("SIGKILL"), 10000);
  let output = "";
  holder.stderr.on("data", (chunk) => (output += chunk));
  const ready = new Promise((resolve, reject) => {
    holder.stdout.on("data", (chunk) => {
      output += chunk;
      if (/^ready$/m.test(output)) resolve();
    });
    holder.on("exit", () => reject(new Error(`holder exited early: ${output}`)));
  });
  holder.stdin.write(`${statements}\nSELECT 'ready';\n`);
  const release = async () => {
    holder.stdin.end();
    await exited;
    clearTimeout(killer);
  };
  return { ready, release };
}

// Reads `sqlQuery` from `uri` the way a one-off sqlite3 would, giving its rows or its error text.
async function readUri(uri, sqlQuery) {
  try {
    const { stdout } = await execFileAsync(SQLITE, sql.sqliteArgs(uri, sqlQuery));
    return { rows: stdout.trim() === "" ? [] : JSON.parse(stdout) };
  } catch (e) {
    return { error: e.stderr };
  }
}

// Safari keeps History.db open in WAL mode; a visit it just wrote may still be in History.db-wal.
test("Safari's newest visit, still in the write-ahead log of an open History.db, is found", { skip: !darwin }, async () => {
  const fx = await fixture();
  const db = constants.safariHistoryPath(fx.home);
  const newest = { url: "https://safari.example.com/newest", title: "Newest", ms: U + 9000 };
  const writer = holdOpen(
    db,
    "PRAGMA journal_mode=WAL;\nPRAGMA wal_autocheckpoint=0;\n" +
      `INSERT INTO history_items(id, url) VALUES (99, ${quote(newest.url)});\n` +
      `INSERT INTO history_visits(history_item, visit_time, title) VALUES (99, ${safariTime(newest.ms)}, ${quote(newest.title)});`,
  );
  try {
    await writer.ready;
    // The visit is only in the WAL, which an immutable read does not see.
    assert.ok(statSync(`${db}-wal`).size > 0);
    assert.deepEqual(await readUri(sql.immutableUri(db), "SELECT url FROM history_items WHERE id = 99"), { rows: [] });
    const { output } = await hist(fx, "", { browser_chrome: "0" });
    assert.equal(output.items[0].title, "Set up Firefox");
    assert.deepEqual(urls(output).slice(1), [newest.url, "https://safari.example.com/x", "https://safari.example.com/sale"]);
  } finally {
    await writer.release();
  }
});

test("when an exclusive lock stops the read-only read of Safari's history, the immutable read still gives it", { skip: !darwin }, async () => {
  const fx = await fixture();
  const db = constants.safariHistoryPath(fx.home);
  const locker = holdOpen(db, "PRAGMA journal_mode=DELETE;\nPRAGMA locking_mode=EXCLUSIVE;\nBEGIN EXCLUSIVE;");
  try {
    await locker.ready;
    const plain = await readUri(sql.readOnlyUri(db), "SELECT url FROM history_items");
    assert.match(plain.error || "", /database is locked/);
    const { output } = await hist(fx, "", { browser_chrome: "0" });
    assert.deepEqual(
      output.items.map((item) => item.title),
      ["Set up Firefox", "it s 50 percent", "Sale: it's 50% today"],
    );
  } finally {
    await locker.release();
  }
});
