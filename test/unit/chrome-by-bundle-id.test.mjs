import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The real Chrome path can't run in tests (R1), so check how the entries name the app.
for (const file of ["tab.js", "act.js"]) {
  test(`${file} opens Chrome by bundle ID, never by name`, () => {
    const source = readFileSync(new URL(`../../workflow/${file}`, import.meta.url), "utf8");
    assert.equal(/Application\(\s*["']Google Chrome["']\s*\)/.test(source), false, "no Application(\"Google Chrome\")");
    assert.ok(source.includes("Application(constants.CHROME_BUNDLE_ID)"), "Application(constants.CHROME_BUNDLE_ID)");
  });
}
