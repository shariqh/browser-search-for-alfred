(function () {
  // Runs one read-only query through macOS's own /usr/bin/sqlite3 and returns its rows. start() returns at
  // once, so the caller can ask several browsers in parallel and collect each answer with finish().
  // loadLib is defined by the entry script that loads this file.
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");
  const sql = loadLib("sql");

  const SQLITE = "/usr/bin/sqlite3";
  let counter = 0;

  function outputDir() {
    return `${jxa.home()}/Library/Caches/${constants.BUNDLE_ID}/sqlite`;
  }

  // Starts sqlite3 on `dbPath` (opened read-only and immutable, so a browser's lock does not stop it) with
  // its JSON output going to a fresh file in a private folder (700; the file is 600). The database URI is
  // its own argument, never part of the SQL text.
  function start(dbPath, query) {
    const pid = Number($.NSProcessInfo.processInfo.processIdentifier);
    const random = Math.random().toString(36).slice(2, 10);
    const handle = { outPath: `${outputDir()}/${pid}-${Date.now()}-${counter++}-${random}.json`, process: null };
    try {
      jxa.ensureDir(outputDir(), 0o700);
      handle.process = jxa.startProcess(SQLITE, ["-readonly", "-json", sql.immutableUri(dbPath), query], handle.outPath);
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
