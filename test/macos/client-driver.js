// A tiny JXA driver for the tests: loads firefox-client.js and prints the result of one request.
// Usage: osascript -l JavaScript client-driver.js <workflow dir> request <command> <params JSON> <timeout ms>
//        osascript -l JavaScript client-driver.js <workflow dir> post <notification name> <object>
ObjC.import("Foundation");

let workflowDir = "";

function loadLib(name) {
  const path = `${workflowDir}/lib/${name}.js`;
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, $());
  return eval(ObjC.unwrap(text));
}

function print(text) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(text + "\n").dataUsingEncoding($.NSUTF8StringEncoding));
}

function run(argv) {
  workflowDir = argv[0];
  if (argv[1] === "post") {
    loadLib("jxa").postNotification(argv[2], argv[3]);
    print("posted");
    return;
  }
  const client = loadLib("firefox-client");
  const started = Date.now();
  const result = client.request(argv[2], JSON.parse(argv[3]), Number(argv[4]));
  print(JSON.stringify({ result, elapsedMs: Date.now() - started }));
}
