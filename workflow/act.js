#!/usr/bin/osascript -l JavaScript
// Entry for actions: osascript -l JavaScript act.js '<json>'
// The JSON has an "action": "setup-firefox" installs the helper copy and registers it with Firefox;
// "activate" brings one browser tab (Firefox or Chrome) to the front; "open" opens a bookmark or history URL in
// its own browser, "open-default" in the default browser, and "open-privacy" opens Full Disk Access in System Settings.
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
  if (request.browser === "chrome") {
    // Tests never touch a real Chrome: the activation is only logged.
    if (jxa.channel() !== "") {
      jxa.logActivation(`chrome ${request.windowId} ${request.tabId}`);
      return;
    }
    // Chrome is only touched while it runs, so a closed Chrome is never launched by Enter.
    if (!jxa.isRunning(constants.CHROME_BUNDLE_ID)) return;
    // A tab or window that closed since the list was shown makes this do nothing.
    // By bundle ID, like the isRunning check. A Chrome that quits in the few milliseconds between the two could
    // be relaunched by JXA; that window is accepted.
    loadLib("chromium").activateTab(Application(constants.CHROME_BUNDLE_ID), String(request.windowId), String(request.tabId));
    return;
  }
  throw new Error(`unknown browser: ${request.browser}`);
}

const OPEN = "/usr/bin/open";
const PRIVACY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

// Runs /usr/bin/open with `args` (an argv array, no shell). Under BSA_TEST_CHANNEL nothing is opened: logLine is
// logged instead (see jxa.logActivation).
function runOpen(args, logLine) {
  const jxa = loadLib("jxa");
  if (jxa.channel() !== "") {
    jxa.logActivation(logLine);
    return;
  }
  const result = jxa.finishProcess(jxa.startProcess(OPEN, args, null), Date.now() + 5000);
  if (result.status !== 0) throw new Error("open failed");
}

// Only http:, https: and file: URLs are opened. isOpenableUrl also rules out a URL that open could read as an option.
function openableUrl(url) {
  if (!loadLib("items").isOpenableUrl(url)) throw new Error("refused to open that URL");
  return url;
}

// Opens a bookmark or history URL in the browser it came from. This may start that browser: Return is an explicit ask.
function openInBrowser(request) {
  const constants = loadLib("constants");
  const bundleIds = { firefox: constants.FIREFOX_BUNDLE_ID, chrome: constants.CHROME_BUNDLE_ID, safari: constants.SAFARI_BUNDLE_ID };
  if (!Object.prototype.hasOwnProperty.call(bundleIds, request.browser)) throw new Error(`unknown browser: ${request.browser}`);
  const bundleId = bundleIds[request.browser];
  const url = openableUrl(request.url);
  runOpen(["-b", bundleId, url], `open ${bundleId} ${url}`);
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
    case "open":
      openInBrowser(request);
      return;
    case "open-default": {
      const url = openableUrl(request.url);
      runOpen([url], `open-default ${url}`);
      return;
    }
    case "open-privacy":
      runOpen([PRIVACY_PANE], "open-privacy");
      return;
    default:
      throw new Error(`unknown action: ${request.action}`);
  }
}
