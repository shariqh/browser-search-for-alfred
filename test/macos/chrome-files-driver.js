// A tiny JXA driver for the tests: calls chromium-files.js, sqlite.js and jxa.js and prints one JSON result.
// Usage: osascript -l JavaScript chrome-files-driver.js <workflow dir> read <path>
//        osascript -l JavaScript chrome-files-driver.js <workflow dir> bookmarks
//          (every profile in $HOME's Chrome folder: {profiles, bookmarks: {<dir>: [...]}, reads: {<dir>: reason}})
//        osascript -l JavaScript chrome-files-driver.js <workflow dir> history <History path> <query> <timeout ms>
//        osascript -l JavaScript chrome-files-driver.js <workflow dir> sql <db path> <sql> <timeout ms>
//          (history and sql also print the sqlite folder's files, with their modes, while sqlite3 runs)
//        osascript -l JavaScript chrome-files-driver.js <workflow dir> process <timeout ms> <stdout path or ""> <executable> <args...>
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

// The files in a folder, each with its POSIX mode.
function listModes(dir) {
  const fm = $.NSFileManager.defaultManager;
  const names = fm.contentsOfDirectoryAtPathError(dir, $());
  if (names.isNil()) return null;
  return ObjC.deepUnwrap(names).map((name) => {
    const attrs = fm.attributesOfItemAtPathError(`${dir}/${name}`, $());
    return { name, mode: Number(ObjC.unwrap(attrs.objectForKey($.NSFilePosixPermissions))) };
  });
}

function runSql(dbPath, query, timeoutMs) {
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const sqlite = loadLib("sqlite");
  const started = Date.now();
  const handle = sqlite.start(dbPath, query);
  const sqliteDir = `${jxa.home()}/Library/Caches/${constants.BUNDLE_ID}/sqlite`;
  const during = listModes(sqliteDir);
  const result = sqlite.finish(handle, started + timeoutMs);
  const elapsedMs = Date.now() - started;
  const pid = handle.process ? handle.process.pid : null;
  return { result, elapsedMs, pid, during, after: listModes(sqliteDir), dirMode: (listModes(`${sqliteDir}/..`) || []).find((f) => f.name === "sqlite") };
}

function run(argv) {
  workflowDir = argv[0];
  const jxa = loadLib("jxa");
  const files = loadLib("chromium-files");
  const constants = loadLib("constants");
  const command = argv[1];
  if (command === "read") {
    print(JSON.stringify(jxa.readFileResult(argv[2])));
  } else if (command === "bookmarks") {
    const dataDir = constants.chromeDataDir(jxa.home());
    const state = jxa.readFileResult(`${dataDir}/Local State`);
    const profiles = files.profilesFromLocalState(state.ok ? state.text : null);
    const bookmarks = {};
    const reads = {};
    for (const profile of profiles) {
      const read = jxa.readFileResult(`${dataDir}/${profile.dir}/Bookmarks`);
      reads[profile.dir] = read.ok ? "ok" : read.reason;
      bookmarks[profile.dir] = read.ok ? files.bookmarksFromJson(read.text) : [];
    }
    print(JSON.stringify({ profiles, bookmarks, reads }));
  } else if (command === "history") {
    print(JSON.stringify(runSql(argv[2], files.historySql(argv[3], constants.HISTORY_LIMIT), Number(argv[4]))));
  } else if (command === "sql") {
    print(JSON.stringify(runSql(argv[2], argv[3], Number(argv[4]))));
  } else if (command === "process") {
    const started = Date.now();
    const handle = jxa.startProcess(argv[4], argv.slice(5), argv[3] === "" ? null : argv[3]);
    const result = jxa.finishProcess(handle, started + Number(argv[2]));
    print(JSON.stringify({ result, pid: handle.pid, elapsedMs: Date.now() - started }));
  }
}
