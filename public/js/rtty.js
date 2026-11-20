/* Band Watch by M3vrv: RTTY (radioteletype) decoder, receive only, in plain JavaScript.
 * Audio in (8000 samples a second): two matched filters, one on the mark tone and one on the space tone,
 * each one bit long. Their difference is the bit stream; a start bit (mark to space) lines up the clock for
 * the 5 data bits (ITA2 / Baudot, LTRS and FIGS shifts) and the stop bit. Works in a Web Worker and in Node
 * (tests). `synthesize` makes test audio in memory only (for tests and for trying the decoder); this file
 * never sends anything to a radio. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Rtty = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FS = 8000;
  const LTRS = 31, FIGS = 27, SPACE = 4;
  // ITA2 by 5-bit code. "" is a code with no printing character (null, bell, the two shifts).
  const LETTERS = ["", "E", "\n", "A", " ", "S", "I", "U", "\r", "D", "R", "J", "N", "F", "C", "K", "T", "Z", "L", "W", "H", "Y", "P", "Q", "O", "B", "G", "", "M", "X", "V", ""];
  const FIGURES = ["", "3", "\n", "-", " ", "'", "8", "7", "\r", "$", "4", "", ",", "!", ":", "(", "5", "+", ")", "2", "#", "6", "0", "1", "9", "?", "&", "", ".", "/", "=", ""];
  const TO_CODE = {};
  LETTERS.forEach((c, i) => { if (c && c !== "\r" && c !== "\n") TO_CODE[c] = { code: i, figs: false }; });
  FIGURES.forEach((c, i) => { if (c && c !== "\r" && c !== "\n" && !TO_CODE[c]) TO_CODE[c] = { code: i, figs: true }; });

  const DEFAULTS = { baud: 45.45, shift: 170, low: 2125, reverse: false, usos: true };
  const SQUELCH = 0.1; // share of the audio's power that must be in the two tones

  class Decoder {
    constructor(opts = {}) {
      this.fs = opts.fs || FS;
      this.configure({ ...DEFAULTS, ...opts });
    }

    /** Change speed, shift, tone, Reverse or USOS (starts the filters afresh). */
    configure(o = {}) {
      for (const k of Object.keys(DEFAULTS)) if (o[k] !== undefined) this[k] = o[k];
      this.baud = Number(this.baud) > 0 ? Number(this.baud) : DEFAULTS.baud;
      this.shift = Number(this.shift) > 0 ? Number(this.shift) : DEFAULTS.shift;
      this.low = Math.min(Math.max(Number(this.low) || DEFAULTS.low, 200), this.fs / 2 - this.shift - 100);
      this.reverse = Boolean(this.reverse);
      this.usos = Boolean(this.usos);
      this.bit = this.fs / this.baud; // samples in one bit
      this.nw = Math.max(8, Math.round(this.bit));
      this.wl = (2 * Math.PI * this.low) / this.fs;
      this.wh = (2 * Math.PI * (this.low + this.shift)) / this.fs;
      this.reset();
    }

    reset() {
      this.n = 0;
      this.pl = 0; this.ph = 0; // oscillator phases
      this.ring = [0, 1, 2, 3, 4].map(() => new Float64Array(this.nw)); // low I, low Q, high I, high Q, power
      this.sum = new Float64Array(5);
      this.pos = 0;
      this.peak = 0;
      this.state = 0; // 0 waiting, 1 reading a character
      this.armed = false;
      this.figs = false;
      this.locked = false;
      this.hist = new Float32Array(this.fs * 2); // last 2 s, for find()
      this.heard = 0;
    }

    /** Audio in; the new text out. */
    process(input) {
      let out = "";
      const nw = this.nw, ring = this.ring, sum = this.sum, hist = this.hist;
      const v = new Float64Array(5);
      for (let i = 0; i < input.length; i++) {
        const x = input[i];
        hist[this.n % hist.length] = x;
        this.pl += this.wl; this.ph += this.wh;
        if (this.pl > 1e6) { this.pl %= 2 * Math.PI; this.ph %= 2 * Math.PI; }
        const p = this.pos;
        v[0] = x * Math.cos(this.pl); v[1] = x * Math.sin(this.pl);
        v[2] = x * Math.cos(this.ph); v[3] = x * Math.sin(this.ph);
        v[4] = x * x;
        for (let k = 0; k < 5; k++) { sum[k] += v[k] - ring[k][p]; ring[k][p] = v[k]; }
        this.pos = p + 1 === nw ? 0 : p + 1;
        this.n++;
        if (this.n < nw) continue;
        const zl = Math.hypot(sum[0], sum[1]) / nw, zh = Math.hypot(sum[2], sum[3]) / nw;
        const power = Math.max(sum[4], 0) / nw;
        const ratio = (2 * (zl * zl + zh * zh)) / (power + 1e-12);
        this.locked = ratio > SQUELCH && power > 1e-9;
        const d = this.reverse ? zh - zl : zl - zh; // positive = mark. Mark is the low tone unless Reverse
        const level = Math.max(zl, zh);
        this.peak = Math.max(level, this.peak * 0.99998);
        const pk = this.peak;
        if (this.state === 0) {
          if (d > 0.3 * pk && pk > 1e-6) this.armed = true;
          else if (this.armed && d <= 0) { this.armed = false; this.state = 1; this.k = 0; this.code = 0; this.at = this.n + 0.5 * this.bit; }
          continue;
        }
        if (this.n < this.at) continue;
        this.at += this.bit;
        const k = this.k++;
        if (!this.locked) { this.state = 0; continue; }
        if (k === 0) { if (d >= -0.2 * pk) this.state = 0; } // not a real start bit
        else if (k <= 5) { if (d > 0) this.code |= 1 << (k - 1); }
        else {
          this.state = 0; // the stop bit: mark, or the character is thrown away
          if (d > 0.2 * pk) out += this.character(this.code);
        }
      }
      return out;
    }

    /** One 5-bit code to text, following the LTRS / FIGS shifts (and USOS: a space goes back to letters). */
    character(code) {
      if (code === LTRS) { this.figs = false; return ""; }
      if (code === FIGS) { this.figs = true; return ""; }
      const c = (this.figs ? FIGURES : LETTERS)[code];
      if (code === SPACE && this.usos) this.figs = false;
      if (c === "\r") return "";
      if (c) this.heard++;
      return c;
    }

    /** Look for the tone pair (this shift apart) in the last two seconds of audio. Returns the lower
     *  tone in Hz (to 5 Hz), or null if there's no RTTY there. */
    find() {
      const h = this.hist, n = Math.min(this.n, h.length);
      if (n < this.fs) return null;
      const a = new Float32Array(n);
      for (let i = 0; i < n; i++) a[i] = h[(this.n - n + i) % h.length];
      const step = 5, lo = 300, hi = Math.min(3400, this.fs / 2 - 100);
      const bins = Math.floor((hi + this.shift - lo) / step) + 1;
      const pw = new Float64Array(bins);
      for (let b = 0; b < bins; b++) {
        const f = lo + b * step;
        const c = 2 * Math.cos((2 * Math.PI * f) / this.fs);
        let s1 = 0, s2 = 0;
        for (let i = 0; i < n; i++) { const s0 = a[i] + c * s1 - s2; s2 = s1; s1 = s0; }
        pw[b] = s1 * s1 + s2 * s2 - c * s1 * s2;
      }
      const off = Math.round(this.shift / step);
      let best = -1, bestScore = 0;
      const scores = [];
      for (let b = 0; b + off < bins; b++) {
        const sc = Math.sqrt(pw[b] * pw[b + off]);
        scores.push(sc);
        if (sc > bestScore) { bestScore = sc; best = b; }
      }
      if (best < 0) return null;
      const sorted = scores.slice().sort((x, y) => x - y);
      const median = sorted[sorted.length >> 1] || 1e-12;
      return bestScore > 12 * median ? lo + best * step : null;
    }
  }

  /* ---------- test audio (in memory only: for the tests and for trying the decoder) ---------- */

  /** Text to ITA2 codes with LTRS/FIGS shifts. `usos`: the sender, like the receiver, drops back to letters
   *  after a space. A new line is CR LF. */
  function encode(text, { usos = true } = {}) {
    const codes = [LTRS, LTRS];
    let figs = false;
    for (const ch of String(text).toUpperCase()) {
      if (ch === "\n") { codes.push(8, 2); continue; }
      if (ch === " ") { codes.push(SPACE); if (usos) figs = false; continue; }
      const t = TO_CODE[ch];
      if (!t) continue;
      if (t.figs !== figs) { codes.push(t.figs ? FIGS : LTRS); figs = t.figs; }
      codes.push(t.code);
    }
    codes.push(LTRS);
    return codes;
  }

  /** Audio of text as RTTY: continuous-phase two-tone FSK, 1 start, 5 data (low bit first) and `stop` stop
   *  bits, with idle mark before and after. `reverse` swaps mark and space. `noise` is the RMS of added noise. */
  function synthesize(text, { fs = FS, baud = 45.45, shift = 170, low = 2125, reverse = false, usos = true, stop = 1.5,
    amp = 0.5, noise = 0, lead = 0.6, tail = 0.6, seed = 1, codes = null } = {}) {
    const bit = fs / baud;
    const bits = []; // [length in bits, is mark]
    bits.push([lead * baud, 1]);
    for (const c of codes || encode(text, { usos })) {
      bits.push([1, 0]);
      for (let i = 0; i < 5; i++) bits.push([1, (c >> i) & 1]);
      bits.push([stop, 1]);
    }
    bits.push([tail * baud, 1]);
    const total = bits.reduce((s, m) => s + m[0], 0);
    const out = new Float32Array(Math.ceil(total * bit));
    const fMark = reverse ? low + shift : low, fSpace = reverse ? low : low + shift;
    let phase = 0, t = 0, edge = 0;
    for (const [len, isMark] of bits) {
      edge += len * bit;
      const w = (2 * Math.PI * (isMark ? fMark : fSpace)) / fs;
      for (; t < Math.min(Math.round(edge), out.length); t++) { phase += w; out[t] = amp * Math.sin(phase); }
    }
    if (noise > 0) {
      let s = seed >>> 0;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let i = 0; i < out.length; i++) out[i] += noise * Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    }
    return out;
  }

  return { FS, DEFAULTS, Decoder, encode, synthesize, LETTERS, FIGURES };
});
