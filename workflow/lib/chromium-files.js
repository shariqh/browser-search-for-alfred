(function () {
  // Google Chrome's own files, read without Chrome running: profiles from `Local State`, bookmarks from each
  // profile's `Bookmarks`, and the SQL for its `History` database. Pure: the caller reads the files.
  // Formats from Chromium source: pref_names.h and profile_attributes_entry.cc (profile.info_cache),
  // bookmark_codec.cc (Bookmarks), url_database.cc (the urls table) and time.h (times).
  const sql = typeof loadLib === "function" ? loadLib("sql") : require("./sql.js");

  const DEFAULT_PROFILE = "Default";
  // Microseconds from 1601-01-01 (Windows epoch, Chrome's base time) to 1970-01-01, in milliseconds.
  const EPOCH_DELTA_MS = 11644473600000;

  function parse(text) {
    if (typeof text !== "string") return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  const isObject = (value) => value !== null && typeof value === "object";

  // [{dir, name}] from Local State's profile.info_cache: Default first, then the rest sorted by folder name.
  // A profile with no name is called by its folder. Without a usable Local State, Default alone.
  function profilesFromLocalState(text) {
    const state = parse(text);
    const cache = isObject(state) && isObject(state.profile) ? state.profile.info_cache : null;
    const dirs = isObject(cache) ? Object.keys(cache) : [];
    if (dirs.length === 0) return [{ dir: DEFAULT_PROFILE, name: DEFAULT_PROFILE }];
    const rank = (dir) => (dir === DEFAULT_PROFILE ? 0 : 1);
    dirs.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
    return dirs.map((dir) => {
      const entry = cache[dir];
      const name = isObject(entry) && typeof entry.name === "string" ? entry.name : "";
      return { dir, name: name !== "" ? name : dir };
    });
  }

  // [{title, url}] for every `type: "url"` node under the bookmarks bar, other bookmarks and mobile bookmarks,
  // in that order, depth first. Invalid JSON gives [].
  function bookmarksFromJson(text) {
    const data = parse(text);
    const roots = isObject(data) && isObject(data.roots) ? data.roots : {};
    const out = [];
    const walk = (node) => {
      if (!isObject(node)) return;
      if (node.type === "url" && typeof node.url === "string") {
        out.push({ title: typeof node.name === "string" ? node.name : "", url: node.url });
      }
      if (Array.isArray(node.children)) node.children.forEach(walk);
    };
    ["bookmark_bar", "other", "synced"].forEach((root) => walk(roots[root]));
    return out;
  }

  // Visible history rows matching every typed word, newest first. `t` is Chrome's time (see chromeTimeToMs).
  function historySql(query, limit) {
    const where = sql.likeClause(query, ["url", "title"]);
    return `SELECT url, title, last_visit_time AS t FROM urls WHERE hidden = 0 AND ${where} ORDER BY last_visit_time DESC LIMIT ${limit}`;
  }

  // Chrome's time (microseconds since 1601-01-01 UTC, a number or a string) as Unix milliseconds.
  function chromeTimeToMs(value) {
    return Math.floor(Number(value) / 1000) - EPOCH_DELTA_MS;
  }

  const api = { profilesFromLocalState, bookmarksFromJson, historySql, chromeTimeToMs };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
