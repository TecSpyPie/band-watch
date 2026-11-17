"use strict";
const test = require("node:test");
const assert = require("node:assert");
const W = require("../public/js/wspr.js");

// Gaussian noise with a seed, so the tests always see the same noise.
function noise(seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  return () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
}
/** Two minutes of audio with signals at an S/N in 2500 Hz (the way WSJT-X reports it). */
function band(signals, seed = 1) {
  const audio = new Float32Array(120 * 12000);
  const g = noise(seed);
  const sigma = 1;
  for (let i = 0; i < audio.length; i++) audio[i] = sigma * g();
  for (const s of signals) {
    // noise power in 2500 Hz is sigma^2 * 2500 / 6000; a sine of amplitude A has power A^2/2
    const amp = Math.sqrt(2 * (sigma * sigma * 2500 / 6000) * 10 ** (s.snr / 10));
    W.synthesize(W.encodeTones(s.text), { baseHz: s.hz - 1.5 * W.TONE_HZ, startSec: 1 + (s.dt || 0), amp, out: audio });
  }
  return audio;
}

test("sync vector: 162 bits, as published", () => {
  assert.equal(W.SYNC.length, 162);
  // pr3 from WSJT-X (lib/wsprd/wsprsim_utils.c), as published
  const published = "110000001000111000100101111000000010010100000010110011010001101000011010101010010010110001101010001000001001001110110011010001110000010100110000000110101100011000";
  assert.equal(W.SYNC.join(""), published);
});

test("message packing: callsigns, locators and powers round-trip", () => {
  for (const c of ["K1ABC", "M3VRV", "G4ABC", "VK2XYZ", "9A1A", "JA1ZZZ", "W1AW"]) {
    const n = W.packCall(c);
    assert.ok(n >= 0 && n < 2 ** 28, c);
    assert.equal(W.unpackCall(n), c);
  }
  assert.equal(W.packCall("PJ4/K1ABC"), -1);
  for (const [g, p] of [["FN42", 37], ["IO93", 23], ["AA00", 0], ["RR99", 60]]) {
    const m = W.packGridPower(g, p);
    assert.ok(m >= 0 && m < 2 ** 22);
    assert.deepEqual(W.unpackGridPower(m), { grid: g, dbm: p });
  }
  assert.equal(W.packGridPower("IO93", 24), -1, "powers end in 0, 3 or 7");
  assert.throws(() => W.encodeTones("hello"));
});

test("encoder: 162 tones, each tone's low bit is the sync vector", () => {
  const tones = W.encodeTones("K1ABC FN42 37");
  assert.equal(tones.length, 162);
  assert.ok(tones.every((t, i) => t >= 0 && t <= 3 && (t & 1) === W.SYNC[i]));
  assert.notDeepEqual(W.encodeTones("K1ABC FN42 33"), tones);
});

test("Fano decoder: recovers the message from clean and noisy soft symbols", () => {
  const bits = W.messageBits("M3VRV IO93 23");
  // encode by hand (encoder order, before interleaving)
  const enc = [];
  let reg = 0;
  const par = (x) => { let p = 0; while (x) { p ^= x & 1; x >>>= 1; } return p; };
  for (const b of bits) { reg = ((reg << 1) | b) >>> 0; enc.push(par(reg & W.POLY1), par(reg & W.POLY2)); }
  const clean = enc.map((b) => (b ? 200 : 56));
  assert.deepEqual(W.fano(clean).bits, bits);
  const g = noise(7);
  const noisy = enc.map((b) => Math.max(0, Math.min(255, Math.round(128 + (b ? 40 : -40) + 30 * g()))));
  assert.deepEqual(W.fano(noisy).bits, bits);
});

test("decoder: a strong signal, with its frequency, time and S/N", () => {
  const audio = band([{ text: "K1ABC FN42 37", hz: 1480, snr: -10 }]);
  const t = Date.now();
  const got = new W.Decoder().decode(audio);
  const ms = Date.now() - t;
  assert.equal(got.length, 1, JSON.stringify(got));
  const d = got[0];
  assert.equal(d.text, "K1ABC FN42 37");
  assert.deepEqual([d.call, d.grid, d.dbm], ["K1ABC", "FN42", 37]);
  assert.ok(Math.abs(d.freq - 1480) <= 1.5, `freq ${d.freq}`);
  assert.ok(Math.abs(d.dt) <= 0.3, `dt ${d.dt}`);
  assert.ok(Math.abs(d.snr - -10) <= 4, `snr ${d.snr}`);
  assert.ok(ms < 20000, `took ${ms} ms`);
});

test("decoder: several stations at once, including weak ones and late starters", () => {
  const audio = band([
    { text: "M3VRV IO93 23", hz: 1420, snr: -18 },
    { text: "VK2XYZ QF56 30", hz: 1505.5, snr: -24, dt: 1.5 },
    { text: "JA1ZZZ PM95 37", hz: 1590, snr: -14, dt: -0.5 },
  ], 3);
  const got = new W.Decoder().decode(audio).map((d) => d.text).sort();
  assert.deepEqual(got, ["JA1ZZZ PM95 37", "M3VRV IO93 23", "VK2XYZ QF56 30"]);
});

test("decoder: nothing from noise alone", () => {
  assert.deepEqual(new W.Decoder().decode(band([], 9)), []);
});
