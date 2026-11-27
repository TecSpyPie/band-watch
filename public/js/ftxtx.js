/* HamShack by M0GLP & M3VRV: FT8 and FT4 transmitting. Two parts, both plain JavaScript with no page code, so the tests
 * can check them in Node (require) and the page uses them as window.FtxTx:
 *
 *  1. wave(): the on-air audio for a message. GFSK (Gaussian-smoothed tones, BT 2 for FT8 and 1 for FT4) with soft
 *     ramps at the start and end, as WSJT-X makes it (gen_ft8wave / gen_ft4wave), so the signal is clean and narrow.
 *     The plain FSK synthesize() in ft8.js is only for tests: its sharp tone changes splatter.
 *  2. The QSO: the standard messages (CQ, grid, report, R-report, RR73, 73), what to send next when a decode arrives,
 *     and when to stop. Like WSJT-X's "Tx1..Tx6". */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FtxTx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- 1. The signal ---------- */

  // erf, Abramowitz and Stegun 7.1.26 (error under 1.5e-7): plenty for shaping tones.
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const GK = Math.PI * Math.sqrt(2 / Math.log(2));
  /** The Gaussian-filtered frequency pulse of one symbol, t in symbols from its middle. */
  const gfskPulse = (bt, t) => 0.5 * (erf(GK * bt * (t + 0.5)) - erf(GK * bt * (t - 0.5)));

  /**
   * On-air audio for channel tones (from Ftx.encodeTones): Float32Array at `rate`, tone 0 at `baseHz`.
   * FT8: 79 symbols of 0.16 s (12.64 s). FT4: 103 symbols of 0.048 s plus a ramp symbol before and after (5.04 s).
   * Returns { samples, lead }: `lead` is how many seconds of ramp come before the first real symbol, so playing
   * should start `lead` seconds before the protocol's start time (0.5 s into the cycle).
   */
  function wave(tones, { proto, rate = 48000, baseHz = 1500, amp = 1 } = {}) {
    const ft4 = proto.name === "FT4";
    const symSec = proto.nsps / proto.fs;
    const nsps = Math.round(symSec * rate);
    const bt = ft4 ? 1 : 2;
    const nsym = tones.length;
    const pulse = new Float64Array(3 * nsps);
    for (let i = 0; i < 3 * nsps; i++) pulse[i] = gfskPulse(bt, (i - 1.5 * nsps) / nsps);
    const peak = (2 * Math.PI) / nsps; // one tone step = 1/symSec Hz
    const dphi = new Float64Array((nsym + 2) * nsps);
    for (let j = 0; j < nsym; j++) {
      const ib = j * nsps;
      for (let i = 0; i < 3 * nsps; i++) dphi[ib + i] += peak * tones[j] * pulse[i];
    }
    // Hold the first and last tones out past the ends, so the edges sit on the right frequency.
    for (let i = 0; i < 2 * nsps; i++) {
      dphi[i] += peak * tones[0] * pulse[nsps + i];
      dphi[nsym * nsps + i] += peak * tones[nsym - 1] * pulse[i];
    }
    const carrier = (2 * Math.PI * baseHz) / rate;
    const n = ft4 ? (nsym + 2) * nsps : nsym * nsps;
    const from = ft4 ? 0 : nsps; // FT8 starts at its first symbol; FT4 one symbol earlier (its ramp-up symbol)
    const out = new Float32Array(n);
    let ph = 0;
    for (let k = 0; k < n; k++) {
      out[k] = amp * Math.sin(ph);
      ph += dphi[from + k] + carrier;
      if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
    }
    const ramp = ft4 ? nsps : Math.round(nsps / 8);
    for (let i = 0; i < ramp; i++) {
      const g = (1 - Math.cos((Math.PI * i) / ramp)) / 2;
      out[i] *= g;
      out[n - 1 - i] *= g;
    }
    return { samples: out, lead: ft4 ? symSec : 0, seconds: n / rate };
  }

  /** A steady tone for setting the audio level (the radio's ALC): `seconds` long with soft ends. */
  function tune(seconds, { rate = 48000, baseHz = 1500, amp = 1 } = {}) {
    const n = Math.round(seconds * rate);
    const out = new Float32Array(n);
    const ramp = Math.round(0.02 * rate);
    for (let k = 0; k < n; k++) {
      const g = k < ramp ? k / ramp : k > n - ramp ? (n - k) / ramp : 1;
      out[k] = amp * g * Math.sin((2 * Math.PI * baseHz * k) / rate);
    }
    return out;
  }

  /* ---------- Time slots ---------- */

  /** The slot a time falls in: { start (ms), parity 0 (first: :00, :30 for FT8) or 1 (second: :15, :45) }. */
  function slotOf(t, proto) {
    const ms = proto.period * 1000;
    const i = Math.floor(t / ms);
    return { start: i * ms, parity: i % 2 };
  }

  /** The next slot with this parity that we can still start in time: starting up to `lateSec` late is allowed
   *  (the decoders at the other end allow for it). Returns its start time in ms. */
  function nextSlot(now, proto, parity, lateSec = 1) {
    const ms = proto.period * 1000;
    let i = Math.floor(now / ms);
    if (now - i * ms > lateSec * 1000) i++;
    if (i % 2 !== parity) i++;
    return i * ms;
  }

  /* ---------- 2. The QSO ---------- */

  const isCall = (x) => /^[A-Z0-9/]{3,}$/.test(x || "") && /\d/.test(x) && /[A-Z]/.test(x) && !/^[A-R]{2}\d{2}$/.test(x) && !/^R?[+-]\d\d$/.test(x);
  const bare = (x) => String(x || "").replace(/^<|>$/g, "");

  /** What a decoded message says: { cq, to, from, kind: grid|report|rreport|rrr|rr73|73|none|other, value }. */
  function parse(text) {
    const w = String(text || "").trim().toUpperCase().split(/\s+/);
    if (w[0] === "CQ") {
      const i = isCall(bare(w[1])) ? 1 : 2; // "CQ DX G4ABC IO93"
      const from = bare(w[i]);
      if (!isCall(from)) return null;
      const g = /^[A-R]{2}\d{2}$/.test(w[i + 1] || "") ? w[i + 1] : "";
      return { cq: true, to: "", from, kind: "cq", value: g, grid: g };
    }
    if (w.length < 2) return null;
    const to = bare(w[0]), from = bare(w[1]);
    if (!isCall(from) || !(isCall(to) || to === "...")) return null;
    const rest = w.slice(2).join(" ");
    let kind = "other", value = "";
    if (rest === "") kind = "none";
    else if (/^[A-R]{2}\d{2}$/.test(rest) && rest !== "RR73") { kind = "grid"; value = rest; }
    else if (/^R [A-R]{2}\d{2}$/.test(rest)) { kind = "rreport"; value = ""; }
    else if (/^[+-]\d\d$/.test(rest)) { kind = "report"; value = rest; }
    else if (/^R[+-]\d\d$/.test(rest)) { kind = "rreport"; value = rest.slice(1); }
    else if (rest === "RRR") kind = "rrr";
    else if (rest === "RR73") kind = "rr73";
    else if (rest === "73") kind = "73";
    return { cq: false, to, from, kind, value, grid: kind === "grid" ? value : "" };
  }

  /** A signal report for FT8/FT4 from an SNR in dB: "-12", "+05" (kept to -30..+30). */
  function report(snr) {
    const v = Math.max(-30, Math.min(30, Math.round(Number(snr) || 0)));
    return (v >= 0 ? "+" : "-") + String(Math.abs(v)).padStart(2, "0");
  }

  const MAX_TRIES = 6; // overs with no answer before HamShack stops calling (like WSJT-X's Tx watchdog, but sooner)
  const MAX_CQ = 10; // CQ overs before stopping
  const ENDING_TRIES = 2; // RR73 sent this many times with no 73 back: the QSO is complete anyway

  /** A fresh QSO state for your callsign and 4-character grid. */
  function fresh(my, grid) {
    return { my: String(my || "").toUpperCase(), grid: String(grid || "").toUpperCase().slice(0, 4), their: "", theirGrid: "",
      sent: "", got: "", step: "idle", tx: "", parity: 0, tries: 0, complete: false, stopped: "" };
  }

  /** The message for a step. */
  function message(s) {
    const r = s.sent || "-10";
    switch (s.step) {
      case "cq": return `CQ ${s.my} ${s.grid}`;
      case "call": return `${s.their} ${s.my} ${s.grid}`;
      case "report": return `${s.their} ${s.my} ${r}`;
      case "rreport": return `${s.their} ${s.my} R${r}`;
      case "rr73": return `${s.their} ${s.my} RR73`;
      case "73": return `${s.their} ${s.my} 73`;
      default: return "";
    }
  }

  const go = (s, step, changes = {}) => {
    const n = { ...s, ...changes, step, tries: 0, stopped: "" };
    n.tx = message(n);
    return n;
  };

  /** Start calling CQ, sending in slots of this parity. */
  function callCq(s, parity) {
    return go({ ...fresh(s.my, s.grid) }, "cq", { parity });
  }

  /**
   * You clicked a decode (d: { text, snr, parity }): answer it. A CQ, or anyone's message: call that station.
   * A message to you: carry on the QSO from where it is. Returns the new state, or null if it can't be answered.
   */
  function answer(s, d) {
    const p = parse(d.text);
    if (!p || p.from === s.my) return null;
    const parity = 1 - d.parity;
    const base = { ...fresh(s.my, s.grid), their: p.from, theirGrid: p.grid, sent: report(d.snr), parity };
    if (p.to === s.my) {
      const n = heard({ ...base, step: "call" }, d);
      return n || go(base, "call");
    }
    return go(base, "call");
  }

  /**
   * A decode arrived (d: { text, snr, parity }). If it's for us, the next step; otherwise null (nothing changes).
   * While calling CQ, the first station to answer starts a QSO.
   */
  function heard(s, d) {
    const p = parse(d.text);
    if (!p || p.cq || p.to !== s.my || p.from === s.my) return null;
    if (s.step === "idle" || s.step === "done") return null;
    const fromThem = s.their && p.from === s.their;
    const parity = 1 - d.parity;
    // While calling CQ, someone answering (with their grid, or straight in with a report) starts a QSO.
    if (s.step === "cq" && !fromThem) {
      const base = { ...s, their: p.from, theirGrid: p.grid, sent: report(d.snr), parity };
      if (p.kind === "grid" || p.kind === "none") return go(base, "report");
      if (p.kind === "report") return go({ ...base, got: p.value }, "rreport");
      return null;
    }
    if (!fromThem) return null;
    const keep = { parity, theirGrid: p.grid || s.theirGrid, sent: s.sent || report(d.snr) };
    switch (p.kind) {
      case "grid":
      case "none":
        return s.step === "call" || s.step === "report" ? go({ ...s, ...keep }, "report") : null;
      case "report":
        return ["call", "report", "rreport"].includes(s.step) ? go({ ...s, ...keep, got: p.value }, "rreport") : null;
      case "rreport":
        return ["call", "report", "rreport", "rr73"].includes(s.step) ? go({ ...s, ...keep, got: p.value || s.got }, "rr73", { complete: true }) : null;
      case "rrr":
      case "rr73":
        return ["call", "report", "rreport", "rr73", "73"].includes(s.step) ? go({ ...s, ...keep }, "73", { complete: true }) : null;
      case "73":
        return ["rr73", "73"].includes(s.step) ? { ...s, step: "done", tx: "", complete: true, tries: 0 } : null;
      default:
        return null;
    }
  }

  /** After each over we sent: count it, and stop when the QSO is over or nobody answers. */
  function sent(s) {
    const n = { ...s, tries: s.tries + 1 };
    if (s.step === "73") return { ...n, step: "done", tx: "" };
    if (s.step === "rr73" && n.tries >= ENDING_TRIES) return { ...n, step: "done", tx: "" };
    if (s.step === "cq" && n.tries >= MAX_CQ) return { ...n, step: "idle", tx: "", stopped: `No answer after ${MAX_CQ} CQs.` };
    if (s.step !== "cq" && n.tries >= MAX_TRIES) return { ...n, step: "idle", tx: "", stopped: `No answer from ${s.their} after ${MAX_TRIES} tries.` };
    return n;
  }

  return { erf, gfskPulse, wave, tune, slotOf, nextSlot, parse, report, fresh, message, callCq, answer, heard, sent,
    MAX_TRIES, MAX_CQ, ENDING_TRIES };
});
