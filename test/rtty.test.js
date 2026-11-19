"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Rtty = require("../public/js/rtty.js");

/** Feed audio in 20 ms blocks, as the sound card would; a second of silence at the end. */
function run(dec, audio) {
  let text = "";
  for (let i = 0; i < audio.length; i += 160) text += dec.process(audio.subarray(i, i + 160));
  text += dec.process(new Float32Array(Rtty.FS));
  return text;
}
const MSG = "CQ CQ DE M3VRV M3VRV 599 73 K";
const LT = 31, FG = 27;

test("RTTY: clean 45.45 baud, 170 Hz shift, with figures", () => {
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize(MSG)), MSG);
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize("599 73 DE M3VRV")), "599 73 DE M3VRV");
});

test("RTTY: with noise", () => {
  for (const [noise, seed] of [[0.15, 1], [0.3, 2], [0.5, 3]]) {
    const out = run(new Rtty.Decoder(), Rtty.synthesize("599 73 DE M3VRV", { noise, seed }));
    assert.equal(out, "599 73 DE M3VRV", `noise ${noise}`);
  }
});

test("RTTY: other tones, speeds and shifts", () => {
  for (const o of [{ low: 1500 }, { baud: 50, low: 1800 }, { baud: 75, low: 2000 }, { shift: 425, low: 1500 }, { baud: 75, shift: 850, low: 1200 }]) {
    const out = run(new Rtty.Decoder(o), Rtty.synthesize("CQ DE M3VRV 599 73", { ...o, noise: 0.1, seed: 5 }));
    assert.equal(out, "CQ DE M3VRV 599 73", JSON.stringify(o));
  }
});

test("RTTY: one, one and a half and two stop bits", () => {
  for (const stop of [1, 1.5, 2]) assert.equal(run(new Rtty.Decoder(), Rtty.synthesize(MSG, { stop, noise: 0.1 })), MSG, `stop ${stop}`);
});

test("RTTY: Reverse swaps mark and space", () => {
  const audio = Rtty.synthesize(MSG, { reverse: true, noise: 0.1 });
  assert.notEqual(run(new Rtty.Decoder(), audio), MSG, "the wrong way round gives garbage");
  assert.equal(run(new Rtty.Decoder({ reverse: true }), audio), MSG);
  assert.notEqual(run(new Rtty.Decoder({ reverse: true }), Rtty.synthesize(MSG)), MSG);
});

test("RTTY: LTRS and FIGS shifts", () => {
  const d = (codes, o) => { const x = new Rtty.Decoder(o); return codes.map((c) => x.character(c)).join(""); };
  // letters, FIGS (1 2 3 from E W Q... codes 23 19 1 are 1 2 3), then LTRS and letters again
  assert.equal(d([3, FG, 23, 19, 1, LT, 3, 1]), "A123AE");
  // with no shift code the figure codes are letters
  assert.equal(d([23, 19, 1]), "QWE");
  // FIGS stays on until LTRS (USOS off: even over a space)
  assert.equal(d([FG, 22, 4, 23, LT, 3], { usos: false }), "0 1A");
  // codes with nothing to print (null, bell) and CR are left out; LF is a new line
  assert.equal(d([0, 3, 8, 2, 3]), "A\nA");
  // the whole figures table
  assert.equal(d([FG, 22, 23, 19, 1, 10, 16, 21, 7, 6, 24]), "01234567" + "89");
  // through the audio too: the shift codes themselves print nothing
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize("", { codes: [LT, 3, FG, 23, 19, 1, LT, 3, LT] })), "A123A");
});

test("RTTY: USOS (unshift on space) on and off", () => {
  // A sender without USOS keeps FIGS over the space: the receiver needs USOS off to read it.
  const plain = Rtty.encode("599 73", { usos: false });
  assert.equal(plain.filter((c) => c === FG).length, 1);
  assert.equal(run(new Rtty.Decoder({ usos: false }), Rtty.synthesize("", { codes: plain })), "599 73");
  assert.notEqual(run(new Rtty.Decoder({ usos: true }), Rtty.synthesize("", { codes: plain })), "599 73");
  // A sender with USOS sends FIGS again after each space: a receiver with USOS reads it, and so does one without.
  const usos = Rtty.encode("599 73", { usos: true });
  assert.equal(usos.filter((c) => c === FG).length, 2);
  assert.equal(run(new Rtty.Decoder({ usos: true }), Rtty.synthesize("", { codes: usos })), "599 73");
  assert.equal(run(new Rtty.Decoder({ usos: false }), Rtty.synthesize("", { codes: usos })), "599 73");
});

test("RTTY: new lines, and nothing from noise or silence", () => {
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize("CQ\nDE M3VRV", { noise: 0.1 })), "CQ\nDE M3VRV");
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize("", { codes: [], noise: 0.3, lead: 20, tail: 0 })), "");
  assert.equal(run(new Rtty.Decoder(), new Float32Array(Rtty.FS * 3)), "");
});

test("RTTY: a sender 1% off speed, and a tone 10 Hz off", () => {
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize(MSG, { baud: 45.45 * 1.01, noise: 0.1 })), MSG);
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize(MSG, { baud: 45.45 * 0.99, noise: 0.1 })), MSG);
  assert.equal(run(new Rtty.Decoder(), Rtty.synthesize(MSG, { low: 2135, noise: 0.1 })), MSG);
});

test("RTTY: audio at other sample rates is decoded after resampling", () => {
  // The worker resamples to 8000; here, a signal made at 8000 in odd-sized blocks gives the same text.
  const audio = Rtty.synthesize(MSG, { noise: 0.1 });
  const d = new Rtty.Decoder();
  let text = "";
  for (let i = 0, n = 1; i < audio.length; i += n, n = (n * 7) % 331 + 1) text += d.process(audio.subarray(i, i + n));
  assert.equal(text.trim(), MSG);
});

test("RTTY: finds the tone pair by itself", () => {
  for (const low of [1400, 2125, 2503]) {
    const d = new Rtty.Decoder();
    run(d, Rtty.synthesize("CQ CQ CQ DE M3VRV M3VRV PSE K RYRYRY", { low, noise: 0.3, seed: 7 }));
    const f = d.find();
    assert.ok(f !== null && Math.abs(f - low) <= 10, `found ${f} for ${low}`);
  }
  assert.equal(new Rtty.Decoder().find(), null, "not enough audio yet");
});
