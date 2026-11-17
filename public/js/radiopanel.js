/* Radio panel: Band Watch's own radio front panel, a big display, tuning knob, mode and band buttons and an
   S-meter, over the same Listen receiver (and your radio, if it's connected). Everything it does goes through
   tuneTo(), so the rest of Band Watch stays in step. */
"use strict";

const RP_MODES = [["usb", "USB"], ["lsb", "LSB"], ["cw", "CW"], ["am", "AM"], ["fm", "FM"]];
const RP_BANDS = ["160", "80", "60", "40", "30", "20", "17", "15", "12", "10", "6"];
const rp = { angle: 0, drag: null, timer: null };

/** 14200.5 kHz -> "14.200.50" (MHz . kHz . tens of Hz), like a radio's display. */
function rpFreqText(kHz) {
  const hz10 = Math.round(kHz * 100); // tens of Hz
  const mhz = Math.floor(hz10 / 100000);
  const khz = Math.floor((hz10 % 100000) / 100);
  const rest = hz10 % 100;
  return `${mhz}.${String(khz).padStart(3, "0")}.${String(rest).padStart(2, "0")}`;
}

/** Signal strength from the RTL-SDR: dBFS to an S-unit scale (0..1 across S1..S9+40), or null with no signal. */
function rpSignal() {
  if (typeof sdr === "undefined" || !sdr.running || !sdr.demod || !Number.isFinite(sdr.demod.level)) return null;
  const db = sdr.demod.level; // about -100 (noise) to -10 (very strong)
  return Math.max(0, Math.min(1, (db + 100) / 85));
}

function rpSText(v) {
  if (v == null) return "–";
  const s = 1 + v * 12; // S1..S9 then +10, +20, +30, +40
  return s <= 9 ? `S${Math.max(1, Math.round(s))}` : `S9+${Math.min(40, Math.max(10, Math.round(s - 9) * 10))}`;
}

function renderRadioPanel() {
  const dlg = $("rpDlg");
  if (!dlg || !dlg.open) return;
  $("rpFreq").textContent = rpFreqText(listen.kHz);
  $("rpMode").textContent = (RP_MODES.find(([k]) => k === listen.mode) || [, listen.mode.toUpperCase()])[1];
  const seg = typeof planSegment === "function" ? planSegment(listen.kHz) : null;
  $("rpInfo").textContent = `${listen.band ? `${listen.band} m` : "Out of band"}${seg && seg.use ? ` · ${seg.use}` : ""}`;
  $("rpRx").textContent = listen.open ? (RECEIVERS[listen.rx].kind === "rtl" ? "RTL-SDR" : "Web receiver") : "Not listening";
  $("rpRig").textContent = typeof rig !== "undefined" && rig.connected ? `${rig.model || "Radio"} ✓` : "Radio off";
  $("rpRig").classList.toggle("on", typeof rig !== "undefined" && rig.connected);
  $("rpListen").textContent = listen.open ? "Stop" : "Listen";
  $("rpListen").classList.toggle("on", listen.open);
  $("rpStep").textContent = listen.step >= 1 ? `${listen.step} kHz` : `${Math.round(listen.step * 1000)} Hz`;
  for (const b of $("rpModes").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.m === listen.mode));
  for (const b of $("rpBands").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.b === listen.band));
  const v = rpSignal();
  const segs = $("rpMeter").children;
  const lit = v == null ? 0 : Math.round(v * segs.length);
  for (let i = 0; i < segs.length; i++) segs[i].classList.toggle("lit", i < lit);
  $("rpS").textContent = v == null ? (listen.open && listen.rx === "rtl" ? "…" : "–") : rpSText(v);
  $("rpKnobMark").style.transform = `rotate(${rp.angle}deg)`;
}

/** Turn the knob by some degrees: every 15 degrees is one tuning step. */
function rpTurn(deg) {
  rp.angle = (rp.angle + deg) % 360;
  rp.acc = (rp.acc || 0) + deg;
  const steps = Math.trunc(rp.acc / 15);
  if (steps) {
    rp.acc -= steps * 15;
    stepTune(steps > 0 ? 1 : -1, Math.abs(steps));
  }
  renderRadioPanel();
}

function rpPointerAngle(e) {
  const r = $("rpKnob").getBoundingClientRect();
  return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) / RAD;
}

function openRadioPanel() {
  const dlg = $("rpDlg");
  if (!dlg.open) dlg.showModal();
  renderRadioPanel();
  clearInterval(rp.timer);
  rp.timer = setInterval(() => { if (dlg.open) renderRadioPanel(); else clearInterval(rp.timer); }, 200);
}

function setupRadioPanel() {
  if (!$("rpDlg")) return;
  $("rpModes").innerHTML = RP_MODES.map(([k, l]) => `<button type="button" data-m="${k}" aria-pressed="false">${l}</button>`).join("");
  $("rpBands").innerHTML = RP_BANDS.map((b) => `<button type="button" data-b="${b}" aria-pressed="false">${b}</button>`).join("");
  $("rpMeter").innerHTML = Array.from({ length: 24 }, (_, i) => `<span class="${i >= 16 ? "over" : ""}"></span>`).join("");
  $("rpBtn").addEventListener("click", openRadioPanel);
  $("rpClose").addEventListener("click", () => $("rpDlg").close());
  $("rpModes").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) tuneTo(listen.kHz, b.dataset.m, { quiet: true });
    renderRadioPanel();
  });
  $("rpBands").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    $("lsBand").value = b.dataset.b;
    $("lsBand").dispatchEvent(new Event("change"));
    renderRadioPanel();
  });
  $("rpListen").addEventListener("click", () => { if (listen.open) stopListening(); else startListening(); renderRadioPanel(); });
  $("rpDown").addEventListener("click", () => rpTurn(-15));
  $("rpUp").addEventListener("click", () => rpTurn(15));
  $("rpStepBtn").addEventListener("click", () => {
    const i = STEPS.indexOf(listen.step);
    listen.step = STEPS[(i + 1) % STEPS.length];
    saveListen();
    renderListen();
    renderRadioPanel();
  });
  $("rpFreq").addEventListener("click", () => {
    const v = prompt("Frequency in kHz (or MHz)", String(listen.kHz));
    const k = Number(String(v || "").replace(",", "."));
    if (k > 0) tuneTo(k < 1000 ? k * 1000 : k, null, { quiet: true });
    renderRadioPanel();
  });
  const knob = $("rpKnob");
  knob.addEventListener("pointerdown", (e) => { knob.setPointerCapture(e.pointerId); rp.drag = rpPointerAngle(e); });
  knob.addEventListener("pointermove", (e) => {
    if (rp.drag == null) return;
    const a = rpPointerAngle(e);
    let d = a - rp.drag;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    rp.drag = a;
    rpTurn(d);
  });
  const end = () => { rp.drag = null; };
  knob.addEventListener("pointerup", end);
  knob.addEventListener("pointercancel", end);
  knob.addEventListener("wheel", (e) => { e.preventDefault(); rpTurn(e.deltaY < 0 ? 15 : -15); }, { passive: false });
  knob.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); rpTurn(15); }
    if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); rpTurn(-15); }
  });
}
