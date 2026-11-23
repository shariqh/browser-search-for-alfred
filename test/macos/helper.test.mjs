import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readdirSync, statSync, writeFileSync, utimesSync, chmodSync, existsSync, realpathSync } from "node:fs";
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

async function split(fx, command, params, timeoutMs, delayMs) {
  const out = await osascript(fx, ["split", command, JSON.stringify(params), String(timeoutMs), String(delayMs)]);
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

async function withHelper(handler, body, env = {}) {
  const fx = fixture();
  const firefox = startFakeFirefox({ home: fx.home, channel: fx.channel, handler, env });
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
      assert.deepEqual(readdirSync(fx.privateDir), [], "no request or reply file is left behind");
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
      assert.deepEqual(readdirSync(fx.privateDir), [], "no request or reply file is left behind");
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

test("a reply that arrives after the client timed out is swept and leaves nothing behind", { skip: !darwin }, async () => {
  await withHelper(
    (message, ff) => {
      // "late" is answered after the client has given up; anything else is answered at once.
      if (message.command === "late") setTimeout(() => ff.send({ id: message.id, payload: "x".repeat(1000) }), 700);
      else ff.send({ id: message.id, payload: "ok" });
    },
    async (fx) => {
      const { result } = await request(fx, "late", {}, 200);
      assert.deepEqual(result, { ok: false, error: "timeout" });
      assert.deepEqual(readdirSync(fx.privateDir), [], "the client cleaned up its own files");
      // The add-on answers anyway: the helper writes a reply file that nobody will read.
      const deadline = Date.now() + 3000;
      while (readdirSync(fx.privateDir).length === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal(readdirSync(fx.privateDir).length, 1, "the late reply file exists");
      // Once it is older than the (shortened) stale age, the next request sweeps it away.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const next = await request(fx, "list-tabs", {});
      assert.deepEqual(next.result, { ok: true, payload: "ok" });
      assert.deepEqual(readdirSync(fx.privateDir), [], "the late reply was swept");
    },
    { BSA_TEST_STALE_MS: "200" },
  );
});

test("the helper sweeps old files left by a killed client when it starts", { skip: !darwin }, async () => {
  const fx = fixture();
  mkdirSync(fx.privateDir, { recursive: true, mode: 0o700 });
  const old = new Date(Date.now() - 5 * 60 * 1000);
  const stale = ["111-1-aaa.request.json", "111-1-aaa.reply.json"].map((name) => path.join(fx.privateDir, name));
  const other = path.join(fx.privateDir, "notes.txt");
  for (const file of [...stale, other]) {
    writeFileSync(file, "{}");
    utimesSync(file, old, old);
  }
  const firefox = startFakeFirefox({ home: fx.home, channel: fx.channel, handler: () => {} });
  try {
    await firefox.ready(fx.privateDir);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(readdirSync(fx.privateDir), ["notes.txt"], "only its own kind of old file is swept");
  } finally {
    await firefox.stop();
  }
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

// Busy-polls from this process while a child creates the folder, and returns the mode seen the first
// time the folder exists. The child runs on its own, so blocking this thread does not slow it down.
function firstSeenMode(dir, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return statSync(dir).mode & 0o777;
    } catch (e) {
      // not there yet
    }
  }
  return null;
}

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

test("the private folder is never visible with another mode, from the helper or the client", { skip: !darwin }, async () => {
  const helperFx = fixture();
  const firefox = startFakeFirefox({ home: helperFx.home, channel: helperFx.channel, handler: () => {} });
  try {
    assert.equal(firstSeenMode(helperFx.privateDir), 0o700, "helper: mode when first visible");
  } finally {
    await firefox.stop();
  }
  const clientFx = fixture();
  const pending = request(clientFx, "list-tabs", {}, 300);
  assert.equal(firstSeenMode(clientFx.privateDir), 0o700, "client: mode when first visible");
  await pending;
});

test("a private folder that already exists with another mode is made 700 before the helper is ready", { skip: !darwin }, async () => {
  const fx = fixture();
  mkdirSync(fx.privateDir, { recursive: true });
  chmodSync(fx.privateDir, 0o755);
  const firefox = startFakeFirefox({ home: fx.home, channel: fx.channel, handler: () => {} });
  try {
    await firefox.ready(fx.privateDir);
    assert.equal(statSync(fx.privateDir).mode & 0o777, 0o700);
  } finally {
    await firefox.stop();
  }
});

test("start then finish: a reply that lands before finish() is called is still read", { skip: !darwin }, async () => {
  const payload = [{ id: 1, windowId: 2, title: "Early", url: "https://example.com/" }];
  await withHelper(
    (message, ff) => ff.send({ id: message.id, payload }),
    async (fx) => {
      // The wait budget (400 ms) is over long before finish() runs (after 900 ms): the reply file is the truth.
      const { result } = await split(fx, "list-tabs", {}, 400, 900);
      assert.deepEqual(result, { ok: true, payload });
      assert.deepEqual(readdirSync(fx.privateDir), [], "no request or reply file is left behind");
    },
  );
});

test("start then finish with no helper times out within the budget counted from start()", { skip: !darwin }, async () => {
  const fx = fixture();
  const { result, elapsedMs } = await split(fx, "list-tabs", {}, 400, 200);
  assert.deepEqual(result, { ok: false, error: "timeout" });
  assert.ok(elapsedMs < 600, `took ${elapsedMs} ms`);
  assert.deepEqual(readdirSync(fx.privateDir), []);
});
