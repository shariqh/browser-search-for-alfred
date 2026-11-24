import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
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
  assert.equal(p.version, "1.0.0");
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
    runningsubtext: "Loading bookmarks…",
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

test("the Action Script feeds one Post Notification, placed to its right", { skip: !darwin }, () => {
  const p = plistJson();
  const notes = p.objects.filter((o) => o.type === "alfred.workflow.output.notification");
  assert.equal(notes.length, 1);
  const [note] = notes;
  assert.deepEqual(note.config, {
    title: "Browser Search",
    text: "{query}",
    onlyshowifquerypopulated: true,
    lastpathcomponent: false,
    removeextension: false,
  });
  assert.equal(note.version, 1);
  assert.match(note.uid, /^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/);
  assert.ok(![TAB_UID, BMK_UID, HIST_UID, ACT_UID].includes(note.uid));
  assert.deepEqual((p.connections[ACT_UID] || []).map((c) => [c.destinationuid, c.modifiers]), [[note.uid, 0]]);
  assert.ok(p.uidata[note.uid].xpos > p.uidata[ACT_UID].xpos, "to the right of the Action Script");
  assert.equal(p.uidata[note.uid].ypos, p.uidata[ACT_UID].ypos);
  // Nothing else is connected from the notification, and every other object keeps its own connections.
  assert.equal(p.connections[note.uid], undefined);
});

test("Configure Workflow has three keyword fields and five browser checkboxes", { skip: !darwin }, () => {
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
    browser("browser_brave", "", "Brave Browser"),
    browser("browser_edge", "", "Microsoft Edge"),
  ]);
});

test("workflow zip has the workflow at its root and an executable helper", { skip: !darwin }, () => {
  const lines = zipList(workflowZip);
  const names = lines.map((l) => l.trim().split(/\s+/).pop());
  const libs = [
    "ae-budget",
    "browsers",
    "chromium-files",
    "chromium",
    "config",
    "constants",
    "firefox-client",
    "firefox-source",
    "items",
    "jxa",
    "registration",
    "safari-files",
    "safari-tabs",
    "sql",
    "sqlite",
  ];
  const expected = ["info.plist", "icon.png", "tab.js", "bmk.js", "hist.js", "act.js", "firefox-helper.js", ...libs.map((n) => `lib/${n}.js`)];
  for (const n of expected) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  assert.ok(!names.some((n) => n.includes(".DS_Store") || n.startsWith("workflow/")));
  const helper = lines.find((l) => l.trim().endsWith(" firefox-helper.js"));
  assert.ok(helper.startsWith("-rwxr-xr-x"), helper);
});

test("workflow zip has a 512x512 icon.png with an alpha channel", { skip: !darwin }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "bsa-icon-"));
  execFileSync("/usr/bin/unzip", ["-q", workflowZip, "icon.png", "-d", dir]);
  const out = execFileSync("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", path.join(dir, "icon.png")], {
    encoding: "utf8",
  });
  assert.match(out, /pixelWidth: 512\n/);
  assert.match(out, /pixelHeight: 512\n/);
  assert.match(out, /hasAlpha: yes\n/);
});

test("add-on zip has manifest.json at its root", { skip: !darwin }, () => {
  const names = zipList(addonZip).map((l) => l.trim().split(/\s+/).pop());
  assert.ok(names.includes("manifest.json"));
  assert.ok(!names.some((n) => n.includes(".DS_Store") || n.startsWith("addon/")));
  const manifest = JSON.parse(execFileSync("/usr/bin/unzip", ["-p", addonZip, "manifest.json"], { encoding: "utf8" }));
  assert.equal(manifest.version, "1.0.0");
  assert.deepEqual(manifest.permissions, ["nativeMessaging", "tabs", "bookmarks", "history"]);
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions, { required: ["browsingActivity"] });
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "140.0");
});

test("README's user part is info.plist's readme, in the Alfred Gallery order", { skip: !darwin }, () => {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  assert.ok(readme.startsWith("# Browser Search for Alfred\n"), "starts with the title");
  const open = "\n<!-- user -->\n";
  const close = "\n<!-- developer -->\n";
  const from = readme.indexOf(open);
  const to = readme.indexOf(close);
  assert.ok(from > 0, "README.md has a <!-- user --> line of its own");
  assert.ok(to > from, "README.md has a <!-- developer --> line of its own after it");
  assert.equal(readme.indexOf(open, from + 1), -1, "one <!-- user --> line");
  assert.equal(readme.indexOf(close, to + 1), -1, "one <!-- developer --> line");
  // The user part is the text between the two marker lines, exclusive. Both sides are trimmed, so the blank lines
  // around the markers and the plist's closing newline don't matter.
  const userPart = readme.slice(from + open.length, to).trim();
  assert.equal(plistJson().readme.trim(), userPart);
  assert.ok(userPart.startsWith("## Setup\n"), "starts with ## Setup");
  const usage = userPart.indexOf("\n## Usage\n");
  assert.ok(usage > 0, "has ## Usage after ## Setup");
  assert.equal(userPart.indexOf("\n## Setup\n"), -1, "## Setup appears once, at the top");
  assert.ok(!userPart.includes("<!--"), "no HTML comments in the user part");
  assert.ok(userPart.slice(0, usage).includes("(Firefox 140 or later)"), "Setup names the Firefox version the add-on needs");
  // The install links point at the add-on's listing and at the latest release.
  assert.ok(
    userPart.slice(0, usage).includes("https://addons.mozilla.org/firefox/addon/browser-search-for-alfred/"),
    "Setup links the add-on",
  );
  assert.ok(
    userPart.slice(usage).includes("https://github.com/shariqh/browser-search-for-alfred/releases/latest"),
    "Usage links the latest release",
  );
});
