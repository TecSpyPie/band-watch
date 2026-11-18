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

test("fast enough: a second of audio through everything in well under a second", () => {
  const c = new Chain({ voice: true, cw: false, notch: true, nr: true, nrLevel: 3, comp: true });
  const x = noise(1);
  const t = process.hrtime.bigint();
  c.process(x);
  const ms = Number(process.hrtime.bigint() - t) / 1e6;
  assert.ok(ms < 400, `${ms.toFixed(0)} ms`);
});
