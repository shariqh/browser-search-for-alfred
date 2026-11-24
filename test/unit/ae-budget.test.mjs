import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { budget, isDenied } = require("../../workflow/lib/ae-budget.js");

// A clock that moves forward by `stepMs` each time it is read, so budgets are deterministic.
function steppingClock(stepMs, start = 1_000_000) {
  let t = start;
  return () => {
    const now = t;
    t += stepMs;
    return now;
  };
}

test("isDenied is true for errorNumber -1743 and for a message holding (-1743)", () => {
  assert.equal(isDenied({ errorNumber: -1743 }), true);
  assert.equal(isDenied(new Error("Not authorized to send Apple events to Google Chrome. (-1743)")), true);
  assert.equal(isDenied({ errorNumber: -1712 }), false);
  assert.equal(isDenied(new Error("Apple event timed out. (-1712)")), false);
  assert.equal(isDenied(null), false);
  assert.equal(isDenied(undefined), false);
  assert.equal(isDenied("(-1743)"), false);
});

test("timeout counts down in whole seconds from budgetSeconds, never below 1", () => {
  const { timeout } = budget({ budgetSeconds: 3, now: steppingClock(600) });
  // 2.4, 1.8, 1.2 and 0.6 s are left at the four reads.
  assert.deepEqual([timeout(), timeout(), timeout(), timeout()], [2, 1, 1, 1]);
  assert.throws(() => timeout());
});

test("deadlineMs is an absolute time and wins over budgetSeconds", () => {
  const { timeout } = budget({ budgetSeconds: 100, deadlineMs: 1_005_000, now: steppingClock(1000, 1_000_000) });
  // The clock is not read when the budget is made, so 5 s remain at the first call, then 1 s less each.
  assert.equal(timeout(), 5);
  assert.equal(timeout(), 4);
});

test("a deadlineMs in the past is spent at once and call never runs fn", () => {
  const { spent, call } = budget({ deadlineMs: 500, now: () => 1_000 });
  assert.equal(spent(), true);
  let ran = false;
  assert.throws(() => call(() => (ran = true)));
  assert.equal(ran, false);
});

test("call retries once without the modifier after a quick non-timeout error", () => {
  const { call } = budget({ budgetSeconds: 10, now: steppingClock(10) });
  const seen = [];
  const result = call((...m) => {
    seen.push(m.length);
    if (m.length > 0) throw new TypeError("Wrong number of arguments");
    return "ok";
  });
  assert.equal(result, "ok");
  assert.deepEqual(seen, [1, 0]);
});

test("call does not retry a timeout (-1712) or a denied error (-1743)", () => {
  for (const errorNumber of [-1712, -1743]) {
    const { call } = budget({ budgetSeconds: 10, now: steppingClock(10) });
    let runs = 0;
    assert.throws(
      () =>
        call(() => {
          runs++;
          throw Object.assign(new Error("x"), { errorNumber });
        }),
      (e) => e.errorNumber === errorNumber,
    );
    assert.equal(runs, 1, String(errorNumber));
  }
});
