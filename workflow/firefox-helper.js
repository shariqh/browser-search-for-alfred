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

// These duplicate workflow/lib/constants.js (a test compares them). Keep them plain string literals.
const BUNDLE_ID = "io.github.shariqh.browser-search-for-alfred";
const REQUEST_NOTIFICATION = "io.github.shariqh.browser-search-for-alfred.request";
const REPLY_NOTIFICATION = "io.github.shariqh.browser-search-for-alfred.reply";

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

const environment = $.NSProcessInfo.processInfo.environment;

function envVar(name) {
  const value = environment.objectForKey(name);
  return value.isNil() ? "" : String(ObjC.unwrap(value));
}

const HOME = envVar("HOME") !== "" ? envVar("HOME") : String(ObjC.unwrap($.NSHomeDirectory()));
const CHANNEL = envVar("BSA_TEST_CHANNEL");
const PRIVATE_DIR = `${HOME}/Library/Caches/${BUNDLE_ID}/firefox`;

function notificationName(base) {
  return CHANNEL !== "" ? `${base}.test.${CHANNEL}` : base;
}

const fileManager = $.NSFileManager.defaultManager;

function setMode(path, mode) {
  const attrs = $.NSDictionary.dictionaryWithObjectForKey($(mode), $.NSFilePosixPermissions);
  fileManager.setAttributesOfItemAtPathError(attrs, path, $());
}

function ensurePrivateDir() {
  const attrs = $.NSDictionary.dictionaryWithObjectForKey($(0o700), $.NSFilePosixPermissions);
  fileManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(PRIVATE_DIR, true, attrs, $());
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

// ---- Firefox side: framed messages on stdin and stdout --------------------------------------

const stdin = $.NSFileHandle.fileHandleWithStandardInput;
const stdout = $.NSFileHandle.fileHandleWithStandardOutput;
let inbox = $.NSMutableData.data;

// Ids of requests forwarded to Firefox that have not been answered yet.
const pending = {};

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

function handleFirefoxMessage(message) {
  if (message === null || typeof message !== "object") return;
  const id = message.id;
  if (typeof id !== "string" || !ID_PATTERN.test(id) || !pending[id]) return;
  delete pending[id];
  const reply = "error" in message ? { id, error: message.error } : { id, payload: message.payload };
  if (writeTextAtomic(`${PRIVATE_DIR}/${id}.reply.json`, JSON.stringify(reply))) {
    $.NSDistributedNotificationCenter.defaultCenter.postNotificationNameObjectUserInfoDeliverImmediately(
      notificationName(REPLY_NOTIFICATION),
      $(id),
      $(),
      true,
    );
  }
}

function drainInbox() {
  while (Number(inbox.length) >= 4) {
    const header = ObjC.unwrap(
      $.NSString.alloc.initWithDataEncoding(inbox.subdataWithRange($.NSMakeRange(0, 4)), $.NSISOLatin1StringEncoding),
    );
    const n = header.charCodeAt(0) | (header.charCodeAt(1) << 8) | (header.charCodeAt(2) << 16) | (header.charCodeAt(3) << 24);
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
    handleFirefoxMessage(message);
  }
}

// ---- Alfred side: a request notification names a request file ---------------------------------

function handleRequestNotification(id) {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return;
  const requestFile = `${PRIVATE_DIR}/${id}.request.json`;
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
  pending[id] = true;
  // params is forwarded exactly as received: 0, false and "" are real values.
  sendToFirefox({ id, command: request.command, params: request.params });
}

ObjC.registerSubclass({
  name: "BrowserSearchFirefoxHelperObserver",
  methods: {
    "onStdin:": {
      types: ["void", ["id"]],
      implementation: function (note) {
        try {
          const data = note.userInfo.objectForKey($.NSFileHandleNotificationDataItem);
          // End of file: Firefox closed our stdin. (A plain `data.length === 0` never matched here.)
          if (data.isNil() || Number(data.length) === 0) $.exit(0);
          inbox.appendData(data);
          drainInbox();
        } catch (e) {
          // Never throw out of a callback: it is swallowed, and the read must be re-armed.
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
          // Ignore: one bad request must not stop the helper.
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

for (;;) {
  $.NSRunLoop.currentRunLoop.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.distantFuture);
}
