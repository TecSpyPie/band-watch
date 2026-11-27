/* HamShack by M0GLP & M3VRV: CW (Morse) decoder, and a keyer for testing, in plain JavaScript.
 * Finds the strongest tone between 300 and 1200 Hz, follows its level every 5 ms with a Goertzel
 * filter, decides key-down/key-up with an adaptive threshold, learns the speed from the marks it
 * hears, and turns marks and gaps into letters and words. Works in a Web Worker and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Cw = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FS = 8000;
  const BLOCK = 40; // 5 ms
  const MORSE = {
    A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..",
    M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
    Y: "-.--", Z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...",
    8: "---..", 9: "----.", "/": "-..-.", "?": "..--..", ".": ".-.-.-", ",": "--..--", "=": "-...-", "+": ".-.-.", "-": "-....-",
  };
  const FROM_MORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  // Prosigns sent as one character
  Object.assign(FROM_MORSE, { "...-.-": "<SK>", "-.--.": "<KN>", "...-.": "<SN>", "........": "<HH>" });

  /** Audio (FS) of Morse text at a speed in WPM (PARIS timing) on a tone, with soft edges. */
  function key(text, { wpm = 20, hz = 700, amp = 1, lead = 0.3, tail = 0.5, fs = FS } = {}) {
    const unit = 1.2 / wpm; // seconds
    const parts = [];
    for (const word of String(text).toUpperCase().trim().split(/\s+/)) {
      if (parts.length) parts.push([0, 7]);
      [...word].forEach((ch, ci) => {
        const code = MORSE[ch];
        if (!code) return;
        if (ci) parts.push([0, 3]);
        [...code].forEach((el, ei) => {
          if (ei) parts.push([0, 1]);
          parts.push([1, el === "." ? 1 : 3]);
        });
      });
    }
    const total = lead + tail + parts.reduce((s, [, u]) => s + u * unit, 0);
    const out = new Float32Array(Math.ceil(total * fs));
    let t = Math.round(lead * fs);
    const ramp = Math.round(0.005 * fs);
    for (const [on, u] of parts) {
      const n = Math.round(u * unit * fs);
      if (on) {
        for (let i = 0; i < n; i++) {
          const env = Math.min(1, i / ramp, (n - i) / ramp);
          out[t + i] = amp * env * Math.sin((2 * Math.PI * hz * (t + i)) / fs);
        }
      }
      t += n;
    }
    return out;
  }

  class Decoder {
    constructor({ fs = FS, tone = 0 } = {}) {
      this.fs = fs;
      this.fixedTone = tone; // 0 = find it
      this.reset();
    }

    reset() {
      this.tone = this.fixedTone || 0;
      this.hist = []; // recent audio for finding the tone
      this.histLen = 0;
      this.block = new Float32Array(BLOCK);
      this.fill = 0;
      this.level = 0; this.floor = 0; this.peak = 0; this.started = false;
      this.down = false;
      this.run = 0; // ms in the current state
      this.unit = 60; // ms per dit (20 WPM) until learned
      this.marks = []; // recent mark lengths, ms
      this.code = "";
      this.text = "";
      this.wordGap = false;
      this.findCount = 0;
    }

    get wpm() { return Math.round(1200 / this.unit); }

    /** Feed audio at fs. Returns any new text. */
    process(samples) {
      let out = "";
      const hadTone = Boolean(this.tone);
      this.findTone(samples);
      // Until the tone is known, keep the audio; once it is, decode what was kept first.
      const chunks = !hadTone && this.tone ? this.hist.slice() : this.tone ? [samples] : [];
      for (const chunk of chunks) {
        for (let i = 0; i < chunk.length; i++) {
          this.block[this.fill++] = chunk[i];
          if (this.fill === BLOCK) {
            this.fill = 0;
            out += this.step(this.goertzel(this.block));
          }
        }
      }
      this.text = (this.text + out).slice(-2000);
      return out;
    }

    /** Pick the strongest steady tone, 300-1200 Hz, from the last second or so (unless fixed). */
    findTone(samples) {
      if (this.fixedTone) return;
      this.hist.push(samples);
      this.histLen += samples.length;
      while (this.histLen > this.fs * 1.2 && this.hist.length > 1) this.histLen -= this.hist.shift().length;
      this.findCount += samples.length;
      if (this.tone && this.findCount < this.fs) return;
      if (this.histLen < this.fs * 0.4) return;
      this.findCount = 0;
      const n = 4096;
      const buf = new Float32Array(n);
      let k = n;
      for (let h = this.hist.length - 1; h >= 0 && k > 0; h--) {
        const a = this.hist[h];
        const take = Math.min(k, a.length);
        buf.set(a.subarray(a.length - take), k - take);
        k -= take;
      }
      let bestHz = 0, best = 0;
      const all = [];
      for (let hz = 300; hz <= 1200; hz += 5) {
        const p = goertzelPower(buf, hz, this.fs);
        all.push(p);
        if (p > best) { best = p; bestHz = hz; }
      }
      // A real signal stands well above the noise across the band; noise alone doesn't.
      all.sort((a, b) => a - b);
      if (best < 12 * all[Math.floor(all.length / 2)]) return;
      // Only move to a new tone if it's clearly the strongest (and not just a gap in the keying).
      const cur = this.tone ? goertzelPower(buf, this.tone, this.fs) : 0;
      if (!this.tone || (Math.abs(bestHz - this.tone) > 15 && best > 4 * cur)) {
        if (this.tone && bestHz !== this.tone) this.started = false;
        this.tone = bestHz;
      }
    }

    goertzel(block) {
      if (!this.tone) return 0;
      return Math.sqrt(goertzelPower(block, this.tone, this.fs)) / block.length;
    }

    /** One 5 ms level: track the noise floor and the peak, decide up or down, time marks and gaps. */
    step(level) {
      const ms = (BLOCK / this.fs) * 1000;
      this.level = 0.6 * this.level + 0.4 * level;
      const v = this.level;
      if (!this.started) { this.floor = v; this.peak = v; this.started = true; }
      // The floor follows quiet moments quickly and creeps up slowly; the peak the reverse.
      this.floor = v < this.floor ? 0.7 * this.floor + 0.3 * v : this.floor + 0.003 * (v - this.floor);
      this.peak = v > this.peak ? 0.6 * this.peak + 0.4 * v : this.peak + 0.0015 * (v - this.peak);
      if (this.peak < this.floor * 3) return this.tick(false, ms); // no signal
      const hi = this.floor + 0.55 * (this.peak - this.floor);
      const lo = this.floor + 0.35 * (this.peak - this.floor);
      const down = this.down ? v > lo : v > hi;
      return this.tick(down, ms);
    }

    tick(down, ms) {
      let out = "";
      if (down === this.down) {
        this.run += ms;
        // A long enough gap ends the letter, then the word.
        if (!down) {
          if (this.code && this.run > 2 * this.unit) { out += FROM_MORSE[this.code] || "*"; this.code = ""; this.wordGap = true; }
          if (this.wordGap && this.run > 5 * this.unit) { out += " "; this.wordGap = false; }
        }
        return out;
      }
      if (this.down) this.mark(this.run); // a mark just ended
      this.down = down;
      this.run = ms;
      return out;
    }

    mark(len) {
      if (len < 0.3 * this.unit || len < 12) return; // a click, not a dit
      const isDah = len > 2 * this.unit;
      this.code += isDah ? "-" : ".";
      if (this.code.length > 8) this.code = this.code.slice(-8);
      // Learn the speed: a dit is one unit, a dah three.
      const est = isDah ? len / 3 : len;
      this.unit = Math.max(20, Math.min(240, 0.8 * this.unit + 0.2 * est));
    }
  }

  function goertzelPower(x, hz, fs) {
    const w = (2 * Math.PI * hz) / fs;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x.length; i++) {
      const s0 = x[i] + c * s1 - s2;
      s2 = s1; s1 = s0;
    }
    return s1 * s1 + s2 * s2 - c * s1 * s2;
  }

  return { FS, MORSE, FROM_MORSE, key, Decoder };
});
