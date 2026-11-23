import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const c = require("../../workflow/lib/constants.js");
const { registrationManifest, registrationProblem } = require("../../workflow/lib/registration.js");

test("registrationManifest is exact", () => {
  assert.deepEqual(registrationManifest("/h/x.js"), {
    name: c.HOST_NAME,
    description: "Browser Search for Alfred helper",
    path: "/h/x.js",
    type: "stdio",
    allowed_extensions: [c.ADDON_ID],
  });
});

test("registrationProblem branches", () => {
  const good = JSON.stringify(registrationManifest("/h/x.js"));
  assert.equal(registrationProblem(null, "/h/x.js", true), "missing");
  assert.equal(registrationProblem("{not json", "/h/x.js", true), "missing");
  assert.equal(registrationProblem("null", "/h/x.js", true), "missing");
  assert.equal(registrationProblem(JSON.stringify({ ...registrationManifest("/other.js") }), "/h/x.js", true), "elsewhere");
  assert.equal(
    registrationProblem(JSON.stringify({ ...registrationManifest("/h/x.js"), allowed_extensions: ["a@b"] }), "/h/x.js", true),
    "elsewhere",
  );
  assert.equal(registrationProblem(JSON.stringify({ path: "/h/x.js" }), "/h/x.js", true), "elsewhere");
  assert.equal(registrationProblem(good, "/h/x.js", false), "stale");
  assert.equal(registrationProblem(good, "/h/x.js", true), null);
});

test("firefox-helper.js duplicates match constants.js", () => {
  const text = readFileSync(new URL("../../workflow/firefox-helper.js", import.meta.url), "utf8");
  assert.ok(text.includes(`const BUNDLE_ID = "${c.BUNDLE_ID}";`));
  assert.ok(text.includes(`const REQUEST_NOTIFICATION = "${c.notificationName("request", "")}";`));
  assert.ok(text.includes(`const REPLY_NOTIFICATION = "${c.notificationName("reply", "")}";`));
  assert.ok(text.includes("const PRIVATE_DIR = `${HOME}/Library/Caches/${BUNDLE_ID}/firefox`;"));
  assert.equal(c.privateDir("${HOME}"), "${HOME}/Library/Caches/" + c.BUNDLE_ID + "/firefox");
  assert.ok(text.includes("`${base}.test.${CHANNEL}`"));
});
