/* Band Watch by M3vrv: spots an rtl_tcp that is connected but sends no signal (a "stall"), and decides what to do.
 * Pure functions, so they can be tested in Node. Receive only: nothing here touches a transmitter. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SdrStall = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STALL_MS = 9000; // connected (header seen) but no I/Q bytes for this long
  const LOOP_ATTEMPTS = 2; // reconnects in a row that got the header and no samples
  const MAX_RESTARTS = 2; // automatic restarts of our own rtl_tcp ...
  const WINDOW_MS = 10 * 60 * 1000; // ... per this long

  const MSG_FOREIGN = "rtl_tcp is connected but not sending any signal. It may be stuck: close and restart it.";
  const MSG_LIMIT = "rtl_tcp stopped sending signal again after Band Watch restarted it twice in 10 minutes, so Band Watch has stopped trying. "
    + "Unplug and replug the dongle, then press Listen.";
  const msgPortHeld = (port) => `Another program (most likely another rtl_tcp) is holding port ${port}, so Band Watch couldn't start its own. `
    + "Band Watch won't close a program it didn't start: close that rtl_tcp yourself, then press Listen.";

  /** True when the header arrived (headerAt, a ms clock reading) but no I/Q bytes since (lastIqAt, 0/null = none yet). */
  function isStalled({ headerAt, lastIqAt, now, timeoutMs = STALL_MS }) {
    if (!headerAt) return false;
    return now - Math.max(headerAt, lastIqAt || 0) >= timeoutMs;
  }

  /** True when reconnecting keeps getting the header and no samples. */
  const isLoopStalled = (headerOnlyAttempts, limit = LOOP_ATTEMPTS) => headerOnlyAttempts >= limit;

  /** The restarts (times, ms) still inside the window, and whether one more is allowed. */
  function restartBudget(times, now, max = MAX_RESTARTS, windowMs = WINDOW_MS) {
    const recent = (times || []).filter((t) => now - t < windowMs);
    return { recent, allowed: recent.length < max };
  }

  /** Did Band Watch start the rtl_tcp that answers on this port? (status is GET /api/sdr/launch) */
  function isOurs(status, port) {
    if (!status || status.running !== true || !Array.isArray(status.args)) return false;
    const i = status.args.indexOf("-p");
    return i >= 0 && Number(status.args[i + 1]) === Number(port);
  }

  /** What to do about a stall: "restart" (ours, within the limit), "limit" (ours, restarted too often) or "foreign" (hands off). */
  function plan({ status, port, restarts, now }) {
    if (!isOurs(status, port)) return "foreign";
    return restartBudget(restarts, now).allowed ? "restart" : "limit";
  }

  return { STALL_MS, LOOP_ATTEMPTS, MAX_RESTARTS, WINDOW_MS, MSG_FOREIGN, MSG_LIMIT, msgPortHeld, isStalled, isLoopStalled, restartBudget, isOurs, plan };
});
