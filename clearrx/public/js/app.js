/* ClearRX by M3VRV: the window. Sound comes in from the chosen input (your radio's USB sound card or a line-in),
   goes through the effects in clearrx-worklet.js (which uses rxfx.js), and out to the chosen speakers.
   The settings are kept by ClearRX.exe (/api/settings), so they're there next time and Band Watch can use them. */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PRESETS = [["off", "Off"], ["ssb", "SSB voice"], ["weak", "Weak DX"], ["cw", "CW"], ["am", "AM broadcast"]];
const LO = [100, 200, 300, 400, 500], HI = [1800, 2100, 2400, 2700, 3000, 3500, 4500, 6000];
const TONES = [500, 600, 650, 700, 750, 800], WIDTHS = [100, 150, 200, 300, 500];
/* "My radio": which sound input to look for, a starting preset, and a tip for that radio. */
const RADIOS = [
  { id: "rtl", label: "RTL-SDR", preset: "ssb",
    tip: "Your RTL-SDR's sound comes through Band Watch: in Band Watch, open Listen, pick Receiver: My RTL-SDR and tick "
      + "\"Send my RTL-SDR sound through ClearRX\". You don't need to press Start here; just keep ClearRX open and set the switches." },
  { id: "yaesu", label: "Yaesu", preset: "ssb", match: [/usb audio codec/i, /usb audio/i],
    tip: "Yaesu (FT-991A, FT-710, FTdx10 and others): the sound comes in on the radio's USB Audio CODEC, the same USB lead as "
      + "radio control. If ClearRX says it's too loud, turn down the radio's USB/DATA output level in its menu." },
  { id: "icom", label: "Icom", preset: "ssb", match: [/usb audio codec/i, /usb audio/i],
    tip: "Icom (IC-7300, IC-705, IC-7610 and others): the sound comes in on the radio's USB Audio CODEC. On the IC-7300 its level "
      + "is MENU > SET > Connectors > ACC/USB AF Output Level." },
  { id: "ats", label: "ATS Mini", preset: "am", match: [/line/i, /microphone|mic/i],
    tip: "The ATS Mini has no USB sound. Run a lead from its headphone socket to the PC's line-in (often the blue socket) or "
      + "microphone socket, and set the ATS Mini's volume to about half." },
  { id: "malahit", label: "Malahit", preset: "ssb", match: [/malahit/i, /usb audio/i, /line/i],
    tip: "Malahit DSP2: if Windows shows a Malahit or USB audio input, ClearRX picks it. If not, run a lead from its headphone "
      + "socket to the PC's line-in." },
  { id: "other", label: "Other / mixer", tip: "Pick where the sound comes from yourself: a mixer, a sound card or a line-in." },
];

const KEYS = ["voice", "lo", "hi", "cw", "tone", "width", "notch", "nr", "nrLevel", "comp"];

const app = {
  findAfterStart: false,
  s: { radio: "", preset: "ssb", voice: true, lo: 300, hi: 2700, cw: false, tone: 700, width: 200, notch: true, nr: false, nrLevel: 1, comp: true, on: true },
  ctx: null, node: null, stream: null, before: null, after: null, running: false, bypass: false, gain: 1,
  meter: { inPeak: -120, outPeak: -120, clip: false }, saveTimer: null,
};

/* ---------- Settings: kept by ClearRX.exe ---------- */
async function loadSettings() {
  try {
    const r = await fetch("/api/settings");
    if (r.ok) Object.assign(app.s, await r.json());
  } catch { /* defaults */ }
  try { app.gain = Math.max(0, Math.min(2, Number(localStorage.getItem("clearrx-gain")) || 1)); } catch { /* default */ }
}
function saveSettings() {
  clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(() => {
    fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(app.s) }).catch(() => {});
  }, 250);
}

/** The effects' settings from a preset, or the boxes for Custom. */
function applySettings() {
  const s = app.s;
  if (s.preset !== "custom") {
    const p = RxFx.PRESETS[s.preset] || RxFx.PRESETS.off;
    for (const k of KEYS) if (p[k] !== undefined) s[k] = p[k];
    if (s.preset === "off") for (const k of ["voice", "cw", "notch", "nr", "comp"]) s[k] = false;
  }
  const settings = {};
  for (const k of KEYS) settings[k] = s[k];
  if (app.node) app.node.port.postMessage({ settings, bypass: app.bypass, gain: app.gain });
  render();
}

/* ---------- Sound in and out ---------- */
async function listDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  const all = await navigator.mediaDevices.enumerateDevices();
  const fill = (sel, kind, first) => {
    const keep = sel.value || (() => { try { return localStorage.getItem(`clearrx-${sel.id}`) || ""; } catch { return ""; } })();
    const devs = all.filter((d) => d.kind === kind && d.deviceId !== "default" && d.deviceId !== "communications");
    sel.innerHTML = `<option value="">${first}</option>${devs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || `${kind === "audioinput" ? "Input" : "Output"} ${i + 1}`)}</option>`).join("")}`;
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  };
  fill($("inDev"), "audioinput", "Default input");
  fill($("outDev"), "audiooutput", "Default speakers");
  $("outDev").disabled = !("setSinkId" in AudioContext.prototype);
  if ($("outDev").disabled) $("outDev").title = "This browser plays to the default speakers only";
}

async function start() {
  if (app.running) return;
  try {
    const id = $("inDev").value;
    // The radio's sound as it is: no echo cancelling, noise suppression or automatic gain from the browser
    app.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: id ? { exact: id } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 },
    } });
    app.ctx = new AudioContext({ sampleRate: RxFx.RATE, latencyHint: "interactive" });
    await app.ctx.audioWorklet.addModule("/js/rxfx.js?v=1.1.0");
    await app.ctx.audioWorklet.addModule("/js/clearrx-worklet.js?v=1.1.0");
    const src = app.ctx.createMediaStreamSource(app.stream);
    app.node = new AudioWorkletNode(app.ctx, "clearrx", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    app.node.port.onmessage = (e) => { if (e.data && e.data.meter) app.meter = e.data.meter; };
    app.before = app.ctx.createAnalyser(); app.after = app.ctx.createAnalyser();
    for (const a of [app.before, app.after]) { a.fftSize = 4096; a.smoothingTimeConstant = 0.6; }
    src.connect(app.before);
    src.connect(app.node);
    app.node.connect(app.after);
    app.node.connect(app.ctx.destination);
    const out = $("outDev").value;
    if (out && app.ctx.setSinkId) await app.ctx.setSinkId(out).catch(() => setStatus("Couldn't use that output: playing to the default speakers."));
    if (app.ctx.state === "suspended") await app.ctx.resume();
    app.running = true;
    applySettings();
    await listDevices(); // now the names show (the browser only gives them after you allow the sound)
    setStatus(`Running: ${selectedName($("inDev"))} → ${selectedName($("outDev"))}.`);
    if (app.findAfterStart) { app.findAfterStart = false; setTimeout(() => pickRadio(app.s.radio, false), 0); }
  } catch (e) {
    stop();
    setStatus(e && e.name === "NotAllowedError"
      ? "ClearRX needs permission to use the sound input. Press Start again and choose Allow."
      : `Couldn't start the sound: ${e.message || e}`);
  }
  render();
}

function stop() {
  app.running = false;
  if (app.stream) for (const t of app.stream.getTracks()) t.stop();
  if (app.ctx) app.ctx.close().catch(() => {});
  app.ctx = app.node = app.stream = app.before = app.after = null;
  app.meter = { inPeak: -120, outPeak: -120, clip: false };
  render();
}

const selectedName = (sel) => (sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : "default");
function setStatus(t) { $("status").textContent = t; }

/* ---------- My radio ---------- */
/** The input for a radio: the first input whose name matches, in order of the radio's patterns. */
function findInput(radio) {
  const opts = [...$("inDev").options].filter((o) => o.value);
  for (const re of radio.match || []) {
    const o = opts.find((x) => re.test(x.textContent));
    if (o) return o.value;
  }
  return null;
}

/** Choose a radio: remember it, set its preset (when picked by hand) and its sound input. */
async function pickRadio(id, byHand) {
  const radio = RADIOS.find((x) => x.id === id);
  if (!radio) return;
  app.s.radio = id;
  if (byHand && radio.preset) app.s.preset = radio.preset;
  applySettings();
  saveSettings();
  if (!radio.match) return;
  const names = [...$("inDev").options].some((o) => o.value && o.textContent && !/^Input \d+$/.test(o.textContent));
  const dev = findInput(radio);
  if (dev === null) {
    setStatus(names
      ? `ClearRX couldn't find a sound input for your ${radio.label}. Check it's plugged in, or pick it in "Sound from".`
      : `Press Start once and allow the sound input, so ClearRX can see your sound devices' names and find your ${radio.label}.`);
    if (!names) app.findAfterStart = true;
    return;
  }
  if ($("inDev").value === dev) return;
  $("inDev").value = dev;
  try { localStorage.setItem("clearrx-inDev", dev); } catch { /* fine */ }
  setStatus(`Sound from: ${selectedName($("inDev"))} (for your ${radio.label}).`);
  if (app.running) { stop(); await start(); }
}

/* ---------- Screen ---------- */
function render() {
  const s = app.s;
  for (const b of $("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.p === s.preset));
  for (const b of $("radios").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.r === s.radio));
  const r = RADIOS.find((x) => x.id === s.radio);
  $("radioTip").textContent = r ? r.tip : "Pick your radio, and ClearRX finds its sound input and a good starting preset.";
  $("fxVoice").checked = s.voice; $("fxLo").value = String(s.lo); $("fxHi").value = String(s.hi);
  $("fxCw").checked = s.cw; $("fxTone").value = String(s.tone); $("fxWidth").value = String(s.width);
  $("fxNotch").checked = s.notch; $("fxNr").checked = s.nr; $("fxNrLevel").value = String(s.nrLevel); $("fxComp").checked = s.comp;
  $("bypass").checked = app.bypass;
  $("power").textContent = app.running ? "Stop" : "Start";
  $("power").setAttribute("aria-pressed", String(app.running));
  $("vol").value = String(Math.round(app.gain * 100));
  $("volVal").textContent = `${Math.round(app.gain * 100)}%`;
}

function drawMeters() {
  const pct = (db) => Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  const m = app.meter;
  $("inBar").style.width = `${app.running ? pct(m.inPeak) : 0}%`;
  $("outBar").style.width = `${app.running ? pct(m.outPeak) : 0}%`;
  $("inDb").textContent = app.running ? `${Math.round(m.inPeak)} dB` : "";
  $("outDb").textContent = app.running ? `${Math.round(m.outPeak)} dB` : "";
  $("inBar").classList.toggle("hot", app.running && m.inPeak > -3);
  $("outBar").classList.toggle("hot", app.running && m.outPeak > -3);
  $("clip").textContent = app.running && m.clip
    ? "The sound coming in is too loud: turn down the radio's USB audio level (or this PC's input level), or the Volume here."
    : "";
}

function drawSpectrum() {
  const cv = $("spec");
  const W = cv.clientWidth || 600, H = cv.clientHeight || 160, dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const TOP = 6000; // Hz: radio sound lives below this (AM to about 4.5 kHz), so the filters show
  // Grid with kHz marks
  g.strokeStyle = "rgba(127,154,166,.25)"; g.fillStyle = "#7f9aa6"; g.font = "11px system-ui, sans-serif"; g.lineWidth = 1;
  for (let k = 0; k <= 6; k++) {
    const x = (k * 1000 / TOP) * W;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H - 14); g.stroke();
    g.textAlign = k === 0 ? "left" : k === 6 ? "right" : "center";
    g.fillText(`${k} kHz`, Math.min(W - 2, Math.max(2, x)), H - 2);
  }
  if (!app.running || !app.before) return;
  const trace = (an, colour, fill) => {
    const bins = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(bins);
    const hz = app.ctx.sampleRate / an.fftSize;
    g.beginPath();
    for (let x = 0; x < W; x++) {
      const k = Math.min(bins.length - 1, Math.round(((x / W) * TOP) / hz));
      const v = Math.max(0, Math.min(1, (bins[k] + 110) / 90));
      const y = (H - 14) - v * (H - 20);
      x ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    if (fill) { g.lineTo(W, H - 14); g.lineTo(0, H - 14); g.closePath(); g.fillStyle = fill; g.fill(); }
    else { g.strokeStyle = colour; g.lineWidth = 1.5; g.stroke(); }
  };
  trace(app.before, null, "rgba(160,170,180,.28)");
  trace(app.after, "#45e0f5", null);
}

function frame() {
  drawMeters();
  drawSpectrum();
  requestAnimationFrame(frame);
}

/* ---------- Band Watch's link ---------- */
async function checkLink() {
  try {
    const h = await (await fetch("/healthz", { cache: "no-store" })).json();
    $("bwLink").hidden = !h.bandWatchLinked;
  } catch { $("bwLink").hidden = true; }
}

/* ---------- Setup ---------- */
async function setup() {
  await loadSettings();
  $("presets").innerHTML = PRESETS.map(([k, l]) => `<button type="button" class="key" data-p="${k}" aria-pressed="false">${esc(l)}</button>`).join("")
    + '<button type="button" class="key" data-p="custom" aria-pressed="false" disabled title="Change any switch for your own settings">Custom</button>';
  $("radios").innerHTML = RADIOS.map((r) => `<button type="button" class="key" data-r="${r.id}" aria-pressed="false">${esc(r.label)}</button>`).join("");
  $("radios").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) pickRadio(b.dataset.r, true);
  });
  $("fxLo").innerHTML = LO.map((v) => `<option value="${v}">${v} Hz</option>`).join("");
  $("fxHi").innerHTML = HI.map((v) => `<option value="${v}">${(v / 1000).toFixed(1)} kHz</option>`).join("");
  $("fxTone").innerHTML = TONES.map((v) => `<option value="${v}">${v} Hz</option>`).join("");
  $("fxWidth").innerHTML = WIDTHS.map((v) => `<option value="${v}">${v} Hz</option>`).join("");
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    app.s.preset = b.dataset.p;
    applySettings(); saveSettings();
  });
  const custom = (k, v) => { app.s[k] = v; app.s.preset = "custom"; applySettings(); saveSettings(); };
  for (const [id, k] of [["fxVoice", "voice"], ["fxCw", "cw"], ["fxNotch", "notch"], ["fxNr", "nr"], ["fxComp", "comp"]]) $(id).addEventListener("change", (e) => custom(k, e.target.checked));
  for (const [id, k] of [["fxLo", "lo"], ["fxHi", "hi"], ["fxTone", "tone"], ["fxWidth", "width"], ["fxNrLevel", "nrLevel"]]) $(id).addEventListener("change", (e) => custom(k, Number(e.target.value)));
  $("bypass").addEventListener("change", (e) => { app.bypass = e.target.checked; applySettings(); });
  $("vol").addEventListener("input", (e) => {
    app.gain = Number(e.target.value) / 100;
    try { localStorage.setItem("clearrx-gain", String(app.gain)); } catch { /* fine */ }
    applySettings();
  });
  for (const id of ["inDev", "outDev"]) $(id).addEventListener("change", (e) => {
    try { localStorage.setItem(`clearrx-${id}`, e.target.value); } catch { /* fine */ }
    if (app.running) { stop(); start(); }
  });
  $("power").addEventListener("click", () => (app.running ? stop() : start()));
  $("quit").addEventListener("click", async (e) => {
    e.preventDefault();
    stop();
    await fetch("/api/quit", { method: "POST", headers: { "X-ClearRX": "quit" } }).catch(() => {});
    setStatus("ClearRX has closed. You can close this window.");
    window.close();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", listDevices);
  applySettings(); // shows the saved preset straight away
  await listDevices();
  checkLink();
  setInterval(checkLink, 3000);
  requestAnimationFrame(frame);
}

setup();
