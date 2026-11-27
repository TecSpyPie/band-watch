"use strict";
// ClearRX's big graph: where frequencies and EQ levels go, and dragging the EQ points (the maths only).
const test = require("node:test");
const assert = require("node:assert");
const E = require("../clearrx/public/js/eqgraph.js");

test("frequency across the graph: log spreads the low notes, linear doesn't, and both go back the other way", () => {
  assert.equal(E.xFrac(50, "log"), 0);
  assert.equal(E.xFrac(6000, "log"), 1);
  assert.equal(E.xFrac(6000, "linear"), 1);
  assert.ok(E.xFrac(500, "log") > 0.4 && E.xFrac(500, "linear") < 0.1, "500 Hz is near the middle on log, near the left on linear");
  for (const scale of ["log", "linear"]) for (const hz of [100, 300, 1200, 3500, 5000]) {
    assert.ok(Math.abs(E.hzAt(E.xFrac(hz, scale), scale) - hz) < 1e-6, `${hz} Hz ${scale}`);
  }
  assert.equal(E.xFrac(10, "log"), 0, "below the graph stays at the edge");
  assert.equal(E.xFrac(9000, "linear"), 1);
});

test("EQ level up and down the graph: +12 at the top, 0 in the middle, whole dB back", () => {
  const H = 230;
  assert.ok(E.yOfDb(12, H) < E.yOfDb(0, H) && E.yOfDb(0, H) < E.yOfDb(-12, H));
  for (let db = -12; db <= 12; db++) assert.equal(E.dbAtY(E.yOfDb(db, H), H), db);
  assert.equal(E.dbAtY(-50, H), 12);
  assert.equal(E.dbAtY(5000, H), -12);
  assert.ok(Object.is(E.dbAtY(E.yOfDb(0, H), H), 0), "never -0");
});

test("dragging a point moves it by the pointer's distance and stays within +-12 dB", () => {
  const H = 230, perDb = (E.plotH(H) - 8) / 24;
  assert.equal(E.dragDb(3, 100, 100, H), 3, "no movement, no change");
  assert.equal(E.dragDb(3, 100, 100 - 4 * perDb, H), 7, "up 4 dB");
  assert.equal(E.dragDb(-2, 100, 100 + 5 * perDb, H), -7, "down 5 dB");
  assert.equal(E.dragDb(10, 100, -500, H), 12);
  assert.equal(E.dragDb(-10, 100, 900, H), -12);
});

test("the nearest EQ point to the pointer, or none when it's too far", () => {
  const F = [100, 200, 300, 500, 800, 1200, 1800, 2500, 3500, 5000], W = 800;
  for (const scale of ["log", "linear"]) {
    F.forEach((f, i) => { if (scale === "log" || f >= 500) assert.equal(E.nearestPoint(F, E.xFrac(f, scale) * W + 3, W, scale), i, `${f} ${scale}`); });
  }
  assert.equal(E.nearestPoint(F, 2, W, "log", 10), -1, "the far left is nowhere near 100 Hz on log");
  assert.deepEqual(E.ticks("log").map(E.tickName), ["50", "100", "200", "500", "1k", "2k", "5k"]);
});
