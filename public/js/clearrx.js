/* ClearRX: the radio audio processor's controls (the sound itself is worked on by rxfx.js).
   It works on your RTL-SDR's sound, after the decoders have had theirs untouched. Web receivers (WebSDR, KiwiSDR)
   play their own sound inside their page, so ClearRX can't reach it.
   Presets: Auto (follows the mode: SSB voice on USB/LSB, CW on CW, AM broadcast on AM, off on FM), Off, SSB voice,
   Weak DX, CW, AM broadcast; changing a box makes it Custom. */
"use strict";

const CRX_PRESETS = [["auto", "Auto"], ["off", "Off"], ["ssb", "SSB voice"], ["weak", "Weak DX"], ["cw", "CW"], ["am", "AM broadcast"]];
const CRX_LO = [100, 200, 300, 400, 500];
const CRX_HI = [1800, 2100, 2400, 2700, 3000, 3500, 4500, 6000];
const CRX_WIDTH = [100, 150, 200, 300, 500];
const crx = {
  cfg: { ...RxFx.DEFAULTS, preset: "auto" }, // Auto by default: it follows the mode
  chain: new RxFx.Chain(),
  mode: "", // the Listen mode Auto last followed
  timer: null,
};

/** The preset Auto stands for in this mode. */
function crxAutoPreset(mode) {
  return { usb: "ssb", lsb: "ssb", cw: "cw", am: "am" }[mode] || "off";
}

function loadClearRx() {
  try {
    const s = JSON.parse(load("bw-clearrx") || "{}");
    if (s && typeof s === "object") {
      if (CRX_PRESETS.some(([k]) => k === s.preset) || s.preset === "custom") crx.cfg.preset = s.preset;
      for (const k of ["voice", "cw", "notch", "nr", "comp"]) if (typeof s[k] === "boolean") crx.cfg[k] = s[k];
      for (const k of ["lo", "hi", "width", "nrLevel"]) if (Number.isFinite(s[k])) crx.cfg[k] = s[k];
    }
  } catch { /* defaults */ }
}
function saveClearRx() {
  const { preset, voice, lo, hi, cw, width, notch, nr, nrLevel, comp } = crx.cfg;
  store("bw-clearrx", { preset, voice, lo, hi, cw, width, notch, nr, nrLevel, comp });
}

/** Set the processor from the settings (Auto: from the Listen mode). */
function crxApply() {
  const c = crx.cfg;
  crx.mode = listen.mode;
  if (c.preset === "custom") {
    crx.chain.configure({ voice: c.voice, lo: c.lo, hi: c.hi, cw: c.cw, width: c.width, notch: c.notch, nr: c.nr, nrLevel: c.nrLevel, comp: c.comp });
  } else {
    const p = c.preset === "auto" ? crxAutoPreset(listen.mode) : c.preset;
    const s = crx.chain.configure({ preset: p });
    // Show the preset's switches in the boxes
    for (const k of ["voice", "lo", "hi", "cw", "width", "notch", "nr", "nrLevel", "comp"]) c[k] = s[k];
  }
}

/** Is ClearRX doing anything right now? */
function crxActive() {
  const s = crx.chain.s;
  return s.voice || s.cw || s.notch || s.nr || s.comp;
}

/** Called by the RTL-SDR with each block of sound (48 kHz), before it's played. */
function clearRxProcess(audio) {
  if (crx.cfg.preset === "auto" && listen.mode !== crx.mode) { crxApply(); renderClearRx(); }
  crx.chain.process(audio);
}

function renderClearRx() {
  if (!$("fxBox")) return;
  const c = crx.cfg;
  for (const b of $("fxPresets").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.p === c.preset));
  $("fxVoice").checked = c.voice; $("fxLo").value = String(c.lo); $("fxHi").value = String(c.hi);
  $("fxCw").checked = c.cw; $("fxWidth").value = String(c.width);
  $("fxNotch").checked = c.notch;
  $("fxNr").checked = c.nr; $("fxNrLevel").value = String(c.nrLevel);
  $("fxComp").checked = c.comp;
  if ($("pnFx")) $("pnFx").value = c.preset === "custom" ? "custom" : c.preset;
  const auto = c.preset === "auto" ? `Auto: ${RxFx.PRESET_NAMES[crxAutoPreset(listen.mode)]} for ${listen.mode.toUpperCase()}. ` : c.preset === "custom" ? "Your own settings. " : "";
  const rtl = typeof RECEIVERS !== "undefined" && RECEIVERS[listen.rx] && RECEIVERS[listen.rx].kind === "rtl";
  $("fxNote").textContent = auto + (rtl ? "" : "ClearRX works on your RTL-SDR's sound (web receivers play their own).");
  renderClearRxMeter();
}

function renderClearRxMeter() {
  if (!$("fxBar")) return;
  const m = crx.chain.meter;
  const live = typeof sdr !== "undefined" && sdr.running;
  const pct = live ? Math.max(0, Math.min(100, ((m.peak + 48) / 48) * 100)) : 0;
  $("fxBar").style.width = `${pct}%`;
  $("fxBar").classList.toggle("hot", live && m.peak > -3);
  $("fxPeak").textContent = !live ? "" : m.clip ? "Too loud: turn the volume down" : `${Math.round(m.peak)} dB`;
  $("fxPeak").classList.toggle("clip", live && m.clip);
}

function setupClearRx() {
  if (!$("fxBox") || typeof RxFx === "undefined") return;
  loadClearRx();
  $("fxPresets").innerHTML = CRX_PRESETS.map(([k, l]) => `<button type="button" class="lbtn" data-p="${k}" aria-pressed="false">${esc(l)}</button>`).join("");
  $("fxLo").innerHTML = CRX_LO.map((v) => `<option value="${v}">${v} Hz</option>`).join("");
  $("fxHi").innerHTML = CRX_HI.map((v) => `<option value="${v}">${(v / 1000).toFixed(1)} kHz</option>`).join("");
  $("fxWidth").innerHTML = CRX_WIDTH.map((v) => `<option value="${v}">${v} Hz</option>`).join("");
  if ($("pnFx")) $("pnFx").innerHTML = `${CRX_PRESETS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join("")}<option value="custom">Custom</option>`;
  const pick = (p) => { crx.cfg.preset = p; crxApply(); saveClearRx(); renderClearRx(); };
  $("fxPresets").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) pick(b.dataset.p); });
  if ($("pnFx")) $("pnFx").addEventListener("change", (e) => { if (e.target.value !== "custom") pick(e.target.value); else renderClearRx(); });
  // Changing any box makes your own (Custom) settings, starting from what the preset had
  const custom = (k, v) => { crx.cfg[k] = v; crx.cfg.preset = "custom"; crxApply(); saveClearRx(); renderClearRx(); };
  for (const [id, k] of [["fxVoice", "voice"], ["fxCw", "cw"], ["fxNotch", "notch"], ["fxNr", "nr"], ["fxComp", "comp"]]) {
    $(id).addEventListener("change", (e) => custom(k, e.target.checked));
  }
  for (const [id, k] of [["fxLo", "lo"], ["fxHi", "hi"], ["fxWidth", "width"], ["fxNrLevel", "nrLevel"]]) {
    $(id).addEventListener("change", (e) => custom(k, Number(e.target.value)));
  }
  crxApply();
  renderClearRx();
  crx.timer = setInterval(() => { if (!document.hidden) renderClearRxMeter(); }, 200);
}
