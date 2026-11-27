/* ClearRX by M3VRV: the radio audio processor's sound engine. It works on 48 kHz sound: a radio's audio in ClearRX,
 * or HamShack's RTL-SDR sound after it has been demodulated (the decoders get theirs before this, untouched).
 *
 * In order:
 *   1. Noise blanker: spots clicks far louder than the sound around them (electric fences, ignition, static
 *      crashes) and silences them for a millisecond, before the filters can smear them out.
 *   2. Voice filter: high-pass and low-pass (4th order each), keeping roughly 300-2700 Hz, so SSB voices stand out.
 *   3. CW peak: a narrow band-pass on the CW note (700 Hz, 6th order), for Morse in a crowded band.
 *   4. Manual notch: a deep, narrow notch at a frequency you choose, for a whistle that moves too little to matter.
 *   5. Auto notch: an adaptive (LMS) filter that learns steady tones, like carriers and tune-ups, and removes them.
 *      Speech changes too quickly for it to learn, so voices pass.
 *   6. Hiss remover (spectral noise reduction): splits the sound into 257 pitches, knows how loud the noise is at
 *      each (from the noise you taught it with Learn noise, or its own running guess) and turns each pitch down by
 *      how much of it is noise. 11 ms late, much stronger on steady hiss than the noise reduction below.
 *   7. Noise reduction: the same kind of adaptive filter the other way round: it keeps what it can predict (voice,
 *      tones) and lets go of what it can't (hiss). This is how DSP noise reduction in radios and speakers works.
 *   8. Squelch: quiet between signals. It listens before the compressor, so the compressor can't lift the noise
 *      over it, opens at once and closes after a short hang.
 *   9. Compressor (AGC): brings quiet and loud stations to a steady level, fast, medium or slow to recover.
 * 10. Graphic EQ: ten bands (100 Hz to 5 kHz), +-12 dB each.
 * 11. Tone: bass and treble shelves.
 * 12. Compressor / limiter: threshold, ratio and make-up gain, and a limiter that holds the sound under -1 dBFS.
 * Then a soft limiter so it never clips, and a meter: peak and average level, gain reduction, and whether the sound
 * would have clipped.
 * The numbers above are only the usual order: ClearRX is an effects rack, and "order" (a list of the module ids in
 * MODULES) puts the modules in any order. HamShack passes no order, so it gets the usual one, exactly as before.
 * Everything is plain arithmetic per sample: light enough for a modest PC.
 * Used by ClearRX (clearrx/, in its sound worklet) and by HamShack when it sends its RTL-SDR sound through ClearRX.
 * Works in the browser and an AudioWorklet (globalThis.RxFx) and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RxFx = factory();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () { // globalThis: also in an AudioWorklet
  "use strict";

  const RATE = 48000;

  /* ---------- Biquad filters (Robert Bristow-Johnson's Audio EQ Cookbook) ---------- */
  class Biquad {
    constructor() { this.set(1, 0, 0, 0, 0); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
    set(b0, b1, b2, a1, a2) { this.b0 = b0; this.b1 = b1; this.b2 = b2; this.a1 = a1; this.a2 = a2; return this; }
    /** gainDb is for the shelves only. */
    static design(type, f, q, rate = RATE, gainDb = 0) {
      const w = (2 * Math.PI * Math.max(1, Math.min(f, rate * 0.49))) / rate;
      const cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
      let b0, b1, b2, a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
      if (type === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
      else if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
      else if (type === "bandpass") { b0 = alpha; b1 = 0; b2 = -alpha; } // 0 dB at the centre
      else if (type === "notch") { b0 = 1; b1 = -2 * cos; b2 = 1; }
      else if (type === "peaking") { // a bell: gainDb at f, 0 dB far away (the graphic EQ's bands)
        const A = Math.pow(10, gainDb / 40);
        b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a2 = 1 - alpha / A;
      }
      else if (type === "lowshelf" || type === "highshelf") {
        const A = Math.pow(10, gainDb / 40), r = 2 * Math.sqrt(A) * alpha, s = type === "lowshelf" ? 1 : -1;
        b0 = A * ((A + 1) - s * (A - 1) * cos + r);
        b1 = 2 * s * A * ((A - 1) - s * (A + 1) * cos);
        b2 = A * ((A + 1) - s * (A - 1) * cos - r);
        a0 = (A + 1) + s * (A - 1) * cos + r;
        a1 = -2 * s * ((A - 1) + s * (A + 1) * cos);
        a2 = (A + 1) + s * (A - 1) * cos - r;
      }
      else throw new Error(`unknown filter ${type}`);
      return new Biquad().set(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }
    run(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x; this.y2 = this.y1;
      this.y1 = Math.abs(y) < 1e-25 ? 0 : y; // no denormals
      return this.y1;
    }
  }
  /** The level (dB) a biquad gives a tone at f Hz: used to draw and test the EQ's response. */
  function magnitudeDb(b, f, rate = RATE) {
    const w = (2 * Math.PI * f) / rate, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b.b0 + b.b1 * c1 + b.b2 * c2, ni = -(b.b1 * s1 + b.b2 * s2);
    const dr = 1 + b.a1 * c1 + b.a2 * c2, di = -(b.a1 * s1 + b.a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  // Two biquads with these Qs make a 4th-order Butterworth.
  const BUTTER4 = [0.5411961, 1.3065630];

  /* ---------- Adaptive (LMS) filter, used for the auto notch and the noise reduction ---------- */
  class Lms {
    /** taps: filter length; delay: how far back it looks (decorrelates speech from itself); mu: learning speed. */
    constructor(taps, delay, mu, leak = 1) {
      this.n = taps; this.delay = delay; this.mu = mu; this.leak = leak;
      this.w = new Float32Array(taps);
      this.hist = new Float32Array(taps + delay + 1);
      this.pos = 0;
    }
    /** Returns [prediction, error] for one sample. */
    step(x) {
      const H = this.hist, len = H.length;
      H[this.pos] = x;
      let y = 0, pw = 1e-6;
      for (let k = 0; k < this.n; k++) {
        const v = H[(this.pos - this.delay - k + len * 2) % len];
        y += this.w[k] * v;
        pw += v * v;
      }
      const e = x - y;
      const g = (this.mu * e) / pw; // normalised LMS: the same speed whatever the level
      for (let k = 0; k < this.n; k++) {
        const v = H[(this.pos - this.delay - k + len * 2) % len];
        this.w[k] = this.w[k] * this.leak + g * v;
      }
      this.pos = (this.pos + 1) % len;
      return [y, e];
    }
  }

  /* ---------- Spectral noise reduction ("learn the hiss") ----------
   * The sound is cut into short overlapping slices (512 samples, about 11 ms, each half over the last) and each slice
   * is split into 257 pitches with an FFT. For every pitch it knows how loud the noise is there: either the noise you
   * taught it (Learn noise, on an empty bit of band), or, until then, its own estimate (the quietest that pitch has
   * been over the last 1.5 seconds: noise is always there, speech comes and goes). Each pitch is turned down by how
   * much of it is noise (a Wiener filter with Ephraim and Malah's "decision-directed" smoothing, which keeps the hiss
   * that's left smooth rather than twinkly), never by more than the Strength. The slices are put back together
   * (sqrt-Hann windows, overlap-add), so with nothing to take out the sound comes out exactly as it went in, 512
   * samples (11 ms) later. */
  const SNR_N = 512, SNR_HOP = 256, SNR_BINS = SNR_N / 2 + 1;
  const SNR_SUB = 48, SNR_SUBS = 6; // its own estimate: the quietest over 6 stretches of 48 slices (about 1.5 s)
  const SNR_BIAS = 1.6; // the quietest is below the average noise: lift it back up
  const SNR_OVER = 1.4; // take out a little more than the noise, so less of it gets through
  const SNR_LEARN_SECS = 1.5;
  const SNR_RANGE = [6, 30]; // Strength: the most a pitch is turned down, dB
  const SNR_PROFILE_MIN = -3000, SNR_PROFILE_MAX = 600; // a saved profile: tenths of a dB per pitch
  let fftTab = null;
  function fftTables() {
    if (fftTab) return fftTab;
    const n = SNR_N, bits = Math.log2(n), rev = new Uint16Array(n), cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
    for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
    // sqrt of a periodic Hann, going in and coming out: the two make a Hann, and Hanns half over each other add up to 1
    const win = new Float64Array(n);
    for (let i = 0; i < n; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    return (fftTab = { rev, cos, sin, win });
  }
  /** In-place radix-2 FFT of SNR_N points (inverse: the other way round, not divided by N). */
  function fft(re, im, inverse) {
    const { rev, cos, sin } = fftTables(), n = re.length;
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = inverse ? -sin[k * step] : sin[k * step];
          const a = s + k, b = a + half;
          const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
    }
  }

  class SpectralNr {
    constructor() {
      fftTables();
      this.frame = new Float64Array(SNR_N); // the last 512 samples in
      this.fill = new Float64Array(SNR_HOP); // new samples waiting for the next slice
      this.ready = new Float64Array(SNR_HOP); // finished samples going out
      this.acc = new Float64Array(SNR_N); // overlap-add
      this.re = new Float64Array(SNR_N); this.im = new Float64Array(SNR_N);
      this.k = 0;
      this.smooth = new Float64Array(SNR_BINS); // each pitch's level, smoothed
      this.curMin = new Float64Array(SNR_BINS).fill(Infinity);
      this.mins = Array.from({ length: SNR_SUBS }, () => new Float64Array(SNR_BINS).fill(Infinity));
      this.minAt = 0; this.subCount = 0;
      this.auto = new Float64Array(SNR_BINS); // its own noise estimate
      this.profile = null; // the noise you taught it (power per pitch at an input gain of 1), or null
      this.scale = 1; // the input gain squared: a profile learnt at one volume still fits at another
      this.gPrev = new Float64Array(SNR_BINS).fill(1);
      this.postPrev = new Float64Array(SNR_BINS).fill(1);
      this.floor = Math.pow(10, -15 / 20);
      this.learnLeft = 0; this.learnSum = null; this.learnN = 0;
      this.learnt = 0; // goes up by one each time it finishes learning (so the worklet knows to send the profile)
      this.frames = 0;
      this.reduction = 0; // how much it's taking out just now, dB
    }
    /** Strength in dB: the most any pitch is turned down. */
    setStrength(db) { this.floor = Math.pow(10, -db / 20); }
    /** Learn the noise from what passes through in the next few seconds (1.5 by default). */
    learn(secs = SNR_LEARN_SECS) {
      this.learnLeft = Math.max(1, Math.round((secs * RATE) / SNR_HOP));
      this.learnN = 0; this.learnSum = new Float64Array(SNR_BINS);
    }
    get learning() { return this.learnLeft > 0; }
    /** A saved profile (257 numbers, tenths of a dB, as profileOut gives), or anything else to forget it. */
    setProfile(list) {
      if (Array.isArray(list) && list.length === SNR_BINS && list.every(Number.isFinite)) this.profile = Float64Array.from(list, (v) => Math.pow(10, v / 100));
      else this.profile = null;
    }
    /** The learnt profile as whole tenths of a dB (small enough for the settings file), or [] if there isn't one. */
    profileOut() {
      if (!this.profile) return [];
      return Array.from(this.profile, (p) => Math.max(SNR_PROFILE_MIN, Math.min(SNR_PROFILE_MAX, Math.round(100 * Math.log10(Math.max(p, 1e-30))))));
    }
    /** Empty buffers (when it's switched back on), keeping what it knows about the noise. */
    clear() { this.frame.fill(0); this.fill.fill(0); this.ready.fill(0); this.acc.fill(0); this.k = 0; this.gPrev.fill(1); this.postPrev.fill(1); }
    step(x) {
      const y = this.ready[this.k];
      this.fill[this.k] = x;
      if (++this.k === SNR_HOP) { this.k = 0; this.slice(); }
      return y;
    }
    slice() {
      const { win } = fftTab, N = SNR_N, H = SNR_HOP, re = this.re, im = this.im, fr = this.frame;
      fr.copyWithin(0, H); fr.set(this.fill, N - H);
      for (let i = 0; i < N; i++) { re[i] = fr[i] * win[i]; im[i] = 0; }
      fft(re, im, false);
      this.frames++;
      // Its own estimate: each pitch's smoothed level, and the quietest of it over the last 1.5 s
      const sm = this.smooth, cm = this.curMin;
      for (let b = 0; b < SNR_BINS; b++) {
        const p = re[b] * re[b] + im[b] * im[b];
        sm[b] = this.frames === 1 ? p : 0.85 * sm[b] + 0.15 * p;
        if (sm[b] < cm[b]) cm[b] = sm[b];
        if (this.learnLeft > 0) this.learnSum[b] += p;
      }
      if (this.learnLeft > 0) {
        this.learnN++;
        if (--this.learnLeft === 0) {
          const sc = Math.max(1e-12, this.scale), n = this.learnN;
          this.profile = Float64Array.from(this.learnSum, (v) => Math.max(1e-30, v / n / sc));
          this.learnSum = null; this.learnt++;
        }
      }
      if (++this.subCount === SNR_SUB) {
        this.subCount = 0;
        this.mins[this.minAt].set(cm); this.minAt = (this.minAt + 1) % SNR_SUBS;
        cm.fill(Infinity);
      }
      const auto = this.auto;
      for (let b = 0; b < SNR_BINS; b++) {
        let m = cm[b];
        for (let j = 0; j < SNR_SUBS; j++) if (this.mins[j][b] < m) m = this.mins[j][b];
        auto[b] = (Number.isFinite(m) ? m : sm[b]) * SNR_BIAS;
      }
      // Turn each pitch down by how much of it is noise
      const prof = this.profile, sc = this.scale, floor = this.floor, gp = this.gPrev, pp = this.postPrev;
      let inSum = 0, outSum = 0;
      for (let b = 0; b < SNR_BINS; b++) {
        const p = re[b] * re[b] + im[b] * im[b];
        const nz = Math.max(1e-20, (prof ? prof[b] * sc : auto[b]) * SNR_OVER);
        const post = p / nz;
        const prio = 0.98 * gp[b] * gp[b] * pp[b] + 0.02 * Math.max(post - 1, 0);
        let g = prio / (1 + prio);
        if (g < floor) g = floor;
        gp[b] = g; pp[b] = Math.min(post, 1e6);
        inSum += p; outSum += p * g * g;
        re[b] *= g; im[b] *= g;
        if (b > 0 && b < N / 2) { re[N - b] = re[b]; im[N - b] = -im[b]; } // the mirror half, so it stays real sound
      }
      this.reduction = inSum > 1e-20 ? Math.max(0, 10 * Math.log10(inSum / Math.max(outSum, 1e-30))) : 0;
      fft(re, im, true);
      const acc = this.acc;
      for (let i = 0; i < N; i++) acc[i] += (re[i] / N) * win[i];
      this.ready.set(acc.subarray(0, H));
      acc.copyWithin(0, H); acc.fill(0, N - H);
    }
  }

  /* ---------- The rack: modules, their order, the EQ and the compressor's curve (pure, tested on their own) ---------- */

  // Every module, in the usual order. The ids are what ClearRX keeps in its settings ("order").
  const MODULES = ["nb", "voice", "cw", "mnotch", "notch", "snr", "nr", "sq", "comp", "eq", "tone", "cmp"];
  const MODULE_NAMES = { nb: "Noise blanker", voice: "Band-pass filter", cw: "CW peak filter", mnotch: "Manual notch", notch: "Auto notch",
    snr: "Hiss remover", nr: "Noise reduction", sq: "Squelch", comp: "Steady volume (AGC)", eq: "Graphic EQ", tone: "Bass and treble", cmp: "Compressor / limiter" };
  // A module added in a later version goes after this one in an order saved before it existed (not at the end)
  const AFTER = { snr: "notch" };

  /** A list of module ids made safe: unknown ids and repeats dropped, missing modules added in their usual place. */
  function normalizeOrder(order) {
    const out = [];
    if (Array.isArray(order)) for (const id of order) if (MODULES.includes(id) && !out.includes(id)) out.push(id);
    for (const id of MODULES) if (!out.includes(id) && !AFTER[id]) out.push(id);
    for (const id of MODULES) if (!out.includes(id)) { const at = out.indexOf(AFTER[id]); out.splice(at < 0 ? out.length : at + 1, 0, id); }
    return out;
  }
  /** The order with one module moved up (dir -1) or down (+1) a place. Returns a new list (the same places if it can't move). */
  function moveModule(order, id, dir) {
    const o = normalizeOrder(order), i = o.indexOf(id), j = i + (dir < 0 ? -1 : 1);
    if (i < 0 || j < 0 || j >= o.length) return o;
    [o[i], o[j]] = [o[j], o[i]];
    return o;
  }

  // Graphic EQ: ten bands that suit radio sound (a voice lives between 300 Hz and 3 kHz), each a bell about an octave wide.
  const EQ_FREQS = [100, 200, 300, 500, 800, 1200, 1800, 2500, 3500, 5000];
  const EQ_Q = 1.4;
  const EQ_RANGE = 12; // dB, up or down
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ssb: [-8, -5, -2, 0, 1, 2, 3, 3, 2, -3], // SSB punch: lows trimmed, presence lifted
    weak: [-12, -9, -5, -1, 2, 4, 5, 4, 0, -8], // Weak DX: speech band forward, rumble and hiss down
    cw: [-10, -8, -4, 3, 6, 3, -4, -8, -10, -12], // CW: the note's neighbourhood (500-800 Hz) up, the rest down
    am: [3, 3, 2, 1, 0, -1, -1, -2, -3, -5], // AM warm: fuller lows, softer highs
  };
  const EQ_NAMES = { flat: "Flat", ssb: "SSB punch", weak: "Weak DX", cw: "CW", am: "AM warm" };
  // Which EQ curve each ClearRX preset uses
  const PRESET_EQ = { off: "flat", ssb: "ssb", weak: "weak", cw: "cw", am: "am" };
  /** Ten whole-dB gains within +-12 (anything else becomes 0; a short list is padded with 0). */
  function normalizeGains(g) {
    return EQ_FREQS.map((_, i) => {
      const v = Math.round(Number(Array.isArray(g) ? g[i] : 0));
      return Number.isFinite(v) ? Math.max(-EQ_RANGE, Math.min(EQ_RANGE, v)) : 0;
    });
  }
  /** The EQ's total response (dB) at f Hz for ten gains. */
  function eqResponseDb(gains, f) {
    const g = normalizeGains(gains);
    let total = 0;
    for (let i = 0; i < g.length; i++) if (g[i]) total += magnitudeDb(Biquad.design("peaking", EQ_FREQS[i], EQ_Q, RATE, g[i]), f);
    return total;
  }

  // Compressor: how many dB the gain drops (a number <= 0) for a level, with a soft knee.
  const CMP_KNEE = 6; // dB
  function compGainDb(levelDb, thresholdDb, ratio, kneeDb = CMP_KNEE) {
    if (!(ratio > 1)) return 0;
    const slope = 1 / ratio - 1, over = levelDb - thresholdDb;
    if (kneeDb > 0 && 2 * over < -kneeDb) return 0;
    if (kneeDb > 0 && Math.abs(2 * over) <= kneeDb) { const t = over + kneeDb / 2; return (slope * t * t) / (2 * kneeDb); }
    return over > 0 ? slope * over : 0;
  }
  const CMP_CEILING = Math.pow(10, -1 / 20); // the limiter holds the sound under -1 dBFS

  /* ---------- The chain ---------- */

  const PRESETS = {
    off: { voice: false, cw: false, notch: false, nr: false, comp: false },
    ssb: { voice: true, lo: 300, hi: 2700, cw: false, notch: true, nr: false, nrLevel: 1, comp: true },
    weak: { voice: true, lo: 300, hi: 2400, cw: false, notch: true, nr: true, nrLevel: 2, comp: true },
    cw: { voice: false, cw: true, tone: 700, width: 200, notch: false, nr: true, nrLevel: 1, comp: true },
    am: { voice: true, lo: 100, hi: 4500, cw: false, notch: true, nr: false, nrLevel: 1, comp: true },
  };
  const PRESET_NAMES = { off: "Off", ssb: "SSB voice", weak: "Weak DX", cw: "CW", am: "AM broadcast" };
  // The extras (noise blanker, AGC speed, squelch, tone, manual notch) are kept whichever preset you pick.
  const DEFAULTS = { preset: "off", voice: false, lo: 300, hi: 2700, cw: false, tone: 700, width: 200, notch: false, nr: false, nrLevel: 1, comp: false,
    snr: false, snrLevel: 15, snrProfile: [],
    nb: false, nbLevel: 2, agc: "medium", sq: 0, bass: 0, treble: 0, mnotch: 0,
    // The rack: module order, graphic EQ, compressor / limiter
    order: MODULES, eq: false, eqGains: EQ_PRESETS.flat, cmp: false, cmpThr: -18, cmpRatio: 3, cmpMakeup: 0, cmpLimit: true };
  // AGC speed: how quickly the level is let go of, and how quickly the gain comes back up after a loud signal
  const AGC = { fast: [0.08, 0.0015], medium: [0.25, 0.0005], slow: [0.8, 0.00015] };
  const NB_THRESHOLD = [0, 12, 7, 4]; // Light, Medium, Strong: how many times louder than the average a click must be

  // How long a change of order takes: the sound fades out, the modules swap places, and it fades back in (no click)
  const FADE_SECS = 0.012;
  const copyState = (to, from) => { if (from) { to.x1 = from.x1; to.x2 = from.x2; to.y1 = from.y1; to.y2 = from.y2; } return to; };

  class Chain {
    constructor(settings = {}) {
      this.s = { ...DEFAULTS };
      this.meter = { peak: -120, rms: -120, clip: false, clipAt: 0, gr: 0 };
      this.order = null; // the order the sound goes through now
      this.pending = null; // a new order waiting for the fade-out to finish
      this.fadeG = 1;
      this.fadeHold = 0;
      this.eqF = [];
      this.configure(settings);
    }

    /** Apply settings (any of DEFAULTS' keys, or { preset: "ssb" } for a preset). */
    configure(settings = {}) {
      if (settings.preset && PRESETS[settings.preset]) this.s = { ...this.s, ...PRESETS[settings.preset], preset: settings.preset };
      for (const k of Object.keys(DEFAULTS)) if (k !== "preset" && settings[k] !== undefined) this.s[k] = settings[k];
      const s = this.s;
      s.lo = Math.max(50, Math.min(1500, Number(s.lo) || 300));
      s.hi = Math.max(s.lo + 300, Math.min(8000, Number(s.hi) || 2700));
      s.tone = Math.max(300, Math.min(1500, Number(s.tone) || 700));
      s.width = Math.max(50, Math.min(800, Number(s.width) || 200));
      s.nrLevel = Math.max(1, Math.min(3, Math.round(Number(s.nrLevel) || 1)));
      s.snr = Boolean(s.snr);
      s.snrLevel = Math.max(SNR_RANGE[0], Math.min(SNR_RANGE[1], Math.round(Number(s.snrLevel) || 15)));
      s.snrProfile = Array.isArray(s.snrProfile) && s.snrProfile.length === SNR_BINS && s.snrProfile.every((v) => Number.isFinite(Number(v)))
        ? s.snrProfile.map((v) => Math.max(SNR_PROFILE_MIN, Math.min(SNR_PROFILE_MAX, Math.round(Number(v))))) : [];
      s.nb = Boolean(s.nb);
      s.nbLevel = Math.max(1, Math.min(3, Math.round(Number(s.nbLevel) || 2)));
      if (!AGC[s.agc]) s.agc = "medium";
      s.sq = Number(s.sq) ? Math.max(-80, Math.min(-20, Math.round(Number(s.sq)))) : 0; // dBFS, 0 = off
      s.bass = Math.max(-12, Math.min(12, Math.round(Number(s.bass) || 0)));
      s.treble = Math.max(-12, Math.min(12, Math.round(Number(s.treble) || 0)));
      s.mnotch = Number(s.mnotch) ? Math.max(200, Math.min(3000, Math.round(Number(s.mnotch)))) : 0; // Hz, 0 = off
      // The rack: EQ, compressor / limiter, order
      s.eq = Boolean(s.eq);
      s.eqGains = normalizeGains(s.eqGains);
      s.cmp = Boolean(s.cmp);
      s.cmpThr = Math.max(-60, Math.min(0, Math.round(Number(s.cmpThr) || 0)));
      s.cmpRatio = Math.max(1, Math.min(20, Number(s.cmpRatio) || 3));
      s.cmpMakeup = Math.max(0, Math.min(24, Math.round(Number(s.cmpMakeup) || 0)));
      s.cmpLimit = Boolean(s.cmpLimit);
      s.order = normalizeOrder(s.order);
      this.voice = [...BUTTER4.map((q) => Biquad.design("highpass", s.lo, q)), ...BUTTER4.map((q) => Biquad.design("lowpass", s.hi, q))];
      // Manual notch: two in a row, about 40 dB deep and some 60 Hz wide
      this.mnotchF = s.mnotch ? [0, 1].map(() => Biquad.design("notch", s.mnotch, 12)) : [];
      // Tone: shelves below 250 Hz and above 2.5 kHz (only built when they're not flat)
      this.toneF = [];
      if (s.bass) this.toneF.push(Biquad.design("lowshelf", 250, Math.SQRT1_2, RATE, s.bass));
      if (s.treble) this.toneF.push(Biquad.design("highshelf", 2500, Math.SQRT1_2, RATE, s.treble));
      // Graphic EQ: a bell for each band that isn't at 0 dB. A band that moves keeps its filter's memory, so dragging a slider doesn't click.
      this.eqF = EQ_FREQS.map((f, i) => (s.eq && s.eqGains[i] ? copyState(Biquad.design("peaking", f, EQ_Q, RATE, s.eqGains[i]), this.eqF[i]) : null));
      // Noise blanker and squelch state
      this.nbAvg = this.nbAvg || 0;
      this.nbHold = this.nbHold || 0;
      this.nbWarm = this.nbWarm || 0; // samples learnt so far: it doesn't blank until it knows the level
      this.sqEnv = this.sqEnv || 0;
      this.sqHang = this.sqHang || 0;
      this.sqGain = this.sqGain === undefined ? 1 : this.sqGain;
      // Three band-passes in a row: steep sides (a station 300 Hz away is over 20 dB down), still 0 dB on the note
      const q = (s.tone / s.width) * 0.8;
      this.cwf = [0, 1, 2].map(() => Biquad.design("bandpass", s.tone, q));
      if (!this.notchF) this.notchF = new Lms(32, 24, 0.004, 1);
      // Noise reduction: stronger = a longer filter that learns more slowly (smoother, a little more "underwater")
      const nr = [null, [24, 1, 0.012], [40, 1, 0.006], [64, 1, 0.003]][s.nrLevel];
      if (!this.nrF || this.nrF.n !== nr[0]) this.nrF = new Lms(nr[0], nr[1], nr[2], 0.99995);
      else this.nrF.mu = nr[2];
      // Compressor state
      this.env = this.env || 0;
      this.gain = this.gain || 1;
      this.cEnv = this.cEnv || 0; // the rack compressor's level follower
      this.cLim = this.cLim === undefined ? 1 : this.cLim; // and its limiter's gain
      // Order: the first one is used at once; a change later fades out, swaps and fades in (see process)
      if (!this.order) this.order = s.order.slice();
      else if (s.order.join() !== this.order.join()) this.pending = s.order.slice();
      else this.pending = null;
      // Hiss remover: its slices are 11 ms late, so switching it on or off fades out and in like a change of order (no click)
      if (!this.snrF) { this.snrF = new SpectralNr(); this.snrLive = s.snr; }
      else if (s.snr !== this.snrLive) this.pending = this.pending || this.order.slice();
      this.snrF.setStrength(s.snrLevel);
      const sig = s.snrProfile.length ? s.snrProfile.join() : "";
      if (sig !== this.snrSig) { this.snrSig = sig; this.snrF.setProfile(s.snrProfile); }
      this.plan();
      return this.s;
    }

    /** Which modules do something, in the order the sound goes through them. */
    plan() {
      const s = this.s;
      const doing = {
        nb: s.nb, voice: s.voice, cw: s.cw, mnotch: this.mnotchF.length > 0, notch: s.notch, snr: this.snrLive, nr: s.nr, sq: s.sq !== 0, comp: s.comp,
        eq: this.eqF.some(Boolean), tone: this.toneF.length > 0, cmp: s.cmp,
      };
      this.active = this.order.filter((id) => doing[id]);
      // The level meter's "would it have clipped" reading is taken just before the squelch or the AGC, whichever comes first
      const first = this.order.findIndex((id) => id === "sq" || id === "comp");
      this.tapAt = this.order.slice(0, first).filter((id) => doing[id]).length;
    }

    /** Process a block in place (Float32Array at 48 kHz). Returns the same array. */
    process(buf) {
      const s = this.s;
      let act = this.active, nAct = act.length;
      let on = nAct > 0;
      let peakIn = 0, sum = 0, peakOut = 0, grBlock = 0;
      const [relSecs, rise] = AGC[s.agc] || AGC.medium;
      const ATT = 1 - Math.exp(-1 / (RATE * 0.004)), REL = 1 - Math.exp(-1 / (RATE * relSecs));
      const TARGET = 0.25; // about -12 dBFS
      // Noise blanker: the average follows over about 10 ms; a blanked click is silenced for 1 ms
      const NB_AVG = 1 - Math.exp(-1 / (RATE * 0.01)), NB_HOLD = Math.round(RATE * 0.001), NB_WARM = Math.round(RATE * 0.01), nbK = NB_THRESHOLD[s.nbLevel];
      // Squelch: opens in 2 ms, holds 400 ms after the signal goes, fades in 5 ms and out in 30 ms
      const SQ_ATT = 1 - Math.exp(-1 / (RATE * 0.002)), SQ_REL = 1 - Math.exp(-1 / (RATE * 0.05));
      const SQ_UP = 1 - Math.exp(-1 / (RATE * 0.005)), SQ_DOWN = 1 - Math.exp(-1 / (RATE * 0.03)), SQ_HANG = Math.round(RATE * 0.4);
      const sqOpenAt = s.sq ? Math.pow(10, s.sq / 20) : 0;
      // Compressor / limiter: follows the level in 5 ms and lets go in 150 ms; the limiter lets go in 60 ms
      const C_ATT = 1 - Math.exp(-1 / (RATE * 0.005)), C_REL = 1 - Math.exp(-1 / (RATE * 0.15)), LIM_REL = 1 - Math.exp(-1 / (RATE * 0.06));
      const FADE_STEP = 1 / (RATE * FADE_SECS);
      for (let i = 0; i < buf.length; i++) {
        let x = buf[i];
        if (on) {
          for (let k = 0; ; k++) {
            if (k === this.tapAt) { const a0 = Math.abs(x); if (a0 > peakIn) peakIn = a0; }
            if (k >= nAct) break;
            switch (act[k]) {
              case "nb": {
                const a0 = Math.abs(x);
                const limit = nbK * this.nbAvg;
                if (this.nbWarm >= NB_WARM && a0 > limit) this.nbHold = NB_HOLD;
                else if (this.nbWarm < NB_WARM) this.nbWarm++;
                // Learn the level, counting a click as no louder than the limit: a click barely moves it, but a
                // station that comes on loud is learnt within a few milliseconds
                this.nbAvg += NB_AVG * ((this.nbWarm >= NB_WARM ? Math.min(a0, limit) : a0) - this.nbAvg);
                if (this.nbHold > 0) { this.nbHold--; x = 0; }
                break;
              }
              case "voice": for (const f of this.voice) x = f.run(x); break;
              case "cw": for (const f of this.cwf) x = f.run(x); break;
              case "mnotch": for (const f of this.mnotchF) x = f.run(x); break;
              case "notch": x = this.notchF.step(x)[1]; break;
              case "snr": x = this.snrF.step(x); break;
              case "nr": {
                const [y] = this.nrF.step(x);
                x = y * 1.4; // the prediction loses a little level: give it back
                break;
              }
              case "sq": {
                // It listens here; the sound is shut (or opened) after the last module, so a compressor can't lift the noise over it
                const a = Math.abs(x);
                this.sqEnv += (a > this.sqEnv ? SQ_ATT : SQ_REL) * (a - this.sqEnv);
                if (this.sqEnv >= sqOpenAt) this.sqHang = SQ_HANG;
                else if (this.sqHang > 0) this.sqHang--;
                const want = this.sqHang > 0 ? 1 : 0;
                this.sqGain += (want > this.sqGain ? SQ_UP : SQ_DOWN) * (want - this.sqGain);
                break;
              }
              case "comp": {
                // Envelope follower (fast attack, release set by the AGC speed), gain towards the target, at most +24 dB
                const a = Math.abs(x);
                this.env += (a > this.env ? ATT : REL) * (a - this.env);
                const want = Math.min(16, TARGET / Math.max(1e-4, this.env));
                this.gain += (want < this.gain ? 0.02 : rise) * (want - this.gain);
                x *= this.gain;
                break;
              }
              case "eq": for (const f of this.eqF) if (f) x = f.run(x); break;
              case "tone": for (const f of this.toneF) x = f.run(x); break;
              case "cmp": {
                const a = Math.abs(x);
                this.cEnv += (a > this.cEnv ? C_ATT : C_REL) * (a - this.cEnv);
                const lvl = this.cEnv > 1e-5 ? 20 * Math.log10(this.cEnv) : -100;
                const cut = compGainDb(lvl, s.cmpThr, s.cmpRatio); // <= 0
                let grNow = -cut;
                x *= Math.pow(10, (cut + s.cmpMakeup) / 20);
                if (s.cmpLimit) {
                  const ax = Math.abs(x), need = ax > CMP_CEILING ? CMP_CEILING / ax : 1;
                  if (need < this.cLim) this.cLim = need; // at once, so it never goes over
                  else this.cLim += (1 - this.cLim) * LIM_REL;
                  x *= this.cLim;
                  grNow -= 20 * Math.log10(this.cLim);
                }
                if (grNow > grBlock) grBlock = grNow;
                break;
              }
            }
          }
          if (s.sq) x *= this.sqGain;
          // Soft limiter: never above ±1, gentle above 0.7
          if (Math.abs(x) > 0.7) x = Math.sign(x) * (0.7 + 0.3 * Math.tanh((Math.abs(x) - 0.7) / 0.3));
        }
        // A new order: fade out, swap the modules over while it's silent, fade back in
        if (this.pending) {
          this.fadeG -= FADE_STEP;
          if (this.fadeG <= 0) {
            this.fadeG = 0;
            this.order = this.pending; this.pending = null;
            if (this.snrLive !== s.snr) {
              this.snrLive = s.snr; this.snrF.clear();
              if (s.snr) this.fadeHold = SNR_N; // it gives silence for its first 512 samples: stay quiet till its sound arrives
            }
            this.plan();
            act = this.active; nAct = act.length; on = on || nAct > 0; // a module switched on mid-block starts at once
          }
        } else if (this.fadeHold > 0) this.fadeHold--;
        else if (this.fadeG < 1) this.fadeG = Math.min(1, this.fadeG + FADE_STEP);
        if (this.fadeG !== 1) x *= this.fadeG;
        const ao = Math.abs(x);
        if (ao > peakOut) peakOut = ao;
        sum += x * x;
        buf[i] = x;
      }
      // The meter shows what you hear; "clip" means it would have clipped without the limiter
      const db = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
      const m = this.meter;
      m.peak = Math.max(db(peakOut), m.peak - 1.5); // falls back gently
      m.rms = db(Math.sqrt(sum / Math.max(1, buf.length)));
      m.gr = grBlock; // the most the compressor / limiter turned the sound down in this block (dB)
      const wouldClip = (on ? (s.comp ? peakIn * this.gain : peakIn) : peakOut) >= 0.999;
      if (wouldClip) { m.clip = true; m.clipAt = Date.now(); } else if (Date.now() - m.clipAt > 1500) m.clip = false;
      return buf;
    }

    /** Hiss remover: learn the noise from the next 1.5 s (on an empty bit of band). inGain: the volume it's learnt at. */
    snrLearn(secs, inGain) { if (inGain > 0) this.snrF.scale = inGain * inGain; this.snrF.learn(secs); }
    /** The volume (input gain) the sound comes in at, so a learnt noise still fits after you turn it up or down. */
    set inGain(g) { if (g > 0) this.snrF.scale = g * g; }
    get snrLearning() { return this.snrF.learning; }
  }

  return { Chain, Biquad, Lms, SpectralNr, fft, SNR_N, SNR_HOP, SNR_BINS, SNR_RANGE, PRESETS, PRESET_NAMES, DEFAULTS, AGC, RATE,
    MODULES, MODULE_NAMES, normalizeOrder, moveModule, EQ_FREQS, EQ_Q, EQ_RANGE, EQ_PRESETS, EQ_NAMES, PRESET_EQ, normalizeGains,
    eqResponseDb, magnitudeDb, compGainDb, CMP_CEILING };
});
