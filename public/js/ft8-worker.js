/* Band Watch by M3vrv: runs the FT8/FT4 decoder in the background, so the page stays smooth.
 * The page sends audio blocks with the time the last sample arrived; this keeps the last
 * cycle or two, and decodes each 15 s (FT8) or 7.5 s (FT4) cycle as soon as it is complete,
 * lined up with UTC as WSJT-X does (so the PC clock needs to be right to within a second). */
"use strict";
importScripts("/js/ft8.js?v=1.29.0", "/js/wspr.js?v=1.29.0", "/js/cw.js?v=1.29.0");

// WSPR: two-minute cycles on the even minute, decoded at 12000 samples a second.
const WSPR_PROTO = { name: "WSPR", period: 120, fs: 12000 };

let st = null;

function start(mode, rate) {
  if (mode === "CW") {
    st = { cw: new Cw.Decoder(), resampler: new Ftx.Resampler(rate, Cw.FS), sent: 0 };
    postMessage({ type: "status", text: "Listening for CW. Tune the Morse to a tone between 300 and 1200 Hz (CW mode puts it near 700 Hz)." });
    return;
  }
  const proto = mode === "WSPR" ? WSPR_PROTO : Ftx.PROTOCOLS[mode] || Ftx.FT8;
  st = {
    proto,
    periodMs: proto.period * 1000,
    resampler: new Ftx.Resampler(rate, proto.fs),
    decoder: mode === "WSPR" ? new Wspr.Decoder() : new Ftx.Decoder(proto),
    buf: new Float32Array(Math.round(proto.fs * proto.period * 2.4)), // ring of samples
    count: 0, // samples written in total
    t0: null, // UTC ms of sample number 0
    lastCycle: 0,
  };
  postMessage({ type: "status", text: `Listening for ${proto.name}. The first decodes come at the end of the next full ${proto.period} s cycle.` });
}

function pushCw(samples) {
  const s = st;
  const text = s.cw.process(s.resampler.process(samples));
  const now = Date.now();
  if (text || now - s.sent > 1000) {
    s.sent = now;
    postMessage({ type: "cw", text, wpm: s.cw.wpm, tone: s.cw.tone });
  }
}

function push(samples, at) {
  const s = st;
  if (s.cw) return pushCw(samples);
  const out = s.resampler.process(samples);
  if (!out.length) return;
  const fs = s.proto.fs;
  // Keep a time for every sample. Re-anchor if the audio and the clock disagree by more than 0.3 s
  // (a gap in the audio, or the sound card's clock drifting).
  const expectEnd = s.t0 === null ? null : s.t0 + ((s.count + out.length) / fs) * 1000;
  if (expectEnd === null || Math.abs(expectEnd - at) > 300) {
    s.t0 = at - ((s.count + out.length) / fs) * 1000;
  }
  const cap = s.buf.length;
  for (let i = 0; i < out.length; i++) s.buf[(s.count + i) % cap] = out[i];
  s.count += out.length;

  const end = s.t0 + (s.count / fs) * 1000; // UTC ms of the newest sample
  const cycle = Math.floor(end / s.periodMs) * s.periodMs - s.periodMs; // the last complete cycle
  if (cycle > s.lastCycle) {
    s.lastCycle = cycle;
    decodeCycle(cycle);
  }
  postMessage({ type: "progress", into: (end % s.periodMs) / s.periodMs });
}

function decodeCycle(cycle) {
  const s = st;
  const fs = s.proto.fs;
  const n = Math.round(s.proto.period * fs);
  const first = Math.round(((cycle - s.t0) / 1000) * fs); // sample number of the cycle's start
  const audio = new Float32Array(n);
  let have = 0;
  const cap = s.buf.length;
  for (let i = 0; i < n; i++) {
    const k = first + i;
    if (k >= 0 && k < s.count && k >= s.count - cap) { audio[i] = s.buf[k % cap]; have++; }
  }
  if (have < n * 0.85) {
    postMessage({ type: "status", text: `Waiting for a full ${s.proto.period} s cycle of audio…` });
    return;
  }
  const t = Date.now();
  if (s.proto.name === "WSPR") postMessage({ type: "status", text: "Decoding the last two minutes of WSPR…" });
  const list = s.decoder.decode(audio);
  postMessage({ type: "decodes", mode: s.proto.name, cycle, list, ms: Date.now() - t });
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "start") start(m.mode, m.rate);
  else if (m.type === "stop") st = null;
  else if (m.type === "audio" && st) push(m.samples, m.at);
};
