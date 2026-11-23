import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The real Apple Event path can't run in tests (R1), so check how the entries name the app: always by the registry
// entry's bundle ID (lib/browsers.js), never by a name such as "Google Chrome" or "Safari".
for (const file of ["tab.js", "act.js"]) {
  test(`${file} opens every Apple Event browser by bundle ID, never by name`, () => {
    const source = readFileSync(new URL(`../../workflow/${file}`, import.meta.url), "utf8");
    const calls = source.match(/Application\([^)]*\)/g) || [];
    assert.ok(calls.length > 0, "the entry asks for an Application");
    assert.deepEqual([...new Set(calls)], ["Application(browser.bundleId)"]);
  });
}
