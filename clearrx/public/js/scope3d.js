/* ClearRX by M3VRV: the 3D spectrum scope. A perspective terrain: left to right is frequency (log scale, 50 Hz to 6 kHz,
 * like the graphic EQ), front to back is time (the newest row at the front, older rows fading away behind it), and the
 * height is the level in dB. The graphic EQ's response is drawn as a glowing line on the front edge.
 * Plain Canvas 2D, no libraries. The pure maths (frequency mapping, bins to columns, projection, colours, the row buffer)
 * has no page in it, so Node can test it; the drawing (Scope3DView) only needs a canvas.
 * Works in the browser (globalThis.Scope3D) and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Scope3D = factory();
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const F_MIN = 50, F_MAX = 6000; // Hz: the edges of the scope (the EQ runs 100 Hz to 5 kHz)
  const DB_FLOOR = -100, DB_CEIL = -20; // dBFS: the bottom and the top of the terrain
  const EQ_SPAN = 12; // dB, up or down, the EQ curve's range (the same as the EQ's sliders)
  const LABELS = [100, 200, 500, 1000, 2000, 5000];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- Frequency and level ---------- */
  /** 0 (F_MIN) to 1 (F_MAX) for a frequency, on a log scale (so each octave is the same width). */
  const freqToX = (f) => clamp(Math.log(Math.max(f, 1e-9) / F_MIN) / Math.log(F_MAX / F_MIN), 0, 1);
  /** The frequency at a place across the scope (0 to 1). */
  const xToFreq = (x) => F_MIN * Math.pow(F_MAX / F_MIN, clamp(x, 0, 1));
  /** 0 (floor) to 1 (ceiling) for a level in dB; a silent bin (-Infinity, NaN) is the floor. */
  const dbToHeight = (db) => (db > DB_FLOOR ? Math.min(1, (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)) : 0);

  /** For each of `cols` columns (log-spaced from F_MIN to F_MAX), which analyser bins feed it. A column narrower than one bin
   *  (the low end) is interpolated between two neighbouring bins; a wider one takes the loudest bin in its range. */
  function makeColumnMap(sampleRate, fftSize, cols) {
    const hz = sampleRate / fftSize, nb = fftSize / 2;
    const lo = new Int32Array(cols), hi = new Int32Array(cols), fr = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      const f0 = xToFreq((c - 0.5) / (cols - 1)), f1 = xToFreq((c + 0.5) / (cols - 1));
      const b0 = f0 / hz, b1 = f1 / hz;
      if (b1 - b0 < 1) {
        const mid = Math.min(nb - 2, (b0 + b1) / 2), i = Math.floor(mid);
        lo[c] = i; hi[c] = i; fr[c] = mid - i;
      } else {
        lo[c] = clamp(Math.round(b0), 1, nb - 1); hi[c] = clamp(Math.round(b1), lo[c], nb - 1); fr[c] = -1;
      }
    }
    return { cols, sampleRate, fftSize, lo, hi, fr };
  }
  const fin = (v) => (v > -200 ? v : -200); // -Infinity and NaN become something that can be added up
  /** Fill `out` (cols dB values) from the analyser's bins (dB). */
  function applyColumnMap(map, bins, out) {
    for (let c = 0; c < map.cols; c++) {
      const a = map.lo[c], b = map.hi[c], f = map.fr[c];
      if (f >= 0) out[c] = fin(bins[a]) * (1 - f) + fin(bins[Math.min(a + 1, bins.length - 1)]) * f;
      else { let m = -200; for (let k = a; k <= b; k++) { const v = fin(bins[k]); if (v > m) m = v; } out[c] = m; }
    }
    return out;
  }
  /** The column nearest a frequency (where a band's marker goes). */
  const columnFor = (f, cols) => Math.round(freqToX(f) * (cols - 1));

  /* ---------- Perspective ---------- */
  /** cam: { left, right (the front edge, px), frontY (its baseline), horizonY (where it all ends in the distance), heightPx (a full-height peak at the front), k (how fast it shrinks) }.
   *  x: 0 to 1 across, y: 0 to 1 up, z: 0 (front) to 1 (the oldest row). Returns the screen point and the scale there. */
  function project(cam, x, y, z) {
    const s = 1 / (1 + cam.k * z);
    const baseY = cam.horizonY + (cam.frontY - cam.horizonY) * s;
    return { x: (cam.left + cam.right) / 2 + (x - 0.5) * (cam.right - cam.left) * s, y: baseY - y * cam.heightPx * s, s };
  }

  /* ---------- Colour ---------- */
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  /** "#rgb" or "#rrggbb" as [r, g, b]; anything else gives the fallback. */
  function parseColor(s, fallback) {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(s || "").trim());
    if (!m) return fallback;
    let h = m[1];
    if (h.length === 3) h = h.replace(/./g, "$&$&");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  /** A colour along a list of stops, t from 0 to 1. */
  function rampColor(stops, t) {
    const x = clamp(t, 0, 1) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
    return mix(stops[i], stops[i + 1], x - i);
  }
  /** How much of the background a row shows through: 0 at the front, rising to `max` at the oldest row. */
  const depthFade = (i, n, max = 0.82) => (n > 1 ? max * Math.pow(clamp(i / (n - 1), 0, 1), 1.1) : 0);
  const DEFAULT_THEME = { led: [69, 224, 245], amber: [255, 181, 71], hot: [255, 90, 78], bg: [11, 26, 33], text: [230, 238, 242], dim: [159, 178, 188] };
  /** The ramp from low to high: "after" runs the theme's blue, amber and red; "before" stays grey and white so the two can't be mixed up. */
  function rampStops(theme, kind) {
    const t = { ...DEFAULT_THEME, ...theme };
    return kind === "before"
      ? [mix(t.bg, t.dim, 0.3), t.dim, t.text, [255, 255, 255]]
      : [mix(t.bg, t.led, 0.25), t.led, t.amber, t.hot];
  }
  const rgb = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;

  /* ---------- The rows: a ring, the newest first ---------- */
  class RowRing {
    constructor(rows, cols) {
      this.rows = rows; this.cols = cols; this.data = new Float32Array(rows * cols); this.head = 0; this.count = 0;
    }
    /** Add a row of levels (dB) as the newest. */
    push(dbRow) {
      this.head = (this.head + 1) % this.rows;
      const o = this.head * this.cols;
      for (let c = 0; c < this.cols; c++) this.data[o + c] = dbToHeight(dbRow[c]);
      if (this.count < this.rows) this.count++;
    }
    /** Row i back in time (0 = the newest): heights 0 to 1. */
    get(i) { const o = ((this.head - i + this.rows * 2) % this.rows) * this.cols; return this.data.subarray(o, o + this.cols); }
    clear() { this.data.fill(0); this.count = 0; }
  }

  /* ---------- The drawing ---------- */
  class Scope3DView {
    /** opts: rows, cols, respFn(gains, f) (the EQ's response in dB: RxFx.eqResponseDb), bandFreqs (the EQ's ten centres). */
    constructor(canvas, opts = {}) {
      this.cv = canvas;
      this.g = canvas.getContext("2d");
      this.rows = opts.rows || 72;
      this.cols = opts.cols || 96;
      this.respFn = opts.respFn || (() => 0);
      this.bandFreqs = opts.bandFreqs || [];
      this.ring = new RowRing(this.rows, this.cols);
      this.dbRow = new Float32Array(this.cols);
      this.source = "after";
      this.secs = 0; // how far back the oldest row is, for the label
      this.peak = { f: 0, db: -120 };
      this.eqCurve = new Float32Array(this.cols);
      this.eqAt = new Float32Array(this.bandFreqs.length);
      this.eqKey = "";
      this.theme = null;
      this.geo = null;
      this.map = null;
      this.stats = { frames: 0, avgMs: 0, maxMs: 0, lastMs: 0 };
    }

    readTheme() {
      const css = getComputedStyle(document.documentElement), get = (n, d) => parseColor(css.getPropertyValue(n), d);
      this.theme = { led: get("--led", DEFAULT_THEME.led), amber: get("--amber", DEFAULT_THEME.amber), hot: get("--hot", DEFAULT_THEME.hot),
        bg: get("--scopebg", DEFAULT_THEME.bg), text: get("--text", DEFAULT_THEME.text), dim: get("--dim", DEFAULT_THEME.dim) };
    }

    setSource(kind) { if (kind !== this.source) { this.source = kind === "before" ? "before" : "after"; this.ring.clear(); this.grads = null; } }

    /** The EQ: ten gains, and whether it is switched on (off is a flat line). The response is worked out only when it changes. */
    setEq(gains, on) {
      const g = on ? gains : null, key = g ? g.join(",") : "off";
      if (key === this.eqKey) return false;
      this.eqKey = key;
      const z = g || new Array(this.bandFreqs.length).fill(0);
      for (let c = 0; c < this.cols; c++) this.eqCurve[c] = g ? this.respFn(z, xToFreq(c / (this.cols - 1))) : 0;
      for (let i = 0; i < this.bandFreqs.length; i++) this.eqAt[i] = g ? this.respFn(z, this.bandFreqs[i]) : 0;
      return true;
    }

    /** New analyser data (dB per bin): becomes the newest row. */
    pushBins(bins, sampleRate, fftSize, rowSecs) {
      if (!this.map || this.map.sampleRate !== sampleRate || this.map.fftSize !== fftSize) this.map = makeColumnMap(sampleRate, fftSize, this.cols);
      applyColumnMap(this.map, bins, this.dbRow);
      this.ring.push(this.dbRow);
      this.secs = this.rows * rowSecs;
      let m = -200, mc = 0;
      for (let c = 0; c < this.cols; c++) if (this.dbRow[c] > m) { m = this.dbRow[c]; mc = c; }
      this.peak = { f: xToFreq(mc / (this.cols - 1)), db: m };
    }

    /** Size the canvas for the screen's pixels and work out where every row goes (done again only when the size changes). */
    resize() {
      const cv = this.cv, W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!W || !H) { this.geo = null; return false; }
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      this.readTheme();
      const cam = { left: 44, right: W - 16, frontY: H - 26, horizonY: 8, heightPx: Math.max(40, (H - 26) * 0.52), k: 1.3 };
      const xs = [], base = [], sc = [];
      for (let i = 0; i < this.rows; i++) {
        const z = i / (this.rows - 1), a = new Float32Array(this.cols);
        for (let c = 0; c < this.cols; c++) a[c] = project(cam, c / (this.cols - 1), 0, z).x;
        const p = project(cam, 0, 0, z), q = project(cam, 0, 1, z);
        xs.push(a); base.push(p.y); sc.push(p.y - q.y);
      }
      this.geo = { W, H, dpr, cam, xs, base, sc };
      this.grads = null;
      return true;
    }

    /** The gradients (height colours) for each row, made once per size and per source. */
    makeGradients() {
      const { cam, base, sc } = this.geo, g = this.g, stops = rampStops(this.theme, this.source), bg = this.theme.bg;
      const fill = [], line = [];
      for (let i = 0; i < this.rows; i++) {
        const f = depthFade(i, this.rows);
        const gf = g.createLinearGradient(0, base[i], 0, base[i] - sc[i]), gl = g.createLinearGradient(0, base[i], 0, base[i] - sc[i]);
        for (const t of [0, 0.25, 0.5, 0.75, 1]) {
          const c = rampColor(stops, t);
          gf.addColorStop(t, rgb(mix(mix(bg, c, 0.4 + 0.3 * t), bg, f)));
          gl.addColorStop(t, rgb(mix(mix(c, [255, 255, 255], t > 0.85 ? 0.25 : 0), bg, f)));
        }
        fill.push(gf); line.push(gl);
      }
      this.grads = { fill, line };
      return cam;
    }

    /** Draw it all, and time it. */
    draw() {
      if (!this.geo && !this.resize()) return;
      if (!this.grads) this.makeGradients();
      const t0 = performance.now();
      const { W, H, dpr, cam, xs, base, sc } = this.geo, g = this.g, th = this.theme, cols = this.cols;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      // The floor's lines: one for each frequency label, running from the front to the back
      g.lineWidth = 1; g.strokeStyle = rgb(th.dim, 0.16);
      g.beginPath();
      for (const f of LABELS) { const x = freqToX(f), a = project(cam, x, 0, 0), b = project(cam, x, 0, 1); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); }
      g.stroke();
      // The rows, from the back to the front: a nearer row hides a farther one
      g.lineJoin = "round"; g.lineWidth = 1.3;
      for (let i = this.ring.count - 1; i >= 0; i--) {
        const h = this.ring.get(i), x = xs[i], b = base[i], k = sc[i];
        g.beginPath();
        g.moveTo(x[0], b);
        for (let c = 0; c < cols; c++) g.lineTo(x[c], b - h[c] * k);
        g.lineTo(x[cols - 1], b);
        g.closePath();
        g.fillStyle = this.grads.fill[i]; g.fill();
        g.strokeStyle = this.grads.line[i]; g.stroke();
      }
      this.drawFront(g, cam, th);
      const ms = performance.now() - t0, st = this.stats;
      st.frames++; st.lastMs = ms; st.avgMs = st.frames === 1 ? ms : st.avgMs * 0.95 + ms * 0.05; if (ms > st.maxMs) st.maxMs = ms;
    }

    /** The front edge: frequency labels, the level scale, the EQ's curve (glowing) and the ten band markers. */
    drawFront(g, cam, th) {
      const cols = this.cols, y0 = cam.frontY, hp = cam.heightPx;
      const yEq = (db) => y0 - hp * (0.3 + (0.28 * clamp(db, -EQ_SPAN, EQ_SPAN)) / EQ_SPAN);
      const xAt = (c) => cam.left + (c / (cols - 1)) * (cam.right - cam.left);
      g.font = "10.5px system-ui, sans-serif"; g.textBaseline = "alphabetic";
      // Frequencies along the front, and the level scale up the left side
      g.fillStyle = rgb(th.dim); g.strokeStyle = rgb(th.dim, 0.4); g.lineWidth = 1;
      g.textAlign = "center";
      g.beginPath();
      for (const f of LABELS) {
        const x = cam.left + freqToX(f) * (cam.right - cam.left);
        g.moveTo(x, y0); g.lineTo(x, y0 + 4);
        g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x, y0 + 16);
      }
      g.stroke();
      g.textAlign = "right";
      for (const db of [-20, -60, -100]) {
        const y = y0 - dbToHeight(db) * hp;
        g.fillText(db === -100 ? "-100 dB" : String(db), cam.left - 6, y + 3);
        g.beginPath(); g.moveTo(cam.left - 3, y); g.lineTo(cam.left, y); g.stroke();
      }
      g.textAlign = "right"; g.fillStyle = rgb(th.dim, 0.8);
      g.fillText(`back: ${this.secs ? this.secs.toFixed(1) : "0"} s ago`, cam.right, cam.horizonY + 10);
      // The 0 dB line of the EQ, and its scale on the right
      g.setLineDash([3, 4]); g.strokeStyle = rgb(th.dim, 0.5);
      g.beginPath(); g.moveTo(cam.left, yEq(0)); g.lineTo(cam.right, yEq(0)); g.stroke();
      g.setLineDash([]);
      g.textAlign = "left"; g.fillStyle = rgb(th.text, 0.75);
      g.fillText("EQ +12", cam.right - 38, yEq(EQ_SPAN) - 3);
      g.fillText("-12", cam.right - 24, yEq(-EQ_SPAN) + 11);
      // The EQ's curve: a wide soft line, a narrower one and a bright thin one make the glow
      g.lineJoin = "round"; g.lineCap = "round";
      const curve = () => { g.beginPath(); for (let c = 0; c < cols; c++) { const x = xAt(c), y = yEq(this.eqCurve[c]); c ? g.lineTo(x, y) : g.moveTo(x, y); } };
      curve(); g.strokeStyle = rgb(th.led, 0.14); g.lineWidth = 9; g.stroke();
      curve(); g.strokeStyle = rgb(th.led, 0.35); g.lineWidth = 4.5; g.stroke();
      curve(); g.strokeStyle = rgb([255, 255, 255], 0.95); g.lineWidth = 1.7; g.stroke();
      // The ten bands: a tick under each, and a dot on the curve
      g.fillStyle = rgb(th.text); g.strokeStyle = rgb(th.led, 0.9); g.lineWidth = 1.4;
      for (let i = 0; i < this.bandFreqs.length; i++) {
        const x = cam.left + freqToX(this.bandFreqs[i]) * (cam.right - cam.left), y = yEq(this.eqAt[i]);
        g.beginPath(); g.moveTo(x, y0 - 3); g.lineTo(x, y0 + 3); g.stroke();
        g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fill(); g.stroke();
      }
    }
  }

  return { F_MIN, F_MAX, DB_FLOOR, DB_CEIL, EQ_SPAN, LABELS, freqToX, xToFreq, dbToHeight, makeColumnMap, applyColumnMap, columnFor,
    project, mix, parseColor, rampColor, rampStops, depthFade, rgb, DEFAULT_THEME, RowRing, Scope3DView };
});
