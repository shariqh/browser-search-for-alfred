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

const TAB_UID = "073BBDBA-2E7E-40A2-B550-706A1E1E9397";
const BMK_UID = "572B2677-9448-4E32-8DDD-FB5620821F8E";
const HIST_UID = "37DBBC3C-BA3C-4F05-B920-DCEC8AC4BA52";
const ACT_UID = "9BF9759C-CA14-401E-B046-511C2C64CE3A";

test("three Script Filters run tab.js, bmk.js and hist.js, and one Action Script runs act.js", { skip: !darwin }, () => {
  const p = plistJson();
  const filters = p.objects.filter((o) => o.type === "alfred.workflow.input.scriptfilter");
  assert.deepEqual(filters.map((f) => f.uid), [TAB_UID, BMK_UID, HIST_UID]);
  const [tab, bmk, hist] = filters;
  assert.equal(tab.config.keyword, "{var:keyword_tabs}");
  assert.match(tab.config.script, /osascript -l JavaScript \.\/tab\.js/);
  const actions = p.objects.filter((o) => o.type === "alfred.workflow.action.script");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].uid, ACT_UID);
  assert.match(actions[0].config.script, /osascript -l JavaScript \.\/act\.js/);
  assert.deepEqual((p.connections[TAB_UID] || []).map((c) => c.destinationuid), [ACT_UID]);

  // bmk: the tab filter's config with its own keyword, title and script.
  assert.deepEqual(bmk.config, {
    ...tab.config,
    keyword: "{var:keyword_bookmarks}",
    title: "Search bookmarks",
    script: '/usr/bin/osascript -l JavaScript ./bmk.js "$1"',
  });
  assert.equal(bmk.version, tab.version);

  // hist: Alfred does not filter; the script searches every time the query changes.
  assert.equal(hist.config.keyword, "{var:keyword_history}");
  assert.equal(hist.config.title, "Search history");
  assert.equal(hist.config.script, '/usr/bin/osascript -l JavaScript ./hist.js "$1"');
  for (const [key, value] of Object.entries({
    alfredfiltersresults: false,
    argumenttype: 1,
    argumenttreatemptyqueryasnil: false,
    argumenttrimmode: 0,
    queuemode: 1,
    queuedelaycustom: 3,
    queuedelayimmediatelyinitially: true,
    queuedelaymode: 0,
    runningsubtext: "Searching history…",
    withspace: true,
  })) {
    assert.equal(hist.config[key], value, key);
  }

  // Both connect to act.js twice: plain Return and ⌘Return.
  for (const uid of [BMK_UID, HIST_UID]) {
    assert.deepEqual(
      (p.connections[uid] || []).map((c) => [c.destinationuid, c.modifiers]),
      [
        [ACT_UID, 0],
        [ACT_UID, 1048576],
      ],
    );
    assert.ok(p.uidata[uid], `uidata for ${uid}`);
  }
});

test("Configure Workflow has three keyword fields and three browser checkboxes", { skip: !darwin }, () => {
  const keyword = (variable, label, value) => ({
    type: "textfield",
    variable,
    label,
    description: "",
    config: { default: value, placeholder: "", required: true, trim: true },
  });
  const browser = (variable, label, text) => ({
    type: "checkbox",
    variable,
    label,
    description: "",
    config: { default: true, required: false, text },
  });
  assert.deepEqual(plistJson().userconfigurationconfig, [
    keyword("keyword_tabs", "Tabs keyword", "tab"),
    keyword("keyword_bookmarks", "Bookmarks keyword", "bmk"),
    keyword("keyword_history", "History keyword", "hist"),
    browser("browser_firefox", "Browsers", "Firefox"),
    browser("browser_chrome", "", "Google Chrome"),
    browser("browser_safari", "", "Safari"),
  ]);
});

test("workflow zip has the workflow at its root and an executable helper", { skip: !darwin }, () => {
  const lines = zipList(workflowZip);
  const names = lines.map((l) => l.trim().split(/\s+/).pop());
  for (const n of ["info.plist", "tab.js", "bmk.js", "hist.js", "act.js", "firefox-helper.js", "lib/constants.js"]) {
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
