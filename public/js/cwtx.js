/* Band Watch by M3vrv: sending Morse (CW). Plain JavaScript; the page uses it as window.CwTx, the tests in Node.
 *
 *  - Timing by the PARIS standard: a dot is one unit (1.2 / WPM seconds), a dash three, one unit between the parts of
 *    a letter, three between letters, seven between words. Farnsworth spacing (for learning) keeps the letters at
 *    full speed and stretches the gaps to an overall slower speed.
 *  - Clean keying: every dot and dash starts and ends with a 5 ms raised-cosine edge, so there are no key clicks.
 *  - Prosigns in angle brackets are sent as one character: <SK>, <KN>, <AR>, <BT>, <AS>, <HH>, <SN>, <KA>, <CT>.
 *  - Messages with {CALL}, {THEIR}, {GRID} and {RST} filled in. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CwTx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...",
    8: "---..", 9: "----.", "/": "-..-.", "?": "..--..", ".": ".-.-.-", ",": "--..--", "=": "-...-", "+": ".-.-.", "-": "-....-",
    "@": ".--.-.", ":": "---...", "'": ".----.", "(": "-.--.", ")": "-.--.-", "!": "-.-.--", "&": ".-...", '"': ".-..-.",
  };
  const PROSIGNS = { SK: "...-.-", KN: "-.--.", AR: ".-.-.", BT: "-...-", AS: ".-...", HH: "........", SN: "...-.", KA: "-.-.-", CT: "-.-.-", BK: "-...-.-" };

  /** Text -> tokens: { text: "C", code: "-.-." } for each character or prosign, { space: true } between words.
   *  Characters with no Morse are left out. */
  function tokens(text) {
    const out = [];
    const s = String(text || "").toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (/\s/.test(ch)) { if (out.length && !out[out.length - 1].space) out.push({ space: true }); continue; }
      if (ch === "<") {
        const m = /^<([A-Z]{2,3})>/.exec(s.slice(i));
        if (m && PROSIGNS[m[1]]) { out.push({ text: `<${m[1]}>`, code: PROSIGNS[m[1]] }); i += m[0].length - 1; continue; }
      }
      if (MORSE[ch]) out.push({ text: ch, code: MORSE[ch] });
    }
    return out;
  }

  /** The Morse for some text as dots and dashes, letters apart: "-.-. --.-". */
  function morseOf(text) {
    return tokens(text).map((t) => (t.space ? "/" : t.code)).join(" ");
  }

  /** Seconds for one unit, and for the gaps between letters and words (Farnsworth: an overall slower speed). */
  function timing(wpm, farnsWpm = 0) {
    const unit = 1.2 / wpm;
    if (!(farnsWpm > 0) || farnsWpm >= wpm) return { unit, charGap: 3 * unit, wordGap: 7 * unit };
    // ARRL formula: the 19 units of spacing in "PARIS " take ta seconds at the slower overall speed.
    const ta = (60 * wpm - 37.2 * farnsWpm) / (farnsWpm * wpm);
    const tf = ta / 19;
    return { unit, charGap: 3 * tf, wordGap: 7 * tf };
  }

  /** Units of key-down and key-up in one character, from its code: [[on, units]...] (no gap after it). */
  function elements(code) {
    const out = [];
    [...code].forEach((el, i) => { if (i) out.push([0, 1]); out.push([1, el === "." ? 1 : 3]); });
    return out;
  }

  /**
   * Audio for one token at `rate`: the character, then the gap after it (a letter gap, or for a space the rest of a
   * word gap). Returns { samples, seconds }. Edges: 5 ms raised cosine. Phase runs on from `phase` (returned too).
   */
  function renderToken(tok, { wpm = 20, farns = 0, hz = 700, rate = 48000, amp = 0.8 } = {}) {
    const t = timing(wpm, farns);
    if (tok.space) {
      const n = Math.round((t.wordGap - t.charGap) * rate);
      return { samples: new Float32Array(Math.max(0, n)), seconds: Math.max(0, n) / rate };
    }
    const parts = elements(tok.code);
    const unitN = t.unit * rate;
    let n = 0;
    for (const [, u] of parts) n += Math.round(u * unitN);
    const gapN = Math.round(t.charGap * rate);
    const out = new Float32Array(n + gapN);
    const ramp = Math.max(1, Math.round(0.005 * rate));
    let at = 0;
    for (const [on, u] of parts) {
      const len = Math.round(u * unitN);
      if (on) {
        for (let i = 0; i < len; i++) {
          const e = i < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * i) / ramp) : i >= len - ramp ? 0.5 - 0.5 * Math.cos((Math.PI * (len - i)) / ramp) : 1;
          out[at + i] = amp * e * Math.sin((2 * Math.PI * hz * (at + i)) / rate);
        }
      }
      at += len;
    }
    return { samples: out, seconds: out.length / rate };
  }

  /** A whole message as one piece of audio (for tests and for sending a message in one go). */
  function render(text, opts = {}) {
    const parts = tokens(text).map((tok) => renderToken(tok, opts).samples);
    const total = parts.reduce((a, p) => a + p.length, 0);
    const out = new Float32Array(total);
    let at = 0;
    for (const p of parts) { out.set(p, at); at += p.length; }
    return out;
  }

  /** How long a message takes to send, in seconds. */
  function duration(text, { wpm = 20, farns = 0 } = {}) {
    const t = timing(wpm, farns);
    let s = 0;
    for (const tok of tokens(text)) {
      if (tok.space) { s += t.wordGap - t.charGap; continue; }
      for (const [, u] of elements(tok.code)) s += u * t.unit;
      s += t.charGap;
    }
    return s;
  }

  /** Fill in a message: {CALL} your callsign, {THEIR} theirs, {GRID} your locator, {RST} the report. */
  function fill(template, { call = "", their = "", grid = "", rst = "5NN" } = {}) {
    return String(template || "")
      .replace(/\{CALL\}/gi, call.toUpperCase())
      .replace(/\{THEIR\}/gi, their.toUpperCase())
      .replace(/\{GRID\}/gi, grid.toUpperCase().slice(0, 4))
      .replace(/\{RST\}/gi, rst.toUpperCase())
      .replace(/\s+/g, " ").trim();
  }

  const MESSAGES = {
    cq: "CQ CQ CQ DE {CALL} {CALL} K",
    call: "{THEIR} DE {CALL} {CALL} K",
    rpt: "{THEIR} DE {CALL} TU UR {RST} {RST} QTH {GRID} {GRID} BK",
    tu: "{THEIR} DE {CALL} TU 73 <SK>",
    agn: "AGN? AGN? BK",
    qrz: "QRZ? DE {CALL} K",
  };

  return { MORSE, PROSIGNS, tokens, morseOf, timing, elements, renderToken, render, duration, fill, MESSAGES };
});
