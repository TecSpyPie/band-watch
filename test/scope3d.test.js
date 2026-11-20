"use strict";
// ClearRX's 3D spectrum scope: the pure maths (frequency mapping, bins to columns, projection, colours, the row buffer).
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../clearrx/public/js/scope3d.js");
const { EQ_FREQS, eqResponseDb } = require("../public/js/rxfx.js");

test("frequency maps on a log scale across 50 Hz to 6 kHz and back", () => {
  assert.equal(S.freqToX(50), 0);
  assert.equal(S.freqToX(6000), 1);
  assert.equal(S.freqToX(10), 0); // clamped
  assert.equal(S.freqToX(60000), 1);
  const oct = S.freqToX(200) - S.freqToX(100);
  assert.ok(Math.abs(oct - (S.freqToX(2000) - S.freqToX(1000))) < 1e-9, "every octave is the same width");
  for (const f of [50, 123, 1000, 4321, 6000]) assert.ok(Math.abs(S.xToFreq(S.freqToX(f)) - f) < 1e-6 * f);
  const xs = EQ_FREQS.map(S.freqToX);
  assert.ok(xs.every((x, i) => x > 0 && x < 1 && (i === 0 || x > xs[i - 1])), "the ten EQ bands fall inside, in order");
});

test("level maps to height 0..1 and silence is the floor", () => {
  assert.equal(S.dbToHeight(-100), 0);
  assert.equal(S.dbToHeight(-20), 1);
  assert.equal(S.dbToHeight(0), 1);
  assert.equal(S.dbToHeight(-Infinity), 0);
  assert.equal(S.dbToHeight(NaN), 0);
  assert.ok(Math.abs(S.dbToHeight(-60) - 0.5) < 1e-9);
});

test("analyser bins become log-spaced columns: a tone lands in the right column", () => {
  const rate = 48000, fft = 4096, cols = 96, hz = rate / fft;
  const map = S.makeColumnMap(rate, fft, cols);
  const bins = new Float32Array(fft / 2).fill(-100);
  bins[Math.round(1000 / hz)] = -20; // a 1 kHz tone
  const out = S.applyColumnMap(map, bins, new Float32Array(cols));
  let best = 0;
  for (let c = 1; c < cols; c++) if (out[c] > out[best]) best = c;
  assert.ok(Math.abs(best - S.columnFor(1000, cols)) <= 1, `peak in column ${best}`);
  assert.equal(Math.round(out[best]), -20);
  // low end: columns narrower than a bin are interpolated, so a rising ramp of bins gives a rising line
  const ramp = Float32Array.from({ length: fft / 2 }, (_, i) => -100 + i * 0.05);
  const r = S.applyColumnMap(map, ramp, new Float32Array(cols));
  for (let c = 1; c < cols; c++) assert.ok(r[c] >= r[c - 1] - 1e-4, "no dips");
  // silent bins (-Infinity) don't poison it
  const sil = S.applyColumnMap(map, new Float32Array(fft / 2).fill(-Infinity), new Float32Array(cols));
  assert.ok(sil.every((v) => Number.isFinite(v) && S.dbToHeight(v) === 0));
});

test("projection: nearer is lower and wider, farther is higher and narrower, height lifts the point", () => {
  const cam = { left: 40, right: 640, frontY: 214, horizonY: 8, heightPx: 100, k: 1.3 };
  const f = S.project(cam, 0, 0, 0), b = S.project(cam, 0, 0, 1), fr = S.project(cam, 1, 0, 0), br = S.project(cam, 1, 0, 1);
  assert.equal(f.x, 40); assert.equal(fr.x, 640); assert.equal(f.y, 214); assert.equal(f.s, 1);
  assert.ok(b.y < f.y, "the back is higher on the screen");
  assert.ok(br.x - b.x < fr.x - f.x, "the back is narrower");
  assert.ok(Math.abs((b.x + br.x) / 2 - 340) < 1e-9, "and still centred");
  let prev = 1;
  for (let z = 0.1; z <= 1; z += 0.1) { const s = S.project(cam, 0, 0, z).s; assert.ok(s < prev); prev = s; }
  assert.ok(S.project(cam, 0.5, 1, 0).y < S.project(cam, 0.5, 0, 0).y);
  assert.ok(Math.abs(S.project(cam, 0.5, 1, 0).y - (214 - 100)) < 1e-9);
});

test("colours: parse, ramp and depth fade", () => {
  assert.deepEqual(S.parseColor("#45e0f5"), [69, 224, 245]);
  assert.deepEqual(S.parseColor(" #fff "), [255, 255, 255]);
  assert.deepEqual(S.parseColor("red", [1, 2, 3]), [1, 2, 3]);
  const stops = [[0, 0, 0], [100, 100, 100], [200, 0, 0]];
  assert.deepEqual(S.rampColor(stops, 0), [0, 0, 0]);
  assert.deepEqual(S.rampColor(stops, 0.5), [100, 100, 100]);
  assert.deepEqual(S.rampColor(stops, 1), [200, 0, 0]);
  assert.deepEqual(S.rampColor(stops, 2), [200, 0, 0]);
  assert.deepEqual(S.rampColor(stops, 0.25), [50, 50, 50]);
  assert.equal(S.depthFade(0, 72), 0);
  assert.ok(S.depthFade(71, 72) > S.depthFade(36, 72) && S.depthFade(36, 72) > 0);
  assert.ok(S.depthFade(71, 72) <= 0.82 + 1e-9);
  const after = S.rampStops({}, "after"), before = S.rampStops({}, "before");
  assert.deepEqual(after[1], S.DEFAULT_THEME.led);
  assert.notDeepEqual(after, before);
  assert.equal(S.rgb([1.4, 2.6, 3], 0.5), "rgba(1,3,3,0.5)");
});

test("the row buffer keeps the newest first and forgets the oldest", () => {
  const ring = new S.RowRing(3, 2);
  ring.push([-20, -100]); ring.push([-60, -60]);
  assert.equal(ring.count, 2);
  assert.deepEqual(Array.from(ring.get(0)), [0.5, 0.5]);
  assert.deepEqual(Array.from(ring.get(1)), [1, 0]);
  ring.push([-100, -100]); ring.push([-20, -20]);
  assert.equal(ring.count, 3);
  assert.deepEqual(Array.from(ring.get(0)), [1, 1]);
  assert.deepEqual(Array.from(ring.get(2)), [0.5, 0.5], "the first row has been pushed out");
  ring.clear();
  assert.equal(ring.count, 0);
});

test("the EQ curve the scope draws peaks at a boosted band and matches rxfx", () => {
  const cols = 96, gains = [0, 0, 0, 0, 0, 12, 0, 0, 0, 0]; // +12 dB at 1200 Hz
  const curve = Array.from({ length: cols }, (_, c) => eqResponseDb(gains, S.xToFreq(c / (cols - 1))));
  const top = curve.indexOf(Math.max(...curve));
  assert.ok(Math.abs(top - S.columnFor(1200, cols)) <= 1);
  assert.ok(Math.abs(Math.max(...curve) - 12) < 0.5);
});
