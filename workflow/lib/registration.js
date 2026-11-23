(function () {
  const constants = typeof loadLib === "function" ? loadLib("constants") : require("./constants.js");

  function registrationManifest(helperPath) {
    return {
      name: constants.HOST_NAME,
      description: "Browser Search for Alfred helper",
      path: helperPath,
      type: "stdio",
      allowed_extensions: [constants.ADDON_ID],
    };
  }

  // null when Firefox will find the current helper; otherwise why setup is needed again:
  // "missing" (no file, or not JSON), "elsewhere" (wrong path or add-on), "stale" (the copy is out of date).
  function registrationProblem(manifestText, expectedHelperPath, helperCopyMatches) {
    if (typeof manifestText !== "string") return "missing";
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      return "missing";
    }
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return "missing";
    const extensions = Array.isArray(manifest.allowed_extensions) ? manifest.allowed_extensions : [];
    if (manifest.path !== expectedHelperPath || !extensions.includes(constants.ADDON_ID)) return "elsewhere";
    return helperCopyMatches ? null : "stale";
  }

  const api = { registrationManifest, registrationProblem };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
