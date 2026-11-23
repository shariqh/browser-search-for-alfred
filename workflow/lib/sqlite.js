(function () {
  // Runs one read-only query through macOS's own /usr/bin/sqlite3 and returns its rows. start() returns at
  // once, so the caller can ask several browsers in parallel and collect each answer with finish().
  // loadLib is defined by the entry script that loads this file.
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const sql = loadLib("sql");

  const SQLITE = "/usr/bin/sqlite3";
  // Output files older than this were left by a run that was killed between start and finish (the same
  // 60 s the Firefox helper uses for its leftovers). No live query is that old: each has a 400 ms deadline.
  const STALE_MS = 60000;
  let counter = 0;

  function outputDir() {
    return `${jxa.home()}/Library/Caches/${constants.BUNDLE_ID}/sqlite`;
  }

  // Removes the regular files in the output folder modified more than STALE_MS ago. Younger files may belong
  // to a run still going, so they stay. Errors are ignored: the sweep never stops a query.
  function sweep(dir) {
    try {
      const fm = $.NSFileManager.defaultManager;
      const names = fm.contentsOfDirectoryAtPathError(dir, $());
      if (names.isNil()) return;
      const now = Date.now();
      for (const name of ObjC.deepUnwrap(names)) {
        const path = `${dir}/${name}`;
        // attributesOfItemAtPath does not follow a symbolic link, so a link is never "regular" here.
        const attrs = fm.attributesOfItemAtPathError(path, $());
        if (attrs.isNil()) continue;
        if (String(ObjC.unwrap(attrs.objectForKey($.NSFileType))) !== String(ObjC.unwrap($.NSFileTypeRegular))) continue;
        const modified = attrs.objectForKey($.NSFileModificationDate);
        if (modified.isNil()) continue;
        if (now - Number(modified.timeIntervalSince1970) * 1000 > STALE_MS) jxa.remove(path);
      }
    } catch (e) {
      // Ignored: see above.
    }
  }

  // Starts sqlite3 on `dbPath` (opened read-only and immutable, so a browser's lock does not stop it) with
  // its JSON output going to a fresh file in a private folder (700; the file is 600). The database URI is
  // its own argument, never part of the SQL text. Leftovers of killed runs are swept first.
  function start(dbPath, query) {
    const pid = Number($.NSProcessInfo.processInfo.processIdentifier);
    const random = Math.random().toString(36).slice(2, 10);
    const handle = { outPath: `${outputDir()}/${pid}-${Date.now()}-${counter++}-${random}.json`, process: null };
    try {
      jxa.ensureDir(outputDir(), 0o700);
      sweep(outputDir());
      handle.process = jxa.startProcess(SQLITE, sql.sqliteArgs(sql.immutableUri(dbPath), query), handle.outPath);
    } catch (e) {
      // handle.process stays null: finish() reports an error.
    }
    return handle;
  }

  // {ok: true, rows} or {ok: false, reason: "timeout" | "error"}. sqlite3 prints nothing for zero rows, so
  // empty output is rows: []. A sqlite3 still running at deadlineMs is terminated. The output file is
  // removed whatever happens.
  function finish(handle, deadlineMs) {
    try {
      if (handle.process === null) return { ok: false, reason: "error" };
      const { exited, status } = jxa.finishProcess(handle.process, deadlineMs);
      if (!exited) return { ok: false, reason: "timeout" };
      if (status !== 0) return { ok: false, reason: "error" };
      const text = jxa.readText(handle.outPath);
      if (text === null) return { ok: false, reason: "error" };
      if (text.trim() === "") return { ok: true, rows: [] };
      const rows = JSON.parse(text);
      return Array.isArray(rows) ? { ok: true, rows } : { ok: false, reason: "error" };
    } catch (e) {
      return { ok: false, reason: "error" };
    } finally {
      jxa.remove(handle.outPath);
    }
  }

  const api = { start, finish };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
