/* HamShack by M0GLP & M3VRV: the 3D band scope. The live band from the RTL-SDR as a terrain: left to right is the
 * band (the same span as the band scope above it), front to back is time (the newest row at the front, older rows
 * fading away behind), and the height is how far each signal stands above the noise. The tuned frequency is a bright
 * line on the front edge. Plain Canvas 2D, no libraries. The maths (resampling, heights, projection, colours, labels,
 * the row buffer) has no page in it, so Node can test it; RfScope3DView only needs a canvas.
 * Receive only: it draws what the receiver hears and never tunes, transmits or touches power. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RfScope3D = factory();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /** dB above the noise as a height, 0 (the floor) to 1 (`range` dB up). NaN (outside what the receiver sees) is -1. */
  function heightOf(db, range) {
    if (Number.isNaN(db)) return -1;
    return clamp((db + 3) / Math.max(10, range), 0, 1);
  }

  /** `cols` values from a spectrum of any length: the loudest bin in each column, so narrow signals aren't lost.
   *  A column made only of NaN (not seen) stays NaN. */
  function resample(spec, cols) {
    const n = spec.length, out = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const a = Math.floor((c * n) / cols), b = Math.max(a + 1, Math.floor(((c + 1) * n) / cols));
      let m = NaN;
      for (let i = a; i < b && i < n; i++) if (!Number.isNaN(spec[i]) && !(spec[i] <= m)) m = spec[i];
      out[c] = m;
    }
    return out;
  }

  /** Where a frequency sits across the span, 0 to 1 (outside the span is clamped to the edge). */
  const xOf = (f, lo, hi) => clamp((f - lo) / (hi - lo), 0, 1);

  /** Tidy frequency labels for a span in MHz: about `want` of them at a round step. */
  function freqTicks(lo, hi, want = 6) {
    const span = hi - lo;
    if (!(span > 0)) return [];
    const raw = span / want, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
    const out = [];
    for (let f = Math.ceil(lo / step - 1e-9) * step; f <= hi + 1e-9; f += step) out.push(Math.round(f * 1e6) / 1e6);
    return out;
  }
  /** A label for a tick: kHz across a narrow span, MHz with as many decimals as needed otherwise. */
  function tickLabel(f, lo, hi) {
    const span = hi - lo;
    if (span < 0.05) return String(Math.round(f * 1000 * 10) / 10);
    const d = span < 0.5 ? 3 : span < 5 ? 2 : 1;
    return f.toFixed(d).replace(/0+$/, "").replace(/\.$/, "");
  }

  /** cam: { left, right (the front edge, px), frontY, horizonY, heightPx, k }. x 0-1 across, y 0-1 up, z 0 (front) to 1 (oldest). */
  function project(cam, x, y, z) {
    const s = 1 / (1 + cam.k * z);
    const baseY = cam.horizonY + (cam.frontY - cam.horizonY) * s;
    return { x: (cam.left + cam.right) / 2 + (x - 0.5) * (cam.right - cam.left) * s, y: baseY - y * cam.heightPx * s, s };
  }

  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /** "#rgb", "#rrggbb" or "rgb(r, g, b)" as [r, g, b]; anything else gives the fallback. */
  function parseColor(s, fallback) {
    const v = String(s || "").trim();
    const h = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (h) {
      const x = h[1].length === 3 ? h[1].replace(/./g, "$&$&") : h[1];
      return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
    }
    const m = v.match(/\d+(\.\d+)?/g);
    return /^rgba?\(/i.test(v) && m && m.length >= 3 ? m.slice(0, 3).map(Number) : fallback;
  }
  function rampColor(stops, t) {
    const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    return mix(stops[i], stops[i + 1], x - i);
  }
  /** How much of the background a row shows through: 0 at the front, up to `max` at the oldest. */
  const depthFade = (i, n, max = 0.82) => (n > 1 ? max * Math.pow(clamp(i / (n - 1), 0, 1), 1.1) : 0);
  const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
  const DEFAULT_THEME = { bg: [11, 26, 33], cool: [69, 224, 245], warm: [255, 181, 71], text: [230, 238, 242], muted: [140, 160, 170] };

  /** The rows: a ring, the newest first. Heights 0-1, or -1 where the receiver doesn't see. */
  class RowRing {
    constructor(rows, cols) { this.rows = rows; this.cols = cols; this.data = new Float32Array(rows * cols); this.times = new Float64Array(rows); this.head = 0; this.count = 0; }
    push(heights, t) {
      this.head = (this.head + 1) % this.rows;
      this.data.set(heights.subarray ? heights.subarray(0, this.cols) : heights.slice(0, this.cols), this.head * this.cols);
      this.times[this.head] = t || 0;
      if (this.count < this.rows) this.count++;
    }
    get(i) { const r = (this.head - i + this.rows * 2) % this.rows, o = r * this.cols; return this.data.subarray(o, o + this.cols); }
    timeOf(i) { return this.times[(this.head - i + this.rows * 2) % this.rows]; }
    clear() { this.data.fill(0); this.count = 0; }
  }

  class RfScope3DView {
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.g = canvas.getContext("2d");
      this.rows = opts.rows || 52;
      this.maxCols = opts.cols || 160;
      this.cols = this.maxCols;
      this.ring = new RowRing(this.rows, this.cols);
      this.span = null; // [lo, hi] MHz
      this.marker = null; // the tuned frequency, MHz
      this.geo = null;
      this.grads = null;
    }

    readTheme() {
      const css = getComputedStyle(document.documentElement), get = (n, d) => parseColor(css.getPropertyValue(n), d);
      this.theme = { bg: get("--wfbg", DEFAULT_THEME.bg), cool: get("--cool", DEFAULT_THEME.cool), warm: get("--warm", DEFAULT_THEME.warm),
        text: get("--text", DEFAULT_THEME.text), muted: get("--muted", DEFAULT_THEME.muted) };
    }

    /** A new span (MHz) starts a fresh terrain: old rows were a different stretch of the band. */
    setSpan(lo, hi) {
      if (this.span && this.span[0] === lo && this.span[1] === hi) return;
      this.span = [lo, hi];
      this.ring.clear();
    }

    /** One spectrum (dB above the noise per bin, NaN where not seen) becomes the newest row. */
    push(spec, range, t) {
      const cols = this.cols, r = resample(spec, cols), h = new Float32Array(cols);
      for (let c = 0; c < cols; c++) h[c] = heightOf(r[c], range);
      this.ring.push(h, t);
    }

    resize() {
      const cv = this.cv, W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!W || !H) { this.geo = null; return false; }
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      // About one column per 5 px, so a phone isn't asked to draw more than it can show
      const cols = clamp(Math.round(W / 5), 48, this.maxCols);
      if (cols !== this.cols) { this.cols = cols; this.ring = new RowRing(this.rows, cols); }
      this.readTheme();
      const cam = { left: 40, right: W - 12, frontY: H - 24, horizonY: 6, heightPx: Math.max(40, (H - 24) * 0.55), k: 1.3 };
      const xs = [], base = [], sc = [];
      for (let i = 0; i < this.rows; i++) {
        const z = i / (this.rows - 1), a = new Float32Array(cols);
        for (let c = 0; c < cols; c++) a[c] = project(cam, c / (cols - 1), 0, z).x;
        const p = project(cam, 0, 0, z), q = project(cam, 0, 1, z);
        xs.push(a); base.push(p.y); sc.push(p.y - q.y);
      }
      this.geo = { W, H, dpr, cam, xs, base, sc };
      this.grads = null;
      return true;
    }

    makeGradients() {
      const { base, sc } = this.geo, g = this.g, th = this.theme;
      const stops = [mix(th.bg, th.cool, 0.25), th.cool, th.warm, [255, 255, 255]];
      const fill = [], line = [];
      for (let i = 0; i < this.rows; i++) {
        const f = depthFade(i, this.rows);
        const gf = g.createLinearGradient(0, base[i], 0, base[i] - sc[i]), gl = g.createLinearGradient(0, base[i], 0, base[i] - sc[i]);
        for (const t of [0, 0.33, 0.66, 1]) {
          const c = rampColor(stops, t);
          gf.addColorStop(t, rgb(mix(mix(th.bg, c, 0.35 + 0.35 * t), th.bg, f)));
          gl.addColorStop(t, rgb(mix(c, th.bg, f)));
        }
        fill.push(gf); line.push(gl);
      }
      this.grads = { fill, line };
    }

    draw(now) {
      if (!this.geo && !this.resize()) return;
      if (!this.grads) this.makeGradients();
      const { W, H, dpr, cam, xs, base, sc } = this.geo, g = this.g, th = this.theme, cols = this.cols;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      const [lo, hi] = this.span || [0, 1];
      const ticks = this.span ? freqTicks(lo, hi) : [];
      // Floor lines, front to back, at each frequency label
      g.lineWidth = 1; g.strokeStyle = rgb(th.muted, 0.18);
      g.beginPath();
      for (const f of ticks) { const x = xOf(f, lo, hi), a = project(cam, x, 0, 0), b = project(cam, x, 0, 1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
      g.stroke();
      // The rows, back to front, so a nearer row hides a farther one. Where the receiver can't see, the row lies flat and grey.
      g.lineJoin = "round"; g.lineWidth = 1.2;
      for (let i = this.ring.count - 1; i >= 0; i--) {
        const h = this.ring.get(i), x = xs[i], b = base[i], k = sc[i];
        g.beginPath();
        g.moveTo(x[0], b);
        for (let c = 0; c < cols; c++) g.lineTo(x[c], b - Math.max(0, h[c]) * k);
        g.lineTo(x[cols - 1], b);
        g.closePath();
        g.fillStyle = this.grads.fill[i]; g.fill();
        g.strokeStyle = this.grads.line[i]; g.stroke();
      }
      this.drawFront(g, cam, th, lo, hi, ticks, now);
    }

    drawFront(g, cam, th, lo, hi, ticks, now) {
      const y0 = cam.frontY, xAt = (f) => cam.left + xOf(f, lo, hi) * (cam.right - cam.left);
      g.font = "10.5px Barlow, system-ui, sans-serif"; g.textBaseline = "alphabetic";
      g.fillStyle = rgb(th.muted); g.strokeStyle = rgb(th.muted, 0.5); g.lineWidth = 1;
      g.textAlign = "center";
      g.beginPath();
      for (const f of ticks) { const x = xAt(f); g.moveTo(x, y0); g.lineTo(x, y0 + 4); g.fillText(tickLabel(f, lo, hi), x, y0 + 16); }
      g.stroke();
      g.textAlign = "right";
      g.fillText(hi - lo < 0.05 ? "kHz" : "MHz", cam.left - 13, y0 + 16);
      // The level scale up the left side
      g.textAlign = "right";
      for (const t of [0, 0.5, 1]) {
        const y = y0 - t * cam.heightPx;
        g.beginPath(); g.moveTo(cam.left - 3, y); g.lineTo(cam.left, y); g.stroke();
      }
      g.fillText("loud", cam.left - 5, y0 - cam.heightPx + 4);
      g.fillText("noise", cam.left - 5, y0 - 2);
      // How far back the oldest row is
      if (this.ring.count > 1 && now) {
        const secs = (now - this.ring.timeOf(this.ring.count - 1)) / 1000;
        g.fillStyle = rgb(th.muted, 0.85);
        g.fillText(`back: ${secs.toFixed(1)} s ago`, cam.right, cam.horizonY + 10);
      }
      // The tuned frequency: a glowing line from the front edge into the distance
      if (this.marker != null && this.marker >= lo && this.marker <= hi) {
        const x = xOf(this.marker, lo, hi), a = project(cam, x, 0, 0), b = project(cam, x, 0, 1);
        g.lineCap = "round";
        for (const [w, al] of [[6, 0.15], [2.5, 0.45], [1.2, 1]]) {
          g.strokeStyle = rgb(al === 1 ? [255, 255, 255] : th.warm, al); g.lineWidth = w;
          g.beginPath(); g.moveTo(a.x, a.y + 4); g.lineTo(b.x, b.y); g.stroke();
        }
        g.fillStyle = rgb(th.warm); g.textAlign = "center";
        g.fillText("tuned", clamp(a.x, cam.left + 14, cam.right - 14), y0 - cam.heightPx - 2 > cam.horizonY + 22 ? y0 - cam.heightPx - 2 : cam.horizonY + 24);
      }
    }
  }

  return { heightOf, resample, xOf, freqTicks, tickLabel, project, parseColor, rampColor, depthFade, RowRing, RfScope3DView, DEFAULT_THEME };
});
