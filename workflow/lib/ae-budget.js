(function () {
  // A time budget for Apple Events, shared by every browser that is driven through them (the Chromium
  // browsers and Safari).
  //
  // Apple Events to a hung browser would otherwise wait for the default timeout (minutes), so every real call
  // carries a per-call timeout, counted down from one shared deadline.
  //
  // ASSUMPTION, source "JXA release notes: Passing Event Modifiers" (Apple, Release Notes for
  // JavaScript for Automation): event modifiers are passed as the last argument of a command or property
  // read, as in `doc.close({saving: "ask"}, {timeout: 20})`, and `timeout` is "the amount of time a script
  // allows for a single event to execute". The notes give no unit; seconds is assumed, as in AppleScript's
  // `with timeout`. Not proven against a real application here, because any live target raises an
  // Automation prompt. Whole seconds are used, never below 1, so a nearly spent budget does not round to 0;
  // the shared deadline therefore bounds the listing to about the budget plus at most one second per read.
  // Writes (activeTabIndex, index, minimized) are plain assignments, which cannot carry modifiers.
  const DEFAULT_BUDGET_SECONDS = 1;

  // errAEEventNotPermitted (-1743, macOS SDK AppleEvents.h): Automation of that application was refused.
  function isDenied(e) {
    return Boolean(e) && (e.errorNumber === -1743 || /\(-1743\)/.test(String(e.message)));
  }

  // errAETimeout (-1712).
  function isTimeout(e) {
    return Boolean(e) && (e.errorNumber === -1712 || /\(-1712\)/.test(String(e.message)));
  }

  // options = {budgetSeconds, deadlineMs, now}. deadlineMs is an absolute time on the same clock as now
  // (Date.now by default) and wins over budgetSeconds; a deadline already past means nothing may be sent.
  // Returns {timeout, spent, call}.
  //   timeout() -> whole seconds for the next call, or throws once the budget is spent.
  //   spent()   -> true when nothing is left.
  //   call(fn)  -> fn({timeout: n}); fn spreads its arguments into the Apple Event call, so the retry
  //                passes none. The modifier shape is an assumption (above), so if JXA refuses it with
  //                a quick error that is neither a timeout nor a refusal, fn is retried once with no
  //                argument, which is the unbounded call that worked before. A timeout (-1712), a refusal
  //                (-1743: the plain call would be refused too, and a different error from it could hide
  //                that) or a spent budget is rethrown at once, so a hung browser still costs about the
  //                budget. Other errors from the retry propagate to the caller.
  function budget(options) {
    const seconds = options && options.budgetSeconds !== undefined ? options.budgetSeconds : DEFAULT_BUDGET_SECONDS;
    const now = (options && options.now) || Date.now;
    const deadline = options && options.deadlineMs !== undefined ? options.deadlineMs : now() + seconds * 1000;
    const left = () => (deadline - now()) / 1000;
    const spent = () => left() <= 0;
    function timeout() {
      const remaining = left();
      if (remaining <= 0) throw new Error("The browser did not answer in time");
      return Math.max(1, Math.floor(remaining));
    }
    function call(fn) {
      const modifiers = { timeout: timeout() };
      try {
        return fn(modifiers);
      } catch (e) {
        if (isTimeout(e) || isDenied(e) || spent()) throw e;
        return fn();
      }
    }
    return { timeout, spent, call };
  }

  const api = { budget, isDenied, isTimeout };
  if (typeof module === "object" && module && module.exports) module.exports = api;
  return api;
})();
