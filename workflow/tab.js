#!/usr/bin/osascript -l JavaScript
// Script Filter entry for the "tab" keyword: osascript -l JavaScript tab.js '<query>'
// Prints Alfred's Script Filter JSON with the open browser tabs.
ObjC.import("Foundation");

// The folder of this script. Alfred runs entries with the workflow folder as the current directory,
// but tests may run the script by absolute path, so find it from the arguments.
function workflowDir() {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).map(String);
  const script = args.find((arg) => /(^|\/)tab\.js$/.test(arg));
  const cwd = String(ObjC.unwrap($.NSFileManager.defaultManager.currentDirectoryPath));
  if (script === undefined) return cwd;
  const full = script.startsWith("/") ? script : `${cwd}/${script}`;
  return String(ObjC.unwrap($(full).stringByDeletingLastPathComponent));
}

const WORKFLOW_DIR = workflowDir();

function loadLib(name) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(
    `${WORKFLOW_DIR}/lib/${name}.js`,
    $.NSUTF8StringEncoding,
    $(),
  );
  return eval(ObjC.unwrap(text));
}

function firefoxItems() {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const registration = loadLib("registration");
  const items = loadLib("items");
  const home = jxa.home();

  const helperCopy = constants.helperInstallPath(home);
  const problem = registration.registrationProblem(
    jxa.readText(constants.registrationPath(home)),
    helperCopy,
    jxa.filesEqual(`${WORKFLOW_DIR}/firefox-helper.js`, helperCopy),
  );
  if (problem !== null) return [items.setupItem(problem)];

  // Tests say whether Firefox is running; otherwise ask macOS. Nothing here ever launches Firefox.
  const running =
    jxa.channel() !== ""
      ? jxa.envVar("BSA_TEST_FIREFOX_RUNNING") === "1"
      : jxa.isRunning(constants.FIREFOX_BUNDLE_ID);
  if (!running) return [];

  const client = loadLib("firefox-client");
  const reply = client.request("list-tabs", null, constants.FIREFOX_TIMEOUT_MS);
  if (!reply.ok || !Array.isArray(reply.payload)) return [items.firefoxSilentItem()];

  const appPath = jxa.appPath(constants.FIREFOX_BUNDLE_ID);
  return reply.payload.map((t) =>
    items.tabItem(
      { browser: "firefox", browserName: "Firefox", windowId: t.windowId, tabId: t.id, title: t.title || "", url: t.url || "" },
      appPath,
    ),
  );
}

function run() {
  const items = loadLib("items");
  return JSON.stringify(items.scriptFilterOutput(firefoxItems()));
}
