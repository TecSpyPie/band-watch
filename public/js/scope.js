/* Band scope: spectrum, band plan strip and waterfall: live from your RTL-SDR,
   or drawn from spot reports when no receiver is running. */
"use strict";

/* ===================== Band scope ===================== */

// Strip colours for each band plan segment type: [colour variable, how much of it].
const STRIP = { cw: ["--muted", 0.35], narrow: ["--cool", 0.45], unatt: ["--cool", 0.3], digi: ["--cool", 0.3], all: ["--warm", 0.4], beacon: ["--text", 0.5], fm: ["--warm", 0.65], rptin: ["--warm", 0.45], rptout: ["--warm", 0.8], dv: ["--cool", 0.6], sat: ["--warm", 0.2], none: ["--wfbg", 0] };

function spanLimits(b, span) {
  if (app.zoom && app.zoom.b === b) return [app.zoom.lo, app.zoom.hi];
  if (span === "cw") {
    const segs = SEG[b];
    let i = 0;
    while (i + 1 < segs.length && segs[i + 1][0] === "cw") i++;
    return segs[0][0] === "cw" ? [segs[0][1], segs[i][2]] : EDGE[b];
  }
  if (span === "digi") return DIGI[b];
  if (span === "ft8") return [FT8[b], FT8[b] + 0.003];
  return EDGE[b];
}

function renderScopeChips() {
  $("scopeBands").innerHTML = BANDS.map((b) => `<button type="button" data-b="${b}" aria-pressed="${b === app.sel}">${bandName(b)}</button>`).join("");
  $("scopeBands").querySelectorAll("button").forEach((btn) => { btn.onclick = () => selectBand(btn.dataset.b); });
  const zoomed = app.zoom && app.zoom.b === app.sel;
  $("scopeSpan").innerHTML = SPANS.map(([k, l]) => `<button type="button" data-s="${k}" aria-pressed="${!zoomed && k === app.span}">${l}</button>`).join("") +
    (zoomed ? `<button type="button" data-s="unzoom" aria-pressed="true" title="Back to the whole span">Zoomed · reset</button>` : "");
  $("scopeSpan").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      if (btn.dataset.s !== "unzoom") app.span = btn.dataset.s;
      app.zoom = null;
      app.cursor = app.pinned = null;
      renderScopeChips();
      drawScope();
    };
  });
}

function cssColor(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function rgb(v) {
  if (v[0] === "#") {
    if (v.length === 4) v = "#" + [...v.slice(1)].map((c) => c + c).join("");
    return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16));
  }
  const m = v.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [0, 0, 0];
}
function mix(a, b, t) { return a.map((x, i) => Math.round(x + (b[i] - x) * t)); }

let scope = null; // last drawn scope, used by the readout

/* ---------- Live scope (RTL-SDR) ---------- */

// "live": real spectrum and waterfall from the RTL-SDR whenever it's running; "spots": always from spot reports.
const liveScope = {
  src: (() => { try { return localStorage.getItem("bw-scope-src") === "spots" ? "spots" : "live"; } catch { return "live"; } })(),
  key: "", wf: null, rows: 0, floor: null, last: null, startedAt: 0,
};
const LIVE_ROWS = 240; // waterfall history kept, one row per update

/** Is the scope showing the receiver right now? */
function scopeIsLive() {
  return liveScope.src === "live" && typeof sdr !== "undefined" && sdr.running && Boolean(sdr.demod) && sdr.centre > 0;
}

/** What the dongle can see, in Hz: its sample rate around the tuned centre, less the filter edges
 *  and the DC spike at the centre. */
function liveCoverage() {
  const rate = sdr.demod.inRate;
  return { lo: sdr.centre - rate * 0.46, hi: sdr.centre + rate * 0.46, dc: sdr.centre, dcHalf: 1500, rate };
}

/** One spectrum across the scope's bins (dB, NaN where the receiver can't see). */
function liveSpectrum(loMHz, hiMHz, N) {
  const cov = liveCoverage();
  const binHz = ((hiMHz - loMHz) * 1e6) / N;
  const pairs = sdr.iqLen >> 1;
  let n = 2048;
  while (n < 32768 && cov.rate / n > binHz / 2) n *= 2; // at least two FFT bins per scope bin, if there are samples
  while (n > 2048 && n > pairs) n /= 2;
  if (pairs < n) return null;
  const dB = SdrDsp.spectrum(sdr.iq.subarray(sdr.iqLen - n * 2, sdr.iqLen), n);
  const start = cov.dc - cov.rate / 2; // Hz at FFT bin 0
  const hzPerBin = cov.rate / n;
  const out = new Float32Array(N).fill(NaN);
  for (let i = 0; i < N; i++) {
    const f0 = loMHz * 1e6 + i * binHz;
    const f1 = f0 + binHz;
    if (f1 < cov.lo || f0 > cov.hi) continue;
    let k0 = Math.floor((Math.max(f0, cov.lo) - start) / hzPerBin);
    let k1 = Math.floor((Math.min(f1, cov.hi) - start) / hzPerBin);
    k0 = Math.max(0, k0); k1 = Math.min(n - 1, Math.max(k0, k1));
    let v = -Infinity;
    for (let k = k0; k <= k1; k++) {
      if (Math.abs(start + (k + 0.5) * hzPerBin - cov.dc) < cov.dcHalf) continue;
      if (dB[k] > v) v = dB[k];
    }
    if (v > -Infinity) out[i] = v;
  }
  // Fill the DC gap from its neighbours so it doesn't look like a hole in the band.
  for (let i = 0; i < N; i++) {
    if (!Number.isNaN(out[i])) continue;
    const f = loMHz * 1e6 + (i + 0.5) * binHz;
    if (f < cov.lo || f > cov.hi) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && Number.isNaN(out[a])) a--;
    while (b < N && Number.isNaN(out[b])) b++;
    out[i] = a >= 0 && b < N ? (out[a] + out[b]) / 2 : a >= 0 ? out[a] : b < N ? out[b] : NaN;
  }
  return out;
}

/** Called by the receiver about 12 times a second: add a waterfall row and redraw. */
function scopeLiveFeed() {
  if (!scopeIsLive() || !scope || !scope.geom) return;
  const cv = $("scope");
  if (!cv || cv.offsetParent === null) return;
  const { lo, hi, N } = scope.geom;
  const spec = liveSpectrum(lo, hi, N);
  if (!spec) return;
  // Noise floor: the quieter part of what the receiver sees, followed slowly.
  const seen = Array.from(spec).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (!seen.length) { liveScope.last = spec; drawScope(); return; }
  const floor = seen[Math.floor(seen.length * 0.2)];
  liveScope.floor = liveScope.floor == null ? floor : liveScope.floor + 0.08 * (floor - liveScope.floor);
  const rel = spec.map((v) => (Number.isNaN(v) ? NaN : v - liveScope.floor));
  // The trace is lightly averaged so the noise doesn't jump about; the waterfall gets each row as it is.
  const prev = liveScope.last;
  liveScope.last = prev && prev.length === N && liveScope.key === `${lo}|${hi}|${N}`
    ? rel.map((v, i) => (Number.isNaN(v) || Number.isNaN(prev[i]) ? v : Math.max(v, prev[i] + 0.45 * (v - prev[i]))))
    : rel;
  liveAddRow(rel, N);
  drawScope();
}

/** Waterfall rows are kept in frequency order across the scope, so they stay put when the receiver retunes. */
function liveAddRow(rel, N) {
  const key = `${scope.geom.lo}|${scope.geom.hi}|${N}`;
  if (!liveScope.wf || liveScope.key !== key) {
    liveScope.wf = document.createElement("canvas");
    liveScope.wf.width = N;
    liveScope.wf.height = LIVE_ROWS;
    liveScope.key = key;
    liveScope.rows = 0;
  }
  const g = liveScope.wf.getContext("2d");
  g.drawImage(liveScope.wf, 0, 1);
  const row = g.createImageData(N, 1);
  const range = sdr.range || 60;
  const bg = rgb(cssColor("--wfbg")), cool = rgb(cssColor("--cool")), warm = rgb(cssColor("--warm"));
  for (let i = 0; i < N; i++) {
    let c;
    if (Number.isNaN(rel[i])) c = mix(bg, rgb(cssColor("--muted")), 0.12);
    else {
      const t = Math.max(0, Math.min(1, (rel[i] + 3) / (range * 0.6)));
      c = t < 0.5 ? mix(bg, cool, t * 2) : mix(cool, warm, (t - 0.5) * 2);
    }
    row.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  g.putImageData(row, 0, 0);
  liveScope.rows = Math.min(LIVE_ROWS, liveScope.rows + 1);
}

/** The Live / Spots switch and what it needs. */
function renderScopeSrc() {
  const el = $("scopeSrc");
  if (!el) return;
  el.innerHTML = [["live", "Live (RTL-SDR)"], ["spots", "From spots"]]
    .map(([k, l]) => `<button type="button" data-src="${k}" aria-pressed="${liveScope.src === k}">${l}</button>`).join("");
  el.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      liveScope.src = b.dataset.src;
      try { localStorage.setItem("bw-scope-src", liveScope.src); } catch { /* private mode */ }
      renderScopeSrc();
      drawScope();
    };
  });
  const msg = $("scopeLiveMsg");
  const go = $("scopeLiveGo");
  const running = typeof sdr !== "undefined" && sdr.running;
  go.hidden = liveScope.src !== "live" || running || sdr.available === false;
  msg.textContent = liveScope.src !== "live" ? ""
    : running ? "Live from your RTL-SDR."
      : sdr.available === false ? "Live needs HamShack on your PC with an RTL-SDR; showing spots meanwhile."
        : "Your RTL-SDR isn't running; showing spots meanwhile.";
}

/** Start the RTL-SDR on the band shown, for the live scope. */
function scopeGoLive() {
  const b = app.sel;
  const [lo, hi] = spanLimits(b, app.span);
  let kHz = listen.kHz;
  if (!(kHz / 1000 >= lo && kHz / 1000 <= hi)) {
    const ft8 = FT8[b];
    kHz = ft8 && ft8 >= lo && ft8 <= hi ? ft8 * 1000 : Math.round(((lo + hi) / 2) * 1000);
  }
  listen.rx = "rtl";
  tuneTo(kHz, modeForFreq(kHz), { open: true, quiet: true });
}

function drawScope() {
  const cur = app.bands.find((x) => x.b === app.sel);
  const cv = $("scope");
  if (!cur) return;

  const W = cv.clientWidth || 600;
  const H = cv.clientHeight || 280;
  const res = SCOPE_RES[settings.scopeRes] || SCOPE_RES.normal;
  const dpr = Math.min(window.devicePixelRatio || 1, res.maxDpr);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
  }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);

  const [lo, hi] = spanLimits(cur.b, app.span);
  const N = Math.max(40, Math.min(res.maxBins, Math.floor(W / res.pxPerBin)));
  const binW = (hi - lo) / N;
  const fx = (f) => ((f - lo) / (hi - lo)) * W;
  const SPEC_H = 104, TOP = 8, PLAN_Y = SPEC_H + 4, WF_Y = SPEC_H + 20, ROWS = WINDOW_MIN, AXIS_H = 18;
  const rowH = (H - WF_Y - AXIS_H) / ROWS;
  const col = {
    cool: rgb(cssColor("--cool")), warm: rgb(cssColor("--warm")), bg: rgb(cssColor("--wfbg")), mutedRgb: rgb(cssColor("--muted")),
    muted: cssColor("--muted"), line: cssColor("--line"), text: cssColor("--text"), grid: cssColor("--grid"),
  };

  const sp = cur.sp.filter((p) => p.fq >= lo - 0.002 && p.fq <= hi + 0.002);
  const live = scopeIsLive();
  const liveRange = (typeof sdr !== "undefined" && sdr.range) || 60;
  const strength = (p) => Math.max(3, Math.min(44, (p.snr == null ? -12 : p.snr) + 28)); // dB above noise
  const noise = seeded(Number(cur.b) * 977 + Math.floor(Date.now() / 6e4));
  const levelAt = (f, list) => {
    let lin = 0.6 + noise();
    for (const p of list) {
      const sigma = Math.max((BANDWIDTH[p.mk] || 5e-5) / 2.355, binW * 0.6);
      const d = (f - p.fq) / sigma;
      if (d > -5 && d < 5) lin += 10 ** (strength(p) / 10) * Math.exp((-d * d) / 2);
    }
    return 10 * Math.log10(lin);
  };

  // Spectrum
  const RANGE = live ? Math.min(liveRange, 60) : 46;
  const yv = (v) => TOP + (SPEC_H - TOP) * (1 - Math.max(0, Math.min(RANGE, v + 2)) / RANGE);
  g.font = `${Math.round(10 * settings.text / 100)}px Barlow, system-ui, sans-serif`;
  g.lineWidth = 1;
  for (let d = 10; d < RANGE; d += 10) {
    g.strokeStyle = col.grid;
    g.beginPath(); g.moveTo(0, yv(d) + 0.5); g.lineTo(W, yv(d) + 0.5); g.stroke();
    g.fillStyle = col.muted; g.fillText(`${d} dB`, 3, yv(d) - 2);
  }
  const liveSpec = live && liveScope.last && liveScope.last.length === N && liveScope.key === `${lo}|${hi}|${N}` ? liveScope.last : null;
  const spec = live ? (liveSpec || new Float32Array(N).fill(NaN)) : Array.from({ length: N }, (_, i) => levelAt(lo + (i + 0.5) * binW, sp));
  const [cr, cg, cb] = col.cool;
  // Draw each covered stretch (live: the receiver may not see the whole span).
  const runs = [];
  for (let i = 0; i < N; i++) {
    if (Number.isNaN(spec[i])) continue;
    if (runs.length && runs[runs.length - 1][1] === i - 1) runs[runs.length - 1][1] = i; else runs.push([i, i]);
  }
  for (const [a, b] of runs) {
    g.beginPath(); g.moveTo(((a + 0.5) / N) * W, SPEC_H);
    for (let i = a; i <= b; i++) g.lineTo(((i + 0.5) / N) * W, yv(spec[i]));
    g.lineTo(((b + 0.5) / N) * W, SPEC_H); g.closePath();
    g.fillStyle = `rgba(${cr},${cg},${cb},.22)`; g.fill();
    g.beginPath();
    for (let i = a; i <= b; i++) { const x = ((i + 0.5) / N) * W; i > a ? g.lineTo(x, yv(spec[i])) : g.moveTo(x, yv(spec[i])); }
    g.strokeStyle = `rgb(${cr},${cg},${cb})`; g.lineWidth = 1.4; g.stroke(); g.lineWidth = 1;
  }
  if (live) {
    // Shade what the receiver can't see, and mark the spotted stations on the live trace.
    g.fillStyle = `rgba(${col.mutedRgb.join(",")},.10)`;
    let gapFrom = -1;
    for (let i = 0; i <= N; i++) {
      const gap = i < N && Number.isNaN(spec[i]);
      if (gap && gapFrom < 0) gapFrom = i;
      if (!gap && gapFrom >= 0) { g.fillRect((gapFrom / N) * W, TOP, ((i - gapFrom) / N) * W, SPEC_H - TOP); gapFrom = -1; }
    }
    if (!liveSpec) { g.fillStyle = col.muted; g.fillText("Waiting for the receiver…", W / 2 - 60, SPEC_H / 2); }
    else if (!runs.length) { g.fillStyle = col.muted; g.textAlign = "center"; g.fillText("The receiver is tuned outside this span: click here to move it.", W / 2, SPEC_H / 2); g.textAlign = "left"; }
    const [wr, wg, wb] = col.warm;
    g.fillStyle = `rgba(${wr},${wg},${wb},.9)`;
    for (const p of sp) {
      const x = fx(p.fq);
      g.beginPath(); g.moveTo(x - 3, TOP); g.lineTo(x + 3, TOP); g.lineTo(x, TOP + 5); g.closePath(); g.fill();
    }
  }

  // Calling-frequency markers
  g.setLineDash([3, 3]);
  [["FT8", FT8], ["FT4", FT4], ["WSPR", WSPR]].forEach(([name, table], k) => {
    const f = table[cur.b];
    if (!f || f < lo || f > hi) return;
    const x = Math.round(fx(f)) + 0.5;
    g.strokeStyle = col.muted; g.beginPath(); g.moveTo(x, TOP); g.lineTo(x, SPEC_H); g.stroke();
    g.fillStyle = col.muted; g.fillText(name, Math.min(x + 3, W - 28), TOP + 10 + k * 11);
  });
  g.setLineDash([]);

  // Parks and summits on the air at their frequencies
  if (typeof xotaScopeMarks === "function") xotaScopeMarks(g, lo, hi, fx, TOP + 30, cssColor("--pota") || "#2e8b57");

  // Band plan strip
  for (const [type, a, b] of SEG[cur.b]) {
    const x0 = Math.max(0, fx(a)), x1 = Math.min(W, fx(b));
    if (x1 <= x0) continue;
    const [v, amount] = STRIP[type];
    const c = mix(col.bg, rgb(cssColor(v)), amount);
    g.fillStyle = `rgb(${c.join(",")})`; g.fillRect(x0, PLAN_Y, Math.max(1, x1 - x0 - 1), 12);
    const label = PLAN_TYPES[type].short;
    if (x1 - x0 > g.measureText(label).width + 8) { g.fillStyle = col.text; g.fillText(label, x0 + 4, PLAN_Y + 10); }
  }

  // Waterfall. Live: the receiver's last few seconds to a minute, newest at the top.
  // From spots: one row per minute; each spot lights its minute and the next.
  const cellW = W / N + 0.6;
  if (live) {
    if (liveScope.wf && liveScope.key === `${lo}|${hi}|${N}`) {
      g.imageSmoothingEnabled = false;
      g.drawImage(liveScope.wf, 0, 0, N, LIVE_ROWS, 0, WF_Y, W, H - WF_Y - AXIS_H);
      g.imageSmoothingEnabled = true;
    }
    const secs = (LIVE_ROWS * FALL_SPEEDS[sdr.speed]) / 1000;
    const wfH = H - WF_Y - AXIS_H;
    [0, 1 / 3, 2 / 3].forEach((f) => {
      const y = WF_Y + f * wfH;
      g.strokeStyle = col.line; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
      g.fillStyle = col.muted; g.fillText(f ? `−${Math.round(secs * f)} s` : "now", 3, y + 10);
    });
  }
  for (let row = 0; row < (live ? 0 : ROWS); row++) {
    const list = sp.filter((p) => row >= p.t && row < p.t + 2);
    if (!list.length) continue;
    const y = WF_Y + row * rowH;
    for (let i = 0; i < N; i++) {
      const t = Math.max(0, Math.min(1, (levelAt(lo + (i + 0.5) * binW, list) - 1) / 38));
      if (t < 0.02) continue;
      const c = t < 0.5 ? mix(col.bg, col.cool, t * 2) : mix(col.cool, col.warm, (t - 0.5) * 2);
      g.fillStyle = `rgb(${c.join(",")})`; g.fillRect((i / N) * W, y, cellW, rowH + 0.6);
    }
  }
  if (!live) [0, 10, 20].forEach((m) => {
    const y = WF_Y + m * rowH;
    g.strokeStyle = col.line; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke();
    g.fillStyle = col.muted; g.fillText(m ? `−${m} min` : "now", 3, y + 10);
  });

  // Where the receiver is tuned
  const tunedMHz = listen.kHz / 1000;
  if (tunedMHz >= lo && tunedMHz <= hi) {
    const x = Math.round(fx(tunedMHz)) + 0.5;
    g.strokeStyle = cssColor("--warm"); g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, TOP); g.lineTo(x, H - AXIS_H); g.stroke(); g.lineWidth = 1;
    g.fillStyle = cssColor("--warm");
    g.textAlign = x > W - 60 ? "right" : "left";
    g.fillText(`Tuned ${listen.mode.toUpperCase()}`, x + (x > W - 60 ? -4 : 4), H - AXIS_H - 4);
    g.textAlign = "left";
  }

  // Frequency axis
  const decimals = hi - lo < 0.02 ? 4 : hi - lo < 0.5 ? 3 : 2;
  g.fillStyle = col.muted;
  for (let i = 0; i <= 4; i++) {
    g.textAlign = i === 0 ? "left" : i === 4 ? "right" : "center";
    g.fillText((lo + ((hi - lo) * i) / 4).toFixed(decimals), i === 0 ? 3 : i === 4 ? W - 3 : (i * W) / 4, H - 5);
  }
  g.textAlign = "left";

  scope = { lo, hi, binW, sp, decimals, live, spec: live ? spec : null, geom: { lo, hi, N } };
  const n = sp.length;
  cv.setAttribute("aria-label", `${cur.b} metre band scope, ${lo.toFixed(decimals)} to ${hi.toFixed(decimals)} MHz, ${n} station${n === 1 ? "" : "s"} plotted. ` +
    "Arrow keys move the cursor, Enter tunes the receiver there, plus and minus zoom.");
  $("scopeTitle").textContent = `${bandName(cur.b)} band scope${live ? " · live" : ""}`;
  $("scopeNote").textContent = live
    ? "Live from your RTL-SDR: click to tune there, drag to zoom. Top: signal level above the noise, ▼ stations spotted. Middle: UK band plan. Bottom: live waterfall, newest at the top. Shaded: outside what the receiver can see."
    : n
    ? "Click to tune the receiver there, or drag across the scope to zoom in. Top: signal level from spot reports. Middle: UK band plan. Bottom: last 30 minutes, newest at the top."
    : !app.spots ? "Waiting for live spots."
      : app.span === "full" || app.span === "digi" ? "No stations spotted in this span right now." : "No stations spotted in this span. Try Digital or Full band.";
  renderReadout();
}

function renderReadout() {
  const out = $("scopeRead");
  const line = $("cur");
  if (!scope) return;
  if (app.cursor == null) {
    line.style.display = "none";
    out.innerHTML = `<span>Hover, tap or use the arrow keys on the scope to read a frequency.</span>`;
    return;
  }
  const f = scope.lo + app.cursor * (scope.hi - scope.lo);
  line.style.display = "block";
  line.style.left = `${app.cursor * 100}%`;
  const tol = Math.max(scope.binW * 2.5, 2e-5);
  const near = scope.sp
    .filter((p) => Math.abs(p.fq - f) <= Math.max(tol, (BANDWIDTH[p.mk] || 5e-5) / 2))
    .sort((a, b) => (b.snr ?? -99) - (a.snr ?? -99));
  const fine = scope.decimals > 3;
  const kHz = (f * 1000).toLocaleString(undefined, { minimumFractionDigits: fine ? 1 : 0, maximumFractionDigits: fine ? 2 : 1 });
  const seg = planSegment(f * 1000);
  const li = scope.spec ? Math.floor(app.cursor * scope.spec.length) : -1;
  const lv = li >= 0 ? scope.spec[Math.min(li, scope.spec.length - 1)] : NaN;
  out.innerHTML = `<b>${kHz} kHz</b> <button type="button" class="tune" id="scopeTune">Listen here</button> ` +
    (scope.live ? (Number.isNaN(lv) ? "<span>· outside the receiver's view</span> " : `<span>· ${Math.max(0, lv).toFixed(0)} dB above the noise</span> `) : "") +
    (seg ? `<span>· ${esc(PLAN_TYPES[seg.type].short)}</span> ` : "") + (near.length
    ? `<span>· ${near.length} station${near.length === 1 ? "" : "s"}:</span> ` +
      near.slice(0, 3).map((p) => `${callLink(p.c)} <span>${esc(p.m)}${p.snr != null ? ` ${p.snr} dB` : ""}, ${ago(p.t)}</span>`).join("; ") +
      (near.length > 3 ? ` <span>and ${near.length - 3} more</span>` : "")
    : "<span>· nothing spotted here</span>");
  $("scopeTune").onclick = () => tuneTo(Math.round(f * 1e5) / 100, near[0] && near[0].mk === "CW" ? "cw" : modeForFreq(f * 1000), { open: true });
}

function cursorMHz() {
  return scope && app.cursor != null ? scope.lo + app.cursor * (scope.hi - scope.lo) : null;
}

function zoomTo(lo, hi) {
  const [a, b] = EDGE[app.sel];
  const min = 0.0015; // never narrower than 1.5 kHz
  if (hi - lo < min) { const c = (lo + hi) / 2; lo = c - min / 2; hi = c + min / 2; }
  lo = Math.max(a - 0.005, lo); hi = Math.min(b + 0.005, hi);
  app.zoom = { b: app.sel, lo, hi };
  app.cursor = app.pinned = null;
  renderScopeChips();
  drawScope();
}

function setupScopeInput() {
  const cv = $("scope");
  renderScopeSrc();
  $("scopeLiveGo").addEventListener("click", scopeGoLive);
  if (typeof checkSdr === "function") checkSdr().then(renderScopeSrc).catch(() => {});
  const sel = $("scopeSel");
  const frac = (e) => {
    const r = cv.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  let down = null; // { x: 0..1, px } while the pointer is pressed
  const showSel = (a, b) => {
    sel.style.display = "block";
    sel.style.left = `${Math.min(a, b) * 100}%`;
    sel.style.width = `${Math.abs(b - a) * 100}%`;
  };
  cv.addEventListener("pointerdown", (e) => {
    down = { x: frac(e), px: e.clientX };
    try { cv.setPointerCapture(e.pointerId); } catch { /* not supported */ }
    app.cursor = down.x;
    renderReadout();
  });
  cv.addEventListener("pointermove", (e) => {
    app.cursor = frac(e);
    if (down && Math.abs(e.clientX - down.px) > 6) showSel(down.x, app.cursor);
    renderReadout();
  });
  cv.addEventListener("pointerup", (e) => {
    if (!down) return;
    const x = frac(e);
    const dragged = Math.abs(e.clientX - down.px) > 6;
    sel.style.display = "none";
    if (dragged && scope) {
      const a = scope.lo + Math.min(down.x, x) * (scope.hi - scope.lo);
      const b = scope.lo + Math.max(down.x, x) * (scope.hi - scope.lo);
      down = null;
      zoomTo(a, b);
      return;
    }
    down = null;
    app.cursor = app.pinned = x;
    const f = cursorMHz();
    if (f != null) tuneTo(Math.round(f * 1e5) / 100, modeForFreq(f * 1000));
  });
  cv.addEventListener("pointercancel", () => { down = null; sel.style.display = "none"; });
  // After a click the cursor stays where it was clicked, so "Listen here" can be reached.
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && !down) { app.cursor = app.pinned; renderReadout(); } });
  cv.addEventListener("dblclick", () => { app.zoom = null; renderScopeChips(); drawScope(); });
  cv.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 1 / 120;
      app.cursor = Math.max(0, Math.min(1, (app.cursor ?? 0.5) + (e.key === "ArrowRight" ? step : -step)));
      renderReadout();
    } else if (e.key === "Enter" && app.cursor != null) {
      e.preventDefault();
      const f = cursorMHz();
      tuneTo(Math.round(f * 1e5) / 100, modeForFreq(f * 1000), { open: true });
    } else if ((e.key === "+" || e.key === "=" || e.key === "-") && scope) {
      e.preventDefault();
      const c = cursorMHz() ?? (scope.lo + scope.hi) / 2;
      const half = ((scope.hi - scope.lo) / 2) * (e.key === "-" ? 2 : 0.5);
      if (e.key === "-" && half * 2 >= EDGE[app.sel][1] - EDGE[app.sel][0]) { app.zoom = null; renderScopeChips(); drawScope(); return; }
      zoomTo(c - half, c + half);
    } else if (e.key === "Escape") {
      app.cursor = app.pinned = null;
      renderReadout();
    }
  });
  let frame = 0;
  const redraw = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(drawScope); };
  if (window.ResizeObserver) new ResizeObserver(redraw).observe($("scopebox"));
  else window.addEventListener("resize", redraw);
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw); } catch { /* old browser */ }
}
