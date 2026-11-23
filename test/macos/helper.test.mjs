import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFakeFirefox, workflowDir, frame } from "./fake-firefox.mjs";

const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const driver = path.join(path.dirname(fileURLToPath(import.meta.url)), "client-driver.js");

const darwin = process.platform === "darwin";
let counter = 0;

function fixture() {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-helper-")));
  const channel = `t${process.pid}-${Date.now()}-${counter++}`;
  const privateDir = constants.privateDir(home);
  return { home, channel, privateDir };
}

// Always async: the same Node process plays Firefox, and a blocking call would stop it answering.
async function osascript(fx, args) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", driver, workflowDir, ...args], {
    env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel },
  });
  return stdout;
}

async function request(fx, command, params, timeoutMs = 3000) {
  const out = await osascript(fx, ["request", command, JSON.stringify(params), String(timeoutMs)]);
  return JSON.parse(out);
}

function listAll(dir, prefix = "") {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(prefix, entry.name);
    found.push(rel);
    if (entry.isDirectory()) found.push(...listAll(path.join(dir, entry.name), rel));
  }
  return found.sort();
}

async function withHelper(handler, body) {
  const fx = fixture();
  const firefox = startFakeFirefox({ home: fx.home, channel: fx.channel, handler });
  try {
    await firefox.ready(fx.privateDir);
    await body(fx, firefox);
  } finally {
    await firefox.stop();
  }
}

test("round trip: list-tabs returns the scripted payload", { skip: !darwin }, async () => {
  const payload = [{ id: 1, windowId: 2, title: "Example", url: "https://example.com/" }];
  await withHelper(
    (message, ff) => ff.send({ id: message.id, payload }),
    async (fx, ff) => {
      const { result } = await request(fx, "list-tabs", {});
      assert.deepEqual(result, { ok: true, payload });
      assert.equal(ff.received.length, 1);
      assert.equal(ff.received[0].command, "list-tabs");
      assert.match(ff.received[0].id, /^[A-Za-z0-9-]{1,64}$/);
    },
  );
});

test("2,000 tabs with non-ASCII titles arrive intact", { skip: !darwin }, async () => {
  const payload = Array.from({ length: 2000 }, (_, i) => ({
    id: i,
    windowId: 1,
    title: `${i} ✓ ünïcödé 日本 "q" \n`,
    url: `https://example.com/${i}?q=ü`,
  }));
  await withHelper(
    (message, ff) => ff.send({ id: message.id, payload }),
    async (fx) => {
      const { result } = await request(fx, "list-tabs", {}, 5000);
      assert.equal(result.ok, true);
      assert.deepEqual(result.payload, payload);
    },
  );
});

test("frames split across chunks and two frames in one chunk are both read", { skip: !darwin }, async () => {
  const waiting = [];
  await withHelper(
    (message, ff) => {
      if (message.command === "split") {
        const bytes = frame({ id: message.id, payload: { text: "split ✓ 日本" } });
        const third = Math.ceil(bytes.length / 3);
        const pieces = [bytes.subarray(0, 2), bytes.subarray(2, third + 3), bytes.subarray(third + 3)];
        pieces.forEach((piece, i) => setTimeout(() => ff.write(piece), i * 60));
      } else {
        // Hold the first one until the second arrives, then answer both in a single write.
        waiting.push(message);
        if (waiting.length === 2) {
          ff.write(Buffer.concat(waiting.map((m) => frame({ id: m.id, payload: m.command }))));
        }
      }
    },
    async (fx) => {
      const split = await request(fx, "split", {});
      assert.deepEqual(split.result, { ok: true, payload: { text: "split ✓ 日本" } });
      const [a, b] = await Promise.all([request(fx, "first", {}), request(fx, "second", {})]);
      assert.deepEqual(a.result, { ok: true, payload: "first" });
      assert.deepEqual(b.result, { ok: true, payload: "second" });
    },
  );
});

test("a parameter of 0 reaches Firefox as 0", { skip: !darwin }, async () => {
  await withHelper(
    (message, ff) => ff.send({ id: message.id, payload: null }),
    async (fx, ff) => {
      await request(fx, "close-tab", 0);
      assert.equal(ff.received.length, 1);
      assert.ok("params" in ff.received[0]);
      assert.strictEqual(ff.received[0].params, 0);
    },
  );
});

test("an error reply comes back as {ok:false, error}", { skip: !darwin }, async () => {
  await withHelper(
    (message, ff) => ff.send({ id: message.id, error: "no such tab" }),
    async (fx) => {
      const { result } = await request(fx, "activate-tab", { tabId: 9 });
      assert.deepEqual(result, { ok: false, error: "no such tab" });
    },
  );
});

test('no helper running: request returns {ok:false, error:"timeout"} within 600 ms', { skip: !darwin }, async () => {
  const fx = fixture();
  const { result, elapsedMs } = await request(fx, "list-tabs", {}, 400);
  assert.deepEqual(result, { ok: false, error: "timeout" });
  assert.ok(elapsedMs < 600, `took ${elapsedMs} ms`);
  // The client cleans up after itself.
  assert.deepEqual(readdirSync(fx.privateDir), []);
});

test('a request id with "../" is ignored and nothing is written outside the private folder', { skip: !darwin }, async () => {
  await withHelper(
    (message, ff) => ff.send({ id: message.id, payload: "ok" }),
    async (fx, ff) => {
      // A well-formed request file sits next to the private folder, where "../x" would point.
      const outside = path.join(path.dirname(fx.privateDir), "x.request.json");
      writeFileSync(outside, JSON.stringify({ id: "x", command: "list-tabs", params: {} }));
      const before = listAll(fx.home);
      await osascript(fx, ["post", constants.notificationName("request", fx.channel), "../x"]);
      await new Promise((resolve) => setTimeout(resolve, 400));
      assert.deepEqual(listAll(fx.home), before);
      assert.equal(existsSync(outside), true, "the file outside was neither read nor removed");
      assert.equal(ff.received.length, 0, "nothing was forwarded to Firefox");
      // The helper is still alive and serving.
      const { result } = await request(fx, "list-tabs", {});
      assert.deepEqual(result, { ok: true, payload: "ok" });
    },
  );
});

test("the helper exits 0 when stdin closes", { skip: !darwin }, async () => {
  const fx = fixture();
  const firefox = startFakeFirefox({ home: fx.home, channel: fx.channel, handler: () => {} });
  try {
    await firefox.ready(fx.privateDir);
    const started = Date.now();
    firefox.closeStdin();
    const outcome = await Promise.race([
      firefox.exited,
      new Promise((resolve) => setTimeout(() => resolve("still running"), 2000)),
    ]);
    assert.notEqual(outcome, "still running", "the helper did not exit within 2 s");
    assert.deepEqual(outcome, { code: 0, signal: null });
    assert.ok(Date.now() - started < 2000);
  } finally {
    await firefox.stop();
  }
});

test("the private folder is created with mode 700", { skip: !darwin }, async () => {
  await withHelper(
    () => {},
    async (fx) => {
      assert.equal(statSync(fx.privateDir).mode & 0o777, 0o700);
    },
  );
  // The client creates it the same way when the helper has not.
  const fx = fixture();
  await request(fx, "list-tabs", {}, 100);
  assert.equal(statSync(fx.privateDir).mode & 0o777, 0o700);
});
