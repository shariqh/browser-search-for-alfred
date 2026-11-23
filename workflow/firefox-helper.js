#!/usr/bin/osascript -l JavaScript
// The native-messaging helper that Firefox starts for the add-on. It is one self-contained file
// and loads nothing at runtime, so the copy that "Set up Firefox" installs works on its own.
//
// Firefox talks to it on stdin and stdout: a 4-byte little-endian length, then UTF-8 JSON.
// Alfred's scripts talk to it through files in a private folder, with a notification that carries
// only the request ID:
//   <privateDir>/<id>.request.json   written by the client: {id, command, params}
//   <privateDir>/<id>.reply.json     written here: {id, payload} or {id, error}
// Paths never come from a request. Only an ID that matches ID_PATTERN is ever turned into a path.

ObjC.import("Foundation");
ObjC.import("stdlib");
ObjC.import("sys/stat");

// These duplicate workflow/lib/constants.js (a test compares them). Keep them plain string literals.
const BUNDLE_ID = "io.github.shariqh.browser-search-for-alfred";
const REQUEST_NOTIFICATION = "io.github.shariqh.browser-search-for-alfred.request";
const REPLY_NOTIFICATION = "io.github.shariqh.browser-search-for-alfred.reply";

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

// Only these commands are ever forwarded to Firefox; anything else gets an error reply.
const ALLOWED_COMMANDS = ["list-tabs", "activate-tab", "list-bookmarks", "search-history"];
// The add-on checks the same limits again (addon/handler.js has its own copy of these rules).
const QUERY_MAX_CHARS = 512;
const HISTORY_MAX_RESULTS = 50;
// A request is a few hundred bytes; a bigger file is not from our client and is deleted unread.
const MAX_REQUEST_BYTES = 16 * 1024;
// Firefox documents 1 MB as the limit for a message to a native host and 4 GB the other way. Tab lists are
// the largest thing we expect, so a frame over 64 MB means the stream is out of step.
const MAX_FRAME_BYTES = 64 * 1024 * 1024;

const environment = $.NSProcessInfo.processInfo.environment;

function envVar(name) {
  const value = environment.objectForKey(name);
  return value.isNil() ? "" : String(ObjC.unwrap(value));
}

const HOME = envVar("HOME") !== "" ? envVar("HOME") : String(ObjC.unwrap($.NSHomeDirectory()));
const CHANNEL = envVar("BSA_TEST_CHANNEL");
const PRIVATE_DIR = `${HOME}/Library/Caches/${BUNDLE_ID}/firefox`;

// Request and reply files older than this are leftovers (a client that timed out or was killed, a late
// reply) and are swept. Tests may shorten it with BSA_TEST_STALE_MS, honoured only under BSA_TEST_CHANNEL.
const STALE_MS = CHANNEL !== "" && Number(envVar("BSA_TEST_STALE_MS")) > 0 ? Number(envVar("BSA_TEST_STALE_MS")) : 60000;
const LEFTOVER_PATTERN = /^[A-Za-z0-9-]{1,64}\.(request|reply)\.json$/;

function notificationName(base) {
  return CHANNEL !== "" ? `${base}.test.${CHANNEL}` : base;
}

const fileManager = $.NSFileManager.defaultManager;

function setMode(path, mode) {
  const attrs = $.NSDictionary.dictionaryWithObjectForKey($(mode), $.NSFilePosixPermissions);
  fileManager.setAttributesOfItemAtPathError(attrs, path, $());
}

// The folder is never visible with a mode other than 700: a umask that removes the group and other
// bits is in force while it is created, and a folder that already exists is chmodded before we go on.
function ensurePrivateDir() {
  const attrs = $.NSDictionary.dictionaryWithObjectForKey($(0o700), $.NSFilePosixPermissions);
  const previous = $.umask(0o077);
  try {
    fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(PRIVATE_DIR, true, attrs, $());
  } finally {
    $.umask(previous);
  }
  setMode(PRIVATE_DIR, 0o700);
}

function readText(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, $());
  return text.isNil() ? null : String(ObjC.unwrap(text));
}

function writeTextAtomic(path, text) {
  const ok = $(text).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, $());
  if (ok) setMode(path, 0o600);
  return ok;
}

function removeFile(path) {
  fileManager.removeItemAtPathError(path, $());
}

// One fixed line on stderr, never any data: Firefox shows a native host's stderr in its browser console.
function logProblem(line) {
  try {
    $.NSFileHandle.fileHandleWithStandardError.writeData($(line + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
  } catch (e) {
    // Nothing more can be done.
  }
}

// The size in bytes of a file, from its attributes (the file is not read), or null when it cannot be seen.
function fileSize(path) {
  const attrs = fileManager.attributesOfItemAtPathError(path, $());
  if (attrs.isNil()) return null;
  const size = attrs.objectForKey($.NSFileSize);
  return size.isNil() ? null : Number(size.unsignedLongLongValue);
}

// Deletes leftover request and reply files older than STALE_MS, and forgets requests that old.
// Called at start and on every request, so a late reply never stays for long.
function sweep() {
  const now = Date.now();
  for (const id of Object.keys(pending)) {
    if (now - pending[id] > STALE_MS) delete pending[id];
  }
  const names = fileManager.contentsOfDirectoryAtPathError(PRIVATE_DIR, $());
  if (names.isNil()) return;
  const count = Number(names.count);
  for (let i = 0; i < count; i++) {
    const name = String(ObjC.unwrap(names.objectAtIndex(i)));
    if (!LEFTOVER_PATTERN.test(name)) continue;
    const path = `${PRIVATE_DIR}/${name}`;
    const attrs = fileManager.attributesOfItemAtPathError(path, $());
    if (attrs.isNil()) continue;
    const modified = attrs.objectForKey($.NSFileModificationDate);
    if (modified.isNil()) continue;
    if (now - Number(modified.timeIntervalSince1970) * 1000 > STALE_MS) removeFile(path);
  }
}

// ---- Firefox side: framed messages on stdin and stdout --------------------------------------

const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
let inbox = $.NSMutableData.data;

// Ids of requests forwarded to Firefox that have not been answered yet, with the time each was forwarded.
// No prototype, so an id such as "constructor" is not found by accident.
const pending = Object.create(null);

function latin1(str) {
  return $.NSString.alloc.initWithString(str).dataUsingEncoding($.NSISOLatin1StringEncoding);
}

function sendToFirefox(message) {
  const body = $.NSString.alloc.initWithUTF8String(JSON.stringify(message)).dataUsingEncoding($.NSUTF8StringEncoding);
  const n = Number(body.length);
  const out = $.NSMutableData.data;
  out.appendData(latin1(String.fromCharCode(n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255)));
  out.appendData(body);
  stdout.writeData(out);
}

// Writes <id>.reply.json and tells the client. The id has already matched ID_PATTERN.
function writeReply(id, reply) {
  if (writeTextAtomic(`${PRIVATE_DIR}/${id}.reply.json`, JSON.stringify(reply))) {
    $.NSDistributedNotificationCenter.defaultCenter.postNotificationNameObjectUserInfoDeliverImmediately(
      notificationName(REPLY_NOTIFICATION),
      $(id),
      $(),
      true,
    );
  }
}

function handleFirefoxMessage(message) {
  if (message === null || typeof message !== "object") return;
  const id = message.id;
  if (typeof id !== "string" || !ID_PATTERN.test(id) || pending[id] === undefined) return;
  delete pending[id];
  writeReply(id, "error" in message ? { id, error: message.error } : { id, payload: message.payload });
}

function drainInbox() {
  while (Number(inbox.length) >= 4) {
    const header = ObjC.unwrap(
      $.NSString.alloc.initWithDataEncoding(inbox.subdataWithRange($.NSMakeRange(0, 4)), $.NSISOLatin1StringEncoding),
    );
    // >>> 0 reads the four bytes as an unsigned number (a plain << 24 can come out negative).
    const n = (header.charCodeAt(0) | (header.charCodeAt(1) << 8) | (header.charCodeAt(2) << 16) | (header.charCodeAt(3) << 24)) >>> 0;
    if (n > MAX_FRAME_BYTES) {
      logProblem("browser-search-for-alfred helper: message too large, exiting");
      $.exit(1);
    }
    const total = Number(inbox.length);
    if (total < 4 + n) return;
    const json = ObjC.unwrap(
      $.NSString.alloc.initWithDataEncoding(inbox.subdataWithRange($.NSMakeRange(4, n)), $.NSUTF8StringEncoding),
    );
    inbox = $.NSMutableData.dataWithData(inbox.subdataWithRange($.NSMakeRange(4 + n, total - 4 - n)));
    let message = null;
    try {
      message = JSON.parse(json);
    } catch (e) {
      // A frame that is not JSON is dropped.
    }
    // One bad message must not strand the frames that came with it.
    try {
      handleFirefoxMessage(message);
    } catch (e) {
      logProblem("browser-search-for-alfred helper: could not handle a message from Firefox");
    }
  }
}

// ---- Alfred side: a request notification names a request file ---------------------------------

function handleRequestNotification(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return;
  sweep();
  const requestFile = `${PRIVATE_DIR}/${id}.request.json`;
  const size = fileSize(requestFile);
  if (size === null) return;
  if (size > MAX_REQUEST_BYTES) {
    // Not from our client: delete it unread and say nothing.
    removeFile(requestFile);
    return;
  }
  const text = readText(requestFile);
  if (text === null) return;
  removeFile(requestFile);
  let request;
  try {
    request = JSON.parse(text);
  } catch (e) {
    return;
  }
  if (request === null || typeof request !== "object" || typeof request.command !== "string") return;
  if (!ALLOWED_COMMANDS.includes(request.command)) {
    writeReply(id, { id, error: "unsupported command" });
    return;
  }
  if (request.command === "activate-tab") {
    // Both IDs must be integers; the add-on checks again, but a malformed request never leaves this file.
    const params = request.params;
    if (params === null || typeof params !== "object" || !Number.isInteger(params.tabId) || !Number.isInteger(params.windowId)) {
      writeReply(id, { id, error: "invalid params" });
      return;
    }
  }
  if (request.command === "search-history") {
    const params = request.params;
    if (
      params === null ||
      typeof params !== "object" ||
      typeof params.query !== "string" ||
      params.query.length > QUERY_MAX_CHARS ||
      !Number.isInteger(params.maxResults) ||
      params.maxResults < 1 ||
      params.maxResults > HISTORY_MAX_RESULTS
    ) {
      writeReply(id, { id, error: "invalid params" });
      return;
    }
  }
  // These two commands take no parameters, so whatever the request carried is not passed on.
  const takesParams = request.command === "activate-tab" || request.command === "search-history";
  pending[id] = Date.now();
  // Parameters are forwarded exactly as received: 0, false and "" are real values.
  sendToFirefox({ id, command: request.command, params: takesParams ? request.params : null });
}

ObjC.registerSubclass({
  name: "BrowserSearchFirefoxHelperObserver",
  methods: {
    "onStdin:": {
      types: ["void", ["id"]],
      implementation: function (note) {
        // Not being able to read the data counts as end of input: re-arming a broken read could spin.
        let data = null;
        try {
          data = note.userInfo.objectForKey($.NSFileHandleNotificationDataItem);
        } catch (e) {
          $.exit(0);
        }
        // End of file: Firefox closed our stdin. (A plain `data.length === 0` never matched here.)
        let ended = true;
        try {
          ended = data.isNil() || Number(data.length) === 0;
        } catch (e) {
          // ended stays true
        }
        if (ended) $.exit(0);
        try {
          inbox.appendData(data);
          drainInbox();
        } catch (e) {
          // Never throw out of a callback: it is swallowed, and the read must be re-armed.
          logProblem("browser-search-for-alfred helper: could not read from Firefox");
        }
        stdin.readInBackgroundAndNotify;
      },
    },
    "onRequest:": {
      types: ["void", ["id"]],
      implementation: function (note) {
        try {
          handleRequestNotification(ObjC.unwrap(note.object));
        } catch (e) {
          // One bad request must not stop the helper.
          logProblem("browser-search-for-alfred helper: could not handle a request");
        }
      },
    },
  },
});

const observer = $.BrowserSearchFirefoxHelperObserver.alloc.init;
$.NSNotificationCenter.defaultCenter.addObserverSelectorNameObject(
  observer,
  "onStdin:",
  $.NSFileHandleReadCompletionNotification,
  stdin,
);
$.NSDistributedNotificationCenter.defaultCenter.addObserverSelectorNameObjectSuspensionBehavior(
  observer,
  "onRequest:",
  notificationName(REQUEST_NOTIFICATION),
  $(),
  $.NSNotificationSuspensionBehaviorDeliverImmediately,
);
stdin.readInBackgroundAndNotify;

// The folder comes last: once it exists, the observers above are registered.
ensurePrivateDir();
sweep();

for (;;) {
  $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.distantFuture);
}
