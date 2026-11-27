/* HamShack by M0GLP & M3VRV: software radio for an RTL-SDR (including the RTL-SDR Blog V4).
 * Turns the dongle's 8-bit I/Q samples into audio (AM, USB, LSB, CW, FM and broadcast FM)
 * and a spectrum for the waterfall. Plain JavaScript, no dependencies; works in the browser
 * (window.SdrDsp) and in Node (require) for the tests.
 *
 * Signal path: the dongle is tuned a quarter of the sample rate above the wanted frequency,
 * so the dongle's DC spike stays out of the way. Here the wanted signal is moved back to 0 Hz
 * (a quarter-rate shift is just swapping and negating I and Q), filtered and decimated
 * 960 kHz -> 240 kHz -> 48 kHz, then demodulated. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SdrDsp = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const IN_RATE = 960000; // the default sample rate from the dongle (a rate every RTL2832U supports)
  // Sample rates offered: each divides down to 240 kHz. 2.4 MS/s is the most the RTL-SDR Blog V4 does reliably.
  const RATES = [960000, 1920000, 2400000];
  const MID_RATE = 240000; // after the first decimation: wide enough for broadcast FM
  const AUDIO_RATE = 48000;
  const OFFSET = IN_RATE / 4; // the dongle is tuned this far above the wanted frequency, in Hz
  const MODES = ["usb", "lsb", "am", "cw", "fm", "wfm"];
  // Filter widths (Hz) offered for each mode, and the defaults.
  const WIDTHS = { usb: [1800, 2400, 2700, 3000], lsb: [1800, 2400, 2700, 3000], cw: [250, 500, 1000], am: [4000, 6000, 9000], fm: [8000, 12000, 16000] };
  const DEFAULT_WIDTH = { usb: 2700, lsb: 2700, cw: 500, am: 6000, fm: 12000 };
  // How quickly the automatic audio level recovers after a loud signal (per-sample decay at 48 kHz).
  const AGC_DECAY = { fast: 0.9995, normal: 0.99995, slow: 0.999985 };

  /** Low-pass FIR taps: windowed sinc (Blackman), cutoff in Hz at rate in Hz, unity gain at DC. */
  function lowpass(cutoff, rate, n) {
    const fc = cutoff / rate;
    const taps = new Float32Array(n);
    const m = n - 1;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const x = i - m / 2;
      const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
      const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / m) + 0.08 * Math.cos((4 * Math.PI * i) / m);
      taps[i] = sinc * w;
      sum += taps[i];
    }
    for (let i = 0; i < n; i++) taps[i] /= sum;
    return taps;
  }

  /** FIR filter for complex samples with real taps, keeping one output in every `decim`. */
  class ComplexFir {
    constructor(taps, decim = 1) {
      this.taps = taps;
      this.n = taps.length;
      this.decim = decim;
      this.hi = new Float32Array(this.n * 2); // history, written twice so a window is always contiguous
      this.hq = new Float32Array(this.n * 2);
      this.pos = 0;
      this.phase = 0;
    }
    /** Filter a block. Returns [I, Q] arrays of the outputs. */
    run(inI, inQ, len) {
      const { taps, n, decim, hi, hq } = this;
      const outLen = Math.floor((len + this.phase) / decim);
      const oi = new Float32Array(outLen);
      const oq = new Float32Array(outLen);
      let o = 0;
      for (let k = 0; k < len; k++) {
        this.pos = (this.pos + 1) % n;
        hi[this.pos] = hi[this.pos + n] = inI[k];
        hq[this.pos] = hq[this.pos + n] = inQ[k];
        if (++this.phase === decim) {
          this.phase = 0;
          // newest sample is at pos (and pos + n); the window is pos+1 .. pos+n (oldest first)
          let si = 0;
          let sq = 0;
          const base = this.pos + 1;
          for (let t = 0; t < n; t++) {
            si += taps[t] * hi[base + t];
            sq += taps[t] * hq[base + t];
          }
          oi[o] = si;
          oq[o++] = sq;
        }
      }
      return [oi, oq];
    }
  }

  /** FIR filter for real samples, keeping one output in every `decim`. */
  class RealFir {
    constructor(taps, decim = 1) {
      this.taps = taps;
      this.n = taps.length;
      this.decim = decim;
      this.h = new Float32Array(this.n * 2);
      this.pos = 0;
      this.phase = 0;
    }
    run(input) {
      const { taps, n, decim, h } = this;
      const out = new Float32Array(Math.floor((input.length + this.phase) / decim));
      let o = 0;
      for (let k = 0; k < input.length; k++) {
        this.pos = (this.pos + 1) % n;
        h[this.pos] = h[this.pos + n] = input[k];
        if (++this.phase === decim) {
          this.phase = 0;
          let s = 0;
          const base = this.pos + 1;
          for (let t = 0; t < n; t++) s += taps[t] * h[base + t];
          out[o++] = s;
        }
      }
      return out;
    }
  }

  /** Multiplies complex samples by e^(j 2 pi f t), in place, keeping the phase between blocks. */
  class Shifter {
    constructor(freq, rate) {
      this.step = (2 * Math.PI * freq) / rate;
      this.ph = 0;
    }
    run(i, q) {
      for (let k = 0; k < i.length; k++) {
        const c = Math.cos(this.ph);
        const s = Math.sin(this.ph);
        const a = i[k];
        const b = q[k];
        i[k] = a * c - b * s;
        q[k] = a * s + b * c;
        this.ph += this.step;
        if (this.ph > Math.PI) this.ph -= 2 * Math.PI;
        else if (this.ph < -Math.PI) this.ph += 2 * Math.PI;
      }
    }
  }

  class Demodulator {
    /** inRate: the dongle's sample rate (one of RATES). */
    constructor(inRate = IN_RATE) {
      this.inRate = RATES.includes(inRate) ? inRate : IN_RATE;
      this.quarter = 0; // phase of the quarter-rate shift
      this.carry = -1; // an I byte waiting for its Q byte
      const d1 = this.inRate / MID_RATE; // 4, 8 or 10
      this.first = new ComplexFir(lowpass(100000, this.inRate, 8 * d1 + 1), d1); // -> 240 kHz
      this.second = new ComplexFir(lowpass(16000, MID_RATE, 41), 5); // 240 kHz -> 48 kHz
      this.level = -120; // channel power, dBFS
      this.volume = 1;
      this.autoGain = true; // automatic audio level for SSB, CW and AM
      this.agcDecay = AGC_DECAY.normal;
      this.squelch = null; // dBFS; null = open
      this.deemphUs = 50; // broadcast FM de-emphasis: 50 (Europe) or 75 (Americas) microseconds
      this.widths = { ...DEFAULT_WIDTH };
      this.setMode("usb");
    }

    /** Receiver settings: { widths: {usb: Hz, ...}, agc: "fast"|"normal"|"slow", squelch: dBFS or null, deemph: 50|75 }. */
    configure({ widths, agc, squelch, deemph } = {}) {
      if (widths) for (const m of Object.keys(DEFAULT_WIDTH)) if (WIDTHS[m].includes(widths[m])) this.widths[m] = widths[m];
      if (AGC_DECAY[agc]) this.agcDecay = AGC_DECAY[agc];
      if (squelch !== undefined) this.squelch = Number.isFinite(squelch) ? squelch : null;
      if (deemph === 50 || deemph === 75) this.deemphUs = deemph;
      this.setMode(this.mode);
    }

    setMode(mode) {
      if (!MODES.includes(mode)) mode = "usb";
      this.mode = mode;
      const bw = this.widths[mode];
      this.prevI = 0;
      this.prevQ = 0;
      this.dcIn = 0;
      this.dcOut = 0;
      this.deemph = 0;
      this.agc = 1e-3;
      switch (mode) {
        case "usb":
        case "lsb": {
          // Pass 150 Hz to the filter width on one side: move the band's centre to 0 Hz, low-pass, move it back.
          const sign = mode === "usb" ? 1 : -1;
          const centre = (150 + bw) / 2;
          this.pre = new Shifter(-sign * centre, AUDIO_RATE);
          this.chan = new ComplexFir(lowpass((bw - 150) / 2, AUDIO_RATE, 191));
          this.post = new Shifter(sign * centre, AUDIO_RATE);
          break;
        }
        case "cw":
          this.pre = null;
          this.chan = new ComplexFir(lowpass(bw / 2, AUDIO_RATE, 255));
          this.post = new Shifter(700, AUDIO_RATE); // a 700 Hz note
          break;
        case "am":
          this.pre = this.post = null;
          this.chan = new ComplexFir(lowpass(bw / 2, AUDIO_RATE, 95));
          break;
        case "fm":
          this.pre = this.post = null;
          this.chan = new ComplexFir(lowpass(bw / 2, AUDIO_RATE, 63));
          break;
        case "wfm":
          this.pre = this.post = null;
          this.chan = null;
          this.audio = new RealFir(lowpass(15000, MID_RATE, 63), 5); // 240 kHz -> 48 kHz
          // de-emphasis: 50 microseconds (UK and Europe) or 75 (Americas)
          this.deemphA = Math.exp(-1 / (MID_RATE * this.deemphUs * 1e-6));
          break;
      }
    }

    /** I/Q bytes from the dongle in, 48 kHz audio out (Float32Array, roughly -1..1). */
    process(bytes) {
      // 1. bytes -> floats, and move the wanted signal (at -fs/4) to 0 Hz.
      let start = 0;
      let pairs = (bytes.length + (this.carry >= 0 ? 1 : 0)) >> 1;
      const ii = new Float32Array(pairs);
      const qq = new Float32Array(pairs);
      let k = 0;
      if (this.carry >= 0 && bytes.length) {
        this.quarterPut(ii, qq, k++, this.carry, bytes[0]);
        start = 1;
        this.carry = -1;
      }
      for (let b = start; b + 1 < bytes.length; b += 2) this.quarterPut(ii, qq, k++, bytes[b], bytes[b + 1]);
      if ((bytes.length - start) % 2 === 1) this.carry = bytes[bytes.length - 1];
      pairs = k;

      // 2. 960 kHz -> 240 kHz
      const [mi, mq] = this.first.run(ii, qq, pairs);
      if (this.mode === "wfm") return this.wfm(mi, mq);

      // 3. 240 kHz -> 48 kHz, channel filter, demodulate
      const [ai, aq] = this.second.run(mi, mq, mi.length);
      if (this.pre) this.pre.run(ai, aq);
      const [ci, cq] = this.chan.run(ai, aq, ai.length);
      this.measure(ci, cq);
      const out = new Float32Array(ci.length);
      switch (this.mode) {
        case "usb":
        case "lsb":
        case "cw":
          this.post.run(ci, cq);
          for (let n = 0; n < ci.length; n++) out[n] = ci[n];
          return this.gain(out, true);
        case "am":
          for (let n = 0; n < ci.length; n++) {
            const env = Math.hypot(ci[n], cq[n]);
            this.dcIn += 0.0005 * (env - this.dcIn); // remove the carrier
            out[n] = env - this.dcIn;
          }
          return this.gain(out, true);
        case "fm":
          for (let n = 0; n < ci.length; n++) {
            out[n] = this.discriminate(ci[n], cq[n]) * 1.5;
          }
          return this.gain(out, false);
      }
      return out;
    }

    quarterPut(ii, qq, k, bi, bq) {
      const i = (bi - 127.5) / 127.5;
      const q = (bq - 127.5) / 127.5;
      // multiply by j^n: shifts the spectrum up by a quarter of the sample rate
      switch (this.quarter) {
        case 0: ii[k] = i; qq[k] = q; break;
        case 1: ii[k] = -q; qq[k] = i; break;
        case 2: ii[k] = -i; qq[k] = -q; break;
        default: ii[k] = q; qq[k] = -i;
      }
      this.quarter = (this.quarter + 1) & 3;
    }

    /** Phase change since the last sample, scaled to -1..1 */
    discriminate(i, q) {
      // (i + jq) * conj(prev)
      const re = i * this.prevI + q * this.prevQ;
      const im = q * this.prevI - i * this.prevQ;
      this.prevI = i;
      this.prevQ = q;
      return Math.atan2(im, re) / Math.PI;
    }

    wfm(mi, mq) {
      this.measure(mi, mq);
      const demod = new Float32Array(mi.length);
      for (let n = 0; n < mi.length; n++) {
        const v = this.discriminate(mi[n], mq[n]);
        this.deemph = v + this.deemphA * (this.deemph - v);
        demod[n] = this.deemph * 1.2;
      }
      return this.gain(this.audio.run(demod), false);
    }

    measure(i, q) {
      if (!i.length) return;
      let p = 0;
      for (let n = 0; n < i.length; n++) p += i[n] * i[n] + q[n] * q[n];
      const db = 10 * Math.log10(p / i.length + 1e-12);
      this.level = this.level <= -119 ? db : this.level + 0.3 * (db - this.level);
    }

    /** Volume, and automatic gain for the modes that need it, with a gentle limiter. */
    gain(out, agc) {
      if (this.squelch !== null) {
        // Squelch: silent until the signal is above the level set, with 2 dB of hysteresis.
        this.squelched = this.squelched ? this.level < this.squelch + 2 : this.level < this.squelch;
        if (this.squelched) { out.fill(0); return out; }
      } else this.squelched = false;
      for (let n = 0; n < out.length; n++) {
        let v = out[n];
        if (agc && !this.autoGain) {
          v *= 4; // fixed gain: the RF gain sets the loudness
        } else if (agc) {
          const a = Math.abs(v);
          this.agc = a > this.agc ? this.agc + 0.05 * (a - this.agc) : this.agc * this.agcDecay;
          v *= 0.3 / Math.max(this.agc, 1e-4);
        }
        v *= this.volume;
        // remove any DC, then soft-limit
        this.dcOut += 0.001 * (v - this.dcOut);
        v -= this.dcOut;
        out[n] = Math.tanh(v);
      }
      return out;
    }
  }

  /** In-place radix-2 FFT of n complex samples (n a power of two). */
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang);
      const wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1;
        let ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j;
          const b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci;
          const ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
          const t = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = t;
        }
      }
    }
  }

  /** Power spectrum of the first n I/Q pairs in `bytes`, in dB, lowest frequency first. */
  function spectrum(bytes, n = 1024) {
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const pairs = Math.min(n, bytes.length >> 1);
    for (let k = 0; k < pairs; k++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)); // Hann window
      re[k] = ((bytes[2 * k] - 127.5) / 127.5) * w;
      im[k] = ((bytes[2 * k + 1] - 127.5) / 127.5) * w;
    }
    fft(re, im);
    const out = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const src = (k + n / 2) % n; // put 0 Hz in the middle
      out[k] = 10 * Math.log10((re[src] * re[src] + im[src] * im[src]) / n + 1e-12);
    }
    return out;
  }

  /** The frequency (Hz) to tune the dongle to, to hear `dialHz`. */
  const centreFor = (dialHz, inRate = IN_RATE) => Math.round(dialHz + inRate / 4);

  return { IN_RATE, RATES, MID_RATE, AUDIO_RATE, OFFSET, MODES, WIDTHS, DEFAULT_WIDTH, AGC_DECAY, Demodulator, spectrum, centreFor, lowpass, fft };
});
