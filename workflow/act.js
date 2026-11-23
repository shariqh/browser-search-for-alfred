#!/usr/bin/osascript -l JavaScript
// Entry for actions: osascript -l JavaScript act.js '<json>'
// The JSON has an "action": "setup-firefox" installs the helper copy and registers it with Firefox;
// "activate" brings one browser tab (Firefox, Chrome, Safari, Brave or Edge) to the front; "open" opens a bookmark or
// history URL in its own browser, "open-default" in the default browser, "open-privacy" opens Full Disk Access in
// System Settings, and "open-automation" opens Automation there.
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

// Brings one tab to the front. Firefox: the add-on selects the tab and its window, then macOS raises Firefox. If the
// tab closed meanwhile the add-on's answer is an error, which is ignored; Firefox still comes forward if it is
// running and is never launched. Chrome, Brave and Edge: chromium.js selects the tab by its ID. Safari: its tabs
// have no ID, so safari-tabs.js takes the tab at that position when it still shows the URL, else the first tab in
// that window with the URL, else nothing. A tab or window that closed since the list was shown makes these do
// nothing, and they are only touched while running, so Enter never launches a browser.
function activate(request) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  if (request.browser === "firefox") {
    const client = loadLib("firefox-client");
    client.request("activate-tab", { tabId: request.tabId, windowId: request.windowId }, constants.FIREFOX_TIMEOUT_MS);
    jxa.activateApp(constants.FIREFOX_BUNDLE_ID);
    return;
  }
  const registry = loadLib("browsers");
  const browser = registry.ALL.find((b) => b.key === request.browser && b.family !== "firefox");
  if (!browser) throw new Error(`unknown browser: ${request.browser}`);
  const windowId = String(request.windowId);
  const tabId = String(request.tabId);
  // Tests never touch a real browser: the activation is only logged.
  if (jxa.channel() !== "") {
    jxa.logActivation(`${browser.key} ${windowId} ${tabId}`);
    return;
  }
  if (!jxa.isRunning(browser.bundleId)) return;
  // By bundle ID, like the isRunning check. A browser that quits in the few milliseconds between the two could be
  // relaunched by JXA; that window is accepted.
  const app = Application(browser.bundleId);
  if (browser.family === "safari") {
    loadLib("safari-tabs").activateTab(app, windowId, tabId, String(request.url));
  } else {
    loadLib("chromium").activateTab(app, windowId, tabId);
  }
}

const OPEN = "/usr/bin/open";
const PRIVACY_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";
// macOS 27.3's privacy pane index does not list this anchor, so the Allow item's subtitle spells out the path too.
const AUTOMATION_PANE = "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation";

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

// Opens the URL in the default browser, by its bundle ID. A plain `open <url>` would hand a file: URL to the file's
// own app, and could run a .command file or launch an app.
function openInDefaultBrowser(request) {
  const url = openableUrl(request.url);
  const bundleId = loadLib("jxa").defaultBrowserBundleId();
  if (bundleId === "") throw new Error("no default browser");
  runOpen(["-b", bundleId, url], `open-default ${bundleId} ${url}`);
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
    case "open-default":
      openInDefaultBrowser(request);
      return;
    case "open-privacy":
      runOpen([PRIVACY_PANE], "open-privacy");
      return;
    case "open-automation":
      runOpen([AUTOMATION_PANE], "open-automation");
      return;
    default:
      throw new Error(`unknown action: ${request.action}`);
  }
}
