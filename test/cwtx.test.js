"use strict";
// Sending CW: timing (PARIS and Farnsworth), prosigns, clean edges, messages, and Band Watch's own CW decoder
// reading back what it sends.
const test = require("node:test");
const assert = require("node:assert/strict");
const K = require("../public/js/cwtx.js");
const Cw = require("../public/js/cw.js");

test("PARIS at 20 WPM takes 3 seconds (50 units of 60 ms)", () => {
  const d = K.duration("PARIS ", { wpm: 20 });
  assert.ok(Math.abs(d - 3.0) < 1e-9, `${d}`);
  assert.ok(Math.abs(K.duration("PARIS ", { wpm: 12 }) - 5.0) < 1e-9);
  // the audio is that long too
  const a = K.render("PARIS ", { wpm: 20, rate: 8000 });
  assert.ok(Math.abs(a.length / 8000 - 3.0) < 0.01, `${a.length / 8000}`);
});

test("Farnsworth: letters at 18 WPM, spaced out to 5 WPM overall", () => {
  const d = K.duration("PARIS ", { wpm: 18, farns: 5 });
  assert.ok(Math.abs(d - 12.0) < 0.01, `PARIS at 5 WPM overall takes ${d} s`);
  const t = K.timing(18, 5);
  assert.ok(Math.abs(t.unit - 1.2 / 18) < 1e-12, "letters themselves at 18 WPM");
  assert.ok(t.charGap > 3 * t.unit);
  assert.deepEqual(K.timing(20, 25), K.timing(20, 0), "Farnsworth faster than the letters does nothing");
});

test("letters, numbers, punctuation and prosigns; unknown characters are left out", () => {
  assert.equal(K.morseOf("CQ"), "-.-. --.-");
  assert.equal(K.morseOf("de m3vrv"), "-.. . / -- ...-- ...- .-. ...-");
  assert.equal(K.morseOf("73 <SK>"), "--... ...-- / ...-.-");
  assert.equal(K.morseOf("<KN>"), "-.--.");
  assert.equal(K.morseOf("<BT> <AR>"), "-...- / .-.-.");
  assert.equal(K.morseOf("A£B"), ".- -...");
  const t = K.tokens("  CQ   DE  ");
  assert.equal(t.filter((x) => x.space).length, 2);
});

test("clean keying: each dot starts and ends at zero, rising over 5 ms (no clicks)", () => {
  const rate = 48000;
  const { samples } = K.renderToken({ text: "E", code: "." }, { wpm: 20, rate, hz: 700, amp: 1 });
  assert.ok(Math.abs(samples[0]) < 1e-6);
  const dot = Math.round(0.06 * rate);
  let peakStart = 0, peakMid = 0;
  for (let i = 0; i < Math.round(0.002 * rate); i++) peakStart = Math.max(peakStart, Math.abs(samples[i]));
  for (let i = Math.round(0.02 * rate); i < Math.round(0.04 * rate); i++) peakMid = Math.max(peakMid, Math.abs(samples[i]));
  assert.ok(peakStart < 0.4, `still ramping 2 ms in (${peakStart.toFixed(2)})`);
  assert.ok(peakMid > 0.99, "full level in the middle");
  assert.ok(Math.abs(samples[dot - 1]) < 0.01, "back to zero at the end of the dot");
  for (let i = dot; i < samples.length; i++) assert.equal(samples[i], 0, "silent in the gap after it");
});

test("messages are filled in with your callsign, theirs, your locator and the report", () => {
  const v = { call: "m3vrv", their: "g4abc", grid: "IO93fa" };
  assert.equal(K.fill(K.MESSAGES.cq, v), "CQ CQ CQ DE M3VRV M3VRV K");
  assert.equal(K.fill(K.MESSAGES.rpt, v), "G4ABC DE M3VRV TU UR 5NN 5NN QTH IO93 IO93 BK");
  assert.equal(K.fill(K.MESSAGES.tu, v), "G4ABC DE M3VRV TU 73 <SK>");
  assert.equal(K.fill("{THEIR} {RST}", { their: "", rst: "579" }), "579");
});

for (const wpm of [12, 20, 28]) {
  test(`Band Watch's CW decoder reads back what it sends at ${wpm} WPM`, () => {
    const text = "CQ CQ DE M3VRV M3VRV K";
    const body = K.render(text, { wpm, hz: 700, rate: Cw.FS, amp: 0.6 });
    const pad = new Float32Array(Cw.FS);
    const all = new Float32Array(pad.length * 2 + body.length);
    all.set(body, pad.length);
    let seed = 9;
    for (let i = 0; i < all.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; all[i] += 0.02 * (seed / 0x7fffffff - 0.5); }
    const d = new Cw.Decoder();
    let got = "";
    for (let i = 0; i < all.length; i += 400) got += d.process(all.subarray(i, i + 400));
    got += d.process(new Float32Array(Cw.FS * 2));
    assert.match(got.replace(/\s+/g, " ").trim(), /CQ DE M3VRV M3VRV K$/, `got "${got}"`);
    assert.ok(Math.abs(d.wpm - wpm) <= 2, `speed ${d.wpm}`);
  });
}
