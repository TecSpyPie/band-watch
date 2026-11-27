"use strict";
// FT8/FT4 transmitting: the on-air signal (decoded back by HamShack's own decoder, and clean outside its
// bandwidth), the time slots, and the QSO sequence (what to send next, and when to stop).
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../public/js/ft8.js");
const T = require("../public/js/ftxtx.js");

/** A whole cycle at the protocol's rate with our transmission in it, as a receiver would hear it, plus noise. */
function cycleWith(text, proto, baseHz, noise = 0.02, seed = 7) {
  const { samples, lead } = T.wave(F.encodeTones(text, proto), { proto, rate: proto.fs, baseHz, amp: 0.5 });
  const buf = new Float32Array(Math.round(proto.period * proto.fs));
  const at = Math.round((proto.start - lead) * proto.fs);
  for (let i = 0; i < samples.length && at + i < buf.length; i++) buf[at + i] += samples[i];
  let a = seed;
  const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff - 0.5; };
  for (let i = 0; i < buf.length; i++) buf[i] += noise * rnd();
  return buf;
}

for (const proto of [F.FT8, F.FT4]) {
  test(`${proto.name}: what HamShack sends, its own decoder reads back (right text, frequency and time)`, () => {
    for (const [text, hz] of [["CQ M3VRV IO93", 1500], ["G4ABC M3VRV R-08", 840], ["G4ABC M3VRV RR73", 2210]]) {
      const got = new F.Decoder(proto).decode(cycleWith(text, proto, hz));
      const d = got.find((g) => g.text === text);
      assert.ok(d, `${proto.name} "${text}" decoded (got: ${got.map((g) => g.text).join(" | ")})`);
      assert.ok(Math.abs(d.freq - hz) <= 8, `${text}: ${d.freq} Hz, sent at ${hz}`);
      assert.ok(Math.abs(d.dt) <= 0.15, `${text}: DT ${d.dt}`);
    }
  });
}

test("the signal is the right length: FT8 12.64 s, FT4 5.04 s (103 symbols plus a ramp symbol each end)", () => {
  const f8 = T.wave(F.encodeTones("CQ M3VRV IO93", F.FT8), { proto: F.FT8, rate: 48000 });
  assert.equal(f8.samples.length, 79 * 7680);
  assert.equal(f8.lead, 0);
  const f4 = T.wave(F.encodeTones("CQ M3VRV IO93", F.FT4), { proto: F.FT4, rate: 48000 });
  assert.equal(f4.samples.length, 105 * 2304);
  assert.ok(Math.abs(f4.lead - 0.048) < 1e-9);
  // never louder than asked for, and soft at both ends (no clicks)
  for (const w of [f8, f4]) {
    let peak = 0;
    for (const v of w.samples) peak = Math.max(peak, Math.abs(v));
    assert.ok(peak <= 1.0001 && peak > 0.99, `peak ${peak}`);
    assert.ok(Math.abs(w.samples[0]) < 1e-3 && Math.abs(w.samples[w.samples.length - 1]) < 1e-3);
  }
});

/** Power (dB) at frequency f across a buffer, by Goertzel. */
function powerAt(buf, rate, f) {
  const w = (2 * Math.PI * f) / rate, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < buf.length; i++) { const s0 = buf[i] + c * s1 - s2; s2 = s1; s1 = s0; }
  return 10 * Math.log10((s1 * s1 + s2 * s2 - c * s1 * s2) / buf.length + 1e-30);
}

test("FT8: shaped tones keep the signal narrow: far less splatter beside it than plain FSK", () => {
  const tones = F.encodeTones("G4ABC M3VRV -12", F.FT8);
  const rate = 12000, base = 1500;
  const g = T.wave(tones, { proto: F.FT8, rate, baseHz: base }).samples;
  const plain = F.synthesize(tones, { proto: { ...F.FT8, fs: rate, nsps: 1920 }, baseHz: base, startSec: 0, seconds: 12.64 });
  const inside = powerAt(g, rate, base + 25);
  let gWorst = -Infinity, pWorst = -Infinity;
  for (let off = 120; off <= 300; off += 10) {
    for (const f of [base - off, base + 50 + off]) {
      gWorst = Math.max(gWorst, powerAt(g, rate, f));
      pWorst = Math.max(pWorst, powerAt(plain, rate, f));
    }
  }
  assert.ok(inside - gWorst > 50, `GFSK is ${(inside - gWorst).toFixed(1)} dB down 120-300 Hz away`);
  assert.ok(pWorst - gWorst > 15, `GFSK ${(pWorst - gWorst).toFixed(1)} dB cleaner than plain FSK`);
});

test("tune tone: steady, the right length, soft ends", () => {
  const t = T.tune(2, { rate: 8000, baseHz: 1000 });
  assert.equal(t.length, 16000);
  assert.equal(t[0], 0);
  assert.ok(Math.abs(powerAt(t, 8000, 1000) - powerAt(t, 8000, 1300)) > 40);
});

test("time slots: FT8 every 15 s, FT4 every 7.5 s; first and second slots; a little late is allowed", () => {
  const t0 = Date.parse("2026-11-19T14:30:00Z");
  assert.deepEqual(T.slotOf(t0 + 3000, F.FT8), { start: t0, parity: 0 });
  assert.deepEqual(T.slotOf(t0 + 16000, F.FT8), { start: t0 + 15000, parity: 1 });
  assert.equal(T.slotOf(t0 + 8000, F.FT4).parity, 1);
  assert.equal(T.nextSlot(t0 + 500, F.FT8, 0), t0); // 0.5 s into our slot: still in time
  assert.equal(T.nextSlot(t0 + 2500, F.FT8, 0), t0 + 30000); // too late: the next first slot
  assert.equal(T.nextSlot(t0 + 2500, F.FT8, 1), t0 + 15000);
  assert.equal(T.nextSlot(t0 + 100, F.FT4, 1), t0 + 7500);
});

test("reports: -12, +05, kept to -30..+30", () => {
  assert.equal(T.report(-12), "-12");
  assert.equal(T.report(5), "+05");
  assert.equal(T.report(0), "+00");
  assert.equal(T.report(-44), "-30");
  assert.equal(T.report(40), "+30");
});

test("reading messages", () => {
  assert.deepEqual(T.parse("CQ G4ABC IO91"), { cq: true, to: "", from: "G4ABC", kind: "cq", value: "IO91", grid: "IO91" });
  assert.equal(T.parse("CQ DX G4ABC IO91").from, "G4ABC");
  assert.equal(T.parse("M3VRV G4ABC IO91").kind, "grid");
  assert.equal(T.parse("M3VRV G4ABC -07").kind, "report");
  assert.deepEqual([T.parse("M3VRV G4ABC R-07").kind, T.parse("M3VRV G4ABC R-07").value], ["rreport", "-07"]);
  assert.equal(T.parse("M3VRV G4ABC RR73").kind, "rr73");
  assert.equal(T.parse("M3VRV G4ABC RRR").kind, "rrr");
  assert.equal(T.parse("M3VRV G4ABC 73").kind, "73");
  assert.equal(T.parse("M3VRV <PJ4/G4ABC> 73").from, "PJ4/G4ABC");
  assert.equal(T.parse("TNX FOR QSO"), null);
});

const ME = T.fresh("M3VRV", "IO93fa");
const hear = (s, text, snr = -10, parity = 1) => T.heard(s, { text, snr, parity });

test("calling CQ: someone answers, reports, RR73, 73 — every message right, and it ends", () => {
  let s = T.callCq(ME, 0);
  assert.equal(s.tx, "CQ M3VRV IO93");
  assert.equal(hear(s, "G0XYZ G4ABC IO91"), null, "a message for someone else changes nothing");
  assert.equal(hear(s, "CQ G4ABC IO91"), null);
  s = hear(s, "M3VRV G4ABC IO91", -5, 1);
  assert.equal(s.tx, "G4ABC M3VRV -05");
  assert.equal(s.parity, 0);
  assert.equal(s.theirGrid, "IO91");
  assert.equal(hear(s, "M3VRV G7QQQ IO80"), null, "another caller during the QSO is ignored");
  s = hear(s, "M3VRV G4ABC R-12");
  assert.equal(s.tx, "G4ABC M3VRV RR73");
  assert.equal(s.got, "-12");
  assert.equal(s.complete, true, "the QSO counts (log it) once RR73 goes out");
  s = hear(s, "M3VRV G4ABC 73");
  assert.equal(s.step, "done");
  assert.equal(s.tx, "");
});

test("answering a CQ: grid, R-report, 73, then stop", () => {
  let s = T.answer(ME, { text: "CQ G4ABC IO91", snr: -8, parity: 0 });
  assert.equal(s.tx, "G4ABC M3VRV IO93");
  assert.equal(s.parity, 1, "we send in the other slot");
  assert.equal(s.sent, "-08");
  s = hear(s, "M3VRV G4ABC -03", -9, 0);
  assert.equal(s.tx, "G4ABC M3VRV R-08");
  assert.equal(s.got, "-03");
  s = hear(s, "M3VRV G4ABC RR73", -9, 0);
  assert.equal(s.tx, "G4ABC M3VRV 73");
  assert.equal(s.complete, true);
  s = T.sent(s);
  assert.equal(s.step, "done", "73 goes out once");
  assert.equal(s.tx, "");
});

test("they missed our report: we send it again (R-report), not move on", () => {
  let s = T.answer(ME, { text: "CQ G4ABC IO91", snr: -8, parity: 0 });
  s = hear(s, "M3VRV G4ABC -03", -9, 0);
  const again = hear(s, "M3VRV G4ABC -03", -9, 0);
  assert.equal(again.tx, "G4ABC M3VRV R-08");
});

test("answering a station that called us (clicking their message)", () => {
  const s = T.answer(ME, { text: "M3VRV G4ABC IO91", snr: -2, parity: 1 });
  assert.equal(s.tx, "G4ABC M3VRV -02");
  assert.equal(s.parity, 0);
  const s2 = T.answer(ME, { text: "M3VRV G4ABC -15", snr: -2, parity: 1 });
  assert.equal(s2.tx, "G4ABC M3VRV R-02");
  assert.equal(T.answer(ME, { text: "M3VRV M3VRV 73", snr: 0, parity: 1 }), null, "never answers ourselves");
});

test("watchdog: stops calling after 6 unanswered overs (10 CQs); RR73 twice is enough", () => {
  let s = T.answer(ME, { text: "CQ G4ABC IO91", snr: -8, parity: 0 });
  for (let i = 0; i < T.MAX_TRIES - 1; i++) { s = T.sent(s); assert.equal(s.step, "call"); }
  s = T.sent(s);
  assert.equal(s.step, "idle");
  assert.equal(s.tx, "");
  assert.match(s.stopped, /No answer from G4ABC/);
  let c = T.callCq(ME, 0);
  for (let i = 0; i < T.MAX_CQ; i++) c = T.sent(c);
  assert.equal(c.step, "idle");
  let e = T.answer(ME, { text: "M3VRV G4ABC R-04", snr: -2, parity: 1 });
  assert.equal(e.step, "rr73");
  e = T.sent(e); assert.equal(e.step, "rr73");
  e = T.sent(e); assert.equal(e.step, "done");
  // an answer resets the count
  let r = T.answer(ME, { text: "CQ G4ABC IO91", snr: -8, parity: 0 });
  r = T.sent(T.sent(r));
  r = hear(r, "M3VRV G4ABC -03", -9, 0);
  assert.equal(r.tries, 0);
});

test("every message HamShack can send packs into a real FT8/FT4 message and reads back the same", () => {
  const s = T.fresh("M3VRV", "IO93");
  for (const step of ["cq", "call", "report", "rreport", "rr73", "73"]) {
    const text = T.message({ ...s, step, their: "G4ABC", sent: "-07" });
    const bits = F.pack77(text);
    assert.ok(bits, `${text} packs`);
    assert.equal(F.unpack77(bits), text);
  }
});
