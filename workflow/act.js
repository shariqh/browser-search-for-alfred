#!/usr/bin/osascript -l JavaScript
// Entry for actions: osascript -l JavaScript act.js '<json>'
// The JSON has an "action": "setup-firefox" installs the helper copy and registers it with Firefox;
// "activate" brings one browser tab to the front.
ObjC.import("Foundation");

// The folder of this script. Alfred runs entries with the workflow folder as the current directory,
// but tests may run the script by absolute path, so find it from the arguments.
function workflowDir() {
  const args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments).map(String);
  const script = args.find((arg) => /(^|\/)act\.js$/.test(arg));
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

function setupFirefox() {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const registration = loadLib("registration");
  const home = jxa.home();
  const helperPath = constants.helperInstallPath(home);
  const registrationFile = constants.registrationPath(home);
  const dirOf = (path) => String(ObjC.unwrap($(path).stringByDeletingLastPathComponent));

  // Normal Application Support folders: 755. ensureDir also sets the mode of every call's last folder,
  // so make the parents first and leave an existing Application Support folder alone.
  const support = `${home}/Library/Application Support`;
  for (const dir of [`${support}/Mozilla`, dirOf(registrationFile), dirOf(helperPath)]) {
    if (!jxa.fileExists(dir)) jxa.ensureDir(dir, 0o755);
  }

  jxa.copyFileAtomic(`${WORKFLOW_DIR}/firefox-helper.js`, helperPath, 0o755);
  const text = JSON.stringify(registration.registrationManifest(helperPath), null, 2) + "\n";
  jxa.writeTextAtomic(registrationFile, text, 0o644);
}

// Brings a Firefox tab to the front: the add-on selects the tab and its window, then macOS raises Firefox.
// If the tab closed meanwhile the add-on's answer is an error, which is ignored; Firefox still comes forward
// if it is running and is never launched.
function activate(request) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  if (request.browser === "firefox") {
    const client = loadLib("firefox-client");
    client.request("activate-tab", { tabId: request.tabId, windowId: request.windowId }, constants.FIREFOX_TIMEOUT_MS);
    jxa.activateApp(constants.FIREFOX_BUNDLE_ID);
    return;
  }
  throw new Error(`unknown browser: ${request.browser}`);
}

function run(argv) {
  const request = JSON.parse(argv[0] || "{}");
  switch (request.action) {
    case "setup-firefox":
      setupFirefox();
      return;
    case "activate":
      activate(request);
      return;
    default:
      throw new Error(`unknown action: ${request.action}`);
  }
}
