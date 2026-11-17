/* Band Watch by M3vrv: WSPR-2 decoder (and encoder, for testing), in plain JavaScript.
 * The protocol as published by K1JT: a 50-bit message (callsign, 4-character locator, power in dBm),
 * a K=32 rate-1/2 convolutional code, bit-reversal interleaving, and 4-FSK at 1.4648 baud where each
 * tone carries one data bit (MSB) and one bit of a fixed 162-bit sync vector (LSB). Decoding: shift the
 * 1400-1600 Hz audio band down to baseband at 375 samples a second, search for the sync vector in a
 * spectrogram, take soft symbols, de-interleave and run a sequential (Fano) decoder.
 * Works in the browser, in a Web Worker and in Node (tests). Type 1 messages (K1ABC FN42 37). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Wspr = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The 162-bit sync vector (pr3 in WSJT-X's wsprsim_utils.c).
  const SYNC = [
    1, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1,
    0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 1,
    0, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0,
    0, 0,
  ];
  const POLY1 = 0xf2d05351;
  const POLY2 = 0xe4613c47;
  const NSYM = 162;
  const NBITS = 81; // 50 message bits + 31 zero tail bits
  const FS = 12000; // audio sample rate the decoder works at
  const SYM_SAMPLES = 8192; // samples per symbol at 12000 Hz
  const TONE_HZ = FS / SYM_SAMPLES; // 1.4648 Hz
  const CENTRE_HZ = 1500; // middle of the 200 Hz WSPR window above the dial frequency
  const DS = 32; // downsampling to 375 samples a second
  const FS2 = FS / DS;
  const SYM2 = SYM_SAMPLES / DS; // 256 samples per symbol after downsampling
  const HOP = 64; // spectrogram step: a quarter of a symbol
  const NFFT2 = 512; // zero-padded to half-tone resolution
  const POWERS = [0, 3, 7, 10, 13, 17, 20, 23, 27, 30, 33, 37, 40, 43, 47, 50, 53, 57, 60];

  const parity = (x) => {
    x ^= x >>> 16; x ^= x >>> 8; x ^= x >>> 4; x ^= x >>> 2; x ^= x >>> 1;
    return x & 1;
  };
  const rev8 = (i) => {
    let j = 0;
    for (let b = 0; b < 8; b++) if (i & (1 << b)) j |= 1 << (7 - b);
    return j;
  };
  const REV = [];
  for (let i = 0; i < 256; i++) { const j = rev8(i); if (j < NSYM) REV.push(j); } // REV[p] = channel position of encoder symbol p

  /* ---------- Message packing (type 1) ---------- */

  const callCode = (c) => (c >= "0" && c <= "9" ? c.charCodeAt(0) - 48 : c >= "A" && c <= "Z" ? c.charCodeAt(0) - 55 : c === " " ? 36 : -1);
  const CALL_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ ";

  function packCall(call) {
    let c = String(call).toUpperCase().trim();
    if (!/^[A-Z0-9]{3,6}$/.test(c)) return -1;
    if (!/\d/.test(c[2] || "")) { if (/\d/.test(c[1])) c = ` ${c}`; else return -1; }
    if (c.length > 6) return -1;
    c = c.padEnd(6, " ");
    const k = [...c].map(callCode);
    if (k.some((x) => x < 0) || k[2] > 9 || k[1] === 36 || k.slice(3).some((x) => x < 10)) return -1;
    let n = k[0];
    n = n * 36 + k[1];
    n = n * 10 + k[2];
    n = n * 27 + (k[3] - 10);
    n = n * 27 + (k[4] - 10);
    n = n * 27 + (k[5] - 10);
    return n;
  }

  function unpackCall(n) {
    const out = [];
    for (let i = 5; i >= 3; i--) { out[i] = CALL_CHARS[(n % 27) + 10]; n = Math.floor(n / 27); }
    out[2] = CALL_CHARS[n % 10]; n = Math.floor(n / 10);
    out[1] = CALL_CHARS[n % 36]; n = Math.floor(n / 36);
    if (n > 36) return null;
    out[0] = CALL_CHARS[n];
    return out.join("").trim();
  }

  function packGridPower(grid, dbm) {
    const g = String(grid).toUpperCase();
    if (!/^[A-R]{2}\d{2}$/.test(g) || !POWERS.includes(dbm)) return -1;
    const g0 = g.charCodeAt(0) - 65, g1 = g.charCodeAt(1) - 65, g2 = Number(g[2]), g3 = Number(g[3]);
    return ((179 - 10 * g0 - g2) * 180 + 10 * g1 + g3) * 128 + dbm + 64;
  }

  function unpackGridPower(m) {
    const p = (m % 128) - 64;
    const m1 = Math.floor(m / 128);
    const a = 179 - Math.floor(m1 / 180), b = m1 % 180;
    const g0 = Math.floor(a / 10), g2 = a % 10, g1 = Math.floor(b / 10), g3 = b % 10;
    if (g0 < 0 || g0 > 17 || g1 > 17) return null;
    return { grid: String.fromCharCode(65 + g0, 65 + g1) + g2 + g3, dbm: p };
  }

  /** The 81 bits the encoder sends: 28 for the call, 22 for locator and power, 31 zeros. */
  function messageBits(text) {
    const [call, grid, p] = String(text).trim().toUpperCase().split(/\s+/);
    const n = packCall(call || "");
    const m = packGridPower(grid || "", Number(p));
    if (n < 0 || m < 0) throw new Error(`WSPR can only send "CALL GRID dBm" (type 1), not "${text}"`);
    const bits = [];
    for (let i = 27; i >= 0; i--) bits.push(Math.floor(n / 2 ** i) % 2);
    for (let i = 21; i >= 0; i--) bits.push(Math.floor(m / 2 ** i) % 2);
    while (bits.length < NBITS) bits.push(0);
    return bits;
  }

  /** The 162 channel symbols (tones 0-3) for a message. */
  function encodeTones(text) {
    const bits = messageBits(text);
    const enc = [];
    let reg = 0;
    for (const b of bits) {
      reg = ((reg << 1) | b) >>> 0;
      enc.push(parity(reg & POLY1), parity(reg & POLY2));
    }
    const chan = new Array(NSYM);
    for (let p = 0; p < NSYM; p++) chan[REV[p]] = enc[p];
    return chan.map((d, i) => 2 * d + SYNC[i]);
  }

  /** Audio (12000 Hz) of a WSPR transmission starting startSec into a two-minute window. */
  function synthesize(tones, { baseHz = CENTRE_HZ - 1.5 * TONE_HZ, startSec = 1, amp = 1, seconds = 120, out } = {}) {
    const audio = out || new Float32Array(Math.round(seconds * FS));
    let phase = 0;
    let k = Math.round(startSec * FS);
    for (const t of tones) {
      const step = (2 * Math.PI * (baseHz + t * TONE_HZ)) / FS;
      for (let i = 0; i < SYM_SAMPLES; i++, k++) {
        if (k >= 0 && k < audio.length) audio[k] += amp * Math.sin(phase);
        phase += step;
      }
    }
    return audio;
  }

  /* ---------- FFT ---------- */

  function fft(re, im, inverse = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((inverse ? 2 : -2) * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      const half = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < half; j++) {
          const a = i + j, b = a + half;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  /** 1312-1687 Hz of the audio, shifted to baseband at 375 complex samples a second. */
  function downsample(audio) {
    let n = 1;
    while (n < audio.length) n <<= 1;
    const re = new Float64Array(n), im = new Float64Array(n);
    re.set(audio);
    fft(re, im);
    const m = n / DS;
    const bre = new Float64Array(m), bim = new Float64Array(m);
    const centre = Math.round((CENTRE_HZ * n) / FS);
    for (let k = -m / 2; k < m / 2; k++) {
      const src = centre + k;
      const dst = (k + m) % m;
      bre[dst] = re[src]; bim[dst] = im[src];
    }
    fft(bre, bim, true);
    const scale = 1 / n;
    const len = Math.floor(audio.length / DS);
    return { re: bre.subarray(0, len).map((v) => v * scale), im: bim.subarray(0, len).map((v) => v * scale) };
  }

  /* ---------- Sequential (Fano) decoder, after Phil Karn's fano.c ---------- */

  // Branch metrics for soft symbols 0..255 (128 = no idea, 255 = surely a 1), log-likelihood ratios
  // scaled by 10 with the rate-1/2 bias taken off.
  const METTAB = (() => {
    const t = [new Int32Array(256), new Int32Array(256)];
    for (let q = 0; q < 256; q++) {
      const llr = ((q - 127.5) / 32) * 2.2;
      const p1 = 1 / (1 + Math.exp(-llr));
      t[1][q] = Math.round(10 * (Math.log2(2 * p1 + 1e-12) - 0.5));
      t[0][q] = Math.round(10 * (Math.log2(2 * (1 - p1) + 1e-12) - 0.5));
    }
    return t;
  })();

  const encOut = (state) => (parity(state & POLY1) << 1) | parity(state & POLY2);

  /** Decode 162 soft symbols (encoder order) to 81 bits, or null. */
  function fano(soft, { delta = 40, maxCycles = 12000 } = {}) {
    const nodes = Array.from({ length: NBITS + 1 }, () => ({ metrics: [0, 0, 0, 0], tm: [0, 0], gamma: 0, state: 0, i: 0 }));
    for (let k = 0; k < NBITS; k++) {
      const s0 = soft[2 * k], s1 = soft[2 * k + 1];
      const m = nodes[k].metrics;
      m[0] = METTAB[0][s0] + METTAB[0][s1];
      m[1] = METTAB[0][s0] + METTAB[1][s1];
      m[2] = METTAB[1][s0] + METTAB[0][s1];
      m[3] = METTAB[1][s0] + METTAB[1][s1];
    }
    const tailStart = NBITS - 31;
    const setBranches = (np, k) => {
      const lsym = encOut(np.state); // output if this bit is 0
      if (k >= tailStart) { np.tm[0] = np.metrics[lsym]; np.tm[1] = -1e9; return; }
      const m0 = np.metrics[lsym], m1 = np.metrics[3 ^ lsym];
      if (m0 >= m1) { np.tm[0] = m0; np.tm[1] = m1; } else { np.tm[0] = m1; np.tm[1] = m0; np.state = (np.state ^ 1) >>> 0; }
    };
    let k = 0;
    let np = nodes[0];
    np.state = 0; np.gamma = 0; np.i = 0;
    setBranches(np, 0);
    let t = 0;
    const limit = maxCycles * NBITS;
    for (let cycle = 0; cycle < limit; cycle++) {
      const ngamma = np.gamma + np.tm[np.i];
      if (ngamma >= t) {
        if (np.gamma < t + delta) while (ngamma >= t + delta) t += delta; // first visit: tighten
        const nx = nodes[k + 1];
        nx.gamma = ngamma;
        nx.state = (np.state << 1) >>> 0;
        k++;
        if (k === NBITS) {
          const bits = [];
          for (let j = 0; j < NBITS; j++) bits.push(nodes[j].state & 1);
          return { bits, metric: ngamma, cycles: cycle };
        }
        np = nx;
        np.i = 0;
        setBranches(np, k);
        continue;
      }
      for (;;) {
        if (k === 0 || nodes[k - 1].gamma < t) {
          t -= delta;
          if (np.i !== 0) { np.i = 0; np.state = (np.state ^ 1) >>> 0; }
          break;
        }
        k--;
        np = nodes[k];
        if (k < tailStart && np.i !== 1) { np.i = 1; np.state = (np.state ^ 1) >>> 0; break; }
      }
    }
    return null;
  }

  /* ---------- Decoder ---------- */

  class Decoder {
    constructor({ minSync = 0.12, maxCandidates = 24 } = {}) {
      this.minSync = minSync;
      this.maxCandidates = maxCandidates;
    }

    /** audio: two minutes at 12000 Hz starting at the even minute. Returns decodes, strongest first. */
    decode(audio) {
      const bb = downsample(audio);
      const N = bb.re.length;
      const frames = Math.floor((N - SYM2) / HOP);
      if (frames < 4 * NSYM) return [];
      // Spectrogram: power per half-tone bin, -150..+150 Hz.
      const halfBins = Math.floor((150 / FS2) * NFFT2);
      const W = 2 * halfBins + 1;
      const spec = new Float32Array(frames * W);
      const re = new Float64Array(NFFT2), im = new Float64Array(NFFT2);
      for (let f = 0; f < frames; f++) {
        re.fill(0); im.fill(0);
        const o = f * HOP;
        for (let i = 0; i < SYM2; i++) { re[i] = bb.re[o + i]; im[i] = bb.im[o + i]; }
        fft(re, im);
        for (let b = -halfBins; b <= halfBins; b++) {
          const k = (b + NFFT2) % NFFT2;
          spec[f * W + b + halfBins] = re[k] * re[k] + im[k] * im[k];
        }
      }
      // Noise level: the median power across the band.
      const sorted = Float32Array.from(spec).sort();
      const noise = sorted[Math.floor(sorted.length / 2)] || 1e-12;
      // Sync search over start times (0 to about 9 s into the window) and base frequencies (half-tones).
      const maxT0 = frames - 4 * (NSYM - 1) - 1;
      const loB = halfBins - Math.round((110 / FS2) * NFFT2) - 3, hiB = halfBins + Math.round((110 / FS2) * NFFT2) - 3;
      const best = [];
      for (let B = loB; B <= hiB; B++) {
        let top = -1, topT = 0;
        for (let t0 = 0; t0 <= maxT0; t0++) {
          let s = 0, tot = 0;
          for (let i = 0; i < NSYM; i++) {
            const row = (t0 + 4 * i) * W + B;
            const p0 = spec[row], p1 = spec[row + 2], p2 = spec[row + 4], p3 = spec[row + 6];
            const d = p1 + p3 - p0 - p2;
            s += SYNC[i] ? d : -d;
            tot += p0 + p1 + p2 + p3;
          }
          const v = s / (tot || 1);
          if (v > top) { top = v; topT = t0; }
        }
        best.push({ B, t0: topT, sync: top });
      }
      const peaks = best
        .filter((c, i) => c.sync >= this.minSync && (!best[i - 1] || best[i - 1].sync <= c.sync) && (!best[i + 1] || best[i + 1].sync < c.sync))
        .sort((a, b) => b.sync - a.sync);
      const chosen = [];
      for (const p of peaks) {
        if (chosen.every((c) => Math.abs(c.B - p.B) >= 4)) chosen.push(p);
        if (chosen.length >= this.maxCandidates) break;
      }
      const results = [];
      const seen = new Set();
      for (const c of chosen) {
        let got = null;
        for (const [dB, dT] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const B = c.B + dB, t0 = c.t0 + dT;
          if (B < 0 || B + 6 >= W || t0 < 0 || t0 > maxT0) continue;
          got = this.tryDecode(spec, W, B, t0);
          if (got) { got.B = B; got.t0 = t0; break; }
        }
        if (!got || seen.has(got.text)) continue;
        seen.add(got.text);
        // Signal power: the tones it used, against the noise in 2500 Hz (as WSJT-X reports it).
        let sig = 0;
        for (let i = 0; i < NSYM; i++) {
          const row = (got.t0 + 4 * i) * W + got.B;
          sig += Math.max(spec[row], spec[row + 2], spec[row + 4], spec[row + 6]);
        }
        sig /= NSYM;
        // Per bin, a tone of power S stands (S / (N0 * FS2)) * SYM2 above noise of density N0, so
        // S/N in 2500 Hz = (bin ratio) * FS2 / (2500 * SYM2).
        const snr = Math.round(10 * Math.log10(Math.max(1e-6, (sig - noise) / noise)) + 10 * Math.log10(FS2 / (2500 * SYM2)));
        results.push({
          text: got.text, call: got.call, grid: got.grid, dbm: got.dbm,
          freq: Math.round((CENTRE_HZ + ((got.B - halfBins) * FS2) / NFFT2 + 1.5 * TONE_HZ) * 10) / 10,
          dt: Math.round(((got.t0 * HOP) / FS2 - 1) * 10) / 10,
          snr: Math.max(-35, Math.min(30, snr)), sync: Math.round(c.sync * 100) / 100,
        });
      }
      return results;
    }

    tryDecode(spec, W, B, t0) {
      const soft = new Float64Array(NSYM);
      let rms = 0;
      for (let i = 0; i < NSYM; i++) {
        const row = (t0 + 4 * i) * W + B;
        const a = [0, 2, 4, 6].map((d) => Math.sqrt(spec[row + d]));
        soft[i] = SYNC[i] ? a[3] - a[1] : a[2] - a[0];
        rms += soft[i] * soft[i];
      }
      rms = Math.sqrt(rms / NSYM) || 1;
      const q = new Uint8Array(NSYM);
      for (let p = 0; p < NSYM; p++) {
        const v = soft[REV[p]] / rms;
        q[p] = Math.max(0, Math.min(255, Math.round(128 + v * 40)));
      }
      const res = fano(q);
      if (!res) return null;
      const bits = res.bits;
      let n = 0, m = 0;
      for (let i = 0; i < 28; i++) n = n * 2 + bits[i];
      for (let i = 28; i < 50; i++) m = m * 2 + bits[i];
      const call = unpackCall(n);
      const gp = unpackGridPower(m);
      if (!call || !gp || !POWERS.includes(gp.dbm)) return null;
      if (!/^[A-Z0-9]{1,2}\d[A-Z]{1,3}$/.test(call) && !/^[A-Z]\d[A-Z0-9]?\d[A-Z]{1,3}$/.test(call)) return null;
      return { text: `${call} ${gp.grid} ${gp.dbm}`, call, grid: gp.grid, dbm: gp.dbm };
    }
  }

  return { SYNC, POLY1, POLY2, FS, TONE_HZ, CENTRE_HZ, encodeTones, synthesize, messageBits, packCall, unpackCall, packGridPower, unpackGridPower, fano, downsample, Decoder, PERIOD: 120 };
});
