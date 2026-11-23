import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, readdirSync, realpathSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { workflowDir } from "./fake-firefox.mjs";

const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const { registrationManifest } = require("../../workflow/lib/registration.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
let counter = 0;

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-setup-")));
  const home = path.join(root, "home dir");
  mkdirSync(home);
  return { root, home, channel: `s${process.pid}-${Date.now()}-${counter++}` };
}

async function act(fx, json, cwd) {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", path.join(workflowDir, "act.js"), JSON.stringify(json)],
    { cwd, env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel } },
  );
  return stdout;
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

const mode = (p) => statSync(p).mode & 0o777;

test("setup-firefox installs the helper copy and registration", { skip: !darwin }, async () => {
  const fx = fixture();
  const out = await act(fx, { action: "setup-firefox" });
  assert.equal(out, "");
  const helper = constants.helperInstallPath(fx.home);
  const reg = constants.registrationPath(fx.home);
  assert.equal(mode(helper), 0o755);
  assert.equal(mode(reg), 0o644);
  assert.deepEqual(readFileSync(helper), readFileSync(path.join(workflowDir, "firefox-helper.js")));
  const text = readFileSync(reg, "utf8");
  assert.equal(text, JSON.stringify(registrationManifest(helper), null, 2) + "\n");
  assert.equal(mode(path.dirname(helper)), 0o755);
  assert.equal(mode(path.dirname(reg)), 0o755);
});

test("setup-firefox is idempotent and works from the workflow folder as cwd", { skip: !darwin }, async () => {
  const fx = fixture();
  await act(fx, { action: "setup-firefox" });
  const before = listAll(fx.home);
  const helper = constants.helperInstallPath(fx.home);
  const reg = constants.registrationPath(fx.home);
  const bytes = [readFileSync(helper), readFileSync(reg)];
  await act(fx, { action: "setup-firefox" }, workflowDir);
  assert.deepEqual(listAll(fx.home), before);
  assert.deepEqual([readFileSync(helper), readFileSync(reg)], bytes);
  assert.equal(mode(helper), 0o755);
  assert.equal(mode(reg), 0o644);
});

test("setup-firefox replaces a registration that points elsewhere and a stale copy", { skip: !darwin }, async () => {
  const fx = fixture();
  const helper = constants.helperInstallPath(fx.home);
  const reg = constants.registrationPath(fx.home);
  mkdirSync(path.dirname(reg), { recursive: true });
  mkdirSync(path.dirname(helper), { recursive: true });
  writeFileSync(reg, JSON.stringify({ ...registrationManifest("/elsewhere.js") }));
  writeFileSync(helper, "old copy");
  await act(fx, { action: "setup-firefox" });
  assert.equal(JSON.parse(readFileSync(reg, "utf8")).path, helper);
  assert.deepEqual(readFileSync(helper), readFileSync(path.join(workflowDir, "firefox-helper.js")));
  assert.equal(mode(helper), 0o755);
});

test("setup-firefox writes only inside HOME", { skip: !darwin }, async () => {
  const fx = fixture();
  await act(fx, { action: "setup-firefox" });
  assert.deepEqual(readdirSync(fx.root), ["home dir"]);
  assert.deepEqual(listAll(fx.home), [
    "Library",
    "Library/Application Support",
    "Library/Application Support/Mozilla",
    "Library/Application Support/Mozilla/NativeMessagingHosts",
    `Library/Application Support/Mozilla/NativeMessagingHosts/${constants.HOST_NAME}.json`,
    `Library/Application Support/${constants.BUNDLE_ID}`,
    `Library/Application Support/${constants.BUNDLE_ID}/firefox-helper.js`,
  ].sort());
  assert.ok(!existsSync(path.join(fx.home, "Library/Caches")));
});
