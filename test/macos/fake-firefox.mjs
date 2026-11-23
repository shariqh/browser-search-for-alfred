// A stand-in for Firefox. It starts the helper the way Firefox does (the file executed directly,
// with a manifest path and the add-on ID as arguments), reads the helper's framed requests, and
// answers them with whatever the test's handler decides.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
export const workflowDir = path.resolve(here, "../../workflow");
export const helperPath = path.join(workflowDir, "firefox-helper.js");

export function frame(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

// handler(message, firefox) is called for every request the helper forwards.
// firefox.send(message) writes one framed reply; firefox.write(buffer) writes raw bytes.
export function startFakeFirefox({ home, channel, handler, env = {}, addonId = "browser-search-for-alfred@shariqh.github.io" }) {
  const child = spawn(helperPath, [path.join(home, "manifest.json"), addonId], {
    env: { ...process.env, HOME: home, BSA_TEST_CHANNEL: channel, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const received = [];
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  child.stdin.on("error", () => {});

  const firefox = {
    received,
    exited,
    child,
    get stderr() {
      return stderr;
    },
    send: (message) => child.stdin.write(frame(message)),
    write: (buffer) => child.stdin.write(buffer),
    closeStdin: () => child.stdin.end(),
    // The helper creates its private folder after it registers its observers.
    async ready(privateDir, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!existsSync(privateDir)) {
        if (Date.now() > deadline) throw new Error(`helper not ready; stderr: ${stderr}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exited;
    },
  };

  let buffer = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4) {
      const n = buffer.readUInt32LE(0);
      if (buffer.length < 4 + n) break;
      const message = JSON.parse(buffer.subarray(4, 4 + n).toString("utf8"));
      buffer = buffer.subarray(4 + n);
      received.push(message);
      handler(message, firefox);
    }
  });
  return firefox;
}
