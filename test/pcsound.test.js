"use strict";
// ClearRX's "PC sound": finding a virtual cable, and never letting ClearRX hear itself and howl.
const test = require("node:test");
const assert = require("node:assert");
const P = require("../clearrx/public/js/pcsound.js");

test("finds the virtual cable's output among the inputs, the best one first", () => {
  assert.equal(P.findCable(["Microphone (Realtek(R) Audio)", "CABLE Output (VB-Audio Virtual Cable)", "Line In"]), 1);
  assert.equal(P.findCable(["Stereo Mix (Realtek(R) Audio)", "Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)"]), 1);
  assert.equal(P.findCable(["Microphone", "Voicemeeter Out B1", "CABLE Output (VB-Audio Virtual Cable)"]), 2, "VB-CABLE before Voicemeeter");
  assert.equal(P.findCable(["Microphone (USB Audio CODEC)", "Stereo Mix (Realtek(R) Audio)"]), -1, "Stereo Mix isn't a cable");
  assert.equal(P.findCable([]), -1);
});

test("playing into the cable ClearRX listens to is a loop, and stops ClearRX starting", () => {
  assert.equal(P.loopRisk("CABLE Output (VB-Audio Virtual Cable)", "CABLE Input (VB-Audio Virtual Cable)"), "loop");
  assert.equal(P.loopRisk("Voicemeeter Out B1 (VB-Audio Voicemeeter VAIO)", "Voicemeeter Input (VB-Audio Voicemeeter VAIO)"), "loop");
  assert.match(P.loopWords("loop"), /howl.*Play to.*speakers/);
});

test("Stereo Mix, or playing into a cable from a radio, may echo: a warning, not a stop", () => {
  assert.equal(P.loopRisk("Stereo Mix (Realtek(R) Audio)", ""), "echo");
  assert.equal(P.loopRisk("Microphone (USB Audio CODEC)", "CABLE Input (VB-Audio Virtual Cable)"), "echo");
  assert.match(P.loopWords("echo"), /virtual cable/);
});

test("the usual setups are fine", () => {
  assert.equal(P.loopRisk("CABLE Output (VB-Audio Virtual Cable)", ""), null, "cable in, default speakers out");
  assert.equal(P.loopRisk("CABLE Output (VB-Audio Virtual Cable)", "Speakers (Realtek(R) Audio)"), null);
  assert.equal(P.loopRisk("Microphone (USB Audio CODEC)", "Headphones (Realtek(R) Audio)"), null, "a radio as before");
  assert.equal(P.loopWords(null), "");
});

test("the help is plain English and says what to do in Windows and in ClearRX", () => {
  assert.match(P.TIP, /VB-CABLE/);
  assert.match(P.TIP, /Volume mixer/);
  assert.match(P.TIP, /CABLE Output/);
  assert.match(P.NOT_FOUND, /vb-audio\.com/);
});
