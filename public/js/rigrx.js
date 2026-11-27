/* Receive controls for the Radio panel: AF and RF gain, AGC, attenuator, preamp (IPO), noise blanker, DNR and auto
   notch, for Yaesu (FT-991A, FT-710, FTdx10, FTdx101) and Icom (IC-7300, IC-705, IC-7610 …). Receive only: nothing
   here keys the radio or changes its power. HamShack reads them back every few seconds, so turning the radio's
   own knobs shows here too. */
"use strict";

const RX_AGC = {
  yaesu: [["1", "FAST"], ["2", "MID"], ["3", "SLOW"], ["4", "AUTO"]],
  icom: [[1, "FAST"], [2, "MID"], [3, "SLOW"]],
};
const RX_PRE = {
  yaesu: [["0", "IPO"], ["1", "AMP1"], ["2", "AMP2"]],
  icom: [[0, "P.AMP OFF"], [1, "P.AMP1"], [2, "P.AMP2"]],
};
const RX_TOGGLES = [["att", "ATT"], ["nb", "NB"], ["nr", "DNR"], ["an", "Auto notch"]];
const RX_POLL_EVERY = 5; // read them back every 5th poll (about every 5 seconds)

const rx = {
  state: {}, // af, rf (0-255), agc, pre (codes), att, nb, nr, an (booleans)
  lastSet: {}, // when each was last changed here, so a read-back doesn't jump the control back
  tick: 0,
  timers: {},
};

/** Does this radio get the receive controls? */
function rxSupported() {
  return rig.connected && (rig.kind === "yaesu" || rig.kind === "icom");
}

/* ---------- Commands ---------- */

const pad3 = (n) => String(Math.max(0, Math.min(255, Math.round(n)))).padStart(3, "0");
/** 0-255 as Icom's two BCD bytes (0000-0255). */
function civLevel(n) {
  const s = String(Math.max(0, Math.min(255, Math.round(n)))).padStart(4, "0");
  return [(Number(s[0]) << 4) | Number(s[1]), (Number(s[2]) << 4) | Number(s[3])];
}
const civBcd = (b) => (b >> 4) * 10 + (b & 15);

/** The command that sets one control. */
function rxCommand(id, v) {
  if (rig.kind === "yaesu") {
    switch (id) {
      case "af": return `AG0${pad3(v)};`;
      case "rf": return `RG0${pad3(v)};`;
      case "agc": return `GT0${v};`;
      case "pre": return `PA0${v};`;
      case "att": return `RA0${v ? 1 : 0};`;
      case "nb": return `NB0${v ? 1 : 0};`;
      case "nr": return `NR0${v ? 1 : 0};`;
      case "an": return `BC0${v ? 1 : 0};`;
    }
  } else if (rig.kind === "icom") {
    switch (id) {
      case "af": return civFrame(0x14, 0x01, ...civLevel(v));
      case "rf": return civFrame(0x14, 0x02, ...civLevel(v));
      case "agc": return civFrame(0x16, 0x12, v);
      case "pre": return civFrame(0x16, 0x02, v);
      case "att": return civFrame(0x11, v ? 0x20 : 0x00);
      case "nb": return civFrame(0x16, 0x22, v ? 1 : 0);
      case "nr": return civFrame(0x16, 0x40, v ? 1 : 0);
      case "an": return civFrame(0x16, 0x41, v ? 1 : 0);
    }
  }
  return "";
}

/** Ask the radio for all of them. */
function rxPollCommands() {
  if (rig.kind === "yaesu") return "AG0;RG0;GT0;PA0;RA0;NB0;NR0;BC0;";
  if (rig.kind === "icom") {
    return [...civFrame(0x14, 0x01), ...civFrame(0x14, 0x02), ...civFrame(0x16, 0x12), ...civFrame(0x16, 0x02),
      ...civFrame(0x11), ...civFrame(0x16, 0x22), ...civFrame(0x16, 0x40), ...civFrame(0x16, 0x41)];
  }
  return "";
}

/** Called once a second by rig.js's poll: every few seconds, read the controls back. */
function rxPollTick(first = false) {
  if (!rxSupported()) return;
  if (first) rx.tick = 0;
  if (rx.tick++ % RX_POLL_EVERY === 0) rigWrite(rxPollCommands());
}

/* ---------- Answers ---------- */

function rxGot(id, v) {
  if (Date.now() - (rx.lastSet[id] || 0) < 2500) return; // just changed here: the radio may not have caught up
  if (rx.state[id] === v) return;
  rx.state[id] = v;
  rx.dirty = true;
}

/** A Yaesu answer: true if it was one of ours. */
function rxYaesuAnswer(ans) {
  let m;
  if ((m = /^AG0(\d{3})$/.exec(ans))) rxGot("af", Number(m[1]));
  else if ((m = /^RG0(\d{3})$/.exec(ans))) rxGot("rf", Number(m[1]));
  else if ((m = /^GT0([0-6])$/.exec(ans))) rxGot("agc", Number(m[1]) >= 4 ? "4" : m[1]); // 4-6: AUTO (fast, mid, slow)
  else if ((m = /^PA0([0-2])$/.exec(ans))) rxGot("pre", m[1]);
  else if ((m = /^RA0([0-3])$/.exec(ans))) rxGot("att", m[1] !== "0");
  else if ((m = /^NB0([01])$/.exec(ans))) rxGot("nb", m[1] === "1");
  else if ((m = /^NR0([01])$/.exec(ans))) rxGot("nr", m[1] === "1");
  else if ((m = /^BC0([01])$/.exec(ans))) rxGot("an", m[1] === "1");
  else return false;
  return true;
}

/** An Icom frame (FE FE to from cmd sub … FD): true if it was one of ours. */
function rxIcomFrame(f) {
  const cmd = f[4], sub = f[5];
  if (cmd === 0x14 && (sub === 0x01 || sub === 0x02) && f.length >= 9) {
    rxGot(sub === 0x01 ? "af" : "rf", civBcd(f[6]) * 100 + civBcd(f[7]));
  } else if (cmd === 0x16 && f.length >= 8 && [0x12, 0x02, 0x22, 0x40, 0x41].includes(sub)) {
    const v = f[6];
    if (sub === 0x12) rxGot("agc", v);
    else if (sub === 0x02) rxGot("pre", v);
    else rxGot({ 0x22: "nb", 0x40: "nr", 0x41: "an" }[sub], v === 1);
  } else if (cmd === 0x11 && f.length >= 7) {
    rxGot("att", f[5] !== 0);
  } else return false;
  return true;
}

/* ---------- Changing them here ---------- */

function rxSet(id, v, now = false) {
  rx.state[id] = v;
  rx.lastSet[id] = Date.now();
  rx.dirty = true;
  const send = () => rigWrite(rxCommand(id, rx.state[id]));
  clearTimeout(rx.timers[id]);
  if (now) send();
  else rx.timers[id] = setTimeout(send, 80); // sliders: at most a few commands a second
  renderRx();
}

function rxCycle(id, list) {
  const i = list.findIndex(([c]) => String(c) === String(rx.state[id]));
  rxSet(id, list[(i + 1) % list.length][0], true);
}

/* ---------- Screen ---------- */

function renderRx() {
  const box = $("pnRx");
  if (!box) return;
  const on = rxSupported();
  box.hidden = !on;
  if (!on) return;
  const s = rx.state;
  const make = rig.kind;
  for (const id of ["af", "rf"]) {
    const el = $(`pnRx_${id}`);
    if (document.activeElement !== el && s[id] != null) el.value = String(s[id]);
    $(`pnRx_${id}v`).textContent = s[id] == null ? "…" : String(s[id]);
  }
  const name = (list, c) => (list.find(([x]) => String(x) === String(c)) || [null, "…"])[1];
  $("pnRx_agc").textContent = `AGC · ${name(RX_AGC[make], s.agc)}`;
  $("pnRx_pre").textContent = name(RX_PRE[make], s.pre);
  for (const [id] of RX_TOGGLES) {
    const b = $(`pnRx_${id}`);
    b.setAttribute("aria-pressed", String(Boolean(s[id])));
  }
  rx.dirty = false;
}

function setupRx() {
  const box = $("pnRx");
  if (!box) return;
  box.innerHTML = `
    <label class="pnrxlvl">AF gain <input type="range" id="pnRx_af" min="0" max="255" value="0"> <b id="pnRx_afv">…</b></label>
    <label class="pnrxlvl">RF gain <input type="range" id="pnRx_rf" min="0" max="255" value="255"> <b id="pnRx_rfv">…</b></label>
    <button type="button" class="pnkey" id="pnRx_agc" title="AGC: click to step through">AGC</button>
    <button type="button" class="pnkey" id="pnRx_pre" title="Preamp: click to step through">IPO</button>
    ${RX_TOGGLES.map(([id, label]) => `<button type="button" class="pnkey" id="pnRx_${id}" aria-pressed="false">${label}</button>`).join("")}`;
  for (const id of ["af", "rf"]) $(`pnRx_${id}`).addEventListener("input", (e) => rxSet(id, Number(e.target.value)));
  $("pnRx_agc").addEventListener("click", () => rxCycle("agc", RX_AGC[rig.kind] || []));
  $("pnRx_pre").addEventListener("click", () => rxCycle("pre", RX_PRE[rig.kind] || []));
  for (const [id] of RX_TOGGLES) $(`pnRx_${id}`).addEventListener("click", () => rxSet(id, !rx.state[id], true));
  renderRx();
}

setupRx();
