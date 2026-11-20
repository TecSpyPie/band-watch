"use strict";
// Stuck rtl_tcp: the decision logic (public/js/sdr-stall.js). Receive only.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../public/js/sdr-stall.js");

test("stall: needs the header, then about 9 s with no I/Q bytes", () => {
  assert.equal(S.isStalled({ headerAt: 0, lastIqAt: 0, now: 100000 }), false, "no header yet: not a stall");
  assert.equal(S.isStalled({ headerAt: 1000, lastIqAt: 0, now: 9999 }), false);
  assert.equal(S.isStalled({ headerAt: 1000, lastIqAt: 0, now: 10000 }), true, "9 s after the header, nothing");
  assert.equal(S.isStalled({ headerAt: 1000, lastIqAt: 8000, now: 12000 }), false, "samples arrived 4 s ago");
  assert.equal(S.isStalled({ headerAt: 1000, lastIqAt: 8000, now: 17000 }), true, "samples stopped 9 s ago");
  assert.equal(S.isStalled({ headerAt: 1000, lastIqAt: null, now: 5000, timeoutMs: 3000 }), true);
});

test("stall: a reconnect loop of header-only connections counts as a stall", () => {
  assert.equal(S.isLoopStalled(0), false);
  assert.equal(S.isLoopStalled(1), false);
  assert.equal(S.isLoopStalled(2), true);
  assert.equal(S.isLoopStalled(5), true);
});

test("stall: at most 2 automatic restarts per 10 minutes", () => {
  const min = 60000;
  assert.deepEqual(S.restartBudget([], 0), { recent: [], allowed: true });
  assert.equal(S.restartBudget([0], 1 * min).allowed, true);
  assert.equal(S.restartBudget([0, 2 * min], 3 * min).allowed, false, "two already");
  assert.equal(S.restartBudget([0, 2 * min], 9.9 * min).allowed, false);
  const later = S.restartBudget([0, 2 * min], 10 * min);
  assert.equal(later.allowed, true, "the first one is 10 minutes old and no longer counts");
  assert.deepEqual(later.recent, [2 * min]);
  assert.equal(S.restartBudget([0, 2 * min], 12 * min).allowed, true);
  assert.equal(S.restartBudget(undefined, 5).allowed, true);
});

test("stall: only an rtl_tcp Band Watch started on that port is ours", () => {
  const ours = { running: true, path: "C:\rtl_tcp.exe", args: ["-a", "127.0.0.1", "-p", "1234", "-d", "0"] };
  assert.equal(S.isOurs(ours, 1234), true);
  assert.equal(S.isOurs(ours, 8000), false, "ours is on another port, so the one at this address is someone else's");
  assert.equal(S.isOurs({ running: false }, 1234), false);
  assert.equal(S.isOurs({ running: false, args: ours.args }, 1234), false, "exited");
  assert.equal(S.isOurs(null, 1234), false);
  assert.equal(S.isOurs({ running: true }, 1234), false);
});

test("stall: plan restarts our own, stops after the limit, and leaves a foreign rtl_tcp alone", () => {
  const ours = { running: true, args: ["-a", "127.0.0.1", "-p", "1234", "-d", "0"] };
  const now = 1e6;
  assert.equal(S.plan({ status: ours, port: 1234, restarts: [], now }), "restart");
  assert.equal(S.plan({ status: ours, port: 1234, restarts: [now - 1000], now }), "restart");
  assert.equal(S.plan({ status: ours, port: 1234, restarts: [now - 1000, now - 2000], now }), "limit");
  assert.equal(S.plan({ status: ours, port: 1234, restarts: [now - 700000, now - 2000], now }), "restart", "old restarts expire");
  assert.equal(S.plan({ status: { running: false }, port: 1234, restarts: [], now }), "foreign");
  assert.equal(S.plan({ status: null, port: 1234, restarts: [], now }), "foreign", "remote address or no launch API");
  assert.equal(S.plan({ status: ours, port: 4321, restarts: [], now }), "foreign");
});

test("stall: messages say it plainly", () => {
  assert.equal(S.MSG_FOREIGN, "rtl_tcp is connected but not sending any signal. It may be stuck: close and restart it.");
  assert.match(S.msgPortHeld(1234), /holding port 1234/);
  assert.match(S.msgPortHeld(1234), /won't close a program it didn't start/);
  assert.match(S.MSG_LIMIT, /twice in 10 minutes/);
});
