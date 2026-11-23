import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const handlerSource = readFileSync(new URL("../../addon/handler.js", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../../addon/background.js", import.meta.url), "utf8");

// Runs addon/handler.js and addon/background.js as plain scripts in one context, the way the manifest
// loads them, with a fake `browser` and a fake setTimeout that only records its calls.
function load({ connectNative } = {}) {
  const timers = [];
  const ports = [];
  const sandbox = {
    browser: {
      runtime: {
        connectNative: (name) => {
          if (connectNative) connectNative(name);
          const port = {
            name,
            posted: [],
            messageListeners: [],
            disconnectListeners: [],
            onMessage: { addListener: (fn) => port.messageListeners.push(fn) },
            onDisconnect: { addListener: (fn) => port.disconnectListeners.push(fn) },
            postMessage: (m) => port.posted.push(m),
          };
          ports.push(port);
          return port;
        },
      },
      tabs: { TAB_ID_NONE: -1, query: async () => [], update: async () => ({}) },
      windows: { update: async () => ({}) },
    },
    setTimeout: (fn, delay) => timers.push({ fn, delay }),
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(handlerSource, context, { filename: "handler.js" });
  vm.runInContext(backgroundSource, context, { filename: "background.js" });
  const { reconnectDelayMs } = context.BrowserSearchHandler;
  return { sandbox, timers, ports, reconnectDelayMs };
}

const disconnect = (port) => port.disconnectListeners.forEach((fn) => fn(port));

test("it connects once at load", () => {
  const { ports, timers } = load();
  assert.equal(ports.length, 1);
  assert.equal(ports[0].name, "io.github.shariqh.browser_search_for_alfred");
  assert.equal(timers.length, 0);
});

test("a disconnect schedules a reconnect at reconnectDelayMs(0)", () => {
  const { ports, timers, reconnectDelayMs } = load();
  disconnect(ports[0]);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, reconnectDelayMs(0));
  timers[0].fn();
  assert.equal(ports.length, 2);
});

test("repeated disconnects follow the backoff sequence", () => {
  const { ports, timers } = load();
  const delays = [];
  for (let i = 0; i < 7; i++) {
    disconnect(ports[ports.length - 1]);
    const timer = timers[timers.length - 1];
    delays.push(timer.delay);
    timer.fn();
  }
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 10000, 10000, 10000]);
});

test("a message resets the attempt count to 0", () => {
  const { ports, timers } = load();
  for (let i = 0; i < 3; i++) {
    disconnect(ports[ports.length - 1]);
    timers[timers.length - 1].fn();
  }
  assert.equal(timers[timers.length - 1].delay, 4000);
  const live = ports[ports.length - 1];
  live.messageListeners[0]({ id: "r1", command: "x", params: {} });
  disconnect(live);
  assert.equal(timers[timers.length - 1].delay, 1000);
});

test("only one port is live at a time", () => {
  const { ports, timers } = load();
  // A disconnect reported twice for the same port still schedules one reconnect.
  disconnect(ports[0]);
  disconnect(ports[0]);
  assert.equal(timers.length, 1);
  timers[0].fn();
  assert.equal(ports.length, 2);
  // Disconnect of the old port, arriving late, doesn't start a second connection.
  disconnect(ports[0]);
  assert.equal(timers.length, 1);
  assert.equal(ports.length, 2);
});

test("a synchronous throw from connectNative still schedules a retry", () => {
  let calls = 0;
  const { ports, timers } = load({
    connectNative: () => {
      calls += 1;
      if (calls <= 2) throw new Error("native messaging is not available");
    },
  });
  assert.equal(ports.length, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 1000);
  timers[0].fn();
  assert.equal(timers.length, 2);
  assert.equal(timers[1].delay, 2000);
  timers[1].fn();
  assert.equal(ports.length, 1, "the third attempt connected");
});

test("postMessage throwing on a port that already disconnected doesn't reject", async () => {
  const { ports } = load();
  ports[0].postMessage = () => {
    throw new Error("Attempt to postMessage on disconnected port");
  };
  const result = ports[0].messageListeners[0]({ id: "r1", command: "list-tabs", params: {} });
  await assert.doesNotReject(Promise.resolve(result));
});
