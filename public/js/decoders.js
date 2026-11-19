/* FT8 / FT4 / WSPR / CW decoder panel: audio from your RTL-SDR (Listen panel) or this computer's sound input,
 * decoded in a background worker (ft8-worker.js), with a results table here and in a separate
 * results window (decodes.html) that can sit beside Band Watch or on another screen. */
"use strict";

const DC_MAX_ROWS = 600;
const dc = {
  mode: "FT8", src: "rtl", device: "", cqOnly: false, // saved
  running: false, worker: null, rows: [], status: "", progress: 0,
  ctx: null, stream: null, node: null, channel: null, lastCycle: null,
  cwText: "", cwWpm: 0, cwTone: 0,
};
const DC_MODES = ["FT8", "FT4", "WSPR", "CW"];

function loadDc() {
  try {
    const s = JSON.parse(load("bw-decode"));
    if (s && typeof s === "object") {
      if (DC_MODES.includes(s.mode)) dc.mode = s.mode;
      if (s.src === "rtl" || s.src === "mic") dc.src = s.src;
      if (typeof s.device === "string") dc.device = s.device;
      dc.cqOnly = s.cqOnly === true;
    }
  } catch { /* defaults */ }
}
const saveDc = () => store("bw-decode", { mode: dc.mode, src: dc.src, device: dc.device, cqOnly: dc.cqOnly });

function dcSetStatus(text) {
  dc.status = text;
  if ($("dcStatus")) $("dcStatus").textContent = text;
}

/** Audio for the decoder. `rate` is its sample rate; called by the RTL-SDR receiver and the sound input. */
function decoderFeed(samples, rate) {
  if (!dc.running || !dc.worker) return;
  if (dc.rate !== rate) {
    dc.rate = rate;
    dc.worker.postMessage({ type: "start", mode: dc.mode, rate });
  }
  dc.worker.postMessage({ type: "audio", samples, at: Date.now() }, [samples.buffer]);
}

async function dcStart() {
  if (dc.running) return;
  dc.running = true;
  dc.rate = 0;
  if (dc.mode === "CW") dc.cwText = "";
  dc.worker = new Worker("/js/ft8-worker.js?v=1.24.2");
  dc.worker.onmessage = (e) => onDecoderMessage(e.data);
  dc.worker.onerror = (e) => { dcStop(); dcSetStatus(`The decoder stopped: ${e.message}`); };
  if (dc.src === "mic") {
    try {
      const constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
      if (dc.device) constraints.deviceId = { exact: dc.device };
      dc.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
      dc.ctx = new AudioContext();
      await dc.ctx.audioWorklet.addModule("/js/capture-worklet.js?v=1.24.2");
      const srcNode = dc.ctx.createMediaStreamSource(dc.stream);
      dc.node = new AudioWorkletNode(dc.ctx, "bw-capture");
      dc.node.port.onmessage = (e) => decoderFeed(e.data, dc.ctx.sampleRate);
      srcNode.connect(dc.node);
      listDcDevices(); // labels become available once allowed
      dcSetStatus("Listening to the sound input. Waiting for the next cycle…");
    } catch (err) {
      dcStop();
      dcSetStatus(err && err.name === "NotAllowedError" ? "Band Watch wasn't allowed to use the sound input." : `Couldn't open the sound input (${err.message}).`);
      return;
    }
  } else {
    const where = dc.mode === "CW" ? "a CW signal in CW mode" : `the ${dc.mode} frequency in USB`;
    dcSetStatus(sdr.running
      ? `Decoding the RTL-SDR audio. Tune to ${where}.${dc.mode === "CW" ? "" : " Waiting for the next cycle…"}`
      : `Start your RTL-SDR in the Listen panel (receiver: My RTL-SDR), on ${where}.`);
  }
  renderDc();
}

function dcStop() {
  dc.running = false;
  if (dc.worker) dc.worker.terminate();
  dc.worker = null;
  if (dc.stream) dc.stream.getTracks().forEach((t) => t.stop());
  dc.stream = null;
  if (dc.ctx) dc.ctx.close().catch(() => {});
  dc.ctx = dc.node = null;
  dc.progress = 0;
  dcSetStatus("Stopped.");
  renderDc();
}

function onDecoderMessage(m) {
  if (m.type === "status") dcSetStatus(m.text);
  else if (m.type === "cw") {
    dc.cwText = (dc.cwText + (m.text || "")).slice(-3000);
    dc.cwWpm = m.wpm; dc.cwTone = m.tone;
    renderCw();
    if (m.text && dc.channel) dc.channel.postMessage({ type: "cw", text: dc.cwText, wpm: m.wpm, tone: m.tone });
    dcSetStatus(m.tone ? `CW: ${m.wpm} WPM on a ${m.tone} Hz tone.` : "CW: waiting for a signal…");
  }
  else if (m.type === "progress") {
    dc.progress = m.into;
    if ($("dcProg")) $("dcProg").style.width = `${Math.round(m.into * 100)}%`;
  } else if (m.type === "decodes") {
    const utc = new Date(m.cycle).toISOString().slice(11, 19).replace(/:/g, "");
    const rows = m.list
      .sort((a, b) => a.freq - b.freq)
      .map((d) => ({ utc, cycle: m.cycle, mode: m.mode, snr: d.snr, dt: d.dt, freq: d.freq, text: d.text }));
    dc.rows = [...rows, ...dc.rows].slice(0, DC_MAX_ROWS);
    dc.lastCycle = m.cycle;
    dcSetStatus(`${m.mode}: ${rows.length} decoded in the ${utc.slice(0, 2)}:${utc.slice(2, 4)}:${utc.slice(4)} cycle${m.mode === "WSPR" ? ` (${(m.ms / 1000).toFixed(1)} s to decode)` : ""}.`);
    renderDcRows();
    if (dc.channel) dc.channel.postMessage({ type: "cycle", rows, status: dc.status });
    if (typeof checkWanted === "function") checkWanted();
  }
}

/** Callsigns in a message as links (QRZ and the station window), CQ and your own call highlighted. */
function dcMessageHtml(text) {
  return text.split(" ").map((w) => {
    const bare = w.replace(/^<|>$/g, "");
    if (/^(CQ|DE|QRZ|RRR|RR73|73|DX|TEST)$/.test(w) || /^R?[+-]\d\d$/.test(w) || /^R?$/.test(w) || /^[A-R]{2}\d{2}$/.test(w) || bare === "...") return esc(w);
    if (/^[A-Z0-9/]{3,}$/.test(bare) && /\d/.test(bare) && /[A-Z]/.test(bare)) return w.startsWith("<") ? `&lt;${callLink(bare)}&gt;` : callLink(bare);
    return esc(w);
  }).join(" ");
}

/** The station sending a message, and its grid if it gave one: "CQ G4ABC IO93" or "M3VRV G4ABC -12". */
function dcStation(text) {
  const w = String(text || "").split(" ").map((x) => x.replace(/^<|>$/g, ""));
  const isCall = (x) => /^[A-Z0-9/]{3,}$/.test(x || "") && /\d/.test(x) && /[A-Z]/.test(x) && !/^[A-R]{2}\d{2}$/.test(x) && !/^R?[+-]\d\d$/.test(x);
  let i = w[0] === "CQ" ? (isCall(w[1]) ? 1 : 2) : 1;
  if (!isCall(w[i])) return null;
  const grid = /^[A-R]{2}\d{2}$/.test(w[i + 1] || "") && w[i + 1] !== "RR73" ? w[i + 1] : "";
  return { call: w[i], grid };
}

const dcRowClass = (r) => {
  const mine = app.myCall && r.text.split(" ").some((w) => baseCall(w.replace(/^<|>$/g, "")) === app.myCall);
  return mine ? "dcmine" : /^CQ /.test(r.text) ? "dccq" : "";
};

function renderDcRows() {
  const tb = $("dcRows");
  if (!tb) return;
  const rows = dc.cqOnly ? dc.rows.filter((r) => /^CQ /.test(r.text)) : dc.rows;
  let last = null;
  dc.shown = rows.slice(0, 200);
  tb.innerHTML = dc.shown.map((r, i) => {
    const sep = last !== null && r.cycle !== last ? " dcnew" : "";
    last = r.cycle;
    const who = dcStation(r.text);
    const logBtn = who && typeof logPrefill === "function"
      ? `<button type="button" class="linkbtn dclog" data-i="${i}" title="Log a contact with ${esc(who.call)}">Log</button>${typeof workedBefore === "function" && workedBefore(who.call) ? ' <span class="worked" title="Already in your log">✓</span>' : ""}` : "";
    return `<tr class="${dcRowClass(r)}${sep}"><td>${r.utc}</td><td>${r.snr > 0 ? "+" : ""}${r.snr}</td><td>${r.dt.toFixed(1)}</td><td>${r.freq}</td><td class="dcmsg">${dcMessageHtml(r.text)}</td><td>${logBtn}</td></tr>`;
  }).join("") || `<tr><td colspan="6" class="muted small">${dc.running ? "Nothing decoded yet." : "Press Start decoding."}</td></tr>`;
  $("dcCount").textContent = dc.rows.length ? `${dc.rows.length} decode${dc.rows.length === 1 ? "" : "s"}` : "";
}

async function listDcDevices() {
  const sel = $("dcDev");
  if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
    sel.innerHTML = `<option value="">Default input</option>` + devs.filter((d) => d.deviceId && d.deviceId !== "default")
      .map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === dc.device ? " selected" : ""}>${esc(d.label || `Input ${i + 1}`)}</option>`).join("");
  } catch { /* leave as is */ }
}

function renderCw() {
  if (!$("dcCw")) return;
  $("dcCwText").textContent = dc.cwText || (dc.running ? "Listening…" : "Press Start decoding.");
  $("dcCwText").scrollTop = $("dcCwText").scrollHeight;
  $("dcCwInfo").textContent = dc.cwTone ? `${dc.cwWpm} WPM · ${dc.cwTone} Hz tone` : "";
}

/** The FT8, FT4 or WSPR dial frequency (kHz) on the Listen panel's band. */
function dcDialKHz() {
  if (dc.mode === "CW") return null;
  const table = dc.mode === "FT4" ? FT4 : dc.mode === "WSPR" ? WSPR : FT8;
  const mhz = table[listen.band];
  return mhz ? Math.round(mhz * 1000 * 10) / 10 : null;
}

/** The "Tune to FT8 on 20 m" button follows the Listen panel's band. */
function dcRenderTune() {
  if (!$("dcTune")) return;
  const k = dcDialKHz();
  $("dcTune").hidden = dc.src !== "rtl" || !k;
  if (k) $("dcTune").textContent = `Tune to ${dc.mode} on ${listen.band} m (${k.toLocaleString()} kHz USB)`;
}

function renderDc() {
  if (!$("dcMode")) return;
  $("dcMode").value = dc.mode;
  $("dcSrc").value = dc.src;
  $("dcDevRow").hidden = dc.src !== "mic";
  $("dcCqOnly").checked = dc.cqOnly;
  const cw = dc.mode === "CW";
  $("dcCw").hidden = !cw;
  $("dcTable").hidden = cw;
  $("dcCqRow").hidden = cw || dc.mode === "WSPR";
  renderCw();
  $("dcStart").textContent = dc.running ? "Stop decoding" : "Start decoding";
  $("dcStart").classList.toggle("ghost", dc.running);
  dcRenderTune();
  $("dcStatus").textContent = dc.status;
  $("dcProg").style.width = dc.running ? `${Math.round(dc.progress * 100)}%` : "0";
  renderDcRows();
}

function openDecodesWindow() {
  const w = window.open("/decodes", "bw-decodes", "popup,width=780,height=720");
  if (!w) dcSetStatus("Your browser blocked the results window: allow pop-ups for Band Watch.");
}

function setupDecoders() {
  $("dcRows").addEventListener("click", (e) => {
    const b = e.target.closest(".dclog");
    if (!b || !dc.shown) return;
    const r = dc.shown[Number(b.dataset.i)];
    const who = r && dcStation(r.text);
    if (!who) return;
    const dial = listen.kHz; // where the receiver is tuned
    logPrefill({ call: who.call, grid: who.grid, kHz: Math.round((dial + r.freq / 1000) * 100) / 100, mode: r.mode || dc.mode,
      rstR: `${r.snr >= 0 ? "+" : "-"}${String(Math.abs(r.snr)).padStart(2, "0")}`, rstS: "" });
  });
  loadDc();
  if ("BroadcastChannel" in window) {
    dc.channel = new BroadcastChannel("bw-decodes");
    dc.channel.onmessage = (e) => {
      if (e.data && e.data.type === "hello") dc.channel.postMessage({ type: "all", rows: dc.rows, status: dc.status, mode: dc.mode });
      if (e.data && e.data.type === "clear") { dc.rows = []; renderDcRows(); }
    };
  }
  $("dcMode").addEventListener("change", () => {
    dc.mode = DC_MODES.includes($("dcMode").value) ? $("dcMode").value : "FT8";
    saveDc();
    if (dc.running) { dcStop(); dcStart(); }
    renderDc();
  });
  $("dcSrc").addEventListener("change", () => {
    dc.src = $("dcSrc").value === "mic" ? "mic" : "rtl";
    saveDc();
    if (dc.running) { dcStop(); dcStart(); }
    if (dc.src === "mic") listDcDevices();
    renderDc();
  });
  $("dcDev").addEventListener("change", () => {
    dc.device = $("dcDev").value;
    saveDc();
    if (dc.running) { dcStop(); dcStart(); }
  });
  $("dcStart").addEventListener("click", () => (dc.running ? dcStop() : dcStart()));
  $("dcTune").addEventListener("click", () => {
    const k = dcDialKHz();
    if (!k) return;
    if (RECEIVERS[listen.rx].kind !== "rtl") { listen.rx = "rtl"; saveListen(); }
    tuneTo(k, "usb", { quiet: true });
  });
  $("dcCqOnly").addEventListener("change", () => { dc.cqOnly = $("dcCqOnly").checked; saveDc(); renderDcRows(); });
  $("dcClear").addEventListener("click", () => { dc.rows = []; dc.cwText = ""; renderCw(); renderDcRows(); if (dc.channel) dc.channel.postMessage({ type: "all", rows: [], status: dc.status, mode: dc.mode }); });
  $("dcWindow").addEventListener("click", openDecodesWindow);
  if (dc.src === "mic") listDcDevices();
  renderDc();
}
