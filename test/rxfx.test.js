"use strict";
// The radio audio processor: made-up sounds in, check what comes out.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Chain, PRESETS } = require("../public/js/rxfx.js");

const RATE = 48000;
const tone = (f, secs, amp = 0.3) => Float32Array.from({ length: Math.round(secs * RATE) }, (_, n) => amp * Math.sin((2 * Math.PI * f * n) / RATE));
let seed = 1;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
const noise = (secs, amp = 0.2) => Float32Array.from({ length: Math.round(secs * RATE) }, () => amp * rand());
const rms = (a, from = 0) => { let s = 0; for (let i = from; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length - from)); };
const db = (out, inp) => 20 * Math.log10(rms(out, out.length >> 1) / rms(inp, inp.length >> 1)); // after it has settled
const through = (settings, sig) => new Chain(settings).process(Float32Array.from(sig));

test("off: the sound passes untouched", () => {
  const x = noise(0.2);
  assert.deepEqual(Array.from(through({ preset: "off" }, x)), Array.from(x));
});

test("voice filter keeps 300-2700 Hz and cuts below and above", () => {
  const s = { voice: true, lo: 300, hi: 2700 };
  assert.ok(Math.abs(db(through(s, tone(1000, 0.5)), tone(1000, 0.5))) < 1, "1 kHz passes");
  assert.ok(db(through(s, tone(80, 0.5)), tone(80, 0.5)) < -20, "80 Hz hum cut");
  assert.ok(db(through(s, tone(6000, 0.5)), tone(6000, 0.5)) < -20, "6 kHz hiss cut");
});

test("CW peak passes the 700 Hz note and cuts a station 300 Hz away", () => {
  const s = { cw: true, tone: 700, width: 200 };
  assert.ok(Math.abs(db(through(s, tone(700, 0.5)), tone(700, 0.5))) < 1.5);
  assert.ok(db(through(s, tone(1000, 0.5)), tone(1000, 0.5)) < -20);
});

test("auto notch learns a steady carrier and removes it, but lets noise-like sound (speech) through", () => {
  const s = { notch: true };
  assert.ok(db(through(s, tone(1250, 2)), tone(1250, 2)) < -15, "carrier removed");
  const n = noise(2);
  assert.ok(Math.abs(db(through(s, n), n)) < 2, "unpredictable sound passes");
});

test("noise reduction takes hiss down and keeps a tone", () => {
  const n = noise(2);
  assert.ok(db(through({ nr: true, nrLevel: 2 }, n), n) < -6, "hiss reduced");
  const t = tone(800, 2);
  assert.ok(Math.abs(db(through({ nr: true, nrLevel: 2 }, t), t)) < 3, "a tone keeps its level");
});

test("compressor brings quiet and loud stations to a steady level, and never clips", () => {
  const quiet = through({ comp: true }, tone(1000, 2, 0.01));
  const loud = through({ comp: true }, tone(1000, 2, 0.9));
  const q = rms(quiet, quiet.length >> 1), l = rms(loud, loud.length >> 1);
  assert.ok(q > 0.1 && l < 0.5, `quiet ${q.toFixed(3)}, loud ${l.toFixed(3)}`);
  assert.ok(Math.abs(20 * Math.log10(q / l)) < 6, "within 6 dB of each other (they were 39 dB apart)");
  const hot = through({ comp: true }, tone(1000, 0.5, 3));
  assert.ok(hot.every((v) => Math.abs(v) <= 1), "limited");
});

test("meter: level, and a clip warning when the sound is too loud", () => {
  const c = new Chain({ preset: "off" });
  c.process(tone(1000, 0.1, 0.5));
  assert.ok(Math.abs(c.meter.peak - 20 * Math.log10(0.5)) < 0.5);
  assert.equal(c.meter.clip, false);
  c.process(tone(1000, 0.1, 1.5));
  assert.equal(c.meter.clip, true);
});

test("presets", () => {
  const c = new Chain({ preset: "weak" });
  assert.deepEqual([c.s.voice, c.s.hi, c.s.notch, c.s.nr, c.s.comp], [true, 2400, true, true, true]);
  c.configure({ preset: "cw" });
  assert.deepEqual([c.s.voice, c.s.cw, c.s.tone], [false, true, 700]);
  for (const k of Object.keys(PRESETS)) assert.ok(new Chain({ preset: k }).process(noise(0.05)).every(Number.isFinite), k);
});

test("noise blanker silences clicks and leaves the sound between them alone", () => {
  const sig = tone(800, 1, 0.1);
  const clicky = Float32Array.from(sig);
  for (let n = 4800; n < clicky.length; n += 4800) for (let k = 0; k < 20; k++) clicky[n + k] = k % 2 ? -0.9 : 0.9; // 10 clicks
  const out = through({ nb: true, nbLevel: 2 }, clicky);
  const worst = (a) => a.slice(4800).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(worst(clicky) > 0.8 && worst(out) < 0.2, `clicks ${worst(clicky).toFixed(2)} -> ${worst(out).toFixed(2)}`);
  assert.ok(Math.abs(db(through({ nb: true, nbLevel: 2 }, sig), sig)) < 0.5, "a clean tone isn't blanked");
  // A strong station starting suddenly out of near-silence is learnt, not blanked for ever
  const sudden = Float32Array.from({ length: RATE }, (_, n) => (n < RATE * 0.3 ? 0.001 * rand() : 0.5 * Math.sin((2 * Math.PI * 900 * n) / RATE)));
  const kept = through({ nb: true, nbLevel: 3 }, sudden);
  assert.ok(rms(kept.slice(RATE * 0.4)) / rms(sudden.slice(RATE * 0.4)) > 0.95, "a sudden strong signal passes");
});

test("manual notch removes the chosen whistle and keeps a note 300 Hz away", () => {
  const s = { mnotch: 1500 };
  assert.ok(db(through(s, tone(1500, 1)), tone(1500, 1)) < -30, "1500 Hz whistle gone");
  assert.ok(Math.abs(db(through(s, tone(1200, 1)), tone(1200, 1))) < 1, "1200 Hz kept");
  assert.equal(new Chain({ mnotch: 50 }).s.mnotch, 200, "kept in range");
});

test("bass and treble raise and lower the ends and leave the middle", () => {
  assert.ok(Math.abs(db(through({ bass: 9 }, tone(80, 1)), tone(80, 1)) - 9) < 1, "bass +9 dB at 80 Hz");
  assert.ok(Math.abs(db(through({ treble: -9 }, tone(6000, 1)), tone(6000, 1)) + 9) < 1, "treble -9 dB at 6 kHz");
  assert.ok(Math.abs(db(through({ bass: 9, treble: -9 }, tone(1000, 1)), tone(1000, 1))) < 1.5, "1 kHz about the same");
});

test("squelch: quiet noise is silenced, a signal opens it straight away, and it holds over short gaps", () => {
  const quiet = noise(1, 0.003); // about -55 dBFS
  const shut = through({ sq: -40 }, quiet);
  assert.ok(rms(shut, shut.length >> 1) < 1e-4, "closed on the noise");
  const strong = tone(1000, 1, 0.3);
  assert.ok(Math.abs(db(through({ sq: -40 }, strong), strong)) < 0.5, "open on the signal");
  // A 200 ms gap in the signal is held open; the noise after 1 s of silence isn't
  const gap = Float32Array.from({ length: RATE }, (_, n) => (n < RATE * 0.4 || n >= RATE * 0.6 ? 0.3 * Math.sin((2 * Math.PI * 1000 * n) / RATE) : 0.003 * rand()));
  const out = through({ sq: -40 }, gap);
  assert.ok(rms(out.slice(RATE * 0.45, RATE * 0.55)) > 1e-3, "held open in the gap");
});

test("AGC speed: fast comes back up sooner than slow after a loud burst", () => {
  const sig = Float32Array.from({ length: RATE * 2 }, (_, n) => (n < RATE * 0.5 ? 0.9 : 0.02) * Math.sin((2 * Math.PI * 1000 * n) / RATE));
  const at = (agc) => { const o = through({ comp: true, agc }, sig); return rms(o.slice(RATE * 0.8, RATE * 1.0)); };
  const fast = at("fast"), medium = at("medium"), slow = at("slow");
  assert.ok(fast > medium && medium > slow, `level 0.3-0.5 s after the burst: fast ${fast.toFixed(3)}, medium ${medium.toFixed(3)}, slow ${slow.toFixed(3)}`);
  assert.equal(new Chain({ agc: "warp" }).s.agc, "medium");
});

test("the extras stay as they are when a preset is picked", () => {
  const c = new Chain({ nb: true, bass: 6, sq: -50, mnotch: 1000, agc: "slow" });
  c.configure({ preset: "ssb" });
  assert.deepEqual([c.s.nb, c.s.bass, c.s.sq, c.s.mnotch, c.s.agc], [true, 6, -50, 1000, "slow"]);
});

test("fast enough: a second of audio through everything in well under a second", () => {
  const c = new Chain({ voice: true, cw: false, notch: true, nr: true, nrLevel: 3, comp: true, nb: true, sq: -60, bass: 6, treble: 3, mnotch: 1500 });
  const x = noise(1);
  const t = process.hrtime.bigint();
  c.process(x);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});
