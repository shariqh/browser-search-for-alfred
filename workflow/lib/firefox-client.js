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

  // Sends `command` to the Firefox helper (which forwards it to the add-on) and returns at once with a
  // pending handle for finish(). The caller can do other work while Firefox answers.
  function start(command, params) {
    const dir = constants.privateDir(jxa.home());
    const id = newId();
    const pending = {
      requestFile: `${dir}/${id}.request.json`,
      replyFile: `${dir}/${id}.reply.json`,
      startedAt: Date.now(),
      error: null,
    };
    try {
      jxa.ensureDir(dir, 0o700);
      jxa.writeTextAtomic(pending.requestFile, JSON.stringify({ id, command, params }), 0o600);
      jxa.postNotification(constants.notificationName("request", jxa.channel()), id);
    } catch (e) {
      pending.error = String(e && e.message ? e.message : e);
    }
    return pending;
  }

  // Waits for the answer to a start() and removes the request and reply files, whatever happens.
  // The wait budget runs from start(), not from this call, so time spent on other work counts against it.
  // A reply that landed before this call is still read: the file is the source of truth, and the
  // notification only wakes the helper. Returns {ok: true, payload} or {ok: false, error}; error is
  // "timeout" when nothing answered in time.
  function finish(pending, timeoutMs) {
    try {
      if (pending.error !== null) return { ok: false, error: pending.error };
      if (!jxa.waitFor(() => jxa.fileExists(pending.replyFile), pending.startedAt + timeoutMs)) {
        return { ok: false, error: "timeout" };
      }
      return parseReply(jxa.readText(pending.replyFile));
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    } finally {
      jxa.remove(pending.requestFile);
      jxa.remove(pending.replyFile);
    }
  }

  // Asks the Firefox helper to send `command` to the add-on and waits up to timeoutMs for the answer.
  function request(command, params, timeoutMs) {
    return finish(start(command, params), timeoutMs);
  }

  const api = { request, start, finish };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
