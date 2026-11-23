import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, cpSync, existsSync, writeFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { startFakeFirefox, workflowDir } from "./fake-firefox.mjs";

const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
let counter = 0;

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-tab-")));
  const home = path.join(root, "home dir");
  mkdirSync(home);
  return { home, channel: `f${process.pid}-${Date.now()}-${counter++}`, privateDir: constants.privateDir(home) };
}

// Always async: the same Node process plays Firefox, and a blocking call would stop it answering.
async function osascript(fx, script, arg, running = "1") {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", path.join(workflowDir, script), arg],
    { env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel, BSA_TEST_FIREFOX_RUNNING: running } },
  );
  return stdout;
}

async function tab(fx, running = "1") {
  const started = Date.now();
  const out = await osascript(fx, "tab.js", "", running);
  return { output: JSON.parse(out), elapsedMs: Date.now() - started };
}

const setup = (fx) => osascript(fx, "act.js", JSON.stringify({ action: "setup-firefox" }));

const tabs = [
  { id: 11, windowId: 1, index: 0, title: "First", url: "https://example.com/one", active: true },
  { id: 12, windowId: 1, index: 1, title: "", url: "https://example.org/two", active: false },
  { id: 13, windowId: 2, index: 0, title: 'Q "x" \n 😀 עברית', url: "https://example.net/3", active: true },
];

async function withFirefox(fx, handler, body) {
  const firefox = startFakeFirefox({ home: fx.home, channel: fx.channel, handler });
  try {
    await firefox.ready(fx.privateDir);
    await body(firefox);
  } finally {
    await firefox.stop();
  }
}

test("three Firefox tabs give three items in tab order", { skip: !darwin }, async () => {
  const fx = fixture();
  await setup(fx);
  await withFirefox(
    fx,
    (message, ff) => ff.send({ id: message.id, payload: tabs }),
    async (ff) => {
      const { output } = await tab(fx);
      assert.equal(output.skipknowledge, true);
      assert.deepEqual(
        output.items.map((item) => item.title),
        ["First", "example.org/two", 'Q "x" \n 😀 עברית'],
      );
      assert.deepEqual(
        output.items.map((item) => JSON.parse(item.arg)),
        tabs.map((t) => ({ action: "activate", browser: "firefox", windowId: t.windowId, tabId: t.id })),
      );
      assert.equal(output.items[0].subtitle, "Firefox · https://example.com/one");
      assert.equal(ff.received.length, 1);
      assert.equal(ff.received[0].command, "list-tabs");
    },
  );
});

test("no registration puts Set up Firefox first and sends no request", { skip: !darwin }, async () => {
  const fx = fixture();
  await withFirefox(
    fx,
    (message, ff) => ff.send({ id: message.id, payload: tabs }),
    async (ff) => {
      const { output } = await tab(fx);
      assert.equal(output.items.length, 1);
      assert.equal(output.items[0].title, "Set up Firefox");
      assert.deepEqual(JSON.parse(output.items[0].arg), { action: "setup-firefox" });
      assert.equal(ff.received.length, 0);
    },
  );
});

test("a stale helper copy puts Set up Firefox first", { skip: !darwin }, async () => {
  const fx = fixture();
  await setup(fx);
  appendFileSync(constants.helperInstallPath(fx.home), "\n");
  await withFirefox(
    fx,
    (message, ff) => ff.send({ id: message.id, payload: tabs }),
    async (ff) => {
      const { output } = await tab(fx);
      assert.equal(output.items[0].title, "Set up Firefox");
      assert.equal(output.items.length, 1);
      assert.equal(ff.received.length, 0);
    },
  );
});

test("Firefox running but no helper gives Firefox didn't answer within the budget", { skip: !darwin }, async () => {
  const fx = fixture();
  await setup(fx);
  const { output, elapsedMs } = await tab(fx);
  assert.equal(output.items.length, 1);
  assert.equal(output.items[0].title, "Firefox didn't answer");
  assert.equal(output.items[0].valid, false);
  assert.ok(elapsedMs < 1000, `took ${elapsedMs} ms`);
});

test("Firefox not running gives no Firefox items and writes no request file", { skip: !darwin }, async () => {
  const fx = fixture();
  await setup(fx);
  const { output } = await tab(fx, "0");
  assert.deepEqual(output, { skipknowledge: true, items: [] });
  assert.ok(!existsSync(path.join(fx.home, "Library/Caches")), "nothing is created in the cache folder");
});

test("act.js activate sends activate-tab with the given IDs and brings Firefox forward", { skip: !darwin }, async () => {
  const fx = fixture();
  await withFirefox(
    fx,
    (message, ff) => ff.send({ id: message.id, payload: null }),
    async (ff) => {
      const arg = JSON.stringify({ action: "activate", browser: "firefox", windowId: 2, tabId: 13 });
      const out = await osascript(fx, "act.js", arg);
      assert.equal(out, "");
      assert.equal(ff.received.length, 1);
      assert.equal(ff.received[0].command, "activate-tab");
      assert.deepEqual(ff.received[0].params, { tabId: 13, windowId: 2 });
      assert.equal(readFileSync(path.join(fx.home, "activated-apps.log"), "utf8"), "org.mozilla.firefox\n");
    },
  );
});

test("a payload that makes Firefox handling throw still prints one JSON document", { skip: !darwin }, async () => {
  const fx = fixture();
  await setup(fx);
  await withFirefox(
    fx,
    (message, ff) => ff.send({ id: message.id, payload: [null] }),
    async () => {
      const { output } = await tab(fx);
      assert.equal(output.skipknowledge, true);
      assert.equal(output.items.length, 1);
      assert.equal(output.items[0].title, "Firefox didn't answer");
      assert.equal(output.items[0].valid, false);
    },
  );
});

test("a broken library still prints one JSON error item without exception text", { skip: !darwin }, async () => {
  const fx = fixture();
  const copy = path.join(fx.home, "workflow copy");
  cpSync(workflowDir, copy, { recursive: true });
  writeFileSync(path.join(copy, "lib", "items.js"), "this is not ( valid javascript SECRET-MARKER");
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", path.join(copy, "tab.js"), ""], {
    env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel, BSA_TEST_FIREFOX_RUNNING: "1" },
  });
  const output = JSON.parse(stdout);
  assert.equal(output.skipknowledge, true);
  assert.equal(output.items.length, 1);
  assert.equal(output.items[0].title, "Browser Search hit an error");
  assert.equal(output.items[0].valid, false);
  assert.ok(!stdout.includes("SECRET-MARKER"));
});
