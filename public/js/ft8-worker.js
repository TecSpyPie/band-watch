/* Band Watch by M3vrv: runs the FT8/FT4 decoder in the background, so the page stays smooth.
 * The page sends audio blocks with the time the last sample arrived; this keeps the last
 * cycle or two, and decodes each 15 s (FT8) or 7.5 s (FT4) cycle as soon as it is complete,
 * lined up with UTC as WSJT-X does (so the PC clock needs to be right to within a second). */
"use strict";
importScripts("/js/ft8.js?v=1.40.0", "/js/wspr.js?v=1.40.0", "/js/cw.js?v=1.40.0", "/js/sstv.js?v=1.40.0", "/js/aprs.js?v=1.40.0", "/js/rtty.js?v=1.40.0");

// WSPR: two-minute cycles on the even minute, decoded at 12000 samples a second.
const WSPR_PROTO = { name: "WSPR", period: 120, fs: 12000 };
// Early decode, as WSJT-X does: by this far into a cycle every signal that started on time has ended
// (FT8: 0.5 + 12.64 s, FT4: 0.5 + 5.04 s), so there's time to answer in the very next cycle.
// The rest of the cycle is decoded again at its end, for stations that started late.
const EARLY_SEC = { FT8: 13.6, FT4: 6.0 };

let st = null;

function start(mode, rate, cfg) {
  if (mode === "RTTY") {
    st = { rtty: new Rtty.Decoder(cfg || {}), resampler: new Ftx.Resampler(rate, Rtty.FS), sent: 0 };
    postMessage({ type: "status", text: "Listening for RTTY. Set the tones to match the signal (Find the tones does it for you)." });
    return;
  }
  if (mode === "APRS") {
    const demod = new Aprs.Demod((bytes) => { const p = Aprs.parse(bytes); if (p) postMessage({ type: "aprs", p, at: Date.now() }); });
    st = { aprs: demod, resampler: new Ftx.Resampler(rate, Aprs.FS) };
    postMessage({ type: "status", text: "Listening for APRS packets (1200 baud). Tune to 144.800 MHz FM (or the ISS on 145.825)." });
    return;
  }
  if (mode === "SSTV") {
    const dec = new Sstv.Decoder({
      onStart: (s) => postMessage({ type: "sstv-start", ...s, at: Date.now() }),
      onLines: (l) => postMessage({ type: "sstv-lines", from: l.from, to: l.to, rgba: l.rgba, final: Boolean(l.final) }, [l.rgba.buffer]),
      onDone: (r) => postMessage({ type: "sstv-done", mode: r.mode, width: r.width, height: r.height, rgba: r.rgba, slant: r.slant, complete: r.complete, lines: r.lines }, [r.rgba.buffer]),
    });
    st = { sstv: dec, resampler: new Ftx.Resampler(rate, Sstv.FS) };
    postMessage({ type: "status", text: "Listening for SSTV. A picture starts by itself when its VIS code is heard (any of the supported modes)." });
    return;
  }
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
    earlyCycle: 0, earlyTexts: null, // the cycle decoded early, and what that found
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

/** RTTY: text as it is decoded, and about once a second whether a signal is there. */
function pushRtty(samples) {
  const s = st;
  const text = s.rtty.process(s.resampler.process(samples));
  const now = Date.now();
  if (text || now - s.sent > 1000) {
    s.sent = now;
    postMessage({ type: "rtty", text, locked: s.rtty.locked });
  }
}

function push(samples, at) {
  const s = st;
  if (s.rtty) return pushRtty(samples);
  if (s.cw) return pushCw(samples);
  if (s.sstv) { s.sstv.push(s.resampler.process(samples)); return; }
  if (s.aprs) { s.aprs.push(s.resampler.process(samples)); return; }
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
  const early = EARLY_SEC[s.proto.name];
  const current = cycle + s.periodMs; // the cycle under way
  if (early && end - current >= early * 1000 && current > s.earlyCycle) {
    s.earlyCycle = current;
    decodeCycle(current, early);
  }
  postMessage({ type: "progress", into: (end % s.periodMs) / s.periodMs });
}

/** Decode a cycle: the whole of it, or (earlySec) just its first part, ahead of its end. */
function decodeCycle(cycle, earlySec = 0) {
  const s = st;
  const fs = s.proto.fs;
  const n = Math.round(s.proto.period * fs);
  const want = earlySec ? Math.round(earlySec * fs) : n; // samples there should be by now
  const first = Math.round(((cycle - s.t0) / 1000) * fs); // sample number of the cycle's start
  const audio = new Float32Array(n);
  let have = 0;
  const cap = s.buf.length;
  for (let i = 0; i < want; i++) {
    const k = first + i;
    if (k >= 0 && k < s.count && k >= s.count - cap) { audio[i] = s.buf[k % cap]; have++; }
  }
  if (have < want * 0.85) {
    if (!earlySec) postMessage({ type: "status", text: `Waiting for a full ${s.proto.period} s cycle of audio…` });
    return;
  }
  const t = Date.now();
  if (s.proto.name === "WSPR") postMessage({ type: "status", text: "Decoding the last two minutes of WSPR…" });
  let list = s.decoder.decode(audio);
  let late = false;
  if (earlySec) s.earlyTexts = { cycle, texts: new Set(list.map((d) => d.text)) };
  else if (s.earlyTexts && s.earlyTexts.cycle === cycle) {
    // Decoded early already: only pass on what's new (stations that started late).
    list = list.filter((d) => !s.earlyTexts.texts.has(d.text));
    late = true;
    if (!list.length) return;
  }
  postMessage({ type: "decodes", mode: s.proto.name, cycle, list, ms: Date.now() - t, early: Boolean(earlySec), late });
}

onmessage = (e) => {
  const m = e.data;
  if (m.type === "start") start(m.mode, m.rate, m.cfg);
  else if (m.type === "rtty-config" && st && st.rtty) st.rtty.configure(m.cfg);
  else if (m.type === "rtty-find" && st && st.rtty) postMessage({ type: "rtty-tone", low: st.rtty.find() });
  else if (m.type === "stop") st = null;
  else if (m.type === "audio" && st) push(m.samples, m.at);
  else if (m.type === "sstv-now" && st && st.sstv) st.sstv.start(m.mode); // the VIS was missed: start by hand
  else if (m.type === "sstv-stop" && st && st.sstv) st.sstv.stop();
};
