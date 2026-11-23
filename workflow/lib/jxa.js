(function () {
  ObjC.import("Foundation");
  ObjC.import("stdlib");

  const fm = () => $.NSFileManager.defaultManager;

  function envVar(name) {
    const value = $.NSProcessInfo.processInfo.environment.objectForKey(name);
    return value.isNil() ? "" : String(ObjC.unwrap(value));
  }

  // The HOME environment variable, falling back to NSHomeDirectory().
  function home() {
    const fromEnv = envVar("HOME");
    return fromEnv !== "" ? fromEnv : String(ObjC.unwrap($.NSHomeDirectory()));
  }

  // BSA_TEST_CHANNEL, or "" outside tests.
  function channel() {
    return envVar("BSA_TEST_CHANNEL");
  }

  function readText(path) {
    const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, $());
    return text.isNil() ? null : String(ObjC.unwrap(text));
  }

  function setMode(path, mode) {
    const attrs = $.NSDictionary.dictionaryWithObjectForKey($(mode), $.NSFilePosixPermissions);
    fm().setAttributesOfItemAtPathError(attrs, path, $());
  }

  // mode is a number such as 0o600. The write is atomic: a reader sees the old file or the whole new one.
  function writeTextAtomic(path, text, mode) {
    const ok = $(String(text)).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, $());
    if (!ok) throw new Error(`cannot write ${path}`);
    setMode(path, mode === undefined ? 0o600 : mode);
  }

  // Creates the folder (and any parents) and sets the mode of the folder itself.
  function ensureDir(path, mode) {
    const attrs = $.NSDictionary.dictionaryWithObjectForKey($(mode), $.NSFilePosixPermissions);
    fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, attrs, $());
    setMode(path, mode);
  }

  function remove(path) {
    fm().removeItemAtPathError(path, $());
  }

  function fileExists(path) {
    return Boolean(fm().fileExistsAtPath(path));
  }

  // Distributed notifications carry only a name and one string.
  function postNotification(name, object) {
    $.NSDistributedNotificationCenter.defaultCenter.postNotificationNameObjectUserInfoDeliverImmediately(
      name,
      $(String(object)),
      $(),
      true,
    );
  }

  // Runs the run loop in 20 ms slices until predicate() is true or the clock reaches deadlineMs
  // (an absolute time in milliseconds since 1970, like Date.now() + 400). Returns whether predicate held.
  function waitFor(predicate, deadlineMs) {
    for (;;) {
      if (predicate()) return true;
      if (Date.now() >= deadlineMs) return false;
      $.NSRunLoop.currentRunLoop.runModeBeforeDate(
        $.NSDefaultRunLoopMode,
        $.NSDate.dateWithTimeIntervalSinceNow(0.02),
      );
    }
  }

  function isRunning(bundleId) {
    ObjC.import("AppKit");
    return Number($.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleId).count) > 0;
  }

  // Brings a running app to the front without Apple Events. Under BSA_TEST_CHANNEL it activates
  // nothing: it appends the bundle ID to $HOME/activated-apps.log and returns true.
  function activateApp(bundleId) {
    if (channel() !== "") {
      const log = `${home()}/activated-apps.log`;
      writeTextAtomic(log, (readText(log) || "") + bundleId + "\n", 0o600);
      return true;
    }
    ObjC.import("AppKit");
    const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleId);
    if (Number(apps.count) === 0) return false;
    const options = $.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps;
    return Boolean(apps.objectAtIndex(0).activateWithOptions(options));
  }

  // The path of the installed app with that bundle ID, or null.
  function appPath(bundleId) {
    ObjC.import("AppKit");
    const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(bundleId);
    return url.isNil() ? null : String(ObjC.unwrap(url.path));
  }

  const api = {
    home,
    channel,
    readText,
    writeTextAtomic,
    ensureDir,
    remove,
    fileExists,
    postNotification,
    waitFor,
    isRunning,
    activateApp,
    appPath,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
