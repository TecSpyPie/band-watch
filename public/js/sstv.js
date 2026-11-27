/* HamShack by M0GLP & M3VRV: SSTV (slow-scan television) pictures, analogue modes, in plain JavaScript.
 * Works in the decoder's Web Worker and in Node (tests); the page shows the pictures.
 *
 *   MODES     Martin M1/M2, Scottie S1/S2/DX, Robot 36/72, PD 50/90/120/160/180/240/290, Wraase SC2-180,
 *             Pasokon P3/P5/P7, with their VIS codes and line timings (after JL Barber's "Proposal for SSTV Mode
 *             Specifications", as MMSSTV and QSSTV use them).
 *   encode()  a picture -> audio (VIS header and all), for the tests and for sending SSTV later.
 *   Decoder   audio -> pictures. Finds the VIS code to know the mode, follows each line's sync pulse to straighten
 *             the picture (a sound card a little fast or slow makes it slant), and hands over lines as they arrive.
 *
 * Frequencies: sync 1200 Hz, black 1500 Hz, white 2300 Hz; VIS bits 1100 Hz (1) and 1300 Hz (0). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sstv = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const FS = 12000; // the decoder works at 12000 samples a second
  const SYNC = 1200, BLACK = 1500, WHITE = 2300, LEADER = 1900;

  /* ---------- Modes ----------
     A mode is one "scan" repeated: Martin, Scottie, Wraase, Pasokon and Robot 72 send one picture line per scan;
     PD sends two lines per scan (Y of line 1, R-Y, B-Y, Y of line 2); Robot 36 sends Y and one of the two colour
     differences per line, alternately. Each part: [kind, ms, extra]. kind: "sync" (1200 Hz), "tone" (a fixed
     frequency), or a channel: "R", "G", "B", "Y", "Y2", "U" (B-Y), "V" (R-Y), "C" (Robot 36's colour, V on even
     lines and U on odd ones). */
  const p = (ms) => ["tone", ms, BLACK];
  const MODES = {};
  function mode(name, vis, width, height, parts, extra = {}) {
    const scanMs = parts.reduce((a, x) => a + x[1], 0);
    let at = 0, syncAt = -1, syncMs = 0;
    for (const x of parts) { if (x[0] === "sync" && syncAt < 0) { syncAt = at; syncMs = x[1]; } at += x[1]; }
    const linesPerScan = parts.some((x) => x[0] === "Y2") ? 2 : 1;
    MODES[name] = { name, vis, width, height, parts, scanMs, syncAt, syncMs, linesPerScan, scans: height / linesPerScan, firstSyncMs: 0, ...extra };
  }
  const martin = (c) => [["sync", 4.862], p(0.572), ["G", c], p(0.572), ["B", c], p(0.572), ["R", c], p(0.572)];
  mode("Martin M1", 44, 320, 256, martin(146.432));
  mode("Martin M2", 40, 320, 256, martin(73.216));
  const scottie = (c) => [p(1.5), ["G", c], p(1.5), ["B", c], ["sync", 9], p(1.5), ["R", c]];
  mode("Scottie S1", 60, 320, 256, scottie(138.24), { firstSyncMs: 9 });
  mode("Scottie S2", 56, 320, 256, scottie(88.064), { firstSyncMs: 9 });
  mode("Scottie DX", 76, 320, 256, scottie(345.6), { firstSyncMs: 9 });
  mode("Robot 36", 8, 320, 240, [["sync", 9], p(3), ["Y", 88], ["sep", 4.5], ["tone", 1.5, LEADER], ["C", 44]]);
  mode("Robot 72", 12, 320, 240, [["sync", 9], p(3), ["Y", 138], ["tone", 4.5, BLACK], ["tone", 1.5, LEADER], ["V", 69],
    ["tone", 4.5, WHITE], ["tone", 1.5, LEADER], ["U", 69]]);
  const pd = (c) => [["sync", 20], p(2.08), ["Y", c], ["V", c], ["U", c], ["Y2", c]];
  mode("PD50", 93, 320, 256, pd(91.52));
  mode("PD90", 99, 320, 256, pd(170.24));
  mode("PD120", 95, 640, 496, pd(121.6));
  mode("PD160", 98, 512, 400, pd(195.584));
  mode("PD180", 96, 640, 496, pd(183.04));
  mode("PD240", 97, 640, 496, pd(244.48));
  mode("PD290", 94, 800, 616, pd(228.8));
  mode("Wraase SC2-180", 55, 320, 256, [["sync", 5.5225], p(0.5), ["R", 235], ["G", 235], ["B", 235]]);
  const pasokon = (u) => [["sync", 25 * u], p(5 * u), ["R", 640 * u], p(5 * u), ["G", 640 * u], p(5 * u), ["B", 640 * u], p(5 * u)];
  mode("Pasokon P3", 113, 640, 496, pasokon(1000 / 4800));
  mode("Pasokon P5", 114, 640, 496, pasokon(1000 / 3200));
  mode("Pasokon P7", 115, 640, 496, pasokon(1000 / 2400));
  const BY_VIS = new Map(Object.values(MODES).map((m) => [m.vis, m]));

  /** How long a whole picture takes, in seconds (without the VIS header). */
  const seconds = (m) => (m.firstSyncMs + m.scans * m.scanMs) / 1000;

  /* ---------- Colour ---------- */
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  /** Y, R-Y (V), B-Y (U) as Robot and PD send them (studio range, as MMSSTV) -> R, G, B. */
  function yuvToRgb(y, v, u) {
    const yy = 298.082 * (y - 16);
    return [clamp((yy + 408.583 * (v - 128)) / 256), clamp((yy - 100.291 * (u - 128) - 208.12 * (v - 128)) / 256), clamp((yy + 516.411 * (u - 128)) / 256)];
  }
  function rgbToYuv(r, g, b) {
    return [16 + (65.738 * r + 129.057 * g + 25.064 * b) / 256, 128 + (112.439 * r - 94.154 * g - 18.285 * b) / 256, 128 + (-37.945 * r - 74.494 * g + 112.439 * b) / 256];
  }
  const toHz = (v) => BLACK + (v / 255) * (WHITE - BLACK);
  const toLevel = (hz) => clamp(((hz - BLACK) / (WHITE - BLACK)) * 255);

  /* ---------- Encoder ---------- */

  /** The VIS header: leader, break, leader, start bit, 7 bits (lowest first), even parity, stop bit. [[Hz, ms]...] */
  function visTones(code) {
    const t = [[LEADER, 300], [SYNC, 10], [LEADER, 300], [SYNC, 30]];
    let ones = 0;
    for (let i = 0; i < 7; i++) { const b = (code >> i) & 1; ones += b; t.push([b ? 1100 : 1300, 30]); }
    t.push([ones % 2 ? 1100 : 1300, 30], [SYNC, 30]);
    return t;
  }

  /** Audio for a picture: rgba (width x height x 4, the mode's size), at `rate`. Returns a Float32Array. */
  function encode(m, rgba, { rate = FS, amp = 0.8, vis = true } = {}) {
    const segs = []; // [ms, Hz | Float64Array of Hz across the segment]
    if (vis) for (const [hz, ms] of visTones(m.vis)) segs.push([ms, hz]);
    if (m.firstSyncMs) segs.push([m.firstSyncMs, SYNC]);
    const px = (x, y) => { const i = (y * m.width + x) * 4; return [rgba[i], rgba[i + 1], rgba[i + 2]]; };
    for (let s = 0; s < m.scans; s++) {
      const y0 = s * m.linesPerScan;
      for (const [kind, ms, extra] of m.parts) {
        if (kind === "sync") { segs.push([ms, SYNC]); continue; }
        if (kind === "tone") { segs.push([ms, extra]); continue; }
        if (kind === "sep") { segs.push([ms, y0 % 2 ? WHITE : BLACK]); continue; }
        const row = new Float64Array(m.width);
        for (let x = 0; x < m.width; x++) {
          let v;
          if ("RGB".includes(kind)) v = px(x, y0)["RGB".indexOf(kind)];
          else if (kind === "Y") v = rgbToYuv(...px(x, y0))[0];
          else if (kind === "Y2") v = rgbToYuv(...px(x, y0 + 1))[0];
          else if (kind === "V" || kind === "U") {
            // PD and Robot 72: the colour of the line (PD: of both lines, averaged)
            const a = rgbToYuv(...px(x, y0)), b = m.linesPerScan === 2 ? rgbToYuv(...px(x, y0 + 1)) : a;
            const k = kind === "V" ? 1 : 2;
            v = (a[k] + b[k]) / 2;
          } else if (kind === "C") {
            // Robot 36: R-Y on even lines, B-Y on odd lines, each the average of the two lines it covers
            const pair = y0 % 2 ? y0 - 1 : y0;
            const a = rgbToYuv(...px(x, pair)), b = rgbToYuv(...px(x, Math.min(m.height - 1, pair + 1)));
            const k = y0 % 2 ? 2 : 1;
            v = (a[k] + b[k]) / 2;
          }
          row[x] = toHz(Math.max(0, Math.min(255, v)));
        }
        segs.push([ms, row]);
      }
    }
    const total = segs.reduce((a, s) => a + s[0], 0);
    const n = Math.ceil((total / 1000) * rate);
    const out = new Float32Array(n);
    let t0 = 0, ph = 0, i = 0;
    for (const [ms, f] of segs) {
      const s0 = (t0 / 1000) * rate, s1 = ((t0 + ms) / 1000) * rate;
      for (; i < s1 && i < n; i++) {
        const hz = typeof f === "number" ? f : f[Math.min(f.length - 1, Math.floor(((i - s0) / (s1 - s0)) * f.length))];
        ph += (2 * Math.PI * hz) / rate;
        if (ph > 2 * Math.PI) ph -= 2 * Math.PI;
        out[i] = amp * Math.sin(ph);
      }
      t0 += ms;
    }
    return out;
  }

  /* ---------- Decoder ---------- */

  /** FM discriminator: audio at FS -> the frequency of the strongest tone near 1100-2300 Hz, every sample. */
  class Demod {
    constructor() {
      const taps = 41, fc = 1200 / FS;
      this.h = new Float64Array(taps);
      let sum = 0;
      for (let i = 0; i < taps; i++) {
        const k = i - (taps - 1) / 2;
        const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
        this.h[i] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)));
        sum += this.h[i];
      }
      for (let i = 0; i < taps; i++) this.h[i] /= sum;
      this.re = new Float64Array(taps); this.im = new Float64Array(taps);
      this.pos = 0; this.n = 0; this.pr = 0; this.pi = 0;
      this.w = (2 * Math.PI * LEADER) / FS;
    }
    /** Samples in -> frequencies (Hz) out, one each. */
    process(x) {
      const out = new Float32Array(x.length);
      const { h, re, im } = this;
      const L = h.length;
      for (let k = 0; k < x.length; k++) {
        const a = this.w * this.n++;
        re[this.pos] = x[k] * Math.cos(a);
        im[this.pos] = -x[k] * Math.sin(a);
        this.pos = (this.pos + 1) % L;
        let r = 0, i = 0;
        for (let j = 0, q = this.pos; j < L; j++, q = (q + 1) % L) { r += h[j] * re[q]; i += h[j] * im[q]; }
        // angle between this and the last filtered sample = frequency offset from 1900 Hz
        const dr = r * this.pr + i * this.pi, di = i * this.pr - r * this.pi;
        this.pr = r; this.pi = i;
        out[k] = LEADER + (Math.atan2(di, dr) * FS) / (2 * Math.PI);
      }
      if (this.n > 1e9) this.n %= FS * 1000; // keep the phase counter small (a whole number of 1900 Hz cycles per second at FS)
      return out;
    }
  }

  const mean = (a, from, to) => {
    from = Math.max(0, Math.floor(from)); to = Math.min(a.length, Math.ceil(to));
    if (to <= from) return NaN;
    let s = 0;
    for (let i = from; i < to; i++) s += a[i];
    return s / (to - from);
  };
  const near = (v, hz, tol) => Math.abs(v - hz) <= tol;

  /**
   * The decoder: push audio (at FS) with push(); it calls back
   *   onStart({ mode, width, height, at })          a picture begins (VIS seen, or start() called)
   *   onLines({ from, to, rgba })                   lines from..to-1 are ready (RGBA, width x (to-from))
   *   onDone({ mode, width, height, rgba, slant, complete })   the picture is finished (or the signal was lost)
   */
  class Decoder {
    constructor({ onStart = () => {}, onLines = () => {}, onDone = () => {} } = {}) {
      this.cb = { onStart, onLines, onDone };
      this.demod = new Demod();
      this.freq = new Float32Array(FS * 1200); // up to 20 minutes kept, enough for the longest picture
      this.count = 0; // samples demodulated so far (index into a growing time line; freq is a ring)
      this.ms = []; this.msAcc = 0; this.msN = 0; // 1 ms averages, for the VIS search
      this.msBase = 0; // the ms index of this.ms[0]
      this.img = null;
      this.lastVis = -1e9;
    }

    /** Frequency at sample index i (from the start), or NaN if it's no longer kept. */
    f(i) {
      if (i < 0 || i >= this.count || i < this.count - this.freq.length) return NaN;
      return this.freq[i % this.freq.length];
    }
    fMean(from, to) {
      from = Math.floor(from); to = Math.ceil(to);
      let s = 0, n = 0;
      for (let i = from; i < to; i++) { const v = this.f(i); if (v === v) { s += v; n++; } }
      return n ? s / n : NaN;
    }

    push(samples) {
      const fr = this.demod.process(samples);
      const cap = this.freq.length;
      for (let k = 0; k < fr.length; k++) {
        // keep impossible values (noise between pulses) inside the band, so averages stay sensible
        const v = fr[k] < 900 ? 900 : fr[k] > 2600 ? 2600 : fr[k];
        this.freq[this.count % cap] = v;
        this.count++;
        this.msAcc += v; this.msN++;
        if (this.msN === FS / 1000) { this.ms.push(this.msAcc / this.msN); this.msAcc = 0; this.msN = 0; this.checkVis(); }
      }
      if (this.ms.length > 4000) { this.ms.splice(0, 2000); this.msBase += 2000; }
      if (this.img) this.render(false);
    }

    /** Look for a VIS header ending now: leader (1900), start bit, 8 bits, stop bit (each 30 ms, 1200 Hz framing). */
    checkVis() {
      const ms = this.ms, end = ms.length; // the newest ms is end-1
      const tb = end - 300; // where the start bit would begin
      if (tb < 260) return;
      const m = (a, b) => mean(ms, tb + a, tb + b);
      if (!near(m(5, 25), SYNC, 70) || !near(m(275, 295), SYNC, 70)) return;
      if (!near(m(-250, -15), LEADER, 70)) return;
      let code = 0, ones = 0;
      for (let k = 0; k < 8; k++) {
        const v = m(35 + 30 * k, 55 + 30 * k);
        if (!(v > 1000 && v < 1400)) return;
        const bit = v < 1200 ? 1 : 0;
        ones += bit;
        if (k < 7) code |= bit << k;
      }
      if (ones % 2) return;
      const md = BY_VIS.get(code);
      if (!md) return;
      const absMs = this.msBase + tb;
      if (absMs - this.lastVis < 500) return; // the same header seen again a millisecond later
      this.lastVis = absMs;
      // Line up exactly on the end of the stop bit (the first edge after it): the picture starts there.
      const start = Math.round(((absMs + 300) / 1000) * FS);
      this.begin(md, start);
    }

    /** Start a picture in a known mode now (when the VIS header was missed), or at sample `at`. */
    start(name, at = this.count) {
      const md = MODES[name];
      if (md) this.begin(md, at, true);
    }

    begin(md, at, manual = false) {
      if (this.img) this.finish(false);
      const scanS = (md.scanMs / 1000) * FS;
      this.img = {
        mode: md, at, manual, scanS, slope: scanS, offset: at + (md.firstSyncMs / 1000) * FS,
        syncs: [], done: 0, rgba: new Uint8ClampedArray(md.width * md.height * 4), lost: 0, chroma: null,
      };
      this.img.rgba.fill(0);
      for (let i = 3; i < this.img.rgba.length; i += 4) this.img.rgba[i] = 255;
      this.cb.onStart({ mode: md.name, width: md.width, height: md.height, at, manual });
    }

    /** The sync pulse of scan k: where it really is (sample index), or null if there's none near where it should be. */
    findSync(k) {
      const im = this.img, md = im.mode;
      if (md.syncAt < 0) return null;
      const w = Math.round((md.syncMs / 1000) * FS);
      const expect = im.offset + k * im.slope + (md.syncAt / 1000) * FS;
      // Search ±12 ms (or 2 % of a line) of where it should be; started by hand, the first few could be anywhere in the line.
      const span = im.manual && im.syncs.length < 2 ? Math.round(im.slope / 2)
        : Math.max(Math.round(0.012 * FS), Math.round(im.slope * 0.02));
      if (expect + span + w >= this.count) return undefined; // not heard yet
      let best = Infinity, at = -1;
      let s = 0;
      const a0 = Math.round(expect - span);
      for (let i = a0; i < a0 + w; i++) s += this.f(i) || 2000;
      for (let i = a0; i <= expect + span; i++) {
        if (s < best) { best = s; at = i; }
        s += (this.f(i + w) || 2000) - (this.f(i) || 2000);
      }
      const avg = best / w;
      return avg < 1350 ? at : null;
    }

    /** Fit a straight line through the syncs found (scan number -> sample), ignoring ones that don't fit. */
    fit() {
      const im = this.img;
      let pts = im.syncs;
      if (pts.length < 4) return;
      for (let round = 0; round < 3; round++) {
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
        for (const [k, y] of pts) { n++; sx += k; sy += y; sxx += k * k; sxy += k * y; }
        const d = n * sxx - sx * sx;
        if (n < 4 || d === 0) return;
        const slope = (n * sxy - sx * sy) / d;
        const icpt = (sy - slope * sx) / n;
        // a sound card can be off by a few hundred ppm, no more
        if (Math.abs(slope / im.scanS - 1) > 0.01) return;
        im.slope = slope;
        im.offset = icpt - (im.mode.syncAt / 1000) * FS;
        const tol = 0.0015 * FS;
        const kept = pts.filter(([k, y]) => Math.abs(y - (icpt + slope * k)) <= tol);
        if (kept.length === pts.length || kept.length < 4) break;
        pts = kept;
      }
    }

    /** Values (0-255) of one channel across a scan: `fromMs` into the scan, `ms` long, `width` pixels. */
    channel(k, fromMs, ms, width) {
      const im = this.img;
      const s0 = im.offset + k * im.slope + (fromMs / 1000) * FS * (im.slope / im.scanS);
      const len = (ms / 1000) * FS * (im.slope / im.scanS);
      const out = new Float64Array(width);
      for (let x = 0; x < width; x++) {
        const a = s0 + (x / width) * len, b = s0 + ((x + 1) / width) * len;
        // the middle of each pixel (the edges blur into the neighbours)
        const c = (a + b) / 2, h = Math.max(0.5, (b - a) * 0.35);
        out[x] = toLevel(this.fMean(c - h, c + h + 1));
      }
      return out;
    }

    /** Draw the scans that have arrived. `final`: the picture has ended, so draw all of it again with the best fit. */
    render(final) {
      const im = this.img, md = im.mode;
      // syncs heard so far
      while (true) {
        const k = im.syncs.length ? Math.max(im.syncs[im.syncs.length - 1][0] + 1, im.nextSync || 0) : im.nextSync || 0;
        if (k >= md.scans) break;
        const s = this.findSync(k);
        if (s === undefined) break;
        im.nextSync = k + 1;
        if (s !== null) {
          const syncOff = (md.syncAt / 1000) * FS;
          // Started by hand: the first sync found tells us where the lines really are...
          if (im.manual && !im.syncs.length) im.offset = s - syncOff - k * im.slope;
          // ...but only if the next one is a whole number of lines after it. If not, the first wasn't a line's
          // sync (Scottie's extra one before the first line, say): start again from this one, as line 0.
          if (im.manual && im.syncs.length === 1) {
            const [k0, s0] = im.syncs[0];
            const lines = Math.round((s - s0) / im.slope);
            if (lines < 1 || Math.abs(s - s0 - lines * im.slope) > 0.02 * im.slope) {
              im.syncs = [[0, s]]; im.offset = s - syncOff; im.nextSync = 1; im.done = 0; im.lost = 0;
              continue;
            }
            im.syncs.push([k0 + lines, s]); im.nextSync = k0 + lines + 1; im.lost = 0; this.fit();
            continue;
          }
          im.syncs.push([k, s]); im.lost = 0; this.fit();
        } else im.lost++;
      }
      const from = final ? 0 : im.done;
      let k = from;
      for (; k < md.scans; k++) {
        const end = im.offset + (k + 1) * im.slope;
        if (!final && end + FS * 0.02 > this.count) break;
        this.drawScan(k);
      }
      if (k > im.done || final) {
        const y0 = from * md.linesPerScan, y1 = Math.min(md.height, k * md.linesPerScan);
        if (y1 > y0) this.cb.onLines({ from: y0, to: y1, rgba: im.rgba.slice(y0 * md.width * 4, y1 * md.width * 4), final });
        im.done = k;
      }
      if (!final && (im.done >= md.scans || im.lost >= 20)) this.finish(im.done >= md.scans);
    }

    drawScan(k) {
      const im = this.img, md = im.mode, W = md.width;
      const vals = {};
      let at = 0;
      for (const [kind, ms] of md.parts) {
        if (!["sync", "tone", "sep"].includes(kind)) vals[kind] = this.channel(k, at, ms, W);
        if (kind === "sep") vals.sepHz = this.fMean(im.offset + k * im.slope + (at / 1000) * FS, im.offset + k * im.slope + ((at + ms) / 1000) * FS);
        at += ms;
      }
      const put = (y, x, rgb) => { const i = (y * W + x) * 4; im.rgba[i] = rgb[0]; im.rgba[i + 1] = rgb[1]; im.rgba[i + 2] = rgb[2]; };
      const y0 = k * md.linesPerScan;
      if (vals.R && vals.G && vals.B) {
        for (let x = 0; x < W; x++) put(y0, x, [vals.R[x], vals.G[x], vals.B[x]]);
      } else if (vals.Y2) {
        for (let x = 0; x < W; x++) { put(y0, x, yuvToRgb(vals.Y[x], vals.V[x], vals.U[x])); put(y0 + 1, x, yuvToRgb(vals.Y2[x], vals.V[x], vals.U[x])); }
      } else if (vals.U && vals.V) {
        for (let x = 0; x < W; x++) put(y0, x, yuvToRgb(vals.Y[x], vals.V[x], vals.U[x]));
      } else if (vals.C) {
        // Robot 36: this line's colour difference (which one: the separator tone says), and the other from the
        // neighbouring line. Draw this line now with what we have, and redraw the pair when both are in.
        const isU = vals.sepHz === vals.sepHz ? vals.sepHz > 1900 : y0 % 2 === 1;
        if (!im.chroma) im.chroma = {};
        im.chroma[y0] = { Y: vals.Y, C: vals.C, isU };
        const pair = y0 % 2 ? y0 - 1 : y0 + 1;
        const other = im.chroma[pair];
        for (const y of other ? [y0, pair] : [y0]) {
          const me = im.chroma[y];
          let U = me.isU ? me.C : other && !other.isU ? null : null, V = !me.isU ? me.C : null;
          if (other) { if (other.isU) U = other.C; else V = other.C; }
          for (let x = 0; x < W; x++) put(y, x, yuvToRgb(me.Y[x], V ? V[x] : 128, U ? U[x] : 128));
        }
      }
    }

    /** The picture is over: draw it once more with the final fit, and hand it over. */
    finish(complete) {
      const im = this.img;
      if (!im) return;
      this.render(true);
      const md = im.mode;
      const ppm = Math.round((im.slope / im.scanS - 1) * 1e6);
      this.img = null;
      this.cb.onDone({ mode: md.name, width: md.width, height: md.height, rgba: im.rgba, slant: ppm, complete, lines: Math.min(md.height, im.done * md.linesPerScan) });
    }

    /** Stop receiving the picture now (keeps what's arrived). */
    stop() { if (this.img) this.finish(false); }
  }

  return { FS, MODES, BY_VIS, seconds, encode, visTones, yuvToRgb, rgbToYuv, Demod, Decoder };
});
