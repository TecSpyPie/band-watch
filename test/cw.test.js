"use strict";
const test = require("node:test");
const assert = require("node:assert");
const Cw = require("../public/js/cw.js");

function withNoise(audio, sigma, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i++) out[i] = audio[i] + sigma * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  return out;
}
/** Feed audio in 20 ms blocks, as the sound card would. */
function run(dec, audio) {
  let text = "";
  for (let i = 0; i < audio.length; i += 160) text += dec.process(audio.subarray(i, i + 160));
  text += dec.process(new Float32Array(Cw.FS)); // a second of silence to finish the last word
  return text.trim();
}

test("CW: decodes clean Morse at 20 WPM and learns the speed", () => {
  const d = new Cw.Decoder();
  assert.equal(run(d, Cw.key("CQ CQ DE M3VRV M3VRV K", { wpm: 20 })), "CQ CQ DE M3VRV M3VRV K");
  assert.ok(Math.abs(d.wpm - 20) <= 2, `${d.wpm} WPM`);
  assert.ok(Math.abs(d.tone - 700) <= 10, `tone ${d.tone}`);
});

test("CW: other speeds and tones, with noise", () => {
  for (const [wpm, hz] of [[12, 550], [28, 820], [35, 650]]) {
    const d = new Cw.Decoder();
    // warm-up text first, so the speed has been learned by the test words
    const text = run(d, withNoise(Cw.key(`VVV VVV TEST DE G4ABC 5NN TU`, { wpm, hz, amp: 0.5 }), 0.25, wpm));
    assert.match(text, /TEST DE G4ABC 5NN TU$/, `${wpm} WPM at ${hz} Hz: "${text}"`);
    assert.ok(Math.abs(d.wpm - wpm) <= Math.max(3, wpm * 0.12), `${d.wpm} vs ${wpm} WPM`);
  }
});

test("CW: numbers, punctuation and prosigns", () => {
  const d = new Cw.Decoder();
  assert.equal(run(d, Cw.key("RST 599 QTH IO93 = 73", { wpm: 22 })), "RST 599 QTH IO93 = 73");
  assert.equal(Cw.FROM_MORSE["...-.-"], "<SK>");
});

test("CW: nothing from noise alone", () => {
  const d = new Cw.Decoder();
  const text = run(d, withNoise(new Float32Array(Cw.FS * 4), 0.3, 5));
  assert.ok(text.replace(/[ E]/g, "").length <= 2, `"${text}"`);
});
