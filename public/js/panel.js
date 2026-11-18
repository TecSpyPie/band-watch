/* The Radio panel: Band Watch as the front of a transceiver. A big frequency display, an analogue S-meter
   (read from the FT-991A, Icom radios and the ATS Mini), a close-up spectrum around the dial, band and mode
   buttons, and a tuning knob you can drag, scroll or turn with the arrow keys.
   It drives the same dial as everything else (tuneTo), so Listen, the scope and a connected radio all follow.
   There's no transmit button: Band Watch only listens and tunes. */
"use strict";

// Where each band button goes the first time (after that, the last frequency used on that band).
const PANEL_HOME = {
  160: [1900, "lsb"], 80: [3700, "lsb"], 60: [5362, "usb"], 40: [7100, "lsb"], 30: [10120, "cw"], 20: [14200, "usb"],
  17: [18130, "usb"], 15: [21200, "usb"], 12: [24940, "usb"], 10: [28500, "usb"], 6: [50150, "usb"],
};
const PANEL_MODES = [["lsb", "LSB"], ["usb", "USB"], ["cw", "CW"], ["am", "AM"], ["fm", "FM"]];
const PANEL_STEPS = [[0.01, "10 Hz"], [0.1, "100 Hz"], [0.5, "500 Hz"], [1, "1 kHz"], [5, "5 kHz"], [10, "10 kHz"]];
const PANEL_SPANS = [[3, "±1.5 kHz"], [10, "±5 kHz"], [25, "±12.5 kHz"], [50, "±25 kHz"]];
const KNOB_DEG_PER_STEP = 12; // turn the knob this far for one step

const panel = {
  bands: {}, span: 10, angle: 0, drag: null, pending: null, flush: null, meterTimer: null, shown: false,
  needle: -54, // where the drawn needle is, eased towards the reading
};

function loadPanel() {
  try {
    const s = JSON.parse(load("bw-panel") || "{}");
    if (s.bands && typeof s.bands === "object") {
      for (const [b, v] of Object.entries(s.bands)) {
        if (PANEL_HOME[b] && Array.isArray(v) && Number.isFinite(v[0]) && PANEL_MODES.some(([m]) => m === v[1])) panel.bands[b] = v;
      }
    }
    if (PANEL_SPANS.some(([w]) => w === s.span)) panel.span = s.span;
  } catch { /* defaults */ }
}
function savePanel() { store("bw-panel", { bands: panel.bands, span: panel.span }); }

/** "14.074.00" style, like a radio: MHz.kHz.Hz (to 10 Hz). */
function panelFreqText(kHz) {
  const hz = Math.round(kHz * 1000);
  const mhz = Math.floor(hz / 1e6);
  const khz = Math.floor((hz % 1e6) / 1000);
  const tens = Math.floor((hz % 1000) / 10);
  return `${mhz}.${String(khz).padStart(3, "0")}.${String(tens).padStart(2, "0")}`;
}

/** What the panel is connected to, in words. */
function panelSource() {
  if (typeof rig !== "undefined" && rig.connected) return rig.model || (typeof rigLabel === "function" ? rigLabel() : "Radio");
  if (listen.open) return RECEIVERS[listen.rx] ? RECEIVERS[listen.rx].name.split(",")[0].replace(/\s*\(.*$/, "") : "Listen";
  return "";
}

/** Tune from the knob or keys, without flooding the radio: at most ten commands a second. */
function panelTune(kHz, mode) {
  kHz = Math.max(0.01, Math.round(kHz * 100) / 100);
  panel.pending = { kHz, mode: mode || listen.mode };
  renderPanelDisplay(panel.pending.kHz, panel.pending.mode); // the display moves at once
  if (panel.flush) return;
  const go = () => {
    const p = panel.pending;
    panel.pending = null;
    panel.flush = null;
    if (!p) return;
    tuneTo(p.kHz, p.mode, { quiet: true });
    panel.flush = setTimeout(() => { panel.flush = null; if (panel.pending) go(); }, 100);
  };
  go();
}
/** Turn the dial by whole steps, landing on the step's grid like a radio (14200.3 kHz + 1 kHz = 14201). */
function panelStep(steps) {
  const st = listen.step;
  const base = panel.pending ? panel.pending.kHz : listen.kHz;
  const n = base / st;
  const onGrid = Math.abs(n - Math.round(n)) < 1e-6;
  const k = onGrid ? Math.round(n) + steps : (steps > 0 ? Math.floor(n) : Math.ceil(n)) + steps;
  panelTune(k * st);
}

function renderPanelDisplay(kHz = listen.kHz, mode = listen.mode) {
  if (!$("pnFreq")) return;
  $("pnFreq").textContent = panelFreqText(kHz);
  // The radio's own name for its mode when it's connected (DATA-USB, CW-U…), else Band Watch's.
  const radioMode = typeof rig !== "undefined" && rig.connected && rig.modeName && !panel.pending ? rig.modeName : "";
  $("pnMode").textContent = radioMode || (mode || "").toUpperCase();
  const band = bandForKHz(kHz);
  $("pnBand").textContent = band ? `${band} m` : "";
  const knob = $("pnKnob");
  knob.setAttribute("aria-valuenow", String(kHz));
  knob.setAttribute("aria-valuetext", `${kHz.toLocaleString()} kHz ${(mode || "").toUpperCase()}`);
  for (const b of document.querySelectorAll("#pnBands button")) b.setAttribute("aria-pressed", String(b.dataset.band === band));
  for (const b of document.querySelectorAll("#pnModes button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
}

function renderPanel() {
  if (!$("secPanel")) return;
  renderPanelDisplay();
  // The band stack: remember where you are on this band, however you got there.
  const here = bandForKHz(listen.kHz);
  if (here && PANEL_HOME[here]) {
    const prev = panel.bands[here];
    if (!prev || prev[0] !== listen.kHz || prev[1] !== listen.mode) {
      if (PANEL_MODES.some(([m]) => m === listen.mode)) { panel.bands[here] = [listen.kHz, listen.mode]; savePanel(); }
    }
  }
  const src = panelSource();
  $("pnSrc").textContent = src || "Not connected";
  $("pnSrc").classList.toggle("on", Boolean(src));
  $("pnStep").value = String(listen.step);
  $("pnSpan").value = String(panel.span);
  const radio = typeof rig !== "undefined" && rig.connected;
  $("pnNote").textContent = radio
    ? (rigHasMeter() ? "" : `The S-meter isn't read from this radio (its scale differs between models). Tuning works.`)
    : listen.open ? "Tuning the receiver in Listen. Connect your radio to move its dial too."
      : "Tune here and your radio follows once it's connected (Connect radio, at the top). Press Listen to hear the band from an online receiver.";
  $("pnListen").textContent = listen.open ? "Stop listening" : "Listen";
  $("pnListen").setAttribute("aria-pressed", String(listen.open));
  drawPanelMeter();
  drawPanelSpectrum();
}

/* ---------- The analogue meter ---------- */

function drawPanelMeter() {
  const cv = $("pnMeter");
  if (!cv) return;
  const W = cv.clientWidth || 260, H = cv.clientHeight || 120;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H * 1.04, r = Math.min(W * 0.44, H * 0.76);
  const A0 = Math.PI * 1.22, A1 = Math.PI * 1.78; // the arc, left to right
  const at = (db) => A0 + ((Math.max(-54, Math.min(60, db)) + 54) / 114) * (A1 - A0);
  const live = typeof rig !== "undefined" && rigHasMeter() && rig.meter != null && Date.now() - rig.meterAt < 5000;
  const css = (n) => getComputedStyle($("secPanel")).getPropertyValue(n).trim();
  const ink = css("--pn-ink") || "#dff6ff", red = css("--pn-red") || "#ff5a4e", dim = css("--pn-dim") || "#6f8a96";
  g.lineCap = "round";
  // Scale: white to S9, red above
  g.lineWidth = 3;
  g.strokeStyle = ink; g.beginPath(); g.arc(cx, cy, r, A0, at(0)); g.stroke();
  g.strokeStyle = red; g.beginPath(); g.arc(cx, cy, r, at(0), A1); g.stroke();
  g.font = `600 ${Math.round(H * 0.11)}px system-ui, sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  const ticks = [[-48, "1"], [-36, "3"], [-24, "5"], [-12, "7"], [0, "9"], [20, "+20"], [40, "+40"], [60, "+60"]];
  for (const [db, label] of ticks) {
    const a = at(db);
    g.strokeStyle = db > 0 ? red : ink;
    g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 8), cy + Math.sin(a) * (r - 8)); g.lineTo(cx + Math.cos(a) * (r + 2), cy + Math.sin(a) * (r + 2)); g.stroke();
    g.fillStyle = db > 0 ? red : ink;
    g.fillText(label, cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13));
  }
  g.fillStyle = dim;
  g.textAlign = "left";
  g.fillText("S", 6, H * 0.18);
  // The needle eases towards the reading, like a real meter's damping
  const target = live ? rig.meter : -54;
  panel.needle += (target - panel.needle) * 0.35;
  if (Math.abs(target - panel.needle) < 0.3) panel.needle = target;
  const a = at(panel.needle);
  g.strokeStyle = live ? (css("--pn-needle") || "#ffd166") : dim;
  g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25); g.lineTo(cx + Math.cos(a) * (r - 2), cy + Math.sin(a) * (r - 2)); g.stroke();
  $("pnS").textContent = live ? sUnits(rig.meter) : "";
  if (Math.abs(target - panel.needle) > 0.3) requestAnimationFrame(drawPanelMeter);
}

/* ---------- The close-up spectrum ---------- */

function drawPanelSpectrum() {
  const cv = $("pnSpec");
  if (!cv) return;
  const W = cv.clientWidth || 600, H = cv.clientHeight || 110;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const css = (n) => getComputedStyle($("secPanel")).getPropertyValue(n).trim();
  const ink = css("--pn-ink") || "#dff6ff", dim = css("--pn-dim") || "#6f8a96", trace = css("--pn-trace") || "#45e0f5";
  const centre = (panel.pending ? panel.pending.kHz : listen.kHz) / 1000; // MHz
  const half = panel.span / 2000; // MHz
  const lo = centre - half, hi = centre + half;
  const N = Math.max(60, Math.min(400, Math.floor(W / 2)));
  const fx = (f) => ((f - lo) / (hi - lo)) * W;
  const base = H - 16;
  // Grid
  g.strokeStyle = dim; g.globalAlpha = 0.35; g.lineWidth = 1;
  for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo((W * i) / 10, 0); g.lineTo((W * i) / 10, base); g.stroke(); }
  g.globalAlpha = 1;
  let levels = null, src = "";
  if (typeof scopeIsLive === "function" && scopeIsLive()) {
    const cov = liveCoverage();
    if (cov.lo <= hi * 1e6 && cov.hi >= lo * 1e6) {
      const s = liveSpectrum(lo, hi, N);
      if (s) {
        const range = (typeof sdr !== "undefined" && sdr.range) || 60;
        let floor = Infinity;
        for (const v of s) if (!Number.isNaN(v) && v < floor) floor = v;
        levels = Array.from(s, (v) => (Number.isNaN(v) ? 0 : Math.max(0, Math.min(1, (v - floor) / range))));
        src = "Live from your RTL-SDR";
      }
    }
  }
  if (!levels) {
    // From the spots on this band: one peak per station heard, its height from the reported SNR.
    const band = app.bands && app.bands.find((x) => x.b === bandForKHz(centre * 1000));
    const sp = band ? band.sp.filter((p) => p.fq >= lo - 0.002 && p.fq <= hi + 0.002) : [];
    const binW = (hi - lo) / N;
    levels = new Array(N).fill(0);
    for (const p of sp) {
      const h = Math.max(0.12, Math.min(1, ((p.snr == null ? -12 : p.snr) + 28) / 44));
      const sigma = Math.max(((BANDWIDTH[p.mk] || 5e-5) / 2.355), binW * 0.8);
      for (let i = 0; i < N; i++) {
        const d = (lo + (i + 0.5) * binW - p.fq) / sigma;
        if (d > -4 && d < 4) levels[i] = Math.max(levels[i], h * Math.exp((-d * d) / 2));
      }
    }
    src = sp.length ? `${sp.length} station${sp.length === 1 ? "" : "s"} spotted here in the last ${WINDOW_MIN} min` : "No stations spotted within this span";
  }
  // The trace
  const grad = g.createLinearGradient(0, 0, 0, base);
  grad.addColorStop(0, trace); grad.addColorStop(1, "rgba(69,224,245,0.05)");
  g.beginPath(); g.moveTo(0, base);
  for (let i = 0; i < N; i++) g.lineTo((i + 0.5) * (W / N), base - levels[i] * (base - 6));
  g.lineTo(W, base); g.closePath();
  g.fillStyle = grad; g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
  g.strokeStyle = trace; g.lineWidth = 1.5;
  g.beginPath();
  for (let i = 0; i < N; i++) { const x = (i + 0.5) * (W / N), y = base - levels[i] * (base - 6); i ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  // The dial: a red line, with the receive passband shaded
  const bw = { usb: [0.0003, 0.0027], lsb: [-0.0027, -0.0003], cw: [-0.00025, 0.00025], am: [-0.004, 0.004], fm: [-0.006, 0.006] }[listen.mode] || [-0.0015, 0.0015];
  g.fillStyle = css("--pn-pass") || "rgba(255,209,102,0.16)";
  g.fillRect(fx(centre + bw[0]), 0, Math.max(2, fx(centre + bw[1]) - fx(centre + bw[0])), base);
  g.strokeStyle = css("--pn-red") || "#ff5a4e"; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(fx(centre), 0); g.lineTo(fx(centre), base); g.stroke();
  // Scale
  g.fillStyle = ink; g.font = "11px system-ui, sans-serif"; g.textBaseline = "alphabetic";
  g.textAlign = "left"; g.fillText((lo * 1000).toFixed(1), 2, H - 3);
  g.textAlign = "right"; g.fillText((hi * 1000).toFixed(1), W - 2, H - 3);
  g.textAlign = "center"; g.fillStyle = dim; g.fillText(src, W / 2, H - 3);
}

/* ---------- The knob ---------- */

function setupPanelKnob() {
  const knob = $("pnKnob");
  const angleOf = (e) => {
    const r = knob.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };
  const turn = (deg) => {
    panel.angle = (panel.angle + deg) % 360;
    $("pnKnobDot").style.transform = `rotate(${panel.angle}deg)`;
  };
  knob.addEventListener("pointerdown", (e) => {
    knob.setPointerCapture(e.pointerId);
    panel.drag = { last: angleOf(e), acc: 0 };
    knob.focus();
    e.preventDefault();
  });
  knob.addEventListener("pointermove", (e) => {
    if (!panel.drag) return;
    const a = angleOf(e);
    let d = a - panel.drag.last;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    panel.drag.last = a;
    turn(d);
    panel.drag.acc += d;
    const steps = Math.trunc(panel.drag.acc / KNOB_DEG_PER_STEP);
    if (steps) { panel.drag.acc -= steps * KNOB_DEG_PER_STEP; panelStep(steps); }
  });
  const end = () => { panel.drag = null; };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  knob.addEventListener("wheel", (e) => {
    e.preventDefault();
    const steps = e.deltaY < 0 ? 1 : -1;
    turn(steps * KNOB_DEG_PER_STEP);
    panelStep(steps);
  }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (!k) return;
    e.preventDefault();
    turn(k * KNOB_DEG_PER_STEP);
    panelStep(k);
  });
}

function setupPanel() {
  if (!$("secPanel")) return;
  loadPanel();
  $("pnBands").innerHTML = BANDS.map((b) => `<button type="button" class="pnkey" data-band="${b}" aria-pressed="false">${b}</button>`).join("");
  $("pnModes").innerHTML = PANEL_MODES.map(([m, l]) => `<button type="button" class="pnkey" data-mode="${m}" aria-pressed="false">${l}</button>`).join("");
  $("pnStep").innerHTML = PANEL_STEPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("pnSpan").innerHTML = PANEL_SPANS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("pnBands").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    // Like a radio's band stack: back to where you were on that band (renderPanel keeps note).
    const [kHz, mode] = panel.bands[b.dataset.band] || PANEL_HOME[b.dataset.band];
    tuneTo(kHz, mode, { quiet: true });
  });
  $("pnModes").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) tuneTo(listen.kHz, b.dataset.mode, { quiet: true });
  });
  $("pnStep").addEventListener("change", (e) => {
    listen.step = Number(e.target.value);
    saveListen();
    renderListen();
  });
  $("pnSpan").addEventListener("change", (e) => { panel.span = Number(e.target.value); savePanel(); drawPanelSpectrum(); });
  $("pnDown").addEventListener("click", () => panelStep(-1));
  $("pnUp").addEventListener("click", () => panelStep(1));
  $("pnListen").addEventListener("click", () => {
    if (listen.open) stopListening(); else startListening();
    renderPanel();
  });
  // Click the spectrum to tune there.
  $("pnSpec").addEventListener("click", (e) => {
    const r = $("pnSpec").getBoundingClientRect();
    const half = panel.span / 2;
    const kHz = listen.kHz - half + ((e.clientX - r.left) / r.width) * panel.span;
    const st = listen.step >= 0.5 ? 0.1 : 0.01;
    panelTune(Math.round(kHz / st) * st);
  });
  // Freq entry: click the display and type a frequency in kHz or MHz.
  $("pnFreq").addEventListener("click", () => {
    $("pnEntry").hidden = false;
    $("pnEntry").value = "";
    $("pnEntry").focus();
  });
  $("pnEntry").addEventListener("keydown", (e) => {
    if (e.key === "Escape") { $("pnEntry").hidden = true; return; }
    if (e.key !== "Enter") return;
    const v = Number(String($("pnEntry").value).replace(",", "."));
    $("pnEntry").hidden = true;
    if (!(v > 0)) return;
    const kHz = v < 1000 ? v * 1000 : v; // 14.2 = 14.2 MHz, 14200 = 14200 kHz
    if (kHz >= 10 && kHz <= 2e6) tuneTo(kHz, null, { quiet: true });
  });
  $("pnEntry").addEventListener("blur", () => { $("pnEntry").hidden = true; });
  setupPanelKnob();

  // Only ask the radio for its S-meter while the panel is on screen.
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { panel.shown = es.some((x) => x.isIntersecting); }).observe($("secPanel"));
  } else panel.shown = true;
  panel.meterTimer = setInterval(() => {
    if (document.hidden) return;
    const inPopup = !document.contains($("secPanel")); // in its own window (⧉)
    if (!panel.shown && !inPopup) return;
    if (typeof rig !== "undefined" && rig.connected && !panel.pending) {
      const cmd = rigMeterCommand();
      if (cmd && cmd.length) rigWrite(cmd);
    }
    drawPanelMeter();
  }, 400);
  // Redraw the spectrum when the spots change or the RTL-SDR has new samples.
  setInterval(() => { if (!document.hidden && (panel.shown || !document.contains($("secPanel")))) drawPanelSpectrum(); }, 1000);
  window.addEventListener("resize", () => { drawPanelMeter(); drawPanelSpectrum(); });
  renderPanel();
}
