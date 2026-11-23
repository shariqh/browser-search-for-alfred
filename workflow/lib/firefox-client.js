(function () {
  // loadLib is defined by the entry script that loads this file.
  const constants = loadLib("constants");
  const jxa = loadLib("jxa");

  function newId() {
    const pid = Number($.NSProcessInfo.processInfo.processIdentifier);
    const random = Math.random().toString(36).slice(2, 10);
    return `${pid}-${Date.now()}-${random}`;
  }

  function parseReply(text) {
    if (text === null) return { ok: false, error: "unreadable reply" };
    let reply;
    try {
      reply = JSON.parse(text);
    } catch (e) {
      return { ok: false, error: "invalid reply" };
    }
    if (reply === null || typeof reply !== "object") return { ok: false, error: "invalid reply" };
    if ("error" in reply) return { ok: false, error: String(reply.error) };
    return { ok: true, payload: reply.payload };
  }

  // Asks the Firefox helper to send `command` to the add-on and waits up to timeoutMs for the answer.
  // Returns {ok: true, payload} or {ok: false, error}; error is "timeout" when nothing answered in time.
  function request(command, params, timeoutMs) {
    const dir = constants.privateDir(jxa.home());
    const id = newId();
    const requestFile = `${dir}/${id}.request.json`;
    const replyFile = `${dir}/${id}.reply.json`;
    try {
      jxa.ensureDir(dir, 0o700);
      const deadline = Date.now() + timeoutMs;
      jxa.writeTextAtomic(requestFile, JSON.stringify({ id, command, params }), 0o600);
      jxa.postNotification(constants.notificationName("request", jxa.channel()), id);
      // The file is the source of truth; the notification only wakes the helper.
      if (!jxa.waitFor(() => jxa.fileExists(replyFile), deadline)) return { ok: false, error: "timeout" };
      return parseReply(jxa.readText(replyFile));
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    } finally {
      jxa.remove(requestFile);
      jxa.remove(replyFile);
    }
  }

  const api = { request };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
