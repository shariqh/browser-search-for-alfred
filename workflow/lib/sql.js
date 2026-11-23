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

  const api = { splitTerms, likeClause, immutableUri };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
