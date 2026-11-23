(function () {
  // Safari's own files, read without Safari running: bookmarks from the parsed Bookmarks.plist and the SQL for
  // History.db. Pure: the caller reads the files. Formats from the Safari importers in Chromium
  // (safari_importer.mm) and Firefox (SafariProfileMigrator.sys.mjs).
  const sql = typeof loadLib === "function" ? loadLib("sql") : require("./sql.js");

  // Seconds from 1970-01-01 to 2001-01-01 (Safari's base time).
  const EPOCH_DELTA_S = 978307200;

  const isObject = (value) => value !== null && typeof value === "object";

  // [{title, url}] for every leaf under Children, depth first. A leaf is a dict with WebBookmarkType
  // "WebBookmarkTypeLeaf" and a string URLString; its title is URIDictionary.title. A folder with ShouldOmitFromUI
  // true (Safari's own History proxy, for one) is skipped with what is inside it. The Reading List is a folder
  // named "com.apple.ReadingList", so its items are listed like the rest.
  function bookmarksFromPlist(root) {
    const out = [];
    const walk = (node) => {
      if (!isObject(node)) return;
      if (node.WebBookmarkType === "WebBookmarkTypeLeaf") {
        if (typeof node.URLString !== "string") return;
        const title = isObject(node.URIDictionary) ? node.URIDictionary.title : "";
        out.push({ title: typeof title === "string" ? title : "", url: node.URLString });
        return;
      }
      if (node.ShouldOmitFromUI === true) return;
      if (Array.isArray(node.Children)) node.Children.forEach(walk);
    };
    walk(root);
    return out;
  }

  // One row per page that matches every typed word in its URL or in the title of one of its visits, carrying the
  // title and time (`t`, see safariTimeToMs) of its latest visit, newest first. SQLite documents that with a single
  // MAX() the bare title column comes from the row that holds the maximum.
  function historySql(query, limit) {
    const where = sql.likeClause(query, ["history_items.url", "history_visits.title"]);
    return (
      "SELECT history_items.url AS url, history_visits.title AS title, MAX(history_visits.visit_time) AS t " +
      "FROM history_items JOIN history_visits ON history_visits.history_item = history_items.id " +
      `WHERE ${where} GROUP BY history_items.id ORDER BY t DESC LIMIT ${limit}`
    );
  }

  // Safari's time (seconds since 2001-01-01 UTC, a number or a string) as Unix milliseconds.
  function safariTimeToMs(seconds) {
    return Math.round((Number(seconds) + EPOCH_DELTA_S) * 1000);
  }

  const api = { bookmarksFromPlist, historySql, safariTimeToMs };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
