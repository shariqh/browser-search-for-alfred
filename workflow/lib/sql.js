(function () {
  const MAX_TERMS = 10;

  // Words of the query, split on whitespace. Only the first 10 are used.
  function splitTerms(query) {
    return String(query).split(/\s+/).filter(Boolean).slice(0, MAX_TERMS);
  }

  // `\`, `%` and `_` get a backslash so LIKE reads them literally (the clause says ESCAPE '\'); `'` is doubled.
  function escapeTerm(term) {
    return term.replace(/[\\%_]/g, "\\$&").replace(/'/g, "''");
  }

  // The WHERE condition for sqlite3: every word must appear in at least one of the columns. "1" when nothing was typed.
  function likeClause(query, columns) {
    const terms = splitTerms(query);
    if (terms.length === 0) return "1";
    return terms
      .map((term) => "(" + columns.map((column) => `${column} LIKE '%${escapeTerm(term)}%' ESCAPE '\\'`).join(" OR ") + ")")
      .join(" AND ");
  }

  // Opens a browser's database read-only without needing its lock or its -wal file.
  function immutableUri(path) {
    return "file:" + path.split("/").map(encodeURIComponent).join("/") + "?immutable=1";
  }

  // The arguments for /usr/bin/sqlite3: one read-only query on the database at `uri`, printed as JSON. sqlite3
  // otherwise reads ~/.sqliterc (found through the user database, not $HOME), where a `.print`, `.echo on` or
  // `.timer on` would break the JSON, so -init points it at an empty file instead.
  function sqliteArgs(uri, query) {
    return ["-init", "/dev/null", "-readonly", "-json", uri, query];
  }

  const api = { splitTerms, likeClause, immutableUri, sqliteArgs };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
