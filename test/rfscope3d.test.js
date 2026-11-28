"use strict";
// HamShack's 3D band scope: the maths only (heights, resampling, labels, projection, the row ring).
const test = require("node:test");
const assert = require("node:assert");
const R = require("../public/js/rfscope3d.js");

test("height above the noise: the noise is the floor, strong signals reach the top, unseen is marked", () => {
  assert.equal(R.heightOf(-3, 60), 0);
  assert.equal(R.heightOf(-20, 60), 0, "below the noise stays on the floor");
  assert.equal(R.heightOf(57, 60), 1);
  assert.equal(R.heightOf(200, 60), 1, "never past the top");
  assert.ok(R.heightOf(27, 60) > 0.45 && R.heightOf(27, 60) < 0.55);
  assert.equal(R.heightOf(NaN, 60), -1, "outside what the receiver sees");
  assert.ok(R.heightOf(10, 4) <= 1, "a tiny range is treated as 10 dB");
});

test("resampling keeps the loudest bin in each column, so a narrow signal isn't lost", () => {
  const spec = new Float32Array(1000).fill(0);
  spec[503] = 40; // one narrow carrier
  const out = R.resample(spec, 100);
  assert.equal(out.length, 100);
  assert.equal(out[50], 40);
  assert.equal(Math.max(...out), 40);
  const gaps = R.resample([NaN, NaN, 5, NaN], 2);
  assert.ok(Number.isNaN(gaps[0]), "a column the receiver can't see stays unseen");
  assert.equal(gaps[1], 5);
  const up = R.resample([1, 2], 4);
  assert.deepEqual(Array.from(up), [1, 1, 2, 2], "fewer bins than columns repeats them");
});

test("frequency labels are round numbers inside the span, in MHz or kHz", () => {
  const t = R.freqTicks(14.0, 14.35);
  assert.ok(t.length >= 3 && t.length <= 9, t.join());
  assert.ok(t.every((f) => f >= 14.0 && f <= 14.35));
  assert.deepEqual(t.map((f) => R.tickLabel(f, 14.0, 14.35)).slice(0, 3), ["14", "14.1", "14.2"]);
  const ft8 = R.freqTicks(14.074, 14.077);
  assert.ok(ft8.length >= 3);
  assert.equal(R.tickLabel(14.075, 14.074, 14.077), "14075", "a narrow span is in kHz");
  assert.deepEqual(R.freqTicks(5, 5), [], "no span, no labels");
  assert.ok(Math.abs(R.xOf(14.175, 14.0, 14.35) - 0.5) < 1e-9);
  assert.equal(R.xOf(13, 14.0, 14.35), 0, "outside the span sits on the edge");
});

test("perspective: the front row is full width, older rows shrink towards the horizon", () => {
  const cam = { left: 40, right: 640, frontY: 300, horizonY: 10, heightPx: 150, k: 1.3 };
  const front = R.project(cam, 0, 0, 0), back = R.project(cam, 0, 0, 1);
  assert.equal(front.x, 40);
  assert.equal(front.y, 300);
  assert.ok(back.x > front.x && back.y < front.y, "the back row is narrower and higher");
  assert.equal(R.project(cam, 0.5, 0, 1).x, 340, "the middle stays in the middle");
  assert.equal(R.project(cam, 0, 1, 0).y, 150, "full height at the front");
});

test("the row ring keeps the newest first and forgets the oldest", () => {
  const ring = new R.RowRing(3, 2);
  for (let i = 1; i <= 4; i++) ring.push(new Float32Array([i / 10, i / 10]), i * 100);
  assert.equal(ring.count, 3);
  assert.ok(Math.abs(ring.get(0)[0] - 0.4) < 1e-6);
  assert.ok(Math.abs(ring.get(2)[0] - 0.2) < 1e-6);
  assert.equal(ring.timeOf(0), 400);
  assert.equal(ring.timeOf(2), 200);
  ring.clear();
  assert.equal(ring.count, 0);
});

test("theme colours are read from #rgb, #rrggbb and rgb()", () => {
  assert.deepEqual(R.parseColor("#0af", [0, 0, 0]), [0, 170, 255]);
  assert.deepEqual(R.parseColor("#123456", [0, 0, 0]), [18, 52, 86]);
  assert.deepEqual(R.parseColor("rgb(1, 2, 3)", [0, 0, 0]), [1, 2, 3]);
  assert.deepEqual(R.parseColor("teal", [9, 9, 9]), [9, 9, 9]);
});
