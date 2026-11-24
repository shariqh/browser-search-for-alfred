import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { startFakeFirefox, workflowDir } from "./fake-firefox.mjs";

// None of these tests may touch a real Chrome: tab.js and act.js read the fake Chrome from
// BSA_TEST_TABS_CHROME and only log what they would have activated.
const require = createRequire(import.meta.url);
const constants = require("../../workflow/lib/constants.js");
const execFileAsync = promisify(execFile);
const darwin = process.platform === "darwin";
let counter = 0;

function fixture() {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "bsa-chrome-")));
  const home = path.join(root, "home dir");
  mkdirSync(home);
  return { home, channel: `c${process.pid}-${Date.now()}-${counter++}`, privateDir: constants.privateDir(home) };
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

const CHROME = "com.google.Chrome";
const chromeTitle = 'Q "x" \n 😀 עברית';
const chromeData = {
  windows: [
    {
      id: "500",
      tabs: [
        { id: "901", title: "Chrome One", url: "https://chrome.example.com/one" },
        { id: "902", title: "", url: "https://chrome.example.org/two" },
      ],
    },
    { id: "501", tabs: [{ id: "903", title: chromeTitle, url: "https://chrome.example.net/3" }] },
  ],
};
const chromeTitles = ["Chrome One", "chrome.example.org/two", chromeTitle];

function writeChromeTabs(fx, data = chromeData) {
  const file = path.join(fx.home, "chrome-tabs.json");
  writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
  return file;
}

const firefoxTabs = [
  { id: 11, windowId: 1, index: 0, title: "Fire One", url: "https://firefox.example.com/one", active: true },
  { id: 12, windowId: 1, index: 1, title: "Fire Two", url: "https://firefox.example.com/two", active: false },
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

const answerWithTabs = (message, ff) => ff.send({ id: message.id, payload: firefoxTabs });

test("Chrome tabs alone give items with string IDs and arguments that survive the trip", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx, { BSA_TEST_TABS_CHROME: writeChromeTabs(fx) });
  assert.equal(output.skipknowledge, true);
  assert.deepEqual(output.items.map((item) => item.title), chromeTitles);
  assert.deepEqual(
    output.items.map((item) => JSON.parse(item.arg)),
    [
      { action: "activate", browser: "chrome", windowId: "500", tabId: "901", url: "https://chrome.example.com/one" },
      { action: "activate", browser: "chrome", windowId: "500", tabId: "902", url: "https://chrome.example.org/two" },
      { action: "activate", browser: "chrome", windowId: "501", tabId: "903", url: "https://chrome.example.net/3" },
    ],
  );
  assert.equal(output.items[0].subtitle, "Google Chrome · https://chrome.example.com/one");
});

test("without BSA_TEST_TABS_CHROME Chrome counts as not running", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output } = await tab(fx);
  assert.deepEqual(output, { skipknowledge: true, items: [] });
});

test("Firefox and Chrome merge, Firefox first when Alfred's own panel is frontmost", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, answerWithTabs, async (ff) => {
    const { output } = await tab(fx, {
      BSA_TEST_FIREFOX_RUNNING: "1",
      BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
      BSA_TEST_FRONTMOST: "com.runningwithcrayons.Alfred",
    });
    assert.deepEqual(output.items.map((item) => item.title), ["Fire One", "Fire Two", ...chromeTitles]);
    assert.equal(ff.received.length, 1);
  });
});

test("the default order is Firefox first when nothing says what is frontmost", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, answerWithTabs, async () => {
    const { output } = await tab(fx, { BSA_TEST_FIREFOX_RUNNING: "1", BSA_TEST_TABS_CHROME: writeChromeTabs(fx) });
    assert.deepEqual(output.items.map((item) => item.title), ["Fire One", "Fire Two", ...chromeTitles]);
  });
});

test("Chrome frontmost puts the Chrome tabs first", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, answerWithTabs, async () => {
    const { output } = await tab(fx, {
      BSA_TEST_FIREFOX_RUNNING: "1",
      BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
      BSA_TEST_FRONTMOST: CHROME,
    });
    assert.deepEqual(output.items.map((item) => item.title), [...chromeTitles, "Fire One", "Fire Two"]);
  });
});

test("BSA_SKIP_APPLESCRIPT=1 gives no Chrome items even when the Chrome tabs file is set", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, answerWithTabs, async () => {
    const { output } = await tab(fx, {
      BSA_TEST_FIREFOX_RUNNING: "1",
      BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
      BSA_TEST_FRONTMOST: CHROME,
      BSA_SKIP_APPLESCRIPT: "1",
    });
    assert.deepEqual(output.items.map((item) => item.title), ["Fire One", "Fire Two"]);
  });
});

test("browser_chrome=0 gives no Chrome items", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, answerWithTabs, async () => {
    const { output } = await tab(fx, {
      BSA_TEST_FIREFOX_RUNNING: "1",
      BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
      browser_chrome: "0",
    });
    assert.deepEqual(output.items.map((item) => item.title), ["Fire One", "Fire Two"]);
  });
});

test("browser_firefox=0 gives no Firefox items and sends no request", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  await withFirefox(fx, answerWithTabs, async (ff) => {
    const { output } = await tab(fx, {
      BSA_TEST_FIREFOX_RUNNING: "1",
      BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
      browser_firefox: "0",
    });
    assert.deepEqual(output.items.map((item) => item.title), chromeTitles);
    assert.equal(ff.received.length, 0);
  });
});

test("browser_firefox=0 hides the Set up Firefox item too", { skip: !darwin }, async () => {
  const fx = fixture();
  const { output } = await tab(fx, {
    BSA_TEST_FIREFOX_RUNNING: "1",
    BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
    browser_firefox: "0",
  });
  assert.deepEqual(output.items.map((item) => item.title), chromeTitles);
});

test("Firefox that does not answer still shows Chrome tabs within the time budget", { skip: !darwin }, async () => {
  const fx = fixture();
  await setupFirefox(fx);
  const { output, elapsedMs } = await tab(fx, {
    BSA_TEST_FIREFOX_RUNNING: "1",
    BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
  });
  assert.deepEqual(output.items.map((item) => item.title), ["Firefox didn't answer", ...chromeTitles]);
  assert.ok(elapsedMs < 1000, `took ${elapsedMs} ms`);
});

test("the Firefox setup item and Chrome tabs appear together", { skip: !darwin }, async () => {
  const fx = fixture();
  const { output } = await tab(fx, {
    BSA_TEST_FIREFOX_RUNNING: "1",
    BSA_TEST_TABS_CHROME: writeChromeTabs(fx),
    BSA_TEST_FRONTMOST: CHROME,
  });
  assert.deepEqual(output.items.map((item) => item.title), [...chromeTitles, "Set up Firefox"]);
});

test("a broken Chrome tabs file gives no Chrome items and leaves the Firefox tabs alone", { skip: !darwin }, async () => {
  for (const broken of ["this is not json", '{"windows": [null]}', '{"windows": "no"}']) {
    const fx = fixture();
    await setupFirefox(fx);
    await withFirefox(fx, answerWithTabs, async () => {
      const { output } = await tab(fx, {
        BSA_TEST_FIREFOX_RUNNING: "1",
        BSA_TEST_TABS_CHROME: writeChromeTabs(fx, broken),
      });
      assert.deepEqual(output.items.map((item) => item.title), ["Fire One", "Fire Two"], broken);
    });
  }
});

test("act.js activate for Chrome logs the window and tab IDs and nothing else", { skip: !darwin }, async () => {
  const fx = fixture();
  const arg = JSON.stringify({ action: "activate", browser: "chrome", windowId: "501", tabId: "903" });
  const out = await osascript(fx, "act.js", arg);
  assert.equal(out, "");
  assert.equal(readFileSync(path.join(fx.home, "activated-apps.log"), "utf8"), "chrome 501 903\n");
  assert.ok(!existsSync(path.join(fx.home, "Library/Caches")), "no Firefox request is sent for a Chrome tab");
});
