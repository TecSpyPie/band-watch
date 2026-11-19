/* Transmit FT8 and FT4, in the Decoder panel. Band Watch keys your radio over its CAT cable (Yaesu TX1;/TX0;,
   Kenwood TX1;/RX;, Icom CI-V 1C 00) and plays the signal into the radio's USB sound (for the FT-991A, "USB Audio
   CODEC"). The signal and the QSO steps are in ftxtx.js.

   Safety first:
   - Nothing is sent unless you've switched Enable TX on. It's off every time Band Watch starts.
   - Stop TX (or Esc) stops at once: sound off and the radio back to receive, twice to be sure.
   - Every transmission has its own timer that unkeys the radio, whatever else happens.
   - Band Watch only transmits with a callsign and locator set, a radio that can transmit, the radio in DATA-USB
     (USB for Icom and Kenwood) and the whole signal inside a UK amateur band.
   - It stops calling after 6 overs with no answer (10 CQs), and after the QSO's 73.
   - Your power and the parts of the band your licence allows are for you to set on the radio. */
"use strict";

const tx = {
  enabled: false, state: null, on: false, ctx: null, src: null, offTimer: null, tickTimer: null, slotStart: 0,
  dev: "", level: 25, hz: 1500, // saved
  tuning: false, note: "", log: [], offered: false,
};
const TX_KINDS = ["yaesu", "icom", "kenwood"];
const TX_BW_HZ = { FT8: 50, FT4: 90 };
const TX_LATE_SEC = { FT8: 1.6, FT4: 0.8 }; // how late a transmission may still start (the far end allows for it)

function loadTx() {
  try {
    const s = JSON.parse(load("bw-tx") || "{}");
    if (typeof s.dev === "string") tx.dev = s.dev;
    if (Number.isFinite(s.level)) tx.level = Math.max(1, Math.min(100, s.level));
    if (Number.isFinite(s.hz)) tx.hz = Math.max(200, Math.min(3000, Math.round(s.hz)));
  } catch { /* defaults */ }
}
const saveTx = () => store("bw-tx", { dev: tx.dev, level: tx.level, hz: tx.hz });

const txProto = () => (dc.mode === "FT4" ? Ftx.FT4 : Ftx.FT8);
const txMyGrid = () => (typeof grid4 === "function" ? grid4() : "");

function txFreshState() {
  return FtxTx.fresh(app.myCall || "", txMyGrid());
}

/** The commands that key (on) and unkey (off) the radio, for its make. */
function txPttCmd(on) {
  if (rig.kind === "yaesu") return on ? "TX1;" : "TX0;";
  if (rig.kind === "kenwood") return on ? "TX1;" : "RX;";
  if (rig.kind === "icom") return civFrame(0x1c, 0x00, on ? 1 : 0);
  return "";
}

/** Why Band Watch can't transmit right now, in plain words, or "" if it can. */
function txProblem() {
  if (dc.mode !== "FT8" && dc.mode !== "FT4") return "Set the decoder's Mode to FT8 or FT4.";
  if (!app.myCall) return "Enter your callsign first (Your callsign, at the top).";
  if (!/^[A-R]{2}\d{2}$/.test(txMyGrid())) return "Enter your locator first (Your locator, at the top).";
  if (!rig.connected) return "Connect your radio first (Connect radio): Band Watch switches it to transmit over the cable.";
  if (!TX_KINDS.includes(rig.kind)) return `${typeof rigLabel === "function" ? rigLabel() : "This radio"} is a receiver: it can't transmit.`;
  if (!rig.hz) return "Waiting for the radio to say its frequency…";
  if (rig.listenMode !== "usb") return "Put the radio in USB (DATA-USB): click the Tune to FT8 button with the radio connected.";
  if (rig.kind === "yaesu" && rig.modeName !== "DATA-USB") {
    return "Put the radio in DATA-USB, so it takes its sound from the USB cable and not the microphone: click Tune to FT8 (Settings > Radio: tick the data-mode box), or press MODE on the radio.";
  }
  const lo = rig.hz / 1000 + tx.hz / 1000;
  const hi = lo + (TX_BW_HZ[dc.mode] || 50) / 1000;
  const inBand = typeof PLAN_BANDS !== "undefined" && PLAN_BANDS.some((b) => lo >= BANDPLAN[b].lo && hi <= BANDPLAN[b].hi);
  if (!inBand) return `${lo.toFixed(3)} kHz is outside the amateur bands: Band Watch won't transmit there.`;
  if (!tx.dev) return "Choose the radio's sound in Sound to the radio (for the FT-991A: USB Audio CODEC).";
  return "";
}

/* ---------- Sound to the radio ---------- */

async function txListDevices() {
  const sel = $("txDev");
  if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const outs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audiooutput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
    if (!tx.dev) {
      const codec = outs.find((d) => /usb audio codec/i.test(d.label));
      if (codec) { tx.dev = codec.deviceId; saveTx(); }
    }
    const named = outs.some((d) => d.label);
    sel.innerHTML = `<option value="">Choose…</option>` + outs.map((d, i) =>
      `<option value="${esc(d.deviceId)}"${d.deviceId === tx.dev ? " selected" : ""}>${esc(d.label || `Sound output ${i + 1}`)}</option>`).join("");
    $("txDevNote").textContent = named ? "" : "To see the names of your sound outputs, start the decoder once with This computer's sound input (Band Watch then has permission to list them).";
  } catch { /* leave as is */ }
}

async function txAudio() {
  if (!tx.ctx) tx.ctx = new AudioContext({ latencyHint: "interactive" });
  if (tx.ctx.state === "suspended") await tx.ctx.resume();
  if (typeof tx.ctx.setSinkId === "function" && tx.dev && tx.ctx.sinkId !== tx.dev) await tx.ctx.setSinkId(tx.dev);
  return tx.ctx;
}

/** Play samples into the radio, starting `delaySec` from now; returns the source node. */
function txPlay(ctx, samples, delaySec) {
  const buf = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buf.copyToChannel(samples, 0);
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.connect(ctx.destination);
  node.start(ctx.currentTime + delaySec);
  return node;
}

/* ---------- Keying ---------- */

function txKey() {
  rigWrite(txPttCmd(true));
}

/** Back to receive: sound off, radio unkeyed (and again a moment later, in case the first was lost). */
function txUnkey() {
  clearTimeout(tx.offTimer);
  tx.offTimer = null;
  const src = tx.src;
  tx.src = null;
  if (src) { src.onended = null; try { src.stop(); } catch { /* already stopped */ } }
  const was = tx.on || tx.tuning;
  tx.on = false;
  tx.tuning = false;
  if (rig.connected && TX_KINDS.includes(rig.kind)) {
    rigWrite(txPttCmd(false));
    setTimeout(() => { if (!tx.on && !tx.tuning) rigWrite(txPttCmd(false)); }, 300);
  }
  return was;
}

/** Stop everything: no more transmitting until you switch Enable TX on again. */
function txHalt(reason = "") {
  tx.enabled = false;
  txUnkey();
  if (reason) tx.note = reason;
  renderTx();
}

/** Send one over in the slot starting at `slotStart`. */
async function txSend(slotStart) {
  const problem = txProblem();
  if (problem) { txHalt(problem); return; }
  const p = txProto();
  const text = tx.state.tx;
  const tones = Ftx.encodeTones(text, p);
  if (!tones) { txHalt(`Band Watch can't send "${text}" as ${p.name}.`); return; }
  tx.on = true;
  tx.slotStart = slotStart;
  let ctx;
  try { ctx = await txAudio(); } catch (e) { tx.on = false; txHalt(`Couldn't open the radio's sound (${e.message || e}).`); return; }
  if (!tx.enabled || !tx.on) { txUnkey(); return; }
  const { samples, lead } = FtxTx.wave(tones, { proto: p, rate: ctx.sampleRate, baseHz: tx.hz, amp: tx.level / 100 });
  // The signal starts 0.5 s into the slot (less any ramp-up); a little late if we're late, never cut short.
  const startAt = slotStart + (p.start - lead) * 1000;
  const delay = Math.max(0.06, (startAt - Date.now()) / 1000); // the radio needs a moment to switch to transmit
  txKey();
  tx.src = txPlay(ctx, samples, delay);
  tx.src.onended = () => txDone();
  // Belt and braces: unkey after the signal's length plus a little, whatever happens to the sound.
  tx.offTimer = setTimeout(() => { if (tx.on) txDone(); }, (delay + samples.length / ctx.sampleRate + 0.4) * 1000);
  tx.log.unshift({ at: slotStart, text, mode: p.name });
  tx.log = tx.log.slice(0, 30);
  tx.note = "";
  renderTx();
}

/** One over finished: count it and move the QSO on (or stop). */
function txDone() {
  if (!tx.on) return;
  txUnkey();
  if (!tx.state) return;
  tx.state = FtxTx.sent(tx.state);
  txAfterStep();
}

function txAfterStep() {
  const s = tx.state;
  if (s.complete && s.their && !tx.offered) txOfferLog();
  if (s.stopped) txHalt(s.stopped);
  else if (s.step === "done") { tx.enabled = false; tx.note = `QSO with ${s.their} complete. 73!`; }
  else if (s.step === "idle") tx.enabled = false;
  renderTx();
}

/** Put the QSO in the logbook form, ready to save: by itself when it's complete, or when you click Log QSO. */
function txOfferLog(clicked = false) {
  const s = tx.state;
  if (!s || !s.their) return;
  tx.offered = true;
  if (typeof logPrefill !== "function") return;
  const p = txProto();
  const kHz = rig.hz ? Math.round((rig.hz / 1000 + tx.hz / 1000) * 100) / 100 : (listen && listen.kHz) || 0;
  logPrefill({ call: s.their, grid: s.theirGrid, kHz, mode: p.name, rstS: s.sent, rstR: s.got });
  if (!clicked && typeof showToast === "function") showToast(`QSO with ${s.their}`, "It's in the logbook form: check it and save.");
}

/** Called every 100 ms: start the next over when its slot comes round. */
function txTick() {
  if (!tx.enabled || tx.on || tx.tuning || !tx.state || !tx.state.tx) return;
  const p = txProto();
  const now = Date.now();
  const late = TX_LATE_SEC[p.name] || 1;
  const start = FtxTx.nextSlot(now, p, tx.state.parity, late);
  if (now >= start - 250 && now <= start + late * 1000) txSend(start);
  else renderTxNext(start);
}

/** Decodes arrived (from decoders.js): move the QSO on if one is for us. */
function txOnDecodes(rows) {
  if (!tx.state || !tx.state.my) return;
  const p = txProto();
  if (!rows.length || rows[0].mode !== p.name) return;
  // The strongest first, so when calling CQ the loudest caller gets the QSO.
  const list = [...rows].sort((a, b) => b.snr - a.snr);
  for (const r of list) {
    const next = FtxTx.heard(tx.state, { text: r.text, snr: r.snr, parity: FtxTx.slotOf(r.cycle, p).parity });
    if (next) {
      tx.state = next;
      tx.offered = false;
      if (next.step === "done") { txAfterStep(); return; }
      renderTx();
      return;
    }
  }
}

/* ---------- What you click ---------- */

/** Enable TX: the one switch that lets Band Watch transmit. */
async function txSetEnabled(on) {
  if (!on) { txHalt(); return; }
  const problem = txProblem();
  if (problem) { tx.note = problem; renderTx(); return; }
  try { await txAudio(); } catch (e) { tx.note = `Couldn't open the radio's sound (${e.message || e}).`; renderTx(); return; }
  tx.enabled = true;
  tx.note = "";
  if (!tx.state || !tx.state.tx) tx.note = "Click Call CQ, or Reply on a decode, to start a QSO.";
  renderTx();
}

function txCallCq() {
  const p = txProto();
  const now = Date.now();
  // Call in this slot if it's only just begun, otherwise the next one.
  const cur = FtxTx.slotOf(now, p);
  const parity = now - cur.start <= (TX_LATE_SEC[p.name] || 1) * 1000 ? cur.parity : 1 - cur.parity;
  tx.state = FtxTx.callCq(txFreshState(), parity);
  tx.offered = false;
  tx.note = tx.enabled ? "" : "Switch Enable TX on to start calling.";
  renderTx();
}

/** Reply to a decode in the table. */
function txReply(row) {
  const p = txProto();
  const next = FtxTx.answer(txFreshState(), { text: row.text, snr: row.snr, parity: FtxTx.slotOf(row.cycle, p).parity });
  if (!next) { tx.note = "That message can't be answered."; renderTx(); return; }
  tx.state = next;
  tx.offered = false;
  tx.note = tx.enabled ? "" : `Switch Enable TX on to call ${next.their}.`;
  renderTx();
}

/** A steady tone for 10 seconds (or until you click again): set the level so the radio's ALC barely moves. */
async function txTune() {
  if (tx.tuning) { txUnkey(); renderTx(); return; }
  if (tx.on) return;
  const problem = txProblem();
  if (problem) { tx.note = problem; renderTx(); return; }
  let ctx;
  try { ctx = await txAudio(); } catch (e) { tx.note = `Couldn't open the radio's sound (${e.message || e}).`; renderTx(); return; }
  tx.tuning = true;
  txKey();
  tx.src = txPlay(ctx, FtxTx.tune(10, { rate: ctx.sampleRate, baseHz: tx.hz + 25, amp: tx.level / 100 }), 0.06);
  tx.src.onended = () => { txUnkey(); renderTx(); };
  tx.offTimer = setTimeout(() => { txUnkey(); renderTx(); }, 10600);
  tx.note = "";
  renderTx();
}

/* ---------- On screen ---------- */

function renderTxNext(start) {
  const el = $("txNext");
  if (!el) return;
  const s = tx.state;
  const html = !s || !s.tx ? "" : `Next: <b>${esc(s.tx)}</b> at ${new Date(start).toISOString().slice(11, 19)} UTC` +
    ` <span class="muted">(${s.parity === 0 ? "1st" : "2nd"} slot${s.tries ? `, try ${s.tries + 1}` : ""})</span>`;
  if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

function renderTx() {
  const box = $("dcTx");
  if (!box) return;
  const show = dc.mode === "FT8" || dc.mode === "FT4";
  box.hidden = !show;
  if (!show) return;
  const problem = txProblem();
  $("txEnable").textContent = tx.enabled ? "TX enabled" : "Enable TX";
  $("txEnable").classList.toggle("on", tx.enabled);
  $("txEnable").setAttribute("aria-pressed", String(tx.enabled));
  $("txHalt").classList.toggle("live", tx.on || tx.tuning);
  $("txTune").textContent = tx.tuning ? "Stop tune" : "Tune";
  $("txLog").disabled = !(tx.state && tx.state.their);
  $("txLog").title = tx.state && tx.state.their ? `Put the QSO with ${tx.state.their} in the logbook` : "Log QSO: there's no QSO yet (Reply to a station first)";
  $("txHz").value = String(tx.hz);
  $("txLevel").value = String(tx.level);
  $("txLevelVal").textContent = `${tx.level}%`;
  $("txOnAir").hidden = !(tx.on || tx.tuning);
  $("txOnAir").textContent = tx.tuning ? "TRANSMITTING: tune tone" : tx.on ? `TRANSMITTING: ${tx.log[0] ? tx.log[0].text : ""}` : "";
  const s = tx.state;
  const qso = s && s.their
    ? `QSO with <b>${callLink(s.their)}</b>${s.theirGrid ? ` (${esc(s.theirGrid)})` : ""}: sent ${esc(s.sent || "–")}, got ${esc(s.got || "–")}${s.complete ? ' · <span class="txok">complete</span>' : ""}`
    : s && s.step === "cq" ? "Calling CQ" : "";
  $("txQso").innerHTML = qso;
  $("txNote").textContent = tx.note || (tx.enabled ? "" : problem ? `Before you can transmit: ${problem}` : "Ready. Switch Enable TX on when you want to transmit.");
  $("txNote").classList.toggle("warn", Boolean(problem) && !tx.enabled);
  if (!s || !s.tx) renderTxNext(0);
  else if (!tx.enabled) renderTxNext(FtxTx.nextSlot(Date.now(), txProto(), s.parity, TX_LATE_SEC[txProto().name] || 1));
  $("txSent").innerHTML = tx.log.slice(0, 6).map((l) => `<li><span class="muted">${new Date(l.at).toISOString().slice(11, 19)}</span> ${esc(l.text)}</li>`).join("");
}

function setupTx() {
  if (!$("dcTx")) return;
  loadTx();
  tx.state = txFreshState();
  $("txEnable").addEventListener("click", () => txSetEnabled(!tx.enabled));
  $("txHalt").addEventListener("click", () => { txHalt("Stopped."); if (tx.state) tx.state = { ...tx.state, step: "idle", tx: "" }; renderTx(); });
  $("txCq").addEventListener("click", txCallCq);
  $("txLog").addEventListener("click", () => txOfferLog(true));
  $("txTune").addEventListener("click", txTune);
  $("txHz").addEventListener("change", () => {
    const v = Math.round(Number($("txHz").value));
    if (v >= 200 && v <= 3000) { tx.hz = v; saveTx(); }
    renderTx();
  });
  $("txLevel").addEventListener("input", () => { tx.level = Number($("txLevel").value) || 25; $("txLevelVal").textContent = `${tx.level}%`; saveTx(); });
  $("txDev").addEventListener("change", () => { tx.dev = $("txDev").value; saveTx(); if (tx.ctx && typeof tx.ctx.setSinkId === "function" && tx.dev) tx.ctx.setSinkId(tx.dev).catch(() => {}); renderTx(); });
  $("txDev").addEventListener("focus", txListDevices);
  $("dcRows").addEventListener("click", (e) => {
    const b = e.target.closest(".dcreply");
    if (!b || !dc.shown) return;
    const r = dc.shown[Number(b.dataset.i)];
    if (r) txReply(r);
  });
  // Esc stops transmitting at once, wherever you are on the page.
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (tx.on || tx.tuning || tx.enabled)) txHalt("Stopped (Esc)."); });
  // Never leave the radio transmitting when Band Watch closes or reloads.
  window.addEventListener("pagehide", () => { if (tx.on || tx.tuning) txUnkey(); });
  window.addEventListener("beforeunload", () => { if (tx.on || tx.tuning) txUnkey(); });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", txListDevices);
  txListDevices();
  tx.tickTimer = setInterval(txTick, 100);
  setInterval(() => { if (!tx.on) renderTx(); }, 1000);
  renderTx();
}
