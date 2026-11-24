import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import { startFakeFirefox, workflowDir } from "./fake-firefox.mjs";

// Every browser file here lives under a temp HOME; bmk.js and act.js run only with BSA_TEST_CHANNEL, so nothing
// reads real browser data and act.js only logs what it would have opened.
const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
const here = path.dirname(fileURLToPath(import.meta.url));
const chromeFixtures = path.join(here, "..", "fixtures", "chrome");
let counter = 0;

const FIREFOX = constants.FIREFOX_BUNDLE_ID;
const CHROME = constants.CHROME_BUNDLE_ID;
const SAFARI = constants.SAFARI_BUNDLE_ID;

// Safari's Bookmarks.plist is binary: write it as XML and convert it.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const leaf = (title, url) =>
  `<dict><key>URIDictionary</key><dict><key>title</key><string>${esc(title)}</string></dict>` +
  `<key>URLString</key><string>${esc(url)}</string><key>WebBookmarkType</key><string>WebBookmarkTypeLeaf</string></dict>`;
const list = (title, children) =>
  `<dict><key>Title</key><string>${esc(title)}</string><key>WebBookmarkType</key><string>WebBookmarkTypeList</string>` +
  `<key>Children</key><array>${children.join("")}</array></dict>`;

async function makeSafariBookmarks(fx) {
  const root = list("", [list("BookmarksBar", [leaf("Safari One", "https://safari.example.com/one"), leaf("Safari Script", "javascript:alert(1)")])]);
  const xml = path.join(fx.root, "Bookmarks.xml");
  writeFileSync(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">${root}</plist>\n`,
  );
  await execFileAsync("/usr/bin/plutil", ["-convert", "binary1", xml, "-o", constants.safariBookmarksPath(fx.home)]);
}

// A HOME with Chrome's two profiles (test/fixtures/chrome) and Safari's bookmarks; Firefox is set up separately.
async function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-bmk-")));
  const home = path.join(root, "home dir");
  mkdirSync(path.join(home, "Library", "Safari"), { recursive: true });
  const fx = {
    root,
    home,
    chromeDir: constants.chromeDataDir(home),
    channel: `b${process.pid}-${Date.now()}-${counter++}`,
    privateDir: constants.privateDir(home),
  };
  cpSync(chromeFixtures, fx.chromeDir, { recursive: true });
  await makeSafariBookmarks(fx);
  return fx;
}

// Copies the Chrome fixtures into another Chromium browser's data folder under the fixture HOME, with every title
// and host given a prefix, so each browser's bookmarks are told apart. Returns the folder.
function addChromium(fx, dataDir, label) {
  const slug = label.toLowerCase();
  cpSync(chromeFixtures, dataDir, { recursive: true });
  for (const profile of ["Default", "Profile 1"]) {
    const file = path.join(dataDir, profile, "Bookmarks");
    writeFileSync(file, readFileSync(file, "utf8").replace(/"name": "/g, `"name": "${label} `).replace(/\.example\.com/g, `.${slug}.example.com`));
  }
  return dataDir;
}

// Always async: the same Node process plays Firefox, and a blocking call would stop it answering.
async function osascript(fx, script, arg, env = {}) {
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-l", "JavaScript", path.join(workflowDir, script), arg], {
    env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel, BSA_TEST_FIREFOX_RUNNING: "1", ...env },
  });
  return stdout;
}

const setupFirefox = (fx) => osascript(fx, "act.js", JSON.stringify({ action: "setup-firefox" }));

async function bmk(fx, env = {}) {
  return JSON.parse(await osascript(fx, "bmk.js", "", env));
}

const firefoxBookmarks = [
  { title: "Fire One", url: "https://firefox.example.com/one" },
  { title: "", url: "https://firefox.example.com/two" },
  { title: "Fire Place", url: "place:sort=8" },
];

async function withFirefox(fx, body) {
  const firefox = startFakeFirefox({
    home: fx.home,
    channel: fx.channel,
    handler: (message, ff) => ff.send({ id: message.id, payload: firefoxBookmarks }),
  });
  try {
    await firefox.ready(fx.privateDir);
    await body(firefox);
  } finally {
    await firefox.stop();
  }
}

const firefoxTitles = ["Fire One", "firefox.example.com/two"];
const chromeTitles = ["Bar One", 'Deep "quoted" 😀', "Other One", "Mobile One", "Work Wiki"];
const safariTitles = ["Safari One"];
const ALLOW_SAFARI = "Allow Alfred to read Safari's bookmarks and history";
const ALLOW_CHROME = "Allow Alfred to read Google Chrome's bookmarks and history";

test("bmk lists all three browsers' bookmarks, the frontmost browser first", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async (ff) => {
    const output = await bmk(fx, { BSA_TEST_FRONTMOST: SAFARI });
    assert.deepEqual(output.cache, { seconds: 300, loosereload: true });
    assert.deepEqual(
      output.items.map((item) => item.title),
      [...safariTitles, ...firefoxTitles, ...chromeTitles],
    );
    assert.equal(ff.received.length, 1);
    assert.equal(ff.received[0].command, "list-bookmarks");

    const byTitle = (title) => output.items.find((item) => item.title === title);
    assert.equal(byTitle("Safari One").subtitle, "Safari · https://safari.example.com/one");
    assert.equal(byTitle("Fire One").subtitle, "Firefox · https://firefox.example.com/one");
    assert.equal(byTitle("Bar One").subtitle, "Google Chrome (Person 1) · https://bar.example.com/one");
    assert.equal(byTitle("Work Wiki").subtitle, "Google Chrome (Work) · https://wiki.example.com/");
    assert.equal(byTitle("Bar One").uid, "https://bar.example.com/one");
    assert.deepEqual(JSON.parse(byTitle("Bar One").arg), { action: "open", browser: "chrome", url: "https://bar.example.com/one" });
    assert.deepEqual(JSON.parse(byTitle("Safari One").arg), { action: "open", browser: "safari", url: "https://safari.example.com/one" });
    assert.deepEqual(JSON.parse(byTitle("Fire One").arg), { action: "open", browser: "firefox", url: "https://firefox.example.com/one" });
  });
});

test("Chrome first when Chrome is frontmost, and the default order otherwise", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async () => {
    const chromeFront = await bmk(fx, { BSA_TEST_FRONTMOST: CHROME });
    assert.deepEqual(chromeFront.items.map((item) => item.title), [...chromeTitles, ...firefoxTitles, ...safariTitles]);
    const alfredFront = await bmk(fx, { BSA_TEST_FRONTMOST: "com.runningwithcrayons.Alfred" });
    assert.deepEqual(alfredFront.items.map((item) => item.title), [...firefoxTitles, ...chromeTitles, ...safariTitles]);
  });
});

test("unticking browser_safari drops Safari", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async () => {
    const output = await bmk(fx, { browser_safari: "0" });
    assert.deepEqual(output.items.map((item) => item.title), [...firefoxTitles, ...chromeTitles]);
  });
});

test("one Chrome profile shows no profile name", { skip: !darwin }, async () => {
  const fx = await fixture();
  renameSync(path.join(fx.chromeDir, "Local State"), path.join(fx.root, "Local State.moved"));
  const output = await bmk(fx, { browser_firefox: "0", browser_safari: "0" });
  // Without Local State only the Default profile is read.
  assert.deepEqual(output.items.map((item) => item.title), chromeTitles.slice(0, 4));
  assert.equal(output.items[0].subtitle, "Google Chrome · https://bar.example.com/one");
});

test("a chmod-000 Safari Bookmarks.plist gives one Allow item, and Chrome's and Firefox's bookmarks still show", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  const file = constants.safariBookmarksPath(fx.home);
  chmodSync(file, 0o000);
  try {
    await withFirefox(fx, async () => {
      const output = await bmk(fx);
      assert.deepEqual(output.items.map((item) => item.title), [...firefoxTitles, ...chromeTitles, ALLOW_SAFARI]);
      assert.deepEqual(JSON.parse(output.items.at(-1).arg), { action: "open-privacy" });
      assert.equal("cache" in output, false, "a notice must never be cached");
    });
  } finally {
    chmodSync(file, 0o600);
  }
});

test("a chmod-000 Chrome profile gives one Allow item, and Firefox's and Safari's bookmarks still show", { skip: !darwin }, async () => {
  const fx = await fixture();
  await setupFirefox(fx);
  const profile = path.join(fx.chromeDir, "Profile 1");
  chmodSync(profile, 0o000);
  try {
    await withFirefox(fx, async () => {
      const output = await bmk(fx);
      assert.deepEqual(output.items.map((item) => item.title), [...firefoxTitles, ALLOW_CHROME, ...safariTitles]);
    });
  } finally {
    chmodSync(profile, 0o700);
  }
});

test("a missing Safari Bookmarks.plist and a profile without Bookmarks contribute nothing", { skip: !darwin }, async () => {
  const fx = await fixture();
  renameSync(constants.safariBookmarksPath(fx.home), path.join(fx.root, "Bookmarks.plist.moved"));
  renameSync(path.join(fx.chromeDir, "Profile 1", "Bookmarks"), path.join(fx.root, "Bookmarks.moved"));
  const output = await bmk(fx, { browser_firefox: "0" });
  assert.deepEqual(output.items.map((item) => item.title), chromeTitles.slice(0, 4));
});

// act.js: the open actions. Under the channel they log instead of opening.
const activationLog = (fx) => path.join(fx.home, "activated-apps.log");

test("act.js open logs the bundle ID and URL for each browser", { skip: !darwin }, async () => {
  const fx = await fixture();
  for (const browser of ["firefox", "chrome", "safari"]) {
    const out = await osascript(fx, "act.js", JSON.stringify({ action: "open", browser, url: `https://${browser}.example.com/a?b=c d` }));
    assert.equal(out, "");
  }
  await osascript(fx, "act.js", JSON.stringify({ action: "open-privacy" }));
  assert.equal(
    readFileSync(activationLog(fx), "utf8"),
    [
      `open ${FIREFOX} https://firefox.example.com/a?b=c d`,
      `open ${CHROME} https://chrome.example.com/a?b=c d`,
      `open ${SAFARI} https://safari.example.com/a?b=c d`,
      "open-privacy",
      "",
    ].join("\n"),
  );
});

// ⌘↩ opens the URL in the default browser by its bundle ID, so a file: URL never goes to the file's own app.
test("act.js open-default opens https: and file: URLs in the default browser", { skip: !darwin }, async () => {
  const fx = await fixture();
  const env = { BSA_TEST_DEFAULT_BROWSER: SAFARI };
  await osascript(fx, "act.js", JSON.stringify({ action: "open-default", url: "https://example.com/x" }), env);
  await osascript(fx, "act.js", JSON.stringify({ action: "open-default", url: "file:///tmp/run.command" }), env);
  assert.equal(
    readFileSync(activationLog(fx), "utf8"),
    [`open-default ${SAFARI} https://example.com/x`, `open-default ${SAFARI} file:///tmp/run.command`, ""].join("\n"),
  );
});

test("act.js open-default with no known default browser logs nothing and exits non-zero", { skip: !darwin }, async () => {
  const fx = await fixture();
  const request = JSON.stringify({ action: "open-default", url: "https://example.com/x" });
  await assert.rejects(osascript(fx, "act.js", request, { BSA_TEST_DEFAULT_BROWSER: "" }), (err) => err.code !== 0);
  assert.equal(existsSync(activationLog(fx)), false);
});

test("act.js refuses a javascript: URL, other unopenable URLs and an unknown browser: it logs nothing and exits non-zero", { skip: !darwin }, async () => {
  const fx = await fixture();
  const refused = [
    { action: "open", browser: "chrome", url: "javascript:alert(1)" },
    { action: "open", browser: "safari", url: "data:text/html,hi" },
    { action: "open", browser: "firefox", url: "place:sort=8" },
    { action: "open", browser: "chrome", url: "chrome://settings" },
    { action: "open", browser: "opera", url: "https://example.com/" },
    { action: "open", browser: "constructor", url: "https://example.com/" },
    { action: "open-default", url: "javascript:alert(1)" },
    { action: "open-default" },
  ];
  for (const request of refused) {
    // A default browser is known, so open-default is refused for its URL alone.
    const env = { BSA_TEST_DEFAULT_BROWSER: SAFARI };
    await assert.rejects(osascript(fx, "act.js", JSON.stringify(request), env), (err) => err.code !== 0, JSON.stringify(request));
  }
  assert.equal(existsSync(activationLog(fx)), false);
});

// Brave and Edge read the same way as Chrome, from their own data folders.
const braveTitles = chromeTitles.map((t) => `Brave ${t}`);
const edgeTitles = chromeTitles.map((t) => `Edge ${t}`);
const ALLOW_EDGE = "Allow Alfred to read Microsoft Edge's bookmarks and history";
const noFirefoxNoSafari = { browser_firefox: "0", browser_safari: "0" };

test("bmk lists Brave's and Edge's bookmarks in their own places, with their own names and profile names", { skip: !darwin }, async () => {
  const fx = await fixture();
  addChromium(fx, constants.braveDataDir(fx.home), "Brave");
  addChromium(fx, constants.edgeDataDir(fx.home), "Edge");
  const output = await bmk(fx, noFirefoxNoSafari);
  assert.deepEqual(output.items.map((item) => item.title), [...chromeTitles, ...braveTitles, ...edgeTitles]);
  const byTitle = (title) => output.items.find((item) => item.title === title);
  assert.equal(byTitle("Brave Bar One").subtitle, "Brave Browser (Person 1) · https://bar.brave.example.com/one");
  assert.equal(byTitle("Edge Work Wiki").subtitle, "Microsoft Edge (Work) · https://wiki.edge.example.com/");
  assert.equal(byTitle("Brave Bar One").uid, "https://bar.brave.example.com/one");
  assert.deepEqual(JSON.parse(byTitle("Brave Bar One").arg), { action: "open", browser: "brave", url: "https://bar.brave.example.com/one" });
  assert.deepEqual(JSON.parse(byTitle("Edge Bar One").arg), { action: "open", browser: "edge", url: "https://bar.edge.example.com/one" });
  const front = await bmk(fx, { ...noFirefoxNoSafari, BSA_TEST_FRONTMOST: constants.EDGE_BUNDLE_ID });
  assert.deepEqual(front.items.map((item) => item.title), [...edgeTitles, ...chromeTitles, ...braveTitles]);
});

test("a Brave with one profile shows no profile name, and unticking browser_brave or browser_edge drops it", { skip: !darwin }, async () => {
  const fx = await fixture();
  const dir = addChromium(fx, constants.braveDataDir(fx.home), "Brave");
  addChromium(fx, constants.edgeDataDir(fx.home), "Edge");
  renameSync(path.join(dir, "Local State"), path.join(fx.root, "Brave Local State.moved"));
  const output = await bmk(fx, { ...noFirefoxNoSafari, browser_chrome: "0" });
  assert.deepEqual(output.items.map((item) => item.title), [...braveTitles.slice(0, 4), ...edgeTitles]);
  assert.equal(output.items[0].subtitle, "Brave Browser · https://bar.brave.example.com/one");
  const noBrave = await bmk(fx, { ...noFirefoxNoSafari, browser_chrome: "0", browser_brave: "0" });
  assert.deepEqual(noBrave.items.map((item) => item.title), edgeTitles);
  const noEdge = await bmk(fx, { ...noFirefoxNoSafari, browser_chrome: "0", browser_edge: "0" });
  assert.deepEqual(noEdge.items.map((item) => item.title), braveTitles.slice(0, 4));
});

test("a chmod-000 Edge Bookmarks gives one Allow item for Edge, and the other browsers' bookmarks still show", { skip: !darwin }, async () => {
  const fx = await fixture();
  addChromium(fx, constants.braveDataDir(fx.home), "Brave");
  const edgeDir = addChromium(fx, constants.edgeDataDir(fx.home), "Edge");
  const file = path.join(edgeDir, "Default", "Bookmarks");
  chmodSync(file, 0o000);
  try {
    const output = await bmk(fx, noFirefoxNoSafari);
    assert.deepEqual(output.items.map((item) => item.title), [...chromeTitles, ...braveTitles, ALLOW_EDGE]);
    assert.deepEqual(JSON.parse(output.items.at(-1).arg), { action: "open-privacy" });
    assert.equal("cache" in output, false, "a notice must never be cached");
  } finally {
    chmodSync(file, 0o600);
  }
});

test("a Brave or Edge data folder that does not exist gives no items and no Allow item", { skip: !darwin }, async () => {
  const fx = await fixture();
  assert.equal(existsSync(constants.braveDataDir(fx.home)), false);
  assert.equal(existsSync(constants.edgeDataDir(fx.home)), false);
  const output = await bmk(fx, noFirefoxNoSafari);
  assert.deepEqual(output.items.map((item) => item.title), chromeTitles);
  assert.equal(output.items.some((item) => /Allow Alfred/.test(item.title)), false);
});

test("act.js open logs Brave's and Edge's bundle IDs", { skip: !darwin }, async () => {
  const fx = await fixture();
  for (const browser of ["brave", "edge"]) {
    await osascript(fx, "act.js", JSON.stringify({ action: "open", browser, url: `https://${browser}.example.com/a` }));
  }
  assert.equal(
    readFileSync(activationLog(fx), "utf8"),
    [`open com.brave.Browser https://brave.example.com/a`, `open com.microsoft.edgemac https://edge.example.com/a`, ""].join("\n"),
  );
});
