/* Listen with your own RTL-SDR (the RTL-SDR Blog V4, or any RTL2832U dongle) through rtl_tcp.
 * HamShack's server relays rtl_tcp's samples (it works in HamShack on your own PC only);
 * this page demodulates them (sdr-dsp.js), plays them (sdr-worklet.js) and draws a waterfall. */
"use strict";

// Gains the R820T/R828D tuners accept, in tenths of a dB (rtl_tcp's unit).
const RTL_GAINS = [0, 9, 14, 27, 37, 77, 87, 125, 144, 157, 166, 197, 207, 229, 254, 280, 297, 328, 338, 364, 372, 386, 402, 421, 434, 439, 445, 480, 496];
const RTL_TUNERS = { 1: "E4000", 2: "FC0012", 3: "FC0013", 4: "FC2580", 5: "R820T", 6: "R828D" };
const RTL_MAX_KHZ = 1766000;
// The dongles HamShack knows: how each reaches HF, and where it tunes from.
const DONGLES = {
  v4: { name: "RTL-SDR Blog V4", minKHz: 500, note: "HF through its built-in upconverter (automatic)" },
  v3: { name: "RTL-SDR Blog V3", minKHz: 500, note: "HF by direct sampling (Q branch) below 24 MHz" },
  other: { name: "Other RTL-SDR", minKHz: 24000, note: "24 MHz and up" },
};
const rtlMinKHz = () => (DONGLES[sdr.dongle] || DONGLES.v4).minKHz;
const RTL_MIN_KHZ = 500;
/** The waterfall shows half the sample rate, centred on the dial frequency. */
const spanHz = () => ((sdr.demod && sdr.running ? sdr.demod.inRate : sdr.rate) || SdrDsp.IN_RATE) / 2;

const SDR_DEFAULTS = {
  addr: "127.0.0.1:1234", gain: -1, ppm: 0, bias: false, volume: 70, rtlAgc: false, audioAgc: true, autoLevel: true, range: 60, speed: "normal",
  device: 0, autoStart: false, exePath: "", reconnect: true,
  dongle: "v4", rate: SdrDsp.IN_RATE, widths: { ...SdrDsp.DEFAULT_WIDTH }, squelch: null, agcSpeed: "normal", deemph: 50,
  att: 0, // attenuator, dB: takes this much off the RF gain (Off, 10, 20, 30)
};
const RTL_ATTS = [0, 10, 20, 30];

/** The tuner gain to use (tenths of a dB, -1 = automatic): the RF gain, less the attenuator. With RF gain on
 * Auto, the attenuator counts down from full gain. It uses the nearest gain step the tuner has at or below that. */
function rtlAttGain(gain, att) {
  if (!att) return gain;
  const want = (gain < 0 ? RTL_GAINS[RTL_GAINS.length - 1] : gain) - att * 10;
  let best = RTL_GAINS[0];
  for (const g of RTL_GAINS) if (g <= want) best = g;
  return best;
}
const SDR_RETRIES = 5; // reconnect attempts after the connection drops
const FALL_SPEEDS = { slow: 160, normal: 80, fast: 40 }; // ms between waterfall rows
const sdr = {
  ...SDR_DEFAULTS, // saved
  available: null, running: false, status: "", tuner: "",
  session: null, abort: null, ctx: null, node: null, demod: null, centre: 0, odd: false,
  sending: Promise.resolve(), lastSpec: 0, rows: null, meterAt: 0,
  // The most recent IQ samples, kept for the live band scope (whole I/Q pairs, oldest first).
  iq: new Uint8Array(65536), iqLen: 0, iqCarry: -1, lastScope: 0,
  // Stall watch: rtl_tcp connected (header seen) but sending no samples.
  readId: 0, headerAt: 0, lastIqAt: 0, headerOnly: 0, restarts: [], stallBusy: false, stallShown: false, canRestart: false, watch: null,
};

/** Keep the latest IQ bytes for the live band scope, always starting on an I byte. */
function sdrKeepIq(chunk) {
  let bytes = chunk;
  if (sdr.iqCarry >= 0) {
    bytes = new Uint8Array(chunk.length + 1);
    bytes[0] = sdr.iqCarry;
    bytes.set(chunk, 1);
    sdr.iqCarry = -1;
  }
  if (bytes.length % 2) { sdr.iqCarry = bytes[bytes.length - 1]; bytes = bytes.subarray(0, bytes.length - 1); }
  const buf = sdr.iq;
  if (bytes.length >= buf.length) {
    buf.set(bytes.subarray(bytes.length - buf.length));
    sdr.iqLen = buf.length;
    return;
  }
  const keep = Math.min(sdr.iqLen, buf.length - bytes.length);
  if (keep < sdr.iqLen) buf.copyWithin(0, sdr.iqLen - keep, sdr.iqLen);
  buf.set(bytes, keep);
  sdr.iqLen = keep + bytes.length;
}

function loadSdr() {
  try {
    const s = JSON.parse(load("bw-sdr"));
    if (s && typeof s === "object") {
      if (typeof s.addr === "string") sdr.addr = s.addr;
      if (s.gain === -1 || RTL_GAINS.includes(s.gain)) sdr.gain = s.gain;
      if (Number.isInteger(s.ppm) && Math.abs(s.ppm) <= 200) sdr.ppm = s.ppm;
      sdr.bias = s.bias === true;
      if (Number.isFinite(s.volume)) sdr.volume = Math.max(0, Math.min(100, s.volume));
      sdr.rtlAgc = s.rtlAgc === true;
      sdr.audioAgc = s.audioAgc !== false;
      sdr.autoLevel = s.autoLevel !== false;
      if (Number.isFinite(s.range)) sdr.range = Math.max(30, Math.min(100, Math.round(s.range)));
      if (FALL_SPEEDS[s.speed]) sdr.speed = s.speed;
      if (Number.isInteger(s.device) && s.device >= 0 && s.device <= 9) sdr.device = s.device;
      sdr.autoStart = s.autoStart === true;
      if (typeof s.exePath === "string") sdr.exePath = s.exePath.slice(0, 260);
      sdr.reconnect = s.reconnect !== false;
      if (DONGLES[s.dongle]) sdr.dongle = s.dongle;
      if (SdrDsp.RATES.includes(s.rate)) sdr.rate = s.rate;
      if (s.widths && typeof s.widths === "object") {
        sdr.widths = { ...SdrDsp.DEFAULT_WIDTH };
        for (const m of Object.keys(sdr.widths)) if ((SdrDsp.WIDTHS[m] || []).includes(s.widths[m])) sdr.widths[m] = s.widths[m];
      }
      sdr.squelch = Number.isFinite(s.squelch) && s.squelch >= -100 && s.squelch <= 0 ? s.squelch : null;
      if (SdrDsp.AGC_DECAY[s.agcSpeed]) sdr.agcSpeed = s.agcSpeed;
      if (s.deemph === 50 || s.deemph === 75) sdr.deemph = s.deemph;
      if (RTL_ATTS.includes(s.att)) sdr.att = s.att;
    }
  } catch { /* defaults */ }
}
function saveSdr() {
  store("bw-sdr", Object.fromEntries(Object.keys(SDR_DEFAULTS).map((k) => [k, sdr[k]])));
}

/** Change a receiver setting from either the Listen panel or Settings, apply it, keep both in step. */
function sdrSet(key, value) {
  sdr[key] = value;
  saveSdr();
  switch (key) {
    case "addr": if (sdr.running) { sdrStop(); sdrStart(); } break;
    case "gain": case "att": sdrApplyGain(); if (typeof renderPanel === "function") renderPanel(); break;
    case "ppm": sdrCommand(0x05, sdr.ppm); break;
    case "bias": sdrCommand(0x0e, sdr.bias ? 1 : 0); break;
    case "rtlAgc": sdrCommand(0x08, sdr.rtlAgc ? 1 : 0); break;
    case "audioAgc": if (sdr.demod) sdr.demod.autoGain = sdr.audioAgc; break;
    case "volume": if (sdr.demod) sdr.demod.volume = (sdr.volume / 100) * 1.5; break;
    case "widths": case "squelch": case "agcSpeed": case "deemph": sdrConfigure(); break;
    case "rate":
      if (sdr.running) {
        sdrNewDemod();
        sdrCommand(0x02, sdr.rate);
        sdrTune();
      }
      break;
    case "dongle": sdr.directSampling = null; sdrTune(); if (typeof renderListen === "function") renderListen(); break;
    default: break;
  }
  renderSdr();
}

const sdrPort = () => Number(sdr.addr.split(":").pop()) || 1234;
const sdrIsLocal = () => /^(127\.\d+\.\d+\.\d+|localhost):\d+$/i.test(sdr.addr);
const sdrHeaders = { "Content-Type": "application/json", "X-Band-Watch": "sdr" };

/** Start rtl_tcp on this PC (Settings: "Start rtl_tcp for me"). Returns "" or a problem. */
async function sdrLaunch(opts = {}) {
  try {
    const body = { path: opts.path || sdr.exePath, port: opts.port || sdrPort(), device: opts.device ?? sdr.device };
    const r = await fetch("/api/sdr/launch", { method: "POST", headers: sdrHeaders, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    renderRtlProc(j);
    if (!r.ok) return j.error || `rtl_tcp couldn't start (${r.status}).`;
    if (j.running === false) return j.exit || "rtl_tcp stopped straight away.";
    return "";
  } catch { return "Couldn't reach HamShack's server."; }
}

async function sdrLaunchStatus() {
  try {
    const r = await fetch("/api/sdr/launch", { headers: { "X-Band-Watch": "sdr" }, cache: "no-store" });
    if (r.ok) renderRtlProc(await r.json());
  } catch { /* leave as is */ }
}

function renderRtlProc(st) {
  const el = $("optRtlProc");
  if (!el || !st) return;
  if (!st.path) { el.textContent = st.running === false ? "rtl_tcp isn't running from HamShack." : ""; return; }
  const head = st.running ? `rtl_tcp is running: ${st.path} ${(st.args || []).join(" ")}` : `rtl_tcp isn't running. ${st.exit || ""}`;
  el.textContent = [head, ...(st.output || []).slice(-6)].join("\n");
}

const cleanAddr = (v) => (/^[\w.-]+:\d{1,5}$/.test(String(v).trim()) ? String(v).trim() : SDR_DEFAULTS.addr);

/** Connect to rtl_tcp just long enough to see which tuner answers. */
async function sdrTestConnection() {
  if (sdr.running) return `Connected now: ${sdr.tuner}${sdr.tuner === "R828D" ? " (RTL-SDR Blog V4)" : ""} at ${sdr.addr}.`;
  if (!(await checkSdr())) return "The RTL-SDR receiver works in HamShack on your own PC (the Windows app), not on the website.";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch(`/api/sdr/stream?addr=${encodeURIComponent(sdr.addr)}`, { headers: { "X-Band-Watch": "sdr" }, signal: ctl.signal, cache: "no-store" });
    if (!res.ok) {
      let msg = `Couldn't connect (${res.status}).`;
      try { msg = (await res.json()).error || msg; } catch { /* keep */ }
      return msg;
    }
    const reader = res.body.getReader();
    let got = new Uint8Array(0);
    while (got.length < 12) {
      const { value, done } = await reader.read();
      if (done) break;
      const j = new Uint8Array(got.length + value.length);
      j.set(got);
      j.set(value, got.length);
      got = j;
    }
    ctl.abort();
    if (got.length < 12 || String.fromCharCode(...got.subarray(0, 4)) !== "RTL0") return "That address answered, but it isn't rtl_tcp.";
    const dv = new DataView(got.buffer);
    const tuner = RTL_TUNERS[dv.getUint32(4)] || `tuner ${dv.getUint32(4)}`;
    return `Working: rtl_tcp at ${sdr.addr} has an ${tuner} tuner${tuner === "R828D" ? " (RTL-SDR Blog V4)" : ""} with ${dv.getUint32(8)} gain steps.`;
  } catch {
    return `rtl_tcp at ${sdr.addr} didn't answer.`;
  } finally {
    clearTimeout(timer);
  }
}

/** Does this HamShack have the rtl_tcp bridge? (Only when it runs on your own PC.) */
async function checkSdr() {
  if (sdr.available !== null) return sdr.available;
  try {
    const r = await fetch("/api/sdr", { cache: "no-store" });
    sdr.available = r.ok && (await r.json()).available === true;
  } catch { sdr.available = false; }
  if (typeof renderListen === "function") renderListen();
  return sdr.available;
}

function sdrSetStatus(text) {
  sdr.status = text;
  const el = $("rtlStatus");
  if (el) el.textContent = text;
}

/** Send an rtl_tcp command, in order. */
function sdrCommand(cmd, value) {
  const session = sdr.session;
  if (!session) return Promise.resolve();
  sdr.sending = sdr.sending.then(() => {
    if (sdr.session !== session) return undefined; // that connection has gone: drop its queued commands
    return fetch("/api/sdr/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Band-Watch": "sdr" },
      body: JSON.stringify({ session, cmd, value: Math.round(value) }),
    }).then((r) => { if (r.status === 404 && sdr.session === session) sdr.session = null; }).catch(() => {});
  });
  return sdr.sending;
}

const sdrMode = (m) => (SdrDsp.MODES.includes(m) ? m : "usb");

function sdrApplyGain() {
  const gain = rtlAttGain(sdr.gain, sdr.att);
  if (gain < 0) {
    sdrCommand(0x03, 0); // tuner automatic gain
  } else {
    sdrCommand(0x03, 1);
    sdrCommand(0x04, gain);
  }
}

/** Filter widths, squelch, AGC speed and de-emphasis, from Settings. */
function sdrConfigure() {
  if (sdr.demod) sdr.demod.configure({ widths: sdr.widths, agc: sdr.agcSpeed, squelch: sdr.squelch, deemph: sdr.deemph });
}

/** A fresh demodulator at the chosen sample rate, with the receiver settings. */
function sdrNewDemod() {
  sdr.demod = new SdrDsp.Demodulator(sdr.rate);
  sdr.demod.volume = (sdr.volume / 100) * 1.5;
  sdr.demod.autoGain = sdr.audioAgc;
  sdr.demod.setMode(sdrMode(listen.mode));
  sdrConfigure();
  sdr.rows = null;
  sdr.floor = null;
}

/** Tune the dongle for the current frequency and mode. */
function sdrTune() {
  if (!sdr.running) return;
  sdr.demod.setMode(sdrMode(listen.mode));
  // The Blog V3 reaches HF by direct sampling (Q branch); the V4 and others tune normally.
  const ds = sdr.dongle === "v3" && listen.kHz < 24000 ? 2 : 0;
  if (sdr.directSampling !== ds) {
    sdrCommand(0x09, ds);
    sdr.directSampling = ds;
  }
  sdr.centre = SdrDsp.centreFor(listen.kHz * 1000, sdr.demod.inRate);
  sdrCommand(0x01, sdr.centre);
  sdr.iqLen = 0; // samples from the old frequency
  drawSdrSpectrum(null);
}

async function sdrStart() {
  if (sdr.running) { sdrTune(); return; }
  if (!(await checkSdr())) { sdrSetStatus("The RTL-SDR receiver works in HamShack on your own PC (the Windows app)."); return; }
  sdr.running = true;
  sdr.lastError = "";
  sdr.headerOnly = 0;
  sdr.stallShown = sdr.canRestart = false;
  renderStallUi();
  if (typeof renderScopeSrc === "function") renderScopeSrc();
  sdrNewDemod();
  sdrSetStatus(`Connecting to rtl_tcp at ${sdr.addr}…`);
  try {
    // The page asked for sound with a click, so the browser lets it play.
    // In the window Listen is in (its own, when it went out with the Radio panel): that's where the click was.
    const W = typeof hostWindowOf === "function" ? hostWindowOf("secListen") : window;
    sdr.ctxWin = W;
    sdr.ctx = new W.AudioContext({ sampleRate: SdrDsp.AUDIO_RATE });
    await sdr.ctx.audioWorklet.addModule(new URL("/js/sdr-worklet.js?v=1.8.0", location.href).href);
    sdr.node = new W.AudioWorkletNode(sdr.ctx, "bw-sdr-player", { outputChannelCount: [2] });
    sdr.node.connect(sdr.ctx.destination);
    if (sdr.ctx.state === "suspended") await sdr.ctx.resume().catch(() => {});
  } catch (err) {
    sdrStop(`Your browser couldn't start the sound (${err.message}).`);
    return;
  }
  let launched = false;
  if (sdr.autoStart && sdrIsLocal()) {
    sdrSetStatus("Starting rtl_tcp…");
    const problem = await sdrLaunch();
    if (problem) { sdrStop(problem); return; }
    launched = true;
  }
  // On this PC, if rtl_tcp isn't running, start it rather than just failing.
  let ok = await sdrConnect(launched ? 8 : 1, { canLaunch: !launched && sdrIsLocal() });
  if (ok === "launch") {
    sdrSetStatus("rtl_tcp isn't running, so HamShack is starting it…");
    const problem = await sdrLaunch();
    if (problem) { sdrStop(`${sdr.connectMsg} HamShack tried to start it for you, but: ${problem}`); return; }
    ok = await sdrConnect(8);
  }
  if (!ok) return;
  sdrSendSettings();
  sdrStartReading();
}

/** Read the stream; a newer read (after a reconnect or restart) retires the older one. */
function sdrStartReading() {
  const id = ++sdr.readId;
  sdr.headerAt = sdr.lastIqAt = 0;
  sdrWatchStart();
  readSdrStream(sdr.reader, id).catch(() => { if (sdr.running && id === sdr.readId) sdrLost("The connection to rtl_tcp was lost."); });
}

/** Everything the dongle needs after (re)connecting. */
function sdrSendSettings() {
  sdr.directSampling = null; // send it again after (re)connecting
  sdrCommand(0x02, sdr.rate);
  sdrCommand(0x05, sdr.ppm);
  sdrCommand(0x0e, sdr.bias ? 1 : 0);
  sdrCommand(0x08, sdr.rtlAgc ? 1 : 0);
  sdrApplyGain();
  sdrTune();
}

/** Open the stream from rtl_tcp, trying a few times if it was only just started. */
async function sdrConnect(tries, { canLaunch = false } = {}) {
  for (let i = 1; i <= tries; i++) {
    if (!sdr.running) return false;
    sdr.abort = new AbortController();
    let res;
    try {
      res = await fetch(`/api/sdr/stream?addr=${encodeURIComponent(sdr.addr)}`, { headers: { "X-Band-Watch": "sdr" }, signal: sdr.abort.signal, cache: "no-store" });
    } catch {
      if (sdr.running) sdrStop("Couldn't reach HamShack's server.");
      return false;
    }
    if (res.ok) {
      sdr.session = res.headers.get("X-SDR-Session");
      sdr.retries = 0;
      sdr.reader = res.body.getReader();
      return true;
    }
    let msg = `Couldn't connect (${res.status}).`;
    try { msg = (await res.json()).error || msg; } catch { /* keep */ }
    if (res.status === 502 && canLaunch && sdr.running) { sdr.connectMsg = msg; return "launch"; }
    if (res.status !== 502 || i === tries) { sdrStop(msg); return false; }
    sdrSetStatus(`Waiting for rtl_tcp to start (${i} of ${tries})…`);
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

async function readSdrStream(reader, id) {
  let header = new Uint8Array(0);
  sdr.odd = false; // true when the next byte is a Q byte
  for (;;) {
    const { value, done } = await reader.read();
    if (done || !sdr.running || id !== sdr.readId) break;
    let chunk = value;
    if (header !== null) {
      // rtl_tcp starts with 12 bytes: "RTL0", the tuner type, the number of gain steps.
      const joined = new Uint8Array(header.length + chunk.length);
      joined.set(header);
      joined.set(chunk, header.length);
      if (joined.length < 12) { header = joined; continue; }
      if (String.fromCharCode(...joined.subarray(0, 4)) !== "RTL0") {
        sdrStop(`That address answered, but it isn't rtl_tcp.`);
        return;
      }
      const tuner = new DataView(joined.buffer).getUint32(4);
      sdr.tuner = RTL_TUNERS[tuner] || `tuner ${tuner}`;
      sdrSetStatus(`Connected: ${sdr.tuner}${sdr.tuner === "R828D" ? " (RTL-SDR Blog V4)" : ""} at ${sdr.addr}, ${(sdr.rate / 1e6).toLocaleString()} MS/s.`);
      header = null;
      sdr.headerAt = performance.now();
      sdr.lastIqAt = 0;
      chunk = joined.subarray(12);
      sdr.iqLen = 0;
      sdr.iqCarry = -1;
    }
    if (chunk.length) {
      sdr.lastIqAt = performance.now();
      sdr.headerOnly = 0;
      if (sdr.stallShown) sdrStallClear();
    }
    const startsOdd = sdr.odd;
    sdr.odd = (sdr.odd ? 1 : 0) + chunk.length % 2 === 1;
    const audio = sdr.demod.process(chunk);
    if (audio.length && typeof dc !== "undefined" && dc.running && dc.src === "rtl") decoderFeed(audio.slice(), SdrDsp.AUDIO_RATE);
    if (audio.length && typeof clearrxProcess === "function") clearrxProcess(audio); // ClearRX, if it's open and ticked
    if (audio.length && sdr.node) sdr.node.port.postMessage(audio, [audio.buffer]);
    sdrKeepIq(chunk);
    const now = performance.now();
    if (now - sdr.lastScope > FALL_SPEEDS[sdr.speed] && typeof scopeLiveFeed === "function") {
      sdr.lastScope = now;
      scopeLiveFeed();
      if (typeof panelLiveFeed === "function") panelLiveFeed(); // the Radio panel's spectrum and waterfall
    }
    if (now - sdr.lastSpec > FALL_SPEEDS[sdr.speed] && chunk.length >= 4100) {
      sdr.lastSpec = now;
      let from = chunk.length - 4098;
      if ((from + (startsOdd ? 1 : 0)) % 2) from++; // start on an I byte
      drawSdrSpectrum(SdrDsp.spectrum(chunk.subarray(from, from + 4096), 2048));
    }
    if (now - sdr.meterAt > 250) {
      sdr.meterAt = now;
      const m = $("rtlMeter");
      if (m) m.textContent = `Signal ${sdr.demod.level.toFixed(0)} dBFS`;
    }
  }
  if (sdr.running && id === sdr.readId) sdrLost("rtl_tcp closed the connection. Is the dongle still plugged in?");
}

/** The connection dropped: reconnect if allowed (Settings), otherwise stop. */
async function sdrLost(why) {
  if (sdr.headerAt && !sdr.lastIqAt) sdr.headerOnly++; // that connection got the header and nothing else
  sdr.headerAt = 0;
  if (sdr.running && SdrStall.isLoopStalled(sdr.headerOnly) && !sdr.stallBusy) { sdrStall("loop"); return; }
  if (!sdr.reconnect || (sdr.retries || 0) >= SDR_RETRIES) { sdrStop(why); return; }
  sdr.retries = (sdr.retries || 0) + 1;
  sdr.session = null;
  sdrSetStatus(`Connection lost; reconnecting (${sdr.retries} of ${SDR_RETRIES})…`);
  await new Promise((r) => setTimeout(r, 2000));
  if (!sdr.running) return;
  if (sdr.autoStart && sdrIsLocal()) await sdrLaunch();
  const n = sdr.retries;
  if (await sdrConnect(3)) {
    sdr.retries = n; // count stays until the connection holds
    sdrSendSettings();
    sdrStartReading();
    setTimeout(() => { if (sdr.running && sdr.session) sdr.retries = 0; }, 20000);
  }
}

/* ---------- Stall recovery: rtl_tcp connected but sending no signal ---------- */

function sdrWatchStart() {
  if (sdr.watch) return;
  sdr.watch = setInterval(() => {
    if (!sdr.running || sdr.stallBusy || sdr.stallShown) return;
    if (SdrStall.isStalled({ headerAt: sdr.headerAt, lastIqAt: sdr.lastIqAt, now: performance.now() })) sdrStall("silent");
  }, 1000);
}
function sdrWatchStop() { if (sdr.watch) clearInterval(sdr.watch); sdr.watch = null; }

function renderStallUi() {
  const b = $("rtlRestart");
  if (b) b.hidden = !sdr.canRestart;
}

function sdrStallClear() {
  sdr.stallShown = sdr.canRestart = false;
  renderStallUi();
  if (sdr.running && sdr.tuner) sdrSetStatus(`Connected: ${sdr.tuner}${sdr.tuner === "R828D" ? " (RTL-SDR Blog V4)" : ""} at ${sdr.addr}, ${(sdr.rate / 1e6).toLocaleString()} MS/s.`);
}

async function sdrLaunchState() {
  try {
    const r = await fetch("/api/sdr/launch", { headers: { "X-Band-Watch": "sdr" }, cache: "no-store" });
    if (r.ok) return await r.json();
  } catch { /* unknown */ }
  return null;
}

/** Stop our own rtl_tcp and wait for it to go (the server answers before the program has exited). */
async function sdrStopOurs() {
  try { await fetch("/api/sdr/launch/stop", { method: "POST", headers: sdrHeaders, body: "{}" }); } catch { /* ignore */ }
  for (let i = 0; i < 40; i++) {
    const st = await sdrLaunchState();
    if (!st || st.running === false) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 500)); // let the port free up
}

/** Start our own rtl_tcp; "" when it's up, or a plain-English problem (including a foreign rtl_tcp holding the port). */
async function sdrStartOwn(opts) {
  const port = opts.port || sdrPort();
  const problem = await sdrLaunch(opts);
  if (problem) return problem;
  await new Promise((r) => setTimeout(r, 1200));
  const st = await sdrLaunchState();
  if (st && st.running === false) return SdrStall.msgPortHeld(port);
  return "";
}

const sdrDeviceOf = (st) => Number(st.args[st.args.indexOf("-d") + 1]) || 0;

/** rtl_tcp stopped sending signal ("silent": connected and quiet; "loop": reconnects keep getting no samples). */
async function sdrStall(kind) {
  if (sdr.stallBusy || !sdr.running) return;
  sdr.stallBusy = true;
  try {
    const local = sdrIsLocal() && sdr.available !== false;
    const st = local ? await sdrLaunchState() : null;
    const port = sdrPort();
    const now = Date.now();
    const act = SdrStall.plan({ status: st, port, restarts: sdr.restarts, now });
    if (act === "restart") {
      sdr.restarts = [...SdrStall.restartBudget(sdr.restarts, now).recent, now];
      sdr.readId++; // retire the quiet connection
      if (sdr.abort) sdr.abort.abort();
      sdrSetStatus("rtl_tcp stopped sending signal. HamShack is restarting it…");
      await sdrStopOurs();
      if (!sdr.running) return;
      const problem = await sdrStartOwn({ path: st.path, port, device: sdrDeviceOf(st) });
      if (!sdr.running) return;
      if (problem) { sdrStop(problem); return; }
      sdr.headerOnly = 0;
      sdr.session = null;
      if (!(await sdrConnect(8))) return;
      sdrSendSettings();
      sdrStartReading();
    } else if (act === "limit") {
      sdr.readId++;
      sdrStop(SdrStall.MSG_LIMIT);
    } else if (kind === "loop") {
      sdr.canRestart = local;
      sdrStop(SdrStall.MSG_FOREIGN);
      renderStallUi();
    } else {
      sdr.stallShown = true;
      sdr.canRestart = local;
      sdrSetStatus(SdrStall.MSG_FOREIGN);
      renderStallUi();
    }
  } finally { sdr.stallBusy = false; }
}

/** "Restart receiver": starts HamShack's own rtl_tcp. It never closes a program HamShack didn't start. */
async function sdrRestartClick() {
  if (sdr.stallBusy) return;
  const st = await sdrLaunchState();
  const port = sdrPort();
  const ours = SdrStall.isOurs(st, port);
  sdr.stallBusy = true;
  try {
    sdr.canRestart = false;
    renderStallUi();
    sdrSetStatus("Restarting the receiver…");
    sdr.readId++;
    if (sdr.abort) sdr.abort.abort();
    if (ours) await sdrStopOurs();
    const problem = await sdrStartOwn(ours ? { path: st.path, port, device: sdrDeviceOf(st) } : {});
    if (problem) { sdrStop(problem); sdr.canRestart = true; renderStallUi(); return; }
    sdr.stallShown = false;
    if (!sdr.running) { sdrSetStatus("rtl_tcp started. Press Listen."); return; }
    sdr.headerOnly = 0;
    sdr.session = null;
    if (!(await sdrConnect(8))) return;
    sdrSendSettings();
    sdrStartReading();
  } finally { sdr.stallBusy = false; }
}

/** Stop the receiver; `why` is shown if it stopped by itself. */
function sdrStop(why = "") {
  const wasRunning = sdr.running;
  sdr.running = false;
  sdr.session = null;
  sdr.readId++;
  sdrWatchStop();
  if (sdr.abort) sdr.abort.abort();
  sdr.abort = null;
  if (sdr.ctx) sdr.ctx.close().catch(() => {});
  sdr.ctx = sdr.node = null;
  sdr.ctxWin = null;
  sdrSetStatus(why || (wasRunning ? "Stopped." : ""));
  if (wasRunning && typeof drawScope === "function") { renderScopeSrc(); drawScope(); }
  const m = $("rtlMeter");
  if (m) m.textContent = "";
  if (why && listen.open && listen.rx === "rtl") {
    listen.open = false;
    renderListen();
  }
  // A problem is shown beside the Listen button too, and as a pop-up, so the button never looks dead.
  sdr.lastError = why && why !== "Stopped." ? why : "";
  if (sdr.lastError && listen.rx === "rtl") {
    if ($("lsErr")) $("lsErr").textContent = why;
    if (typeof showToast === "function") showToast("RTL-SDR", why);
  }
}

/* ---------- Spectrum and waterfall ---------- */

const fallColour = (t) => {
  // dark blue -> teal -> yellow -> white
  const stops = [[8, 12, 40], [11, 114, 133], [240, 200, 60], [255, 255, 255]];
  const x = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  return stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * f));
};

/** Draws the spectrum line and adds a waterfall row. dB is the full spectrum (or null to redraw the scale). */
function drawSdrSpectrum(dB) {
  const spec = $("rtlSpec");
  const fall = $("rtlFall");
  if (!spec || !fall || spec.offsetParent === null) return;
  // Sharp on high-DPI screens: the spectrum has as many pixels as the screen, and we draw in CSS pixels.
  // The waterfall stays one pixel per CSS pixel (it's a picture) and is resized only when it must be (that wipes it).
  const w = Math.max(200, Math.round(spec.clientWidth));
  const h = 90;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (spec.width !== Math.round(w * dpr) || spec.height !== Math.round(h * dpr)) { spec.width = Math.round(w * dpr); spec.height = Math.round(h * dpr); }
  if (fall.width !== w || fall.height !== 110) { fall.width = w; fall.height = 110; }
  const g = spec.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#0b1418";
  g.fillRect(0, 0, w, h);
  // The dial frequency is a quarter of the sample rate below the dongle's centre: show the lower half.
  const n = dB ? dB.length : 0;
  const half = n / 2;
  if (dB) {
    // Levels: either follow the noise floor (auto) or a fixed top, with the chosen range in dB.
    let lo;
    if (sdr.autoLevel) {
      const shown = Array.from(dB.subarray(0, half)).sort((a, b) => a - b);
      const floor = shown[Math.floor(shown.length * 0.2)];
      sdr.floor = sdr.floor == null ? floor : sdr.floor + 0.1 * (floor - sdr.floor);
      lo = sdr.floor - 3;
    } else {
      lo = -10 - sdr.range;
    }
    const hi = lo + sdr.range;
    g.strokeStyle = "#5fd3e6";
    g.lineWidth = 1.25;
    g.lineJoin = "round";
    g.beginPath();
    for (let x = 0; x < w; x++) {
      const v = dB[Math.floor((x / w) * half)];
      const y = h - ((v - lo) / (hi - lo)) * h;
      if (x) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    // waterfall: shift down a row, draw the new row at the top
    const fg = fall.getContext("2d");
    const old = sdr.rows;
    if (old && old.width === w) fg.putImageData(old, 0, 1);
    else fg.clearRect(0, 0, fall.width, fall.height); // new start (retuned, new size): begin a fresh waterfall
    const row = fg.createImageData(w, 1);
    for (let x = 0; x < w; x++) {
      const [r, gg, b] = fallColour((dB[Math.floor((x / w) * half)] - lo) / (hi - lo));
      row.data.set([r, gg, b, 255], x * 4);
    }
    fg.putImageData(row, 0, 0);
    sdr.rows = fg.getImageData(0, 0, w, fall.height);
  }
  // scale and the tuned frequency
  g.fillStyle = "rgba(255,255,255,.55)";
  g.font = "11px Barlow, sans-serif";
  const kHzPerPx = spanHz() / 1000 / w;
  const left = listen.kHz - (spanHz() / 2000);
  const tick = spanHz() >= 900000 ? 100 : spanHz() >= 400000 ? 50 : 10;
  for (let k = Math.ceil(left / tick) * tick; k < left + spanHz() / 1000; k += tick) {
    const x = Math.round((k - left) / kHzPerPx);
    g.fillRect(x, h - 6, 1, 6);
    if (x > 20 && x < w - 40) g.fillText(`${k.toLocaleString()}`, x + 2, h - 8);
  }
  g.fillStyle = "rgba(255,90,60,.9)";
  g.fillRect(Math.round(w / 2), 0, 1, h);
}

/** kHz under a point on the waterfall. */
function sdrKHzAt(el, clientX) {
  const r = el.getBoundingClientRect();
  const frac = (clientX - r.left) / r.width;
  return Math.round((listen.kHz + (frac - 0.5) * (spanHz() / 1000)) * 10) / 10;
}

function renderSdr() {
  const gains = `<option value="-1"${sdr.gain < 0 ? " selected" : ""}>Auto</option>` +
    RTL_GAINS.map((t) => `<option value="${t}"${t === sdr.gain ? " selected" : ""}>${(t / 10).toFixed(1)} dB</option>`).join("");
  for (const [id, key] of [["rtlAddr", "addr"], ["optRtlAddr", "addr"], ["rtlPpm", "ppm"], ["optRtlPpm", "ppm"], ["rtlVol", "volume"], ["optRtlRange", "range"]]) {
    if ($(id) && document.activeElement !== $(id)) $(id).value = sdr[key];
  }
  for (const id of ["rtlGain", "optRtlGain"]) if ($(id)) $(id).innerHTML = gains;
  for (const id of ["rtlAtt", "pnAtt"]) if ($(id)) $(id).value = String(sdr.att);
  for (const [id, key] of [["rtlBias", "bias"], ["optRtlBias", "bias"], ["optRtlAgc", "rtlAgc"], ["optRtlAudioAgc", "audioAgc"], ["optRtlAuto", "autoLevel"]]) {
    if ($(id)) $(id).checked = sdr[key];
  }
  if ($("optRtlSpeed")) $("optRtlSpeed").value = sdr.speed;
  if ($("optRtlDongle")) $("optRtlDongle").value = sdr.dongle;
  if ($("optRtlRate")) $("optRtlRate").value = String(sdr.rate);
  if ($("optRtlAgcSpd")) $("optRtlAgcSpd").value = sdr.agcSpeed;
  if ($("optRtlDeemph")) $("optRtlDeemph").value = String(sdr.deemph);
  const widthOpts = (m) => SdrDsp.WIDTHS[m].map((w) => `<option value="${w}"${w === sdr.widths[m] ? " selected" : ""}>${w >= 1000 ? `${(w / 1000).toLocaleString()} kHz` : `${w} Hz`}</option>`).join("");
  for (const [id, m] of [["optRtlWSsb", "usb"], ["optRtlWCw", "cw"], ["optRtlWAm", "am"], ["optRtlWFm", "fm"]]) if ($(id)) $(id).innerHTML = widthOpts(m);
  if ($("rtlWidth")) {
    const m = sdrMode(listen.mode);
    $("rtlWidthRow").hidden = m === "wfm";
    if (m !== "wfm") $("rtlWidth").innerHTML = widthOpts(m);
  }
  if ($("optRtlSql") && document.activeElement !== $("optRtlSql")) $("optRtlSql").value = sdr.squelch === null ? -101 : sdr.squelch;
  if ($("optRtlSqlVal")) $("optRtlSqlVal").textContent = sdr.squelch === null ? "Off" : `${sdr.squelch} dBFS`;
  if ($("optRtlDongleNote")) $("optRtlDongleNote").textContent = DONGLES[sdr.dongle].note;
  for (const [id, key] of [["optRtlAuto2", "autoStart"], ["optRtlReconnect", "reconnect"]]) if ($(id)) $(id).checked = sdr[key];
  if ($("optRtlDev") && document.activeElement !== $("optRtlDev")) $("optRtlDev").value = sdr.device;
  if ($("optRtlExe") && document.activeElement !== $("optRtlExe")) $("optRtlExe").value = sdr.exePath;
  if ($("optRtlRangeVal")) $("optRtlRangeVal").textContent = `${sdr.range} dB`;
  if (!$("rtlStatus")) return;
  $("rtlStatus").textContent = sdr.status;
  $("rtlScope").hidden = !sdr.running;
  if (sdr.available === false) {
    $("rtlStatus").textContent = "The RTL-SDR receiver works in HamShack on your own PC (the Windows app), not on the website.";
  }
}

function setupSdr() {
  loadSdr();
  const on = (id, ev, fn) => { if ($(id)) $(id).addEventListener(ev, fn); };
  // In Settings, Enter applies the box rather than closing the window.
  for (const id of ["optRtlAddr", "optRtlPpm"]) {
    on(id, "keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); $(id).dispatchEvent(new Event("change")); }
    });
  }
  for (const id of ["rtlAddr", "optRtlAddr"]) on(id, "change", () => sdrSet("addr", cleanAddr($(id).value)));
  for (const id of ["rtlGain", "optRtlGain"]) on(id, "change", () => sdrSet("gain", Number($(id).value)));
  for (const id of ["rtlAtt", "pnAtt"]) {
    on(id, "change", () => {
      const v = Number($(id).value);
      sdrSet("att", RTL_ATTS.includes(v) ? v : 0);
      renderSdr(); // keeps the Listen panel's and the Radio panel's ATT in step
    });
  }
  for (const id of ["rtlPpm", "optRtlPpm"]) {
    on(id, "change", () => {
      const v = Math.round(Number($(id).value));
      sdrSet("ppm", Number.isFinite(v) ? Math.max(-200, Math.min(200, v)) : 0);
    });
  }
  for (const id of ["rtlBias", "optRtlBias"]) on(id, "change", () => sdrSet("bias", $(id).checked));
  on("rtlVol", "input", () => sdrSet("volume", Number($("rtlVol").value)));
  on("optRtlAgc", "change", () => sdrSet("rtlAgc", $("optRtlAgc").checked));
  on("optRtlAudioAgc", "change", () => sdrSet("audioAgc", $("optRtlAudioAgc").checked));
  on("optRtlAuto", "change", () => sdrSet("autoLevel", $("optRtlAuto").checked));
  on("optRtlRange", "input", () => sdrSet("range", Number($("optRtlRange").value)));
  on("optRtlSpeed", "change", () => sdrSet("speed", FALL_SPEEDS[$("optRtlSpeed").value] ? $("optRtlSpeed").value : "normal"));
  on("optRtlDongle", "change", () => sdrSet("dongle", DONGLES[$("optRtlDongle").value] ? $("optRtlDongle").value : "v4"));
  on("optRtlRate", "change", () => {
    const r = Number($("optRtlRate").value);
    sdrSet("rate", SdrDsp.RATES.includes(r) ? r : SdrDsp.IN_RATE);
  });
  on("optRtlAgcSpd", "change", () => sdrSet("agcSpeed", SdrDsp.AGC_DECAY[$("optRtlAgcSpd").value] ? $("optRtlAgcSpd").value : "normal"));
  on("optRtlDeemph", "change", () => sdrSet("deemph", $("optRtlDeemph").value === "75" ? 75 : 50));
  on("optRtlSql", "input", () => {
    const v = Number($("optRtlSql").value);
    sdrSet("squelch", v <= -101 ? null : Math.max(-100, Math.min(0, v)));
  });
  const setWidth = (modes, value) => {
    const w = { ...sdr.widths };
    for (const m of modes) if (SdrDsp.WIDTHS[m].includes(value)) w[m] = value;
    sdrSet("widths", w);
  };
  on("optRtlWSsb", "change", () => setWidth(["usb", "lsb"], Number($("optRtlWSsb").value)));
  on("optRtlWCw", "change", () => setWidth(["cw"], Number($("optRtlWCw").value)));
  on("optRtlWAm", "change", () => setWidth(["am"], Number($("optRtlWAm").value)));
  on("optRtlWFm", "change", () => setWidth(["fm"], Number($("optRtlWFm").value)));
  on("rtlWidth", "change", () => {
    const m = sdrMode(listen.mode);
    setWidth(m === "usb" || m === "lsb" ? ["usb", "lsb"] : [m], Number($("rtlWidth").value));
  });
  on("optRtlDev", "change", () => {
    const v = Math.round(Number($("optRtlDev").value));
    sdrSet("device", Number.isFinite(v) ? Math.max(0, Math.min(9, v)) : 0);
  });
  on("optRtlExe", "change", () => sdrSet("exePath", $("optRtlExe").value.trim().replace(/^"|"$/g, "").slice(0, 260)));
  on("optRtlAuto2", "change", () => sdrSet("autoStart", $("optRtlAuto2").checked));
  on("optRtlReconnect", "change", () => sdrSet("reconnect", $("optRtlReconnect").checked));
  on("optRtlLaunch", "click", async () => {
    if (!(await checkSdr())) { $("optRtlMsg").textContent = "Starting rtl_tcp works in HamShack on your own PC."; return; }
    $("optRtlMsg").textContent = "Starting rtl_tcp…";
    const problem = await sdrLaunch();
    $("optRtlMsg").textContent = problem || `rtl_tcp started on port ${sdrPort()}. Press Test connection, or Listen.`;
    setTimeout(sdrLaunchStatus, 1500);
  });
  on("rtlRestart", "click", sdrRestartClick);
  on("optRtlKill", "click", async () => {
    try { await fetch("/api/sdr/launch/stop", { method: "POST", headers: sdrHeaders, body: "{}" }); } catch { /* ignore */ }
    $("optRtlMsg").textContent = "rtl_tcp stopped.";
    sdrLaunchStatus();
  });
  for (const id of ["optRtlDev", "optRtlExe"]) {
    on(id, "keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $(id).dispatchEvent(new Event("change")); } });
  }
  on("optBtn", "click", () => { if (sdr.available !== false) sdrLaunchStatus(); });
  on("optRtlTest", "click", async () => {
    $("optRtlMsg").textContent = `Trying rtl_tcp at ${sdr.addr}…`;
    $("optRtlMsg").textContent = await sdrTestConnection();
  });
  on("optRtlReset", "click", () => {
    const keep = { addr: sdr.addr, exePath: sdr.exePath, device: sdr.device, autoStart: sdr.autoStart, dongle: sdr.dongle };
    Object.assign(sdr, SDR_DEFAULTS, keep);
    saveSdr();
    if (sdr.running) {
      sdrApplyGain();
      sdrCommand(0x05, sdr.ppm);
      sdrCommand(0x0e, 0);
      sdrCommand(0x08, 0);
      sdrNewDemod();
      sdrCommand(0x02, sdr.rate);
      sdrTune();
    }
    renderSdr();
    $("optRtlMsg").textContent = "Receiver settings are back to their defaults (the connection settings are kept).";
  });
  renderSdr();
  for (const id of ["rtlSpec", "rtlFall"]) {
    const el = $(id);
    el.addEventListener("click", (e) => tuneTo(sdrKHzAt(el, e.clientX), listen.mode, { quiet: true }));
    el.addEventListener("wheel", (e) => { e.preventDefault(); stepTune(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    el.addEventListener("mousemove", (e) => { el.title = `${sdrKHzAt(el, e.clientX).toLocaleString()} kHz: click to tune`; });
  }
  window.addEventListener("resize", () => { sdr.rows = null; drawSdrSpectrum(null); });
}
