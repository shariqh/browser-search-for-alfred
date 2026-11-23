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

  // Why a read failed, from the NSError its call filled in (nil when the call gave none): "denied" is
  // NSCocoaErrorDomain 257, from privacy protection or the file's mode (NSFileHandle reports a file's mode as 513,
  // NSFileWriteNoPermissionError, verified on macOS 27.3); "missing" is 260, or NSFileNoSuchFileError 4; anything else
  // is "error".
  function failureReason(err) {
    const code = err.isNil() ? null : Number(err.code);
    if (code === 257 || code === 513) return "denied";
    if (code === 4 || code === 260) return "missing";
    return "error";
  }

  // {ok: true, text} or {ok: false, reason}, the reason as failureReason gives it. Text that is not UTF-8 is "error".
  function readFileResult(path) {
    const err = $();
    const data = $.NSData.dataWithContentsOfFileOptionsError(path, 0, err);
    if (data.isNil()) return { ok: false, reason: failureReason(err) };
    const text = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
    return text.isNil() ? { ok: false, reason: "error" } : { ok: true, text: String(ObjC.unwrap(text)) };
  }

  // {ok: true, value} or {ok: false, reason}, like readFileResult, for a property list (XML or binary) whose
  // top level is a dictionary. value is plain JS (ObjC.deepUnwrap); data and date values come out as opaque objects.
  function readPlistResult(path) {
    const err = $();
    const dict = $.NSDictionary.dictionaryWithContentsOfURLError($.NSURL.fileURLWithPath(path), err);
    return dict.isNil() ? { ok: false, reason: failureReason(err) } : { ok: true, value: ObjC.deepUnwrap(dict) };
  }

  // "ok" when the file can be opened for reading, else "missing", "denied" or "error", without reading it. This is
  // how macOS privacy protection answers for a file we have no right to, such as Safari's without Full Disk Access.
  function accessResult(path) {
    const err = $();
    const handle = $.NSFileHandle.fileHandleForReadingFromURLError($.NSURL.fileURLWithPath(path), err);
    if (handle.isNil()) return failureReason(err);
    handle.closeAndReturnError($());
    return "ok";
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

  // Creates the folder (and any parents) so that the folder itself is never visible with a looser
  // mode than `mode`: a umask that removes the other bits is in force while it is created. A folder that
  // already exists gets its mode set before ensureDir returns.
  function ensureDir(path, mode) {
    ObjC.import("sys/stat");
    const attrs = $.NSDictionary.dictionaryWithObjectForKey($(mode), $.NSFilePosixPermissions);
    const previous = $.umask(~mode & 0o777);
    try {
      fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError(path, true, attrs, $());
    } finally {
      $.umask(previous);
    }
    setMode(path, mode);
  }

  function remove(path) {
    fm().removeItemAtPathError(path, $());
  }

  function fileExists(path) {
    return Boolean(fm().fileExistsAtPath(path));
  }

  // True when both files exist and hold exactly the same bytes.
  function filesEqual(pathA, pathB) {
    const a = $.NSData.dataWithContentsOfFile(pathA);
    const b = $.NSData.dataWithContentsOfFile(pathB);
    if (a.isNil() || b.isNil()) return false;
    return Boolean(a.isEqualToData(b));
  }

  // Copies the bytes of src over dest atomically (a reader sees the old file or the whole new one),
  // then sets the mode of dest.
  function copyFileAtomic(src, dest, mode) {
    const data = $.NSData.dataWithContentsOfFile(src);
    if (data.isNil()) throw new Error(`cannot read ${src}`);
    if (!data.writeToFileAtomically(dest, true)) throw new Error(`cannot write ${dest}`);
    setMode(dest, mode);
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

  // Starts `executable` with `args` through NSTask, never a shell, and returns at once with a handle for
  // finishProcess. stdout goes to `stdoutPath`, created (or emptied) with mode 600, or to /dev/null when it is
  // null; stderr always goes to /dev/null. A process that cannot start gives a handle finishProcess reports
  // as {exited: true, status: null}.
  function startProcess(executable, args, stdoutPath) {
    const handle = { task: null, stdout: null, pid: null };
    try {
      let stdout = $.NSFileHandle.fileHandleWithNullDevice;
      if (stdoutPath !== null) {
        const attrs = $.NSDictionary.dictionaryWithObjectForKey($(0o600), $.NSFilePosixPermissions);
        if (!fm().createFileAtPathContentsAttributes(stdoutPath, $.NSData.data, attrs)) return handle;
        setMode(stdoutPath, 0o600);
        stdout = $.NSFileHandle.fileHandleForWritingAtPath(stdoutPath);
        if (stdout.isNil()) return handle;
        handle.stdout = stdout;
      }
      const task = $.NSTask.alloc.init;
      task.executableURL = $.NSURL.fileURLWithPath(executable);
      task.arguments = $(args.map(String));
      task.standardOutput = stdout;
      task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
      if (task.launchAndReturnError($())) {
        handle.task = task;
        handle.pid = Number(task.processIdentifier);
      }
    } catch (e) {
      // handle.task stays null: the process did not start.
    }
    return handle;
  }

  // Waits (running the run loop, see waitFor) until the process ends or the clock reaches deadlineMs.
  // Returns {exited, status}: exited is false only when the deadline passed, and then the process has been
  // sent SIGTERM (and SIGKILL if it is still there 100 ms later). status is the exit status, or null when
  // the process did not exit by itself or never started. The stdout file is closed either way.
  function finishProcess(handle, deadlineMs) {
    const task = handle.task;
    try {
      if (task === null) return { exited: true, status: null };
      if (waitFor(() => !task.isRunning, deadlineMs)) {
        return { exited: true, status: task.terminationReason === $.NSTaskTerminationReasonExit ? Number(task.terminationStatus) : null };
      }
      task.terminate;
      if (!waitFor(() => !task.isRunning, Date.now() + 100)) {
        ObjC.import("signal");
        $.kill(handle.pid, $.SIGKILL);
        waitFor(() => !task.isRunning, Date.now() + 100);
      }
      return { exited: false, status: null };
    } finally {
      if (handle.stdout !== null) handle.stdout.closeFile;
    }
  }

  function isRunning(bundleId) {
    ObjC.import("AppKit");
    return Number($.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleId).count) > 0;
  }

  // Under BSA_TEST_CHANNEL, activations are logged instead of performed: one line is appended to
  // $HOME/activated-apps.log.
  function logActivation(line) {
    const log = `${home()}/activated-apps.log`;
    writeTextAtomic(log, (readText(log) || "") + line + "\n", 0o600);
  }

  // Brings a running app to the front without Apple Events. Under BSA_TEST_CHANNEL it activates
  // nothing: it logs the bundle ID (see logActivation) and returns true.
  function activateApp(bundleId) {
    if (channel() !== "") {
      logActivation(bundleId);
      return true;
    }
    ObjC.import("AppKit");
    const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(bundleId);
    if (Number(apps.count) === 0) return false;
    const options = $.NSApplicationActivateAllWindows | $.NSApplicationActivateIgnoringOtherApps;
    return Boolean(apps.objectAtIndex(0).activateWithOptions(options));
  }

  // The bundle ID of the browser the person was last in, or "" when unknown. While Alfred's panel is open,
  // Alfred itself is the frontmost app, but the menu bar still belongs to the app underneath, so ask for
  // the menu-bar owner first and fall back to the frontmost app when that is nil or is Alfred. No Apple Events.
  // Under BSA_TEST_CHANNEL it is BSA_TEST_FRONTMOST, so tests never depend on the real desktop.
  // The real path has no automated test (R1): the Task 9 try-out checks it by hand, with each browser in front.
  function frontmostBundleId() {
    if (channel() !== "") return envVar("BSA_TEST_FRONTMOST");
    ObjC.import("AppKit");
    const idOf = (app) => {
      if (app.isNil()) return "";
      const id = app.bundleIdentifier;
      return id.isNil() ? "" : String(ObjC.unwrap(id));
    };
    const workspace = $.NSWorkspace.sharedWorkspace;
    const owner = idOf(workspace.menuBarOwningApplication);
    if (owner !== "" && owner !== "com.runningwithcrayons.Alfred") return owner;
    return idOf(workspace.frontmostApplication);
  }

  // The path of the installed app with that bundle ID, or null.
  function appPath(bundleId) {
    ObjC.import("AppKit");
    const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(bundleId);
    return url.isNil() ? null : String(ObjC.unwrap(url.path));
  }

  const api = {
    envVar,
    home,
    channel,
    readText,
    readFileResult,
    readPlistResult,
    accessResult,
    writeTextAtomic,
    ensureDir,
    remove,
    fileExists,
    filesEqual,
    copyFileAtomic,
    postNotification,
    waitFor,
    startProcess,
    finishProcess,
    isRunning,
    logActivation,
    activateApp,
    frontmostBundleId,
    appPath,
  };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
