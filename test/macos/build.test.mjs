import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { BUNDLE_ID } = require("../../workflow/lib/constants.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const plist = path.join(root, "workflow/info.plist");
const workflowZip = path.join(root, "dist/Browser-Search-for-Alfred.alfredworkflow");
const addonZip = path.join(root, "dist/browser-search-for-alfred-addon.zip");
const darwin = process.platform === "darwin";

function plistJson() {
  const out = execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" });
  return JSON.parse(out);
}

function zipList(file) {
  return execFileSync("/usr/bin/unzip", ["-Z", file], { encoding: "utf8" }).split("\n");
}

test("build script makes both files", { skip: !darwin }, () => {
  execFileSync("/bin/bash", [path.join(root, "scripts/build.sh")], { cwd: root, stdio: "pipe" });
  assert.ok(existsSync(workflowZip));
  assert.ok(existsSync(addonZip));
});

test("info.plist is valid and identifies the workflow", { skip: !darwin }, () => {
  execFileSync("/usr/bin/plutil", ["-lint", plist]);
  const p = plistJson();
  assert.equal(p.bundleid, BUNDLE_ID);
  assert.equal(p.name, "Browser Search for Alfred");
  assert.equal(p.version, "0.1.0");
});

test("one Script Filter runs tab.js and connects to one Action Script running act.js", { skip: !darwin }, () => {
  const p = plistJson();
  const filters = p.objects.filter((o) => o.type === "alfred.workflow.input.scriptfilter");
  assert.equal(filters.length, 1);
  const filter = filters[0];
  assert.equal(filter.config.keyword, "tab");
  assert.match(filter.config.script, /osascript -l JavaScript \.\/tab\.js/);
  const actions = p.objects.filter((o) => o.type === "alfred.workflow.action.script");
  assert.equal(actions.length, 1);
  assert.match(actions[0].config.script, /osascript -l JavaScript \.\/act\.js/);
  const targets = (p.connections[filter.uid] || []).map((c) => c.destinationuid);
  assert.deepEqual(targets, [actions[0].uid]);
});

test("workflow zip has the workflow at its root and an executable helper", { skip: !darwin }, () => {
  const lines = zipList(workflowZip);
  const names = lines.map((l) => l.trim().split(/\s+/).pop());
  for (const n of ["info.plist", "tab.js", "act.js", "firefox-helper.js", "lib/constants.js"]) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  assert.ok(!names.some((n) => n.includes(".DS_Store") || n.startsWith("workflow/")));
  const helper = lines.find((l) => l.trim().endsWith(" firefox-helper.js"));
  assert.ok(helper.startsWith("-rwxr-xr-x"), helper);
});

test("add-on zip has manifest.json at its root", { skip: !darwin }, () => {
  const names = zipList(addonZip).map((l) => l.trim().split(/\s+/).pop());
  assert.ok(names.includes("manifest.json"));
  assert.ok(!names.some((n) => n.includes(".DS_Store") || n.startsWith("addon/")));
});
