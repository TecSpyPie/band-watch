"use strict";
// ClearRX's hiss remover (spectral noise reduction, "learn the hiss"): made-up hiss and voices in, check what comes out.
const test = require("node:test");
const assert = require("node:assert/strict");
const { Chain, SpectralNr, fft, SNR_N, SNR_HOP, SNR_BINS, MODULES, normalizeOrder, DEFAULTS } = require("../public/js/rxfx.js");

const RATE = 48000, LAG = SNR_N; // it gives the sound back 512 samples (about 11 ms) later
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const hiss = (secs, amp = 0.05) => Float32Array.from({ length: Math.round(secs * RATE) }, () => amp * rnd());
const sine = (f, n, amp) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / RATE));
const rms = (a, from = 0, to = a.length) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return Math.sqrt(s / (to - from)); };
const dB = (v) => 20 * Math.log10(v);
const blocks = (chain, sig, size = 128) => { // like the sound worklet: 128 samples at a time
  const out = Float32Array.from(sig);
  for (let i = 0; i < out.length; i += size) chain.process(out.subarray(i, i + size));
  return out;
};
// "Syllables": two tones, 150 ms on and 150 ms off, like speech coming and going
const SYL = 7200;
const sylOn = (i) => i >= 0 && Math.floor(i / SYL) % 2 === 0;
const voice = (n) => Float32Array.from({ length: n }, (_, i) => (sylOn(i) ? 0.3 * Math.sin((2 * Math.PI * 1000 * i) / RATE) + 0.15 * Math.sin((2 * Math.PI * 1700 * i) / RATE) : 0));

test("the FFT is right: a forward and back gives the same, and a tone lands in its own bin", () => {
  const re = new Float64Array(SNR_N), im = new Float64Array(SNR_N);
  for (let i = 0; i < SNR_N; i++) re[i] = Math.cos((2 * Math.PI * 12 * i) / SNR_N);
  fft(re, im, false);
  assert.ok(Math.abs(re[12] - SNR_N / 2) < 1e-9 && Math.abs(re[11]) < 1e-9 && Math.abs(re[13]) < 1e-9);
  fft(re, im, true);
  for (let i = 0; i < SNR_N; i++) assert.ok(Math.abs(re[i] / SNR_N - Math.cos((2 * Math.PI * 12 * i) / SNR_N)) < 1e-12);
});

test("with nothing to take out, the sound comes back exactly as it went in, 512 samples later", () => {
  const f = new SpectralNr();
  f.setProfile(new Array(SNR_BINS).fill(-2500)); // a taught noise far below the sound
  const x = sine(1234, RATE, 0.3), y = x.map((v) => f.step(v));
  let err = 0;
  for (let i = LAG * 2; i < x.length; i++) err = Math.max(err, Math.abs(y[i] - x[i - LAG]));
  assert.ok(err < 1e-9, `largest difference ${err}`);
});

test("it takes steady hiss down by about the Strength, by itself (nothing taught)", () => {
  for (const level of [10, 20]) {
    const x = hiss(4), y = blocks(new Chain({ snr: true, snrLevel: level }), x);
    const cut = dB(rms(x, 2 * RATE) / rms(y, 2 * RATE));
    assert.ok(cut > level - 4 && cut < level + 6, `strength ${level} dB: hiss down ${cut.toFixed(1)} dB`);
  }
});

test("a voice keeps its level, and the hiss between the syllables goes", () => {
  const n = 4 * RATE, v = voice(n), noise = hiss(4), x = v.map((s, i) => s + noise[i]);
  const y = blocks(new Chain({ snr: true, snrLevel: 20 }), x);
  let sv = 0, rv = 0, nv = 0, sg = 0, ng = 0;
  for (let i = 2 * RATE; i < n; i++) {
    const j = i - LAG;
    if (sylOn(j) && sylOn(j - LAG) && sylOn(j + LAG)) { sv += y[i] ** 2; rv += v[j] ** 2; nv++; }
    if (!sylOn(j) && !sylOn(j - LAG) && !sylOn(j + LAG)) { sg += y[i] ** 2; ng++; }
  }
  const keep = 10 * Math.log10(sv / rv), gaps = 10 * Math.log10(sg / ng) - dB(rms(noise));
  assert.ok(Math.abs(keep) < 1, `the voice changed by ${keep.toFixed(2)} dB`);
  assert.ok(gaps < -10, `the hiss between syllables only went down ${(-gaps).toFixed(1)} dB`);
});

test("Learn noise: it learns 1.5 s of hiss, gives a profile to keep, and the profile works after a save and load", () => {
  const c = new Chain({ snr: true, snrLevel: 20 });
  c.snrLearn(1.5, 1);
  assert.equal(c.snrLearning, true);
  blocks(c, hiss(2));
  assert.equal(c.snrLearning, false);
  assert.equal(c.snrF.learnt, 1);
  const p = c.snrF.profileOut();
  assert.equal(p.length, SNR_BINS);
  assert.ok(p.every((v) => Number.isInteger(v) && v >= -3000 && v <= 600));
  // Saved and loaded into a fresh chain (as ClearRX does at the next start): it takes the hiss out at once, no warming up
  const fresh = new Chain({ snr: true, snrLevel: 20, snrProfile: p });
  const x = hiss(1), y = blocks(fresh, x);
  const cut = dB(rms(x, 0.2 * RATE) / rms(y, 0.2 * RATE));
  assert.ok(cut > 14, `with the taught noise, hiss down only ${cut.toFixed(1)} dB in the first second`);
  // Forget it: back to following the noise by itself
  fresh.configure({ snrProfile: [] });
  assert.equal(fresh.snrF.profile, null);
});

test("a taught noise still fits after the Volume changes (it's kept at an input gain of 1)", () => {
  const c = new Chain({ snr: true, snrLevel: 20 });
  c.snrLearn(1.5, 1);
  blocks(c, hiss(2));
  const p = c.snrF.profileOut();
  const louder = new Chain({ snr: true, snrLevel: 20, snrProfile: p });
  louder.inGain = 2; // the worklet tells it the Volume; the sound comes in twice as loud
  const x = hiss(1, 0.1), y = blocks(louder, x);
  assert.ok(dB(rms(x, 0.2 * RATE) / rms(y, 0.2 * RATE)) > 14);
});

test("a wrong profile is dropped, the strength is kept within 6-30 dB, and it starts off", () => {
  assert.equal(DEFAULTS.snr, false);
  assert.equal(new Chain({ snrLevel: 99 }).s.snrLevel, 30);
  assert.equal(new Chain({ snrLevel: 1 }).s.snrLevel, 6);
  assert.deepEqual(new Chain({ snrProfile: [1, 2, 3] }).s.snrProfile, []);
  assert.deepEqual(new Chain({ snrProfile: "nope" }).s.snrProfile, []);
  assert.equal(new Chain({ snrProfile: new Array(SNR_BINS).fill(9999) }).s.snrProfile[0], 600);
});

test("switching it on and off fades, so there's no click (it's 11 ms late, so a plain switch would jump)", () => {
  const c = new Chain({});
  const x = sine(500, 2 * RATE, 0.3), y = Float32Array.from(x);
  for (let i = 0; i < y.length; i += 128) {
    if (i === 24000 * 1 + 64) c.configure({ snr: true });
    if (i === 72000 - 64) c.configure({ snr: false });
    c.process(y.subarray(i, i + 128));
  }
  let jump = 0;
  for (let i = 1; i < y.length; i++) jump = Math.max(jump, Math.abs(y[i] - y[i - 1]));
  const sineStep = 0.3 * 2 * Math.PI * 500 / RATE; // the largest step the tone itself makes
  assert.ok(jump < sineStep * 1.6, `a jump of ${jump.toFixed(4)} (the tone's own steps are up to ${sineStep.toFixed(4)})`);
  assert.equal(c.active.includes("snr"), false);
});

test("in the rack: straight after the auto notch, and an order saved before it existed gets it there too", () => {
  assert.equal(MODULES.indexOf("snr"), MODULES.indexOf("notch") + 1);
  const old = ["cmp", "notch", "nb", "voice", "cw", "mnotch", "nr", "sq", "comp", "eq", "tone"];
  assert.deepEqual(normalizeOrder(old), ["cmp", "notch", "snr", "nb", "voice", "cw", "mnotch", "nr", "sq", "comp", "eq", "tone"]);
  assert.equal(new Chain({ snr: true }).active.includes("snr"), true);
});

test("it's light enough: a minute of sound in well under a second", () => {
  const c = new Chain({ snr: true }), x = hiss(60);
  const t0 = process.hrtime.bigint();
  blocks(c, x);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `${ms.toFixed(0)} ms for 60 s of sound`);
  assert.equal(SNR_HOP, SNR_N / 2);
});
