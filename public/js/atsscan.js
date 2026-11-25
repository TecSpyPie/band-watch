/* The ATS Mini band scan, in its panel: step the radio across a range with its "F" command, read the signal level
   from each status line, draw the graph and list the signals. Listening only: the scan sends nothing but tuning
   (F, and B/b and M/m to reach the right band and mode first). The planning and the maths are in atsscan-data.js
   (AtsScan); this file is the screen part. Memory slots and the radio's screen picture wait while a scan runs. */
"use strict";

const atsScan = {
  running: false,
  phase: "", // "start" (reaching the band and the first step) or "step"
  points: [], i: 0, mode: "AM", band: -1,
  settle: 300, // ms after tuning before a reading counts
  sentAt: 0, tries: 0, startedAt: 0,
  readings: [], // { hz, rssi, snr }; rssi null if the radio didn't answer on that step
  found: [], floor: null,
  back: null, // where to go back to: { hz, mode }
  hover: -1,
};

const ATS_SCAN_WAIT = 3000; // ms to wait for a reading before asking again

function atsScanBusy() {
  return atsScan.running;
}

function atsScanMsg(text) {
  if ($("atsScanMsg")) $("atsScanMsg").textContent = text;
}

/** The radio's mode as Band Watch's listen mode name ("wfm", "lsb", ...). */
const atsScanListen = (mode) => AtsScan.LISTEN[mode] || "am";

function atsScanStart() {
  if (rig.kind !== "atsmini" || !rig.connected || !rig.ats.lastLine) { atsScanMsg("Connect the ATS Mini first."); return; }
  if (atsScan.running) return;
  if (typeof atsMemBusy === "function" && atsMemBusy()) { atsScanMsg("Wait a moment: the memory slots are being read or saved."); return; }
  const mode = $("atsScanMode").value;
  const p = AtsScan.plan({ fromKHz: $("atsScanFrom").value, toKHz: $("atsScanTo").value, stepKHz: $("atsScanStep").value, mode });
  if (p.error) { atsScanMsg(p.error); return; }
  const a = rig.ats;
  Object.assign(atsScan, {
    running: true, phase: "start", points: p.points, i: 0, mode, band: p.band,
    settle: $("atsScanSpeed").value === "careful" ? 800 : 300,
    sentAt: Date.now(), tries: 0, startedAt: Date.now(), readings: [], found: [], floor: null, hover: -1,
    back: $("atsScanBack").checked && rig.hz ? { hz: rig.hz, mode: rig.listenMode || ATS_LISTEN_MODE[a.mode] || "am" } : null,
  });
  // First the right band and mode (a step at a time, as the radio's own buttons do), then the first step
  atsTune(p.points[0], atsScanListen(mode), p.band);
  const secs = AtsScan.estimateSeconds(p.points.length, atsScan.settle > 500);
  atsScanMsg(`Scanning ${p.points.length} steps, about ${secs < 90 ? `${secs} seconds` : `${Math.round(secs / 60)} minutes`}…`);
  atsScanState();
  atsScanDraw();
}

function atsScanSend() {
  atsScan.sentAt = Date.now();
  atsSend(`F${atsScan.points[atsScan.i]}\r\n`);
}

/** Save this step's reading and go on to the next one (or finish). */
function atsScanNext(rssi, snr) {
  atsScan.readings.push({ hz: atsScan.points[atsScan.i], rssi, snr });
  atsScan.i++;
  atsScan.tries = 0;
  if (atsScan.i >= atsScan.points.length) { atsScanFinish(""); return; }
  atsScanSend();
  if (atsScan.i % 5 === 0) atsScanMsg(`Scanning… ${atsScan.i} of ${atsScan.points.length} steps.`);
  atsScanDraw();
}

/** A status line from the radio (called by atsLine). */
function atsScanLine(hz, rssi, snr) {
  if (!atsScan.running || atsScan.phase !== "step") return;
  if (!AtsScan.matches(atsScan.points[atsScan.i], hz, atsScan.mode)) return;
  if (Date.now() - atsScan.sentAt < atsScan.settle) return; // give the receiver a moment to settle
  atsScanNext(Number.isFinite(rssi) ? rssi : null, Number.isFinite(snr) ? snr : null);
}

/** Every tenth of a second: watch for the first step, a radio that stopped answering, or tuning from elsewhere. */
function atsScanTick() {
  if (!atsScan.running) return;
  if (rig.kind !== "atsmini" || !rig.connected) { atsScanFinish("The radio was disconnected."); return; }
  const a = rig.ats;
  if (atsScan.phase === "start") {
    if (a.want) return; // still changing band or mode
    if (a.band !== atsScan.band && Date.now() - atsScan.startedAt > 2000) {
      atsScanFinish(a.note || "The radio didn't go to the band for this scan.");
      return;
    }
    if (a.band !== atsScan.band) return;
    atsScan.phase = "step";
    atsScanSend(); // the first step, sent again so its reading is fresh
    return;
  }
  if (a.want) { atsScan.back = null; atsScanFinish("Stopped: the radio was tuned from somewhere else."); return; }
  if (Date.now() - atsScan.sentAt < ATS_SCAN_WAIT) return;
  if (++atsScan.tries < 2) { atsScanSend(); return; } // ask once more
  atsScanNext(null, null); // no reading for this step: carry on
}

function atsScanStop() {
  if (atsScan.running) atsScanFinish("Stopped.");
}

function atsScanFinish(why) {
  atsScan.running = false;
  atsScan.floor = AtsScan.noiseFloor(atsScan.readings);
  atsScan.found = AtsScan.signals(atsScan.readings);
  const secs = Math.round((Date.now() - atsScan.startedAt) / 1000);
  const missed = atsScan.readings.filter((r) => r.rssi == null).length;
  let text = why
    ? `${why} ${atsScan.readings.length ? `${atsScan.readings.length} of ${atsScan.points.length} steps were read.` : ""}`
    : `Done: ${atsScan.readings.length} steps in ${secs} seconds.`;
  if (atsScan.floor != null) {
    const n = atsScan.found.length;
    text += ` Noise about ${Math.round(atsScan.floor)} dBµV. ${n ? `${n} signal${n === 1 ? "" : "s"} above it.` : "No signals stood out above it."}`;
  }
  if (missed) text += ` The radio didn't answer on ${missed} step${missed === 1 ? "" : "s"}.`;
  if (atsScan.back && rig.connected) atsTune(atsScan.back.hz, atsScan.back.mode);
  atsScan.back = null;
  atsScanMsg(text.trim());
  atsScanRows();
  atsScanState();
  atsScanDraw();
}

/** The table of signals found, strongest first. */
function atsScanRows() {
  const body = $("atsScanRows");
  if (!body) return;
  body.textContent = "";
  for (const s of atsScan.found) {
    const tr = document.createElement("tr");
    tr.dataset.hz = String(s.hz);
    const cell = (text) => { const td = document.createElement("td"); td.textContent = text; tr.append(td); };
    cell(AtsScan.showFreq(s.hz, atsScan.mode));
    cell(`${typeof atsSUnits === "function" ? `${atsSUnits(s.rssi)} · ` : ""}${s.rssi} dBµV`);
    cell(`${s.over} dB`);
    cell(s.snr == null ? "" : `${s.snr} dB`);
    const td = document.createElement("td");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tune";
    b.dataset.act = "tune";
    b.title = "Tune the radio and Band Watch here";
    b.textContent = "Tune";
    td.append(b);
    tr.append(td);
    body.append(tr);
  }
  $("atsScanTable").hidden = !atsScan.found.length;
}

/** Buttons on or off. */
function atsScanState() {
  const box = $("atsScanBox");
  if (!box) return;
  const on = rig.kind === "atsmini" && rig.connected && !!rig.ats.lastLine;
  for (const el of $("atsScanForm").querySelectorAll("button, input, select")) {
    if (el.id === "atsScanStop") el.disabled = !atsScan.running;
    else el.disabled = !on || atsScan.running;
  }
  $("atsScanCsv").disabled = atsScan.running;
  $("atsScanAfter").hidden = !atsScan.readings.length || atsScan.running;
  $("atsScanGraphWrap").hidden = !atsScan.points.length;
  if (!on && !atsScan.running && !atsScan.readings.length) atsScanMsg("Connect the ATS Mini to scan a band.");
}

/* ---------- The graph ---------- */

function atsScanColours(cv) {
  const st = getComputedStyle(cv);
  const v = (name, fallback) => st.getPropertyValue(name).trim() || fallback;
  return { line: v("--cool", "#0b7285"), text: v("--muted", "#52666a"), grid: v("--grid", "#d8dfda"), warm: v("--warm", "#a76a00"), bg: v("--wfbg", "#e9eee9") };
}

/** The graph's layout: where the plot sits, and the dBµV range shown. */
function atsScanLayout(w, h) {
  const vals = atsScan.readings.map((r) => r.rssi).filter((x) => Number.isFinite(x));
  const top = Math.max(40, Math.ceil(((vals.length ? Math.max(...vals) : 0) + 6) / 10) * 10);
  return { x0: 40, x1: w - 10, y0: 10, y1: h - 24, lo: 0, hi: Math.min(130, top) };
}

function atsScanDraw() {
  const cv = $("atsScanGraph");
  if (!cv || !atsScan.points.length) return;
  const win = cv.ownerDocument.defaultView || window;
  const dpr = Math.min(win.devicePixelRatio || 1, 2);
  const w = Math.max(200, cv.clientWidth || 600), h = 180;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const c = atsScanColours(cv);
  const L = atsScanLayout(w, h);
  const first = atsScan.points[0], last = atsScan.points[atsScan.points.length - 1];
  const X = (hz) => L.x0 + ((hz - first) / Math.max(1, last - first)) * (L.x1 - L.x0);
  const Y = (db) => L.y1 - ((Math.max(L.lo, Math.min(L.hi, db)) - L.lo) / (L.hi - L.lo)) * (L.y1 - L.y0);
  // Background panel with a soft sheen, like the radio's screen
  const bg = g.createLinearGradient(0, L.y0, 0, L.y1);
  bg.addColorStop(0, c.bg);
  bg.addColorStop(1, "rgba(0,0,0,0.08)");
  g.fillStyle = bg;
  g.fillRect(L.x0, L.y0, L.x1 - L.x0, L.y1 - L.y0);
  // Grid and scale: dBµV up the side, frequency along the bottom
  g.font = "11px Barlow, sans-serif";
  g.strokeStyle = c.grid;
  g.fillStyle = c.text;
  g.lineWidth = 1;
  g.textAlign = "right";
  g.textBaseline = "middle";
  for (let db = 0; db <= L.hi; db += L.hi > 60 ? 20 : 10) {
    g.beginPath(); g.moveTo(L.x0, Y(db) + 0.5); g.lineTo(L.x1, Y(db) + 0.5); g.stroke();
    g.fillText(String(db), L.x0 - 4, Y(db));
  }
  g.textAlign = "center";
  g.textBaseline = "top";
  // Round numbers along the bottom (1, 2 or 5 times a power of ten), the unit after the last one
  const fm = atsScan.mode === "FM";
  const most = Math.max(2, Math.min(8, Math.floor((L.x1 - L.x0) / 90)));
  let tick = 10;
  for (const m of [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000]) { tick = m * 1000; if ((last - first) / tick <= most) break; }
  const label = (hz) => (fm ? (hz / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 2 }) : Math.round(hz / 1000).toLocaleString("en-GB"));
  const marks = [];
  for (let hz = Math.ceil(first / tick) * tick; hz <= last; hz += tick) marks.push(hz);
  marks.forEach((hz, k) => {
    const end = k === marks.length - 1 && X(hz) > L.x1 - 40;
    g.textAlign = end ? "right" : "center";
    g.fillText(`${label(hz)}${k === marks.length - 1 ? (fm ? " MHz" : " kHz") : ""}`, end ? Math.min(w - 2, X(hz) + 8) : X(hz), L.y1 + 5);
  });
  g.save();
  g.translate(10, (L.y0 + L.y1) / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = "center";
  g.fillText("dBµV", 0, 0);
  g.restore();
  // The readings: a glowing line over a filled area
  const pts = atsScan.readings.filter((r) => Number.isFinite(r.rssi));
  if (pts.length) {
    const fill = g.createLinearGradient(0, L.y0, 0, L.y1);
    fill.addColorStop(0, c.line);
    fill.addColorStop(1, "rgba(0,0,0,0)");
    g.beginPath();
    g.moveTo(X(pts[0].hz), L.y1);
    for (const r of pts) g.lineTo(X(r.hz), Y(r.rssi));
    g.lineTo(X(pts[pts.length - 1].hz), L.y1);
    g.closePath();
    g.globalAlpha = 0.35;
    g.fillStyle = fill;
    g.fill();
    g.globalAlpha = 1;
    g.beginPath();
    pts.forEach((r, k) => (k ? g.lineTo(X(r.hz), Y(r.rssi)) : g.moveTo(X(r.hz), Y(r.rssi))));
    g.strokeStyle = c.line;
    g.lineWidth = 2;
    g.shadowColor = c.line;
    g.shadowBlur = 6;
    g.stroke();
    g.shadowBlur = 0;
  }
  // The noise level, and a marker on each signal found
  if (!atsScan.running && atsScan.floor != null) {
    g.setLineDash([4, 4]);
    g.strokeStyle = c.text;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(L.x0, Y(atsScan.floor) + 0.5); g.lineTo(L.x1, Y(atsScan.floor) + 0.5); g.stroke();
    g.setLineDash([]);
    g.fillStyle = c.warm;
    g.textAlign = "center";
    g.textBaseline = "bottom";
    atsScan.found.slice(0, 6).forEach((s) => {
      g.beginPath(); g.arc(X(s.hz), Y(s.rssi), 3.5, 0, Math.PI * 2); g.fill();
      g.fillText(AtsScan.showFreq(s.hz, atsScan.mode).replace(/ (kHz|MHz)$/, ""), X(s.hz), Math.max(L.y0 + 12, Y(s.rssi) - 5));
    });
  }
  // Where the scan is now
  if (atsScan.running && atsScan.i < atsScan.points.length) {
    g.strokeStyle = c.warm;
    g.lineWidth = 1.5;
    const x = X(atsScan.points[atsScan.i]);
    g.beginPath(); g.moveTo(x, L.y0); g.lineTo(x, L.y1); g.stroke();
  }
  // The step under the mouse
  if (atsScan.hover >= 0 && atsScan.readings[atsScan.hover]) {
    const r = atsScan.readings[atsScan.hover];
    g.strokeStyle = c.text;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(X(r.hz) + 0.5, L.y0); g.lineTo(X(r.hz) + 0.5, L.y1); g.stroke();
  }
}

/** The reading nearest to a point on the graph. */
function atsScanAt(e) {
  const cv = $("atsScanGraph");
  if (!atsScan.readings.length) return -1;
  const rect = cv.getBoundingClientRect();
  const L = atsScanLayout(rect.width, 180);
  const first = atsScan.points[0], last = atsScan.points[atsScan.points.length - 1];
  const hz = first + ((e.clientX - rect.left - L.x0) / (L.x1 - L.x0)) * (last - first);
  let best = -1;
  atsScan.readings.forEach((r, k) => { if (best < 0 || Math.abs(r.hz - hz) < Math.abs(atsScan.readings[best].hz - hz)) best = k; });
  return best;
}

function atsScanTune(hz) {
  if (atsScan.running) return;
  tuneTo(hz / 1000, atsScanListen(atsScan.mode), { quiet: true });
}

function atsScanCsv() {
  if (!atsScan.readings.length) return;
  const blob = new Blob([AtsScan.csv(atsScan.readings, atsScan.mode)], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ats-mini-scan-${Math.round(atsScan.points[0] / 1000)}-${Math.round(atsScan.points[atsScan.points.length - 1] / 1000)}kHz-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  atsScanMsg(`Saved ${atsScan.readings.length} readings to a file in your Downloads.`);
}

function renderAtsScan() {
  atsScanState();
  if ($("atsScanBox") && $("atsScanBox").open) atsScanDraw();
}

function setupAtsScan() {
  const box = $("atsScanBox");
  if (!box) return;
  const sel = $("atsScanPreset");
  AtsScan.PRESETS.forEach(([label], k) => {
    const o = document.createElement("option");
    o.value = String(k);
    o.textContent = label;
    sel.append(o);
  });
  sel.addEventListener("change", () => {
    const p = AtsScan.PRESETS[Number(sel.value)];
    if (!sel.value || !p) return;
    $("atsScanFrom").value = String(p[1]);
    $("atsScanTo").value = String(p[2]);
    $("atsScanStep").value = String(p[3]);
    $("atsScanMode").value = p[4];
    atsScanMsg("");
  });
  box.addEventListener("toggle", () => {
    // Start from the band the radio is on, in its mode
    if (box.open && !$("atsScanFrom").value && rig.connected && rig.ats.band >= 0) {
      const b = ATS_BANDS[rig.ats.band];
      const fm = b[0] === "VHF";
      $("atsScanFrom").value = String(fm ? 87500 : b[1]);
      $("atsScanTo").value = String(b[2]);
      $("atsScanMode").value = fm ? "FM" : ["LSB", "USB"].includes(rig.ats.mode) ? rig.ats.mode : "AM";
      $("atsScanStep").value = fm ? "100" : ["LSB", "USB"].includes(rig.ats.mode) ? "1" : "5";
    }
    renderAtsScan();
  });
  $("atsScanForm").addEventListener("submit", (e) => { e.preventDefault(); atsScanStart(); });
  $("atsScanStop").addEventListener("click", atsScanStop);
  $("atsScanCsv").addEventListener("click", atsScanCsv);
  const cv = $("atsScanGraph");
  cv.addEventListener("mousemove", (e) => {
    const k = atsScanAt(e);
    atsScan.hover = k;
    const tip = $("atsScanTip");
    const r = atsScan.readings[k];
    if (!r) { tip.hidden = true; atsScanDraw(); return; }
    tip.hidden = false;
    tip.textContent = `${AtsScan.showFreq(r.hz, atsScan.mode)}: ${r.rssi == null ? "no reading" : `${r.rssi} dBµV, SNR ${r.snr} dB`}${atsScan.running ? "" : ". Click to tune."}`;
    atsScanDraw();
  });
  cv.addEventListener("mouseleave", () => { atsScan.hover = -1; $("atsScanTip").hidden = true; atsScanDraw(); });
  cv.addEventListener("click", (e) => {
    const r = atsScan.readings[atsScanAt(e)];
    if (r) atsScanTune(r.hz);
  });
  $("atsScanRows").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act='tune']");
    if (b) atsScanTune(Number(b.closest("tr").dataset.hz));
  });
  window.addEventListener("resize", () => { if (box.open) atsScanDraw(); });
  setInterval(atsScanTick, 100);
  atsScanState();
}
