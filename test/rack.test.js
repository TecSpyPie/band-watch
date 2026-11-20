"use strict";
// ClearRX's effects rack: module order, the graphic EQ, the compressor / limiter. Made-up sounds in, check what comes out.
const test = require("node:test");
const assert = require("node:assert/strict");
const Fx = require("../public/js/rxfx.js");
const { Chain, MODULES, normalizeOrder, moveModule, EQ_FREQS, EQ_PRESETS, normalizeGains, eqResponseDb, compGainDb, CMP_CEILING } = Fx;

const RATE = 48000;
const tone = (f, secs, amp = 0.3) => Float32Array.from({ length: Math.round(secs * RATE) }, (_, n) => amp * Math.sin((2 * Math.PI * f * n) / RATE));
const rms = (a, from = 0) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - from)); };
const db = (out, inp) => 20 * Math.log10(rms(out, out.length >> 1) / rms(inp, inp.length >> 1)); // after it has settled
const through = (settings, sig) => new Chain(settings).process(Float32Array.from(sig));
const blocks = (chain, sig, size = 128) => { // like the sound worklet: 128 samples at a time
  const out = Float32Array.from(sig);
  for (let i = 0; i < out.length; i += size) chain.process(out.subarray(i, i + size));
  return out;
};

test("module order: unknown and repeated ids dropped, missing ones added, and a module moves a place at a time", () => {
  assert.deepEqual(normalizeOrder(undefined), MODULES);
  assert.deepEqual(normalizeOrder([]), MODULES);
  assert.deepEqual(normalizeOrder(["cmp", "bogus", "cmp", "nb"]), ["cmp", "nb", ...MODULES.filter((m) => m !== "cmp" && m !== "nb")]);
  assert.deepEqual(normalizeOrder("eq"), MODULES, "not a list");
  assert.equal(new Set(normalizeOrder(["eq", "eq", "eq"])).size, MODULES.length);
  assert.deepEqual(moveModule(MODULES, "sq", -1).slice(5, 8), ["sq", "nr", "comp"]);
  const up = moveModule(MODULES, "eq", -1), down = moveModule(MODULES, "eq", 1);
  assert.equal(up.indexOf("eq"), MODULES.indexOf("eq") - 1);
  assert.equal(down.indexOf("eq"), MODULES.indexOf("eq") + 1);
  assert.deepEqual(moveModule(MODULES, MODULES[0], -1), MODULES, "the top one can't go up");
  assert.deepEqual(moveModule(MODULES, MODULES[MODULES.length - 1], 1), MODULES, "the bottom one can't go down");
  assert.deepEqual(moveModule(MODULES, "nope", 1), MODULES);
  assert.notEqual(moveModule(MODULES, "eq", 1), MODULES, "a new list, the old one is left alone");
});

test("graphic EQ: a band gives its gain at its own frequency and little far away; presets are ten whole dB within +-12", () => {
  assert.equal(EQ_FREQS.length, 10);
  for (const [name, g] of Object.entries(EQ_PRESETS)) {
    assert.equal(g.length, 10, name);
    assert.ok(g.every((v) => Number.isInteger(v) && Math.abs(v) <= 12), name);
  }
  const only = (i, v) => EQ_PRESETS.flat.map((_, k) => (k === i ? v : 0));
  for (const i of [0, 3, 5, 9]) {
    assert.ok(Math.abs(eqResponseDb(only(i, 12), EQ_FREQS[i]) - 12) < 0.05, `${EQ_FREQS[i]} Hz +12`);
    assert.ok(Math.abs(eqResponseDb(only(i, -12), EQ_FREQS[i]) + 12) < 0.05, `${EQ_FREQS[i]} Hz -12`);
  }
  assert.ok(Math.abs(eqResponseDb(only(5, 12), 100)) < 1, "1.2 kHz band leaves 100 Hz alone");
  assert.ok(Math.abs(eqResponseDb(only(5, 12), 5000)) < 1, "and 5 kHz");
  assert.equal(eqResponseDb(EQ_PRESETS.flat, 1000), 0);
  // Through the real chain: a tone at a band's frequency comes out that much louder or quieter
  for (const [g, want] of [[12, 12], [-12, -12], [6, 6]]) {
    const t = tone(1200, 1, 0.05);
    assert.ok(Math.abs(db(through({ eq: true, eqGains: only(5, g) }, t), t) - want) < 0.5, `${g} dB`);
  }
  // Flat, or switched off with gains set: the sound is untouched
  const x = tone(900, 0.2);
  assert.deepEqual(Array.from(through({ eq: true, eqGains: EQ_PRESETS.flat }, x)), Array.from(x));
  assert.deepEqual(Array.from(through({ eq: false, eqGains: only(5, 12) }, x)), Array.from(x));
});

test("graphic EQ: gains are made safe (clamped, whole dB, ten of them)", () => {
  assert.deepEqual(normalizeGains([20, -20, 3.6, "x", null, undefined, NaN, Infinity]), [12, -12, 4, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(normalizeGains(undefined), EQ_PRESETS.flat);
  assert.equal(new Chain({ eq: true, eqGains: [99] }).s.eqGains[0], 12);
  assert.equal(new Chain({ eq: true, eqGains: new Array(30).fill(5) }).s.eqGains.length, 10);
});

test("graphic EQ: dragging a slider while sound plays makes no click", () => {
  const sig = tone(1200, 1, 0.3), c = new Chain({ eq: true, eqGains: EQ_PRESETS.flat });
  const out = Float32Array.from(sig);
  for (let i = 0, step = 0; i < out.length; i += 128, step++) {
    c.configure({ eq: true, eqGains: EQ_PRESETS.flat.map((_, k) => (k === 5 ? Math.round(6 * Math.sin(step / 20)) : 0)) });
    c.process(out.subarray(i, i + 128));
  }
  let worst = 0;
  for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
  assert.ok(worst < 0.1, `biggest step between samples ${worst.toFixed(3)} (a 1.2 kHz tone at this level steps 0.05)`);
});

test("compressor curve: nothing below the threshold, 1 / ratio above it, smooth through the knee", () => {
  assert.equal(compGainDb(-40, -20, 4), 0);
  assert.equal(compGainDb(-20 - 3.01, -20, 4), 0, "the knee starts 3 dB below");
  assert.ok(Math.abs(compGainDb(-8, -20, 4) - -9) < 1e-9, "12 dB over at 4:1 = 9 dB less");
  assert.ok(Math.abs(compGainDb(0, -20, 2) - -10) < 1e-9);
  assert.equal(compGainDb(0, -20, 1), 0, "1:1 does nothing");
  assert.equal(compGainDb(0, -20, 0.5), 0);
  assert.ok(Math.abs(compGainDb(-20, -20, 4, 6) - -0.5625) < 1e-9, "at the threshold the knee has taken a little");
  // never goes up, and never jumps (the knee's two ends meet the straight parts)
  let last = 0;
  for (let l = -60; l <= 0; l += 0.25) {
    const g = compGainDb(l, -30, 6);
    assert.ok(g <= 0 && g <= last + 1e-12, `falls steadily at ${l}`);
    assert.ok(last - g < 0.5, `no jump at ${l}`);
    last = g;
  }
});

test("compressor / limiter: loud sound is turned down by the ratio, quiet sound is left, make-up adds gain", () => {
  const loud = tone(1000, 2, 0.5); // -6 dBFS peak
  const c = new Chain({ cmp: true, cmpThr: -30, cmpRatio: 4, cmpMakeup: 0, cmpLimit: false });
  const out = c.process(Float32Array.from(loud));
  const want = ((-6 - -30) * (1 / 4 - 1)); // about -18 dB
  const got = db(out, loud);
  assert.ok(Math.abs(got - want) < 3, `${got.toFixed(1)} dB, wanted about ${want.toFixed(1)}`);
  assert.ok(c.meter.gr > 10, `meter shows ${c.meter.gr.toFixed(1)} dB of gain reduction`);
  const quiet = tone(1000, 1, 0.005);
  assert.ok(Math.abs(db(through({ cmp: true, cmpThr: -30, cmpRatio: 4, cmpLimit: false }, quiet), quiet)) < 0.3, "below the threshold: untouched");
  const made = db(through({ cmp: true, cmpThr: -30, cmpRatio: 4, cmpMakeup: 12, cmpLimit: false }, loud), loud) - got;
  assert.ok(Math.abs(made - 12) < 0.5, `make-up +12 dB gave ${made.toFixed(1)}`);
  // Off: nothing changes, and the meter reads 0
  const idle = new Chain({ cmp: false });
  idle.process(Float32Array.from(loud));
  assert.equal(idle.meter.gr, 0);
});

test("limiter: nothing gets above -1 dBFS, even a sudden loud burst; with it off the compressor alone lets peaks through", () => {
  const burst = Float32Array.from({ length: RATE }, (_, n) => (n < RATE / 2 ? 0.05 : 3) * Math.sin((2 * Math.PI * 700 * n) / RATE));
  const lim = through({ cmp: true, cmpThr: 0, cmpRatio: 1, cmpLimit: true }, burst);
  const peak = lim.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak <= CMP_CEILING + 1e-6, `peak ${peak.toFixed(3)}`);
  assert.ok(Math.abs(CMP_CEILING - 0.8913) < 0.001);
  const c = new Chain({ cmp: true, cmpThr: 0, cmpRatio: 1, cmpLimit: true });
  c.process(Float32Array.from(burst.slice(RATE / 2, RATE / 2 + 4800)));
  assert.ok(c.meter.gr > 8, `limiter reduction shows: ${c.meter.gr.toFixed(1)} dB`);
  const nolim = through({ cmp: true, cmpThr: 0, cmpRatio: 1, cmpLimit: false }, burst);
  assert.ok(nolim.reduce((m, v) => Math.max(m, Math.abs(v)), 0) > 0.95, "without the limiter the soft limiter alone holds it");
  assert.ok(nolim.every((v) => Math.abs(v) <= 1), "and it still never clips");
});

test("order matters: a compressor after the EQ works on the boosted sound, before it on the original", () => {
  const t = tone(1200, 2, 0.05); // -26 dBFS
  const eq = { eq: true, eqGains: EQ_PRESETS.flat.map((_, k) => (k === 5 ? 12 : 0)), cmp: true, cmpThr: -20, cmpRatio: 8, cmpLimit: false };
  const eqFirst = through({ ...eq, order: ["eq", "cmp"] }, t); // boosted to -14 dBFS, then over the threshold: turned down
  const cmpFirst = through({ ...eq, order: ["cmp", "eq"] }, t); // -26 is under the threshold: untouched, then boosted
  assert.ok(db(cmpFirst, t) > 10.5, `compressor first: ${db(cmpFirst, t).toFixed(1)} dB`);
  assert.ok(db(eqFirst, t) < 8, `EQ first: ${db(eqFirst, t).toFixed(1)} dB`);
  // The usual order is what you get when none is given
  assert.deepEqual(new Chain({}).s.order, MODULES);
  assert.deepEqual(Array.from(through(eq, t)), Array.from(through({ ...eq, order: MODULES }, t)));
});

test("order matters for the squelch too: it listens where it sits", () => {
  // Quiet noise, then the EQ lifts it 12 dB: a squelch before the EQ stays shut, one after it hears the lifted noise and opens
  let seed = 3;
  const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
  const noise = Float32Array.from({ length: RATE }, () => 0.006 * rand());
  const lift = { eq: true, eqGains: EQ_PRESETS.flat.map((_, k) => (k >= 3 && k <= 7 ? 12 : 0)), sq: -34, order: ["sq", "eq"] };
  const shutFirst = through(lift, noise);
  const listenAfter = through({ ...lift, order: ["eq", "sq"] }, noise);
  assert.ok(rms(listenAfter, RATE / 2) > 4 * rms(shutFirst, RATE / 2), `${rms(listenAfter, RATE / 2).toFixed(4)} vs ${rms(shutFirst, RATE / 2).toFixed(4)}`);
});

test("changing the order mid-sound fades out and back in: no click, and the new order takes over", () => {
  const sig = tone(1000, 1, 0.3);
  const c = new Chain({ eq: true, eqGains: EQ_PRESETS.flat.map((_, k) => (k === 5 ? 3 : 0)), cmp: true, cmpThr: -30, cmpRatio: 3, order: ["eq", "cmp"] });
  const out = Float32Array.from(sig);
  let swappedAt = -1;
  for (let i = 0; i < out.length; i += 128) {
    if (i === 128 * 100) c.configure({ order: ["cmp", "eq"] });
    c.process(out.subarray(i, i + 128));
    if (swappedAt < 0 && c.order[0] === "cmp") swappedAt = i;
  }
  assert.deepEqual(c.order.slice(0, 2), ["cmp", "eq"]);
  assert.ok(swappedAt > 128 * 100 && swappedAt < 128 * 100 + RATE * 0.03, `swapped ${swappedAt - 128 * 100} samples after the change`);
  let worst = 0;
  for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]));
  assert.ok(worst < 0.08, `biggest step between samples ${worst.toFixed(3)}`);
  const around = out.slice(128 * 100, 128 * 100 + RATE * 0.03);
  let quietest = 1;
  for (let i = 0; i + 48 <= around.length; i += 24) quietest = Math.min(quietest, rms(around.slice(i, i + 48)));
  assert.ok(quietest < 0.01, `it dipped to silence while it changed (quietest 1 ms: ${quietest.toFixed(4)})`);
  assert.ok(rms(out.slice(RATE / 2)) > 0.05, "and came back");
  // Same order again: nothing happens
  const same = new Chain({ order: ["eq", "cmp"] });
  same.configure({ order: same.order });
  assert.equal(same.pending, null);
  // Changed back before the swap: it just carries on
  const back = new Chain({});
  back.configure({ order: moveModule(MODULES, "eq", 1) });
  back.configure({ order: MODULES });
  assert.equal(back.pending, null);
});

test("a first order is used straight away; switched-off modules cost nothing and change nothing", () => {
  const c = new Chain({ order: ["cmp", "eq", ...MODULES.filter((m) => m !== "cmp" && m !== "eq")] });
  assert.deepEqual(c.order.slice(0, 2), ["cmp", "eq"]);
  const x = tone(900, 0.2);
  assert.deepEqual(Array.from(through({ order: [...MODULES].reverse() }, x)), Array.from(x), "everything off: untouched, whatever the order");
  assert.deepEqual(c.active, []);
  const on = new Chain({ nb: true, eq: true, eqGains: EQ_PRESETS.ssb, cmp: true });
  assert.deepEqual(on.active, ["nb", "eq", "cmp"]);
});

test("the rack is fast enough: a second of audio through every module in well under a second", () => {
  const c = new Chain({ voice: true, cw: true, notch: true, nr: true, nrLevel: 3, comp: true, nb: true, sq: -60, bass: 6, treble: 3, mnotch: 1500,
    eq: true, eqGains: EQ_PRESETS.weak, cmp: true });
  const x = tone(900, 1);
  const t = process.hrtime.bigint();
  blocks(c, x);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});
