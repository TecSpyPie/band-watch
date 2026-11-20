/* Band Watch's link to ClearRX by M3VRV, the radio audio processor (a separate program on this PC).
   ClearRX isn't built into Band Watch. While it's open, Band Watch (the Windows app) shows a tick box in Listen:
   "Send my RTL-SDR sound through ClearRX". When that's ticked, the RTL-SDR sound is cleaned up here with ClearRX's own
   settings (its sound engine, rxfx.js, is the same one), read from ClearRX every few seconds. */
"use strict";

const CRX_PORT = 8074;
const crx = {
  open: false, // ClearRX is running on this PC
  version: "",
  settings: null, // ClearRX's current switches
  use: false, // the tick box
  chain: null, // RxFx.Chain doing the work
  timer: null,
  lastSig: "",
};

try { crx.use = localStorage.getItem("bw-clearrx") === "1"; } catch { /* not saved */ }

const crxBase = () => `http://${location.hostname === "127.0.0.1" ? "127.0.0.1" : "localhost"}:${CRX_PORT}`;

async function crxPoll() {
  let ok = false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch(`${crxBase()}/api/settings`, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    if (r.ok) {
      const s = await r.json();
      if (s && typeof s === "object" && typeof s.preset === "string") {
        ok = true;
        crxApply(s);
      }
    }
  } catch { /* ClearRX isn't open */ }
  if (crx.open !== ok) {
    crx.open = ok;
    if (!ok) crx.chain = null; // start fresh next time
    renderClearRx();
  }
}

/** ClearRX's settings into the sound engine (only when they've changed). */
function crxApply(s) {
  crx.settings = s;
  const sig = JSON.stringify(s);
  if (sig === crx.lastSig && crx.chain) return;
  crx.lastSig = sig;
  const fx = { preset: "custom" };
  // ClearRX switched off: switches off, and the squelch, tone and manual notch at 0 (off), which is what they mean
  const zeroWhenOff = ["sq", "bass", "treble", "mnotch"];
  for (const k of ["voice", "lo", "hi", "cw", "tone", "width", "notch", "nr", "nrLevel", "comp", "nb", "nbLevel", "agc", ...zeroWhenOff]) {
    fx[k] = s.on === false ? (typeof s[k] === "boolean" ? false : zeroWhenOff.includes(k) ? 0 : s[k]) : s[k];
  }
  // The rack (ClearRX 1.3 and later): the EQ, the compressor / limiter and the order of the modules. Older ClearRX sends none of these.
  // The hiss remover (ClearRX 1.4): on and its strength. Not the noise you taught it in ClearRX: that was learnt at your
  // radio's sound level, and the RTL-SDR's is different, so here it follows the noise by itself.
  for (const k of ["eq", "eqGains", "cmp", "cmpThr", "cmpRatio", "cmpMakeup", "cmpLimit", "order", "snr", "snrLevel"]) {
    if (s[k] !== undefined) fx[k] = s.on === false && typeof s[k] === "boolean" ? false : s[k];
  }
  if (typeof RxFx === "undefined") return;
  if (!crx.chain) crx.chain = new RxFx.Chain(fx);
  else crx.chain.configure(fx);
  renderClearRx();
}

/** Called by sdr.js with each block of RTL-SDR sound (48 kHz), before it's played. Changes it in place. */
function clearrxProcess(audio) {
  if (!crx.use || !crx.open || !crx.chain || !audio || !audio.length) return;
  crx.chain.process(audio);
}

function crxPresetName(s) {
  if (!s) return "";
  if (s.on === false) return "ClearRX is switched off";
  if (s.preset === "custom") return "your own settings";
  return (typeof RxFx !== "undefined" && RxFx.PRESET_NAMES[s.preset]) || s.preset;
}

function renderClearRx() {
  const row = $("crxRow");
  if (!row) return;
  row.hidden = !crx.open;
  $("crxUse").checked = crx.use;
  $("crxNote").textContent = crx.open ? (crx.use ? `Using: ${crxPresetName(crx.settings)}. Change it in the ClearRX window.` : "ClearRX is open.") : "";
}

function startClearRxLink() {
  if (crx.timer) return;
  crxPoll();
  crx.timer = setInterval(crxPoll, 4000);
}

$("crxUse").addEventListener("change", (e) => {
  crx.use = e.target.checked;
  try { localStorage.setItem("bw-clearrx", crx.use ? "1" : "0"); } catch { /* fine */ }
  renderClearRx();
});

// Only in the Windows app (on the website, a page asking for this PC's programs would be odd and the browser would ask)
(function waitForDesktop(n) {
  if (app.desktop) startClearRxLink();
  else if (n > 0) setTimeout(() => waitForDesktop(n - 1), 500);
})(20);
