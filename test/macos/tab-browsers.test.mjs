import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { startFakeFirefox, workflowDir } from "./fake-firefox.mjs";

// None of these tests may touch a real browser: tab.js builds each Apple Event browser from the JSON file named by
// BSA_TEST_TABS_<KEY>, and act.js only logs what it would have activated or opened.
const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
let counter = 0;

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-browsers-")));
  const home = path.join(root, "home dir");
  mkdirSync(home);
  return { home, channel: `b${process.pid}-${Date.now()}-${counter++}`, privateDir: constants.privateDir(home) };
}

// Always async: the same Node process plays Firefox, and a blocking call would stop it answering.
async function osascript(fx, script, arg, env = {}) {
  const { stdout } = await execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", path.join(workflowDir, script), arg],
    { env: { ...process.env, HOME: fx.home, BSA_TEST_CHANNEL: fx.channel, BSA_TEST_FIREFOX_RUNNING: "0", ...env } },
  );
  return stdout;
}

async function tab(fx, env = {}) {
  const started = Date.now();
  const out = await osascript(fx, "tab.js", "", env);
  return { output: JSON.parse(out), elapsedMs: Date.now() - started };
}

const setupFirefox = (fx) => osascript(fx, "act.js", JSON.stringify({ action: "setup-firefox" }));
const activityLog = (fx) => readFileSync(path.join(fx.home, "activated-apps.log"), "utf8");

const BRAVE = "com.brave.Browser";

// One normal window per browser; Chrome, Brave and Edge also have an incognito window that must never show.
const incognito = (id, title) => ({ id, mode: "incognito", tabs: [{ id: "999", title, url: "https://private.example.com/" }] });
const DATA = {
  CHROME: { windows: [{ id: "500", mode: "normal", tabs: [{ id: "901", title: "Chrome One", url: "https://chrome.example.com/" }] }, incognito("501", "Chrome Secret")] },
  SAFARI: {
    windows: [
      {
        id: 7,
        tabs: [
          { title: "Safari One", url: "https://safari.example.com/one" },
          { title: "Safari Two", url: "https://safari.example.com/two" },
        ],
      },
    ],
  },
  BRAVE: { windows: [incognito("2", "Brave Secret"), { id: "3", tabs: [{ id: "11", title: "Brave One", url: "https://brave.example.com/" }] }] },
  EDGE: { windows: [{ id: "4", mode: "normal", tabs: [{ id: "12", title: "Edge One", url: "https://edge.example.com/" }] }, incognito("5", "Edge Secret")] },
};

// Writes one file per browser and returns the BSA_TEST_TABS_<KEY> variables. `overrides` replaces a browser's
// document (or, with null, leaves that browser without a file).
function tabsEnv(fx, overrides = {}) {
  const env = {};
  for (const key of Object.keys(DATA)) {
    const data = key in overrides ? overrides[key] : DATA[key];
    if (data === null) continue;
    const file = path.join(fx.home, `tabs-${key.toLowerCase()}.json`);
    writeFileSync(file, JSON.stringify(data));
    env[`BSA_TEST_TABS_${key}`] = file;
  }
  return env;
}

const firefoxTabs = [{ id: 21, windowId: 1, index: 0, title: "Fire One", url: "https://firefox.example.com/", active: true }];

async function withFirefox(fx, body) {
  const firefox = startFakeFirefox({
    home: fx.home,
    channel: fx.channel,
    handler: (message, ff) => ff.send({ id: message.id, payload: firefoxTabs }),
  });
  try {
    await firefox.ready(fx.privateDir);
    await body(firefox);
  } finally {
    await firefox.stop();
  }
}

const titles = (output) => output.items.map((item) => item.title);
const ALL_TITLES = ["Fire One", "Chrome One", "Safari One", "Safari Two", "Brave One", "Edge One"];

test("tabs from all five browsers appear in the default order when Alfred is frontmost", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async () => {
    const { output } = await tab(fx, { BSA_TEST_FIREFOX_RUNNING: "1", BSA_TEST_FRONTMOST: "com.runningwithcrayons.Alfred", ...tabsEnv(fx) });
    assert.equal(output.skipknowledge, true);
    assert.deepEqual(titles(output), ALL_TITLES);
    assert.ok(output.items.every((item) => !("uid" in item)));
  });
});

test("the frontmost browser comes first: Brave", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async () => {
    const { output } = await tab(fx, { BSA_TEST_FIREFOX_RUNNING: "1", BSA_TEST_FRONTMOST: BRAVE, ...tabsEnv(fx) });
    assert.deepEqual(titles(output), ["Brave One", "Fire One", "Chrome One", "Safari One", "Safari Two", "Edge One"]);
  });
});

test("the frontmost browser comes first: Safari and Edge", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const env = tabsEnv(fx);
  const safari = await tab(fx, { BSA_TEST_FRONTMOST: "com.apple.Safari", ...env });
  assert.deepEqual(titles(safari.output), ["Safari One", "Safari Two", "Chrome One", "Brave One", "Edge One"]);
  const edge = await tab(fx, { BSA_TEST_FRONTMOST: "com.microsoft.edgemac", ...env });
  assert.deepEqual(titles(edge.output), ["Edge One", "Chrome One", "Safari One", "Safari Two", "Brave One"]);
});

test("incognito windows of Chrome, Brave and Edge are never listed", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx, tabsEnv(fx));
  const text = JSON.stringify(output);
  for (const secret of ["Chrome Secret", "Brave Secret", "Edge Secret", "private.example.com"]) {
    assert.ok(!text.includes(secret), secret);
  }
});

test("each browser's items carry its own name, icon path and an arg that brings the tab forward", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx, tabsEnv(fx));
  const byTitle = Object.fromEntries(output.items.map((item) => [item.title, item]));
  assert.equal(byTitle["Safari Two"].subtitle, "Safari · https://safari.example.com/two");
  assert.deepEqual(JSON.parse(byTitle["Safari Two"].arg), {
    action: "activate",
    browser: "safari",
    windowId: "7",
    tabId: "2",
    url: "https://safari.example.com/two",
  });
  assert.equal(byTitle["Brave One"].subtitle, "Brave Browser · https://brave.example.com/");
  assert.deepEqual(JSON.parse(byTitle["Brave One"].arg), {
    action: "activate",
    browser: "brave",
    windowId: "3",
    tabId: "11",
    url: "https://brave.example.com/",
  });
  assert.equal(byTitle["Edge One"].subtitle, "Microsoft Edge · https://edge.example.com/");
  assert.deepEqual(JSON.parse(byTitle["Edge One"].arg), {
    action: "activate",
    browser: "edge",
    windowId: "4",
    tabId: "12",
    url: "https://edge.example.com/",
  });
});

test("Safari refusing Automation gives exactly one Allow item and every other browser's tabs", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async () => {
    const { output } = await tab(fx, {
      BSA_TEST_FIREFOX_RUNNING: "1",
      BSA_TEST_FRONTMOST: "com.runningwithcrayons.Alfred",
      ...tabsEnv(fx, { SAFARI: { denied: true } }),
    });
    assert.deepEqual(titles(output), ["Fire One", "Chrome One", "Allow Alfred to control Safari", "Brave One", "Edge One"]);
    const allow = output.items.filter((item) => item.title.startsWith("Allow Alfred to control"));
    assert.equal(allow.length, 1);
    assert.deepEqual(allow[0], {
      title: "Allow Alfred to control Safari",
      subtitle: "Press Return, then turn on Safari under Alfred in Privacy & Security → Automation",
      arg: JSON.stringify({ action: "open-automation" }),
    });
  });
});

test("a Chromium browser refusing Automation gives its own Allow item", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx, tabsEnv(fx, { EDGE: { denied: true } }));
  assert.deepEqual(titles(output), ["Chrome One", "Safari One", "Safari Two", "Brave One", "Allow Alfred to control Microsoft Edge"]);
});

test("unticking browser_edge drops Edge, even its Allow item", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const env = { ...tabsEnv(fx), browser_edge: "0" };
  assert.deepEqual(titles((await tab(fx, env)).output), ["Chrome One", "Safari One", "Safari Two", "Brave One"]);
  const denied = { ...tabsEnv(fx, { EDGE: { denied: true } }), browser_edge: "0" };
  assert.deepEqual(titles((await tab(fx, denied)).output), ["Chrome One", "Safari One", "Safari Two", "Brave One"]);
});

test("unticking browser_safari and browser_brave drops them", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx, { ...tabsEnv(fx), browser_safari: "0", browser_brave: "0" });
  assert.deepEqual(titles(output), ["Chrome One", "Edge One"]);
});

test("a browser with no tabs file counts as not running", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx, tabsEnv(fx, { SAFARI: null, BRAVE: null }));
  assert.deepEqual(titles(output), ["Chrome One", "Edge One"]);
});

test("BSA_SKIP_APPLESCRIPT=1 skips every Apple Event browser and leaves Firefox", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, async () => {
    const { output } = await tab(fx, { BSA_TEST_FIREFOX_RUNNING: "1", BSA_SKIP_APPLESCRIPT: "1", ...tabsEnv(fx, { SAFARI: { denied: true } }) });
    assert.deepEqual(titles(output), ["Fire One"]);
  });
});

test("a broken tabs file for one browser hides only that browser", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const env = tabsEnv(fx);
  writeFileSync(env.BSA_TEST_TABS_SAFARI, "this is not json");
  writeFileSync(env.BSA_TEST_TABS_CHROME, '{"windows": [null]}');
  const { output } = await tab(fx, env);
  assert.deepEqual(titles(output), ["Brave One", "Edge One"]);
});

// Review Focus 3. A fake read with delayMs waits that long, but never past the per-call timeout it was given;
// a read that would wait longer fails with -1712 after the timeout, like a real browser that does not answer.
test("a hung Chrome costs at most the shared budget, and the browsers after it still show", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output, elapsedMs } = await tab(fx, tabsEnv(fx, { CHROME: { ...DATA.CHROME, delayMs: 60000 } }));
  assert.deepEqual(titles(output), ["Safari One", "Safari Two", "Brave One", "Edge One"]);
  assert.ok(elapsedMs < constants.TABS_BUDGET_MS + 1000, `took ${elapsedMs} ms`);
});

test("a slow Chrome that spends the shared budget makes the browsers after it be skipped, not waited on", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  // Each Chrome read takes 1 s, so Chrome alone runs past the 1.5 s budget. Safari, Brave and Edge are just as
  // slow; waiting on any of them would add at least another second.
  const slow = (key) => ({ ...DATA[key], delayMs: 1000 });
  const { output, elapsedMs } = await tab(fx, tabsEnv(fx, { CHROME: slow("CHROME"), SAFARI: slow("SAFARI"), BRAVE: slow("BRAVE"), EDGE: slow("EDGE") }));
  assert.deepEqual(output, { skipknowledge: true, items: [] });
  assert.ok(elapsedMs < 3500, `took ${elapsedMs} ms`);
});

test("act.js activate logs Safari, Brave and Edge activations and opens nothing", { skip: !darwin }, async () => {
  const fx = fixture();
  const cases = [
    [{ browser: "safari", windowId: "7", tabId: "2", url: "https://safari.example.com/two" }, "safari 7 2"],
    [{ browser: "brave", windowId: "3", tabId: "11", url: "https://brave.example.com/" }, "brave 3 11"],
    [{ browser: "edge", windowId: "4", tabId: "12", url: "https://edge.example.com/" }, "edge 4 12"],
    [{ browser: "chrome", windowId: "500", tabId: "901", url: "https://chrome.example.com/" }, "chrome 500 901"],
  ];
  for (const [request] of cases) {
    assert.equal(await osascript(fx, "act.js", JSON.stringify({ action: "activate", ...request })), "");
  }
  assert.equal(activityLog(fx), cases.map(([, line]) => line).join("\n") + "\n");
});

test("act.js activate with an unknown browser fails and logs nothing", { skip: !darwin }, async () => {
  const fx = fixture();
  const arg = JSON.stringify({ action: "activate", browser: "opera", windowId: "1", tabId: "1", url: "https://x.test/" });
  await assert.rejects(osascript(fx, "act.js", arg));
  assert.throws(() => activityLog(fx), { code: "ENOENT" });
});

test("act.js open-automation logs open-automation and opens nothing", { skip: !darwin }, async () => {
  const fx = fixture();
  assert.equal(await osascript(fx, "act.js", JSON.stringify({ action: "open-automation" })), "");
  assert.equal(activityLog(fx), "open-automation\n");
});
