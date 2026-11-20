/* ClearRX by M3VRV: the window. Sound comes in from the chosen input (your radio's USB sound card or a line-in),
   goes through the effects in clearrx-worklet.js (which uses rxfx.js), and out to the chosen speakers.
   The settings are kept by ClearRX.exe (/api/settings), so they're there next time and Band Watch can use them. */
"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PRESETS = [["off", "Off"], ["ssb", "SSB voice"], ["weak", "Weak DX"], ["cw", "CW"], ["am", "AM broadcast"]];
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

// The extras: noise blanker, hiss remover, AGC speed, squelch, tone, manual notch and the compressor / limiter. Picking a preset leaves them as they are.
const EXTRAS = ["nb", "nbLevel", "snr", "snrLevel", "snrProfile", "agc", "sq", "bass", "treble", "mnotch", "cmp", "cmpThr", "cmpRatio", "cmpMakeup", "cmpLimit"];
// Everything the sound processor is told. The EQ and the module order are set by the presets (the order only by you).
const KEYS = ["voice", "lo", "hi", "cw", "tone", "width", "notch", "nr", "nrLevel", "comp", "eq", "eqGains", "order", ...EXTRAS];

const app = {
  findAfterStart: false,
  s: { radio: "", preset: "ssb", voice: true, lo: 300, hi: 2700, cw: false, tone: 700, width: 200, notch: true, nr: false, nrLevel: 1, comp: true, on: true,
    nb: false, nbLevel: 2, snr: false, snrLevel: 15, snrProfile: [], agc: "medium", sq: 0, bass: 0, treble: 0, mnotch: 0,
    order: RxFx.MODULES.slice(), eq: false, eqPreset: "flat", eqGains: RxFx.EQ_PRESETS.flat.slice(), cmp: false, cmpThr: -18, cmpRatio: 3, cmpMakeup: 0, cmpLimit: true },
  // What a module that is off by having the value 0 (squelch, manual notch, bass/treble) goes back to when it's switched on again
  last: { sq: -50, mnotch: 1000, bass: 0, treble: 0 }, armed: { tone: false }, focusMove: null, gr: 0, outClipAt: 0, snrLearning: 0,
  ctx: null, node: null, stream: null, before: null, after: null, running: false, bypass: false, gain: 1,
  meter: { inPeak: -120, outPeak: -120, outRms: -120, gr: 0, clip: false, outClip: false }, saveTimer: null,
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
    // A preset sets the EQ too (its own curve; Off is flat and off)
    const eq = RxFx.PRESET_EQ[s.preset] || "flat";
    s.eqPreset = eq; s.eqGains = RxFx.EQ_PRESETS[eq].slice(); s.eq = eq !== "flat";
    if (s.preset === "off") {
      for (const k of ["voice", "cw", "notch", "nr", "comp", "nb", "snr", "cmp"]) s[k] = false;
      for (const k of ["sq", "bass", "treble", "mnotch"]) s[k] = 0; // Off means everything off
    }
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
    await app.ctx.audioWorklet.addModule("/js/rxfx.js?v=1.3.0");
    await app.ctx.audioWorklet.addModule("/js/clearrx-worklet.js?v=1.3.0");
    const src = app.ctx.createMediaStreamSource(app.stream);
    app.node = new AudioWorkletNode(app.ctx, "clearrx", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    app.node.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.meter) app.meter = d.meter;
      if (Array.isArray(d.profile)) gotNoiseProfile(d.profile);
    };
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
    if (scope.view) scope.view.ring.clear();
    applySettings();
    scopeKick();
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
  app.meter = { inPeak: -120, outPeak: -120, outRms: -120, gr: 0, clip: false, outClip: false };
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

/* ---------- The effects rack ----------
   Each module is a card: a switch, its controls, Reset, and arrows to move it up or down. The sound goes through the
   modules from the top to the bottom, and the order is kept (s.order) and sent to the sound processor, which
   changes over with a short fade so there's no click. "kind": a preset sets the module ("preset"), or the module is
   an extra that keeps its settings whichever preset you pick ("extra"). */
const FMT = {
  lo: (v) => `${v} Hz`, hi: (v) => `${v} Hz`, mnotch: (v) => `${v} Hz`, sq: (v) => `${v} dB`,
  bass: (v) => `${v > 0 ? "+" : ""}${v} dB`, treble: (v) => `${v > 0 ? "+" : ""}${v} dB`,
  snrLevel: (v) => `${v} dB`, cmpThr: (v) => `${v} dB`, cmpRatio: (v) => `${v}:1`, cmpMakeup: (v) => `+${v} dB`,
};
const rng = (k, label, min, max, step) => `<label class="ctl"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}"><output data-o="${k}"></output></label>`;
const sel = (k, label, opts, str) => `<label class="ctl"><span>${label}</span><select data-k="${k}"${str ? " data-str" : ""}>${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></label>`;
const LEVELS = [[1, "Light"], [2, "Medium"], [3, "Strong"]];
const BANDS = [["SSB", 300, 2700], ["Wide", 100, 3000], ["CW", 400, 800], ["AM", 100, 4500]];
const hzName = (f) => (f >= 1000 ? `${f / 1000}k` : String(f));

/* ---------- The 3D spectrum scope (in the graphic EQ's card; the drawing is in scope3d.js) ----------
   It reads the "before" or "after" analyser (already there for the 2D spectrum), 20 times a second: nothing extra runs in the
   sound thread. Its on/off and Before/After are kept in this browser only (like the volume). It stops drawing when it is
   switched off, scrolled out of view, or the page is hidden. */
const SCOPE_HTML = `<div class="scope3d" id="scope3d">
  <div class="scopebar">
    <button type="button" class="key mini" id="scopeOn" aria-pressed="true">3D scope</button>
    <span class="scopechips" role="group" aria-label="What the scope shows">
      <button type="button" class="key mini" data-scopesrc="before" aria-pressed="false">Before</button>
      <button type="button" class="key mini" data-scopesrc="after" aria-pressed="true">After</button>
    </span>
    <span class="small" id="scopeNote"></span>
  </div>
  <div class="scopewrap" id="scopeWrap">
    <canvas id="scope3dCv" role="img" aria-label="3D spectrum scope: frequency from 50 Hz to 6 kHz across, time from now at the front to a few seconds ago at the back, level as height. The glowing line on the front edge is the graphic EQ's curve." aria-describedby="scopeDesc"></canvas>
  </div>
  <p class="sr" id="scopeDesc"></p>
</div>`;
const scope = { on: true, src: "after", view: null, visible: true, raf: 0, last: 0, descAt: 0, bins: null, reduced: false, dirty: true };
const scopeActive = () => scope.on && scope.visible && !document.hidden && Boolean(scope.view);
function scopeKick() { if (!scope.raf && scopeActive()) scope.raf = requestAnimationFrame(scopeLoop); }
function scopeLoop(now) {
  scope.raf = 0;
  if (!scopeActive()) return; // switched off, scrolled out of view or the page is hidden: nothing is drawn
  const interval = scope.reduced ? 250 : 50; // 20 rows a second (4 with "reduce motion")
  const an = app.running ? app[scope.src] : null;
  if (an && now - scope.last >= interval) {
    scope.last = now;
    if (!scope.bins || scope.bins.length !== an.frequencyBinCount) scope.bins = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(scope.bins);
    scope.view.pushBins(scope.bins, app.ctx.sampleRate, an.fftSize, interval / 1000);
    scope.dirty = true;
  }
  if (scope.dirty) { scope.dirty = false; scope.view.draw(); }
  if (now - scope.descAt > 1000) { scope.descAt = now; scopeDescribe(); }
  scopeKick();
}
function scopeDescribe() {
  const v = scope.view, s = app.s, name = scope.src === "before" ? "before ClearRX" : "after ClearRX";
  const bands = RxFx.EQ_FREQS.map((f, i) => [f, s.eq ? s.eqGains[i] : 0]).filter(([, g]) => g !== 0);
  const eq = bands.length ? `The EQ changes ${bands.map(([f, g]) => `${hzName(f)} Hz by ${g > 0 ? "plus " : "minus "}${Math.abs(g)} dB`).join(", ")}.` : "The EQ is flat.";
  const pk = app.running && v.peak.db > -90 ? `Loudest at about ${Math.round(v.peak.f)} Hz, ${Math.round(v.peak.db)} dB.` : "No sound yet.";
  const txt = `Showing the sound ${name}. ${pk} ${eq}`;
  const el = $("scopeDesc");
  if (el && el.textContent !== txt) el.textContent = txt;
}
function scopeApplyEq() {
  if (!scope.view) return;
  if (scope.view.setEq(app.s.eqGains, app.s.eq)) { scope.dirty = true; scopeKick(); }
}
function scopeRender() {
  $("scopeOn").setAttribute("aria-pressed", String(scope.on));
  for (const b of document.querySelectorAll("[data-scopesrc]")) b.setAttribute("aria-pressed", String(b.dataset.scopesrc === scope.src));
  $("scopeWrap").hidden = !scope.on;
  $("scopeNote").textContent = scope.on ? "Front = now, back = a few seconds ago. The glowing line is the EQ." : "The 3D scope is off (it uses some of the computer's power).";
}
function scopeSave() { try { localStorage.setItem("clearrx-scope3d", scope.on ? "1" : "0"); localStorage.setItem("clearrx-scope3dsrc", scope.src); } catch { /* fine */ } }
function setupScope() {
  try {
    scope.on = localStorage.getItem("clearrx-scope3d") !== "0";
    scope.src = localStorage.getItem("clearrx-scope3dsrc") === "before" ? "before" : "after";
  } catch { /* defaults */ }
  const cv = $("scope3dCv");
  if (typeof Scope3D === "undefined" || !cv.getContext) { $("scope3d").hidden = true; return; }
  scope.view = new Scope3D.Scope3DView(cv, { respFn: RxFx.eqResponseDb, bandFreqs: RxFx.EQ_FREQS });
  scope.view.setSource(scope.src);
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  if (mq) { scope.reduced = mq.matches; mq.addEventListener("change", (e) => { scope.reduced = e.matches; }); }
  const again = () => { scope.view.geo = null; scope.dirty = true; scopeKick(); }; // size changed (or the screen's pixel ratio): lay it out again
  if (window.ResizeObserver) new ResizeObserver(again).observe($("scopeWrap")); else window.addEventListener("resize", again);
  if (window.IntersectionObserver) new IntersectionObserver((es) => { scope.visible = es[es.length - 1].isIntersecting; scope.dirty = true; scopeKick(); }).observe(cv);
  document.addEventListener("visibilitychange", () => { scope.dirty = true; scopeKick(); });
  $("scope3d").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "scopeOn") scope.on = !scope.on;
    else if (b.dataset.scopesrc) { scope.src = b.dataset.scopesrc; scope.view.setSource(scope.src); }
    else return;
    scopeSave(); scopeRender();
    scope.view.geo = null; scope.dirty = true; scopeKick();
  });
  scopeRender();
  scopeApplyEq();
  scopeKick();
  window.ClearRXScope = { scope, stats: scope.view.stats }; // so its speed can be checked
}

const MOD_UI = {
  nb: { kind: "extra", power: "fxNb", hint: "Silences clicks and crackles (ignition, electric fences, static).", body: sel("nbLevel", "Strength", LEVELS), reset: { nbLevel: 2 } },
  voice: { kind: "preset", power: "fxVoice", hint: "Keeps only the part of the sound you want: a voice sits between about 300 and 2700 Hz, Morse in a narrow slice.",
    body: `<div class="chips" role="group" aria-label="Band-pass presets">${BANDS.map(([n, lo, hi]) => `<button type="button" class="key mini" data-bp="${lo},${hi}" aria-pressed="false" title="${lo} to ${hi} Hz">${n} ${lo}-${hi}</button>`).join("")}</div>`
      + rng("lo", "Low cut", 50, 1500, 10) + rng("hi", "High cut", 350, 8000, 50), reset: { lo: 300, hi: 2700 } },
  cw: { kind: "preset", power: "fxCw", hint: "A narrow filter on the Morse note, for a crowded band.", body: sel("tone", "Note", TONES.map((v) => [v, `${v} Hz`])) + sel("width", "Width", WIDTHS.map((v) => [v, `${v} Hz`])), reset: { tone: 700, width: 200 } },
  mnotch: { kind: "extra", power: "fxMnotch", hint: "Cuts out one whistle at the pitch you choose.", body: rng("mnotch", "Notch at", 200, 3000, 10), reset: { mnotch: 1000 } },
  notch: { kind: "preset", power: "fxNotch", hint: "Learns steady whistles and carriers and removes them; voices pass.", body: "", reset: null },
  snr: { kind: "extra", power: "fxSnr", hint: "Takes away steady hiss and noise. Tune to an empty bit of the band and press Learn noise, and it learns exactly what to take out.",
    body: rng("snrLevel", "Strength", 6, 30, 1)
      + `<div class="chips"><button type="button" class="key mini" data-snrlearn>Learn noise</button><button type="button" class="key mini" data-snrforget>Forget it</button></div>`
      + `<p class="small" id="snrState" aria-live="polite"></p>`, reset: { snrLevel: 15 } },
  nr: { kind: "preset", power: "fxNr", hint: "Takes the hiss down and keeps voices and tones.", body: sel("nrLevel", "Strength", LEVELS), reset: { nrLevel: 1 } },
  sq: { kind: "extra", power: "fxSq", hint: "Quiet between signals. It listens at this place in the rack, so put it before the compressors.", body: rng("sq", "Opens above", -80, -20, 1), reset: { sq: -50 } },
  comp: { kind: "preset", power: "fxComp", hint: "Brings quiet and loud stations to a steady level.", body: sel("agc", "Speed", [["fast", "Fast"], ["medium", "Medium"], ["slow", "Slow"]], true), reset: { agc: "medium" } },
  eq: { kind: "preset", power: "fxEq", pre: "scope", hint: "Ten bands, 100 Hz to 5 kHz, up or down 12 dB. Drag a slider, or use the arrow keys.",
    body: `<div class="chips" role="group" aria-label="EQ presets">${Object.entries(RxFx.EQ_NAMES).map(([k, n]) => `<button type="button" class="key mini" data-eqp="${k}" aria-pressed="false">${esc(n)}</button>`).join("")}</div>`
      + `<div class="eqbank">${RxFx.EQ_FREQS.map((f, i) => `<div class="band"><output class="dbv" data-ev="${i}"></output><span class="track"><input type="range" data-eq="${i}" min="-12" max="12" step="1" aria-label="${hzName(f)} Hz gain, dB"></span><span class="hz">${hzName(f)}</span></div>`).join("")}</div>`,
    reset: { eqPreset: "flat" } },
  tone: { kind: "extra", power: "fxTone", hint: "Warmer or brighter sound.", body: rng("bass", "Bass", -12, 12, 1) + rng("treble", "Treble", -12, 12, 1), reset: { bass: 0, treble: 0 } },
  cmp: { kind: "extra", power: "fxCmp", hint: "Turns down loud sound over the threshold, and the limiter stops it clipping.",
    body: rng("cmpThr", "Threshold", -60, 0, 1) + rng("cmpRatio", "Ratio", 1, 20, 1) + rng("cmpMakeup", "Make-up gain", 0, 24, 1)
      + `<label class="ctl chk"><input type="checkbox" data-k="cmpLimit"><span>Limiter (holds the sound under -1 dB)</span></label>`
      + `<div class="grrow"><span>Gain reduction</span><div class="bar gr"><i id="grBar"></i></div><b id="grDb">0 dB</b></div>`, reset: { cmpThr: -18, cmpRatio: 3, cmpMakeup: 0, cmpLimit: true } },
};
// The setting each switch turns on (the manual notch, squelch and bass/treble are on when their value isn't 0)
const POWER_KEY = { nb: "nb", snr: "snr", voice: "voice", cw: "cw", notch: "notch", nr: "nr", comp: "comp", eq: "eq", cmp: "cmp" };

function isOn(id) {
  const s = app.s;
  if (id === "mnotch") return s.mnotch !== 0;
  if (id === "sq") return s.sq !== 0;
  if (id === "tone") return s.bass !== 0 || s.treble !== 0 || app.armed.tone;
  return Boolean(s[POWER_KEY[id]]);
}

function buildRack() {
  $("mods").innerHTML = RxFx.MODULES.map((id) => {
    const m = MOD_UI[id], name = RxFx.MODULE_NAMES[id];
    return `<li class="mod" data-mod="${id}" aria-label="${esc(name)}">
      <div class="mhead">
        <span class="idx" aria-hidden="true"></span>
        <label class="sw"><input type="checkbox" id="${m.power}" data-power><span class="mtitle">${esc(name)}</span></label>
        <span class="mbtns">
          <button type="button" class="key mini" data-reset${m.reset ? "" : " disabled title=\"Nothing to reset\""}>Reset</button>
          <button type="button" class="key mini arrow" data-move="-1" aria-label="Move ${esc(name)} up">&#9650;</button>
          <button type="button" class="key mini arrow" data-move="1" aria-label="Move ${esc(name)} down">&#9660;</button>
        </span>
      </div>
      <p class="mhint">${esc(m.hint)}</p>
      ${m.pre === "scope" ? SCOPE_HTML : ""}
      ${m.body ? `<div class="mbody">${m.body}</div>` : ""}
    </li>`;
  }).join("");
}

/** Change settings from a module. A preset's modules make the preset Custom; extras keep it (but Off would switch them straight off again). */
function change(patch, kind) {
  Object.assign(app.s, patch);
  if (kind === "preset" || app.s.preset === "off") app.s.preset = "custom";
  applySettings(); saveSettings();
}

function say(t) { $("rackNote").textContent = t; }

function toggleModule(id, on) {
  const kind = MOD_UI[id].kind;
  if (id === "mnotch" || id === "sq") change({ [id]: on ? app.last[id] : 0 }, kind);
  else if (id === "tone") {
    app.armed.tone = on;
    change(on ? { bass: app.last.bass, treble: app.last.treble } : { bass: 0, treble: 0 }, kind);
  } else change({ [POWER_KEY[id]]: on }, kind);
}

function resetModule(id) {
  const m = MOD_UI[id];
  if (!m || !m.reset) return;
  const patch = { ...m.reset };
  if (id === "eq") { patch.eqGains = RxFx.EQ_PRESETS.flat.slice(); }
  // A module that's off by being 0 stays off; what it comes back at is reset
  for (const k of ["mnotch", "sq"]) if (k in patch) { app.last[k] = patch[k]; if (!app.s[k]) delete patch[k]; }
  if (id === "tone") { app.last.bass = 0; app.last.treble = 0; }
  change(patch, m.kind);
  say(`${RxFx.MODULE_NAMES[id]} is back to its usual settings.`);
}

/* Hiss remover: Learn noise listens to 1.5 seconds of an empty bit of band, and the sound thread sends back what the
   noise sounds like (a profile, kept in the settings). Forget it goes back to following the noise by itself. */
function learnNoise() {
  if (!app.running) { say("Press Start first, then tune to an empty bit of the band and press Learn noise."); return; }
  if (app.bypass) { say("Switch Bypass off first, so ClearRX can hear the noise."); return; }
  if (!app.s.snr) change({ snr: true }, "extra");
  app.node.port.postMessage({ learn: true });
  app.snrLearning = performance.now();
  say("Listening to the noise for a moment. Keep the band quiet...");
}
function gotNoiseProfile(profile) {
  app.snrLearning = 0;
  change({ snr: true, snrProfile: profile }, "extra");
  say("Learnt! The hiss remover now takes out the noise it heard. Turn the Strength up or down to taste.");
}
function snrStatus() {
  const el = $("snrState");
  if (!el) return;
  const m = app.meter.snr, learnt = (app.s.snrProfile || []).length > 0;
  let t;
  if (app.snrLearning && performance.now() - app.snrLearning < 4000) t = "Listening to the noise...";
  else if (!app.s.snr) t = learnt ? "It remembers the noise you taught it." : "";
  else {
    t = learnt ? "Using the noise you taught it." : "Following the noise by itself.";
    if (app.running && m && m.cut > 0.5) t += ` Taking out about ${Math.round(m.cut)} dB.`;
  }
  if (el.textContent !== t) el.textContent = t;
  const forget = $("mods").querySelector("[data-snrforget]");
  if (forget) forget.disabled = !learnt;
}

function moveModule(id, dir) {
  const next = RxFx.moveModule(app.s.order, id, dir);
  if (next.join() === app.s.order.join()) return;
  app.s.order = next;
  app.focusMove = { id, dir };
  applySettings(); saveSettings();
  say(`${RxFx.MODULE_NAMES[id]} is now number ${next.indexOf(id) + 1} of ${next.length}${dir < 0 ? ", earlier" : ", later"} in the chain.`);
}

function setupRack() {
  buildRack();
  const mods = $("mods");
  mods.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    const id = b.closest("[data-mod]").dataset.mod;
    if (b.dataset.move) moveModule(id, Number(b.dataset.move));
    else if (b.hasAttribute("data-reset")) resetModule(id);
    else if (b.hasAttribute("data-snrlearn")) learnNoise();
    else if (b.hasAttribute("data-snrforget")) {
      change({ snrProfile: [] }, "extra");
      say("Forgotten. The hiss remover now follows the noise by itself.");
    }
    else if (b.dataset.bp) { const [lo, hi] = b.dataset.bp.split(",").map(Number); change({ voice: true, lo, hi }, "preset"); }
    else if (b.dataset.eqp) {
      const k = b.dataset.eqp;
      change({ eq: k !== "flat", eqPreset: k, eqGains: RxFx.EQ_PRESETS[k].slice() }, "preset");
    }
  });
  mods.addEventListener("input", (e) => {
    const el = e.target;
    if (el.matches("[data-eq]")) { // an EQ slider: moving it switches the EQ on
      const g = app.s.eqGains.slice();
      g[Number(el.dataset.eq)] = Number(el.value);
      change({ eq: true, eqPreset: "custom", eqGains: g }, "preset");
    } else if (el.matches('input[type="range"][data-k]')) setControl(el, Number(el.value));
  });
  mods.addEventListener("change", (e) => {
    const el = e.target;
    if (el.matches("[data-power]")) toggleModule(el.closest("[data-mod]").dataset.mod, el.checked);
    else if (el.matches('select[data-k]')) setControl(el, el.hasAttribute("data-str") ? el.value : Number(el.value));
    else if (el.matches('input[type="checkbox"][data-k]')) setControl(el, el.checked);
  });
  $("resetOrder").addEventListener("click", () => {
    app.s.order = RxFx.MODULES.slice();
    applySettings(); saveSettings();
    say("The modules are back in their usual order.");
  });
}

/** A slider or box inside a module changed. */
function setControl(el, v) {
  const k = el.dataset.k, id = el.closest("[data-mod]").dataset.mod, patch = { [k]: v };
  if (k === "lo" && app.s.hi < v + 300) patch.hi = Math.min(8000, v + 300); // the high cut stays at least 300 Hz above
  if (k === "hi" && v < app.s.lo + 300) patch.hi = app.s.lo + 300;
  if (k in app.last) app.last[k] = v; // what it comes back at when switched on again
  if (id === "tone") app.armed.tone = true; // moving them switches it on (even if they're both at 0 for now)
  change(patch, MOD_UI[id].kind);
}

/** Show the settings in the rack: switches, controls, and the cards in their order. */
function renderRack() {
  const s = app.s, mods = $("mods");
  const cards = new Map([...mods.children].map((c) => [c.dataset.mod, c]));
  if ([...mods.children].map((c) => c.dataset.mod).join() !== s.order.join()) for (const id of s.order) mods.append(cards.get(id));
  s.order.forEach((id, i) => {
    const c = cards.get(id), on = isOn(id);
    c.querySelector(".idx").textContent = String(i + 1);
    c.classList.toggle("off", !on);
    c.querySelector("[data-power]").checked = on;
    const up = c.querySelector('[data-move="-1"]'), down = c.querySelector('[data-move="1"]');
    up.disabled = i === 0; down.disabled = i === s.order.length - 1;
  });
  for (const el of mods.querySelectorAll("[data-k]")) {
    const k = el.dataset.k;
    let v = s[k];
    if (k in app.last && v === 0) v = app.last[k]; // off: show what it'll come back at
    if (el.type === "checkbox") el.checked = Boolean(v); else el.value = String(v);
    const o = mods.querySelector(`[data-o="${k}"]`);
    if (o) o.textContent = FMT[k](v);
  }
  scopeApplyEq();
  s.eqGains.forEach((g, i) => {
    mods.querySelector(`[data-eq="${i}"]`).value = String(g);
    const o = mods.querySelector(`[data-ev="${i}"]`);
    o.textContent = `${g > 0 ? "+" : ""}${g}`;
    o.classList.toggle("nz", g !== 0);
  });
  for (const b of mods.querySelectorAll("[data-eqp]")) b.setAttribute("aria-pressed", String(b.dataset.eqp === s.eqPreset));
  for (const b of mods.querySelectorAll("[data-bp]")) b.setAttribute("aria-pressed", String(b.dataset.bp === `${s.lo},${s.hi}`));
  // After a move the card has been shifted in the page, which drops the focus: put it back on the same arrow (or the other one at an end)
  if (app.focusMove) {
    const { id, dir } = app.focusMove;
    app.focusMove = null;
    const c = cards.get(id);
    let b = c.querySelector(`[data-move="${dir}"]`);
    if (b.disabled) b = c.querySelector(`[data-move="${-dir}"]`);
    b.focus();
  }
}

/* ---------- Screen ---------- */
function render() {
  const s = app.s;
  for (const b of $("presets").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.p === s.preset));
  for (const b of $("radios").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.r === s.radio));
  const r = RADIOS.find((x) => x.id === s.radio);
  $("radioTip").textContent = r ? r.tip : "Pick your radio, and ClearRX finds its sound input and a good starting preset.";
  renderRack();
  $("bypass").checked = app.bypass;
  $("power").textContent = app.running ? "Stop" : "Start";
  $("power").setAttribute("aria-pressed", String(app.running));
  $("vol").value = String(Math.round(app.gain * 100));
  $("volVal").textContent = `${Math.round(app.gain * 100)}%`;
}

function drawMeters() {
  const pct = (db) => Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  const m = app.meter, on = app.running;
  $("inBar").style.width = `${on ? pct(m.inPeak) : 0}%`;
  $("outBar").style.width = `${on ? pct(m.outPeak) : 0}%`;
  $("inDb").textContent = on ? `${Math.round(m.inPeak)} dB` : "";
  $("outDb").textContent = on ? `${Math.round(m.outPeak)} dB` : "";
  $("outRms").textContent = on ? `average ${Math.round(m.outRms)} dB` : "";
  $("inBar").classList.toggle("hot", on && m.inPeak > -3);
  $("outBar").classList.toggle("hot", on && m.outPeak > -3);
  $("clip").textContent = on && m.clip
    ? "The sound coming in is too loud: turn down the radio's USB audio level (or this PC's input level), or the Volume here."
    : "";
  // The output's CLIP lamp stays lit for a moment, so a brief touch of the limit can be seen
  if (on && m.outClip) app.outClipAt = performance.now();
  const clipping = on && performance.now() - app.outClipAt < 1500;
  $("outLamp").classList.toggle("lit", clipping);
  $("outWarn").textContent = clipping
    ? "The sound going out is at its limit and may sound harsh: turn the Volume down, or switch on the Compressor / limiter."
    : "";
  // Compressor / limiter gain reduction: jumps up at once and falls back gently
  const now = performance.now(), dt = Math.min(0.5, (now - (app.lastDraw || now)) / 1000);
  app.lastDraw = now;
  app.gr = on ? Math.max(m.gr || 0, app.gr * Math.pow(0.92, dt * 60)) : 0; // the same fall-back whatever the frame rate
  const gb = $("grBar");
  if (gb) { gb.style.width = `${Math.min(100, (app.gr / 24) * 100)}%`; $("grDb").textContent = `${app.gr.toFixed(1)} dB`; }
  snrStatus();
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
  $("presets").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || b.disabled) return;
    app.s.preset = b.dataset.p;
    applySettings(); saveSettings();
  });
  setupRack();
  setupScope();
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
  saveSettings(); // and keeps what it works out (files from older versions get the rack's settings added)
  await listDevices();
  checkLink();
  setInterval(checkLink, 3000);
  requestAnimationFrame(frame);
}

setup();
