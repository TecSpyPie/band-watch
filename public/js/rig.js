/* Radio control (CAT) over the radio's USB cable, for Yaesu (FT-991A, FT-710, FTDX10, FTDX101),
   Kenwood (TS-590, TS-890, TS-990, TS-480, TS-2000) and Icom (IC-7300, IC-705, IC-7610, IC-9700 and
   other CI-V radios). Uses the browser's Web Serial (Chrome or Edge on the PC the radio is plugged into).
   Band Watch tunes the radio when you click a spot, the band scope, the band plan or a decoder button,
   and shows the radio's own frequency and mode as you turn the dial. */

const RIG_KINDS = {
  yaesu: { name: "Yaesu", bauds: [4800, 9600, 19200, 38400], baud: 4800 },
  kenwood: { name: "Kenwood", bauds: [4800, 9600, 19200, 38400, 57600, 115200], baud: 115200 },
  icom: { name: "Icom", bauds: [4800, 9600, 19200, 38400, 57600, 115200], baud: 115200 },
};
const RIG_DEFAULTS = { kind: "yaesu", baud: 4800, civ: "94", follow: true, read: true, dataMode: true, autoConnect: true };
const RIG_MIN_HZ = 30000;
const RIG_MAX_HZ = 470000000;

// Yaesu operating modes (MD0x;): code -> name, and Band Watch's listen modes -> code.
const RIG_MODES = {
  1: "LSB", 2: "USB", 3: "CW-U", 4: "FM", 5: "AM", 6: "RTTY-LSB", 7: "CW-L", 8: "DATA-LSB",
  9: "RTTY-USB", A: "DATA-FM", B: "FM-N", C: "DATA-USB", D: "AM-N", E: "C4FM",
};
const RIG_MODE_FOR = { usb: "2", lsb: "1", cw: "3", am: "5", fm: "4", wfm: "4" };
const RIG_LISTEN_MODE = { 1: "lsb", 2: "usb", 3: "cw", 4: "fm", 5: "am", 6: "lsb", 7: "cw", 8: "lsb", 9: "usb", A: "fm", B: "fm", C: "usb", D: "am", E: "fm" };
const YAESU_IDS = { "0670": "FT-991A", "0800": "FT-710", "0761": "FTDX10", "0570": "FTDX101D", "0681": "FTDX101MP" };

// Kenwood modes (MDx;) and models (IDxxx;).
const KW_MODES = { 1: "LSB", 2: "USB", 3: "CW", 4: "FM", 5: "AM", 6: "FSK", 7: "CW-R", 9: "FSK-R" };
const KW_MODE_FOR = { usb: "2", lsb: "1", cw: "3", am: "5", fm: "4", wfm: "4" };
const KW_LISTEN_MODE = { 1: "lsb", 2: "usb", 3: "cw", 4: "fm", 5: "am", 6: "lsb", 7: "cw", 9: "usb" };
const KW_IDS = { "019": "TS-2000", "020": "TS-480", "021": "TS-590S", "022": "TS-990", "023": "TS-590SG", "024": "TS-890" };

// Icom CI-V: modes (command 06) and the factory CI-V addresses of popular radios.
const ICOM_MODES = { 0: "LSB", 1: "USB", 2: "AM", 3: "CW", 4: "RTTY", 5: "FM", 6: "WFM", 7: "CW-R", 8: "RTTY-R", 0x17: "DV" };
const ICOM_MODE_FOR = { usb: 1, lsb: 0, cw: 3, am: 2, fm: 5, wfm: 5 };
const ICOM_LISTEN_MODE = { 0: "lsb", 1: "usb", 2: "am", 3: "cw", 4: "lsb", 5: "fm", 6: "wfm", 7: "cw", 8: "usb", 0x17: "fm" };
const ICOM_RADIOS = { "94": "IC-7300", A4: "IC-705", "98": "IC-7610", A2: "IC-9700", "88": "IC-7100", "8E": "IC-7851", AC: "IC-905", "70": "IC-7000", "7C": "IC-9100" };
const CIV_ME = 0xe0; // Band Watch's own CI-V address (the usual one for a computer)

const rig = {
  ...RIG_DEFAULTS,
  port: null, writer: null, reader: null, connected: false, busy: false,
  hz: 0, modeName: "", listenMode: "", data: false, model: "", buf: "", bytes: [], poll: null, lastSet: 0, error: "",
};

function rigSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.serial) && typeof navigator.serial.requestPort === "function";
}

const rigKind = () => RIG_KINDS[rig.kind] || RIG_KINDS.yaesu;

function loadRig() {
  try {
    const s = JSON.parse(load("bw-rig") || "{}");
    if (RIG_KINDS[s.kind]) rig.kind = s.kind;
    rig.baud = rigKind().baud;
    if (rigKind().bauds.includes(s.baud)) rig.baud = s.baud;
    if (typeof s.civ === "string" && /^[0-9A-F]{2}$/.test(s.civ)) rig.civ = s.civ;
    for (const k of ["follow", "read", "dataMode", "autoConnect"]) if (typeof s[k] === "boolean") rig[k] = s[k];
  } catch { /* defaults */ }
}

function saveRig() {
  store("bw-rig", { kind: rig.kind, baud: rig.baud, civ: rig.civ, follow: rig.follow, read: rig.read, dataMode: rig.dataMode, autoConnect: rig.autoConnect });
}

/** Is this frequency one of the digital-mode calling frequencies (FT8, FT4, WSPR and the like)? */
function rigIsDigital(kHz) {
  const seg = typeof planSegment === "function" ? planSegment(kHz) : null;
  if (seg && seg.type === "digi") return true;
  const near = (list) => list && Object.values(list).some((f) => Math.abs(f * 1000 - kHz) <= 3);
  return near(typeof FT8 !== "undefined" ? FT8 : null) || near(typeof FT4 !== "undefined" ? FT4 : null) || near(typeof WSPR !== "undefined" ? WSPR : null);
}

/* ---------- Icom CI-V frames ---------- */

/** A CI-V frame to the radio: FE FE <radio> E0 <command and data> FD. */
function civFrame(...body) {
  return [0xfe, 0xfe, parseInt(rig.civ, 16), CIV_ME, ...body, 0xfd];
}

/** A frequency in Hz as CI-V's five BCD bytes, lowest digits first. */
function civFreqBytes(hz) {
  const out = [];
  for (let i = 0; i < 5; i++) {
    const lo = Math.floor(hz / 10 ** (2 * i)) % 10;
    const hi = Math.floor(hz / 10 ** (2 * i + 1)) % 10;
    out.push((hi << 4) | lo);
  }
  return out;
}

function civFreqHz(bytes) {
  let hz = 0;
  for (let i = bytes.length - 1; i >= 0; i--) hz = hz * 100 + (bytes[i] >> 4) * 10 + (bytes[i] & 15);
  return hz;
}

/* ---------- What to send ---------- */

/** The commands that set a frequency (Hz) and mode on the radio: a string (Yaesu, Kenwood) or bytes (Icom). */
function rigCommands(hz, mode, kHz) {
  hz = Math.round(hz);
  if (!(hz >= RIG_MIN_HZ && hz <= RIG_MAX_HZ)) return "";
  const ssb = mode === "usb" || mode === "lsb";
  const digital = rig.dataMode && ssb && rigIsDigital(kHz);
  if (rig.kind === "kenwood") {
    const da = rig.dataMode && ssb ? (digital ? "DA1;" : "DA0;") : "";
    return `FA${String(hz).padStart(11, "0")};MD${KW_MODE_FOR[mode] || "2"};${da}`;
  }
  if (rig.kind === "icom") {
    const out = [...civFrame(0x05, ...civFreqBytes(hz)), ...civFrame(0x06, ICOM_MODE_FOR[mode] ?? 1, 0x01)];
    if (rig.dataMode && ssb) out.push(...civFrame(0x1a, 0x06, digital ? 1 : 0, digital ? 1 : 0));
    return out;
  }
  let code = RIG_MODE_FOR[mode] || "2";
  if (digital) code = mode === "lsb" ? "8" : "C";
  return `FA${String(hz).padStart(9, "0")};MD0${code};`;
}

/** Ask the radio for its frequency and mode. */
function rigPollCommands(first = false) {
  if (rig.kind === "kenwood") return `${first ? "ID;" : ""}FA;MD;${rig.dataMode ? "DA;" : ""}`;
  if (rig.kind === "icom") return [...civFrame(0x03), ...civFrame(0x04), ...(rig.dataMode ? civFrame(0x1a, 0x06) : [])];
  return `${first ? "ID;" : ""}FA;MD0;`;
}

async function rigWrite(cmd) {
  if (!rig.writer || !cmd || !cmd.length) return;
  try {
    await rig.writer.write(typeof cmd === "string" ? new TextEncoder().encode(cmd) : Uint8Array.from(cmd));
  } catch (e) {
    rigLost(`Couldn't send to the radio: ${e.message || e}`);
  }
}

/** Tune the radio, called whenever Band Watch tunes (tuneTo). */
function rigTune(kHz, mode) {
  if (!rig.connected || !rig.follow) return;
  const cmd = rigCommands(kHz * 1000, mode, kHz);
  if (!cmd || !cmd.length) return;
  rig.lastSet = Date.now();
  rigWrite(cmd);
}

/* ---------- What the radio says ---------- */

function rigSetState(hz, modeName, listenMode) {
  const changed = (hz != null && hz !== rig.hz) || (modeName != null && modeName !== rig.modeName);
  if (hz != null) rig.hz = hz;
  if (modeName != null) rig.modeName = modeName;
  if (listenMode != null) rig.listenMode = listenMode;
  if (changed) rigFromRadio();
}

/** Yaesu answers: FA (frequency), MD0 (mode), ID (model), ?; (didn't understand). */
function rigYaesuAnswer(ans) {
  if (/^FA\d{8,9}$/.test(ans)) rigSetState(Number(ans.slice(2)));
  else if (/^MD0[0-9A-E]$/.test(ans)) rigSetState(null, RIG_MODES[ans[3]] || "", RIG_LISTEN_MODE[ans[3]] || "");
  else if (/^ID\d{4}$/.test(ans)) rig.model = YAESU_IDS[ans.slice(2)] || "";
}

/** Kenwood answers: FA (11 digits), MD, DA (data mode), ID. */
function rigKenwoodAnswer(ans) {
  if (/^FA\d{11}$/.test(ans)) rigSetState(Number(ans.slice(2)));
  else if (/^MD\d$/.test(ans)) { rig.kwMode = ans[2]; rigKenwoodMode(); }
  else if (/^DA[01]$/.test(ans)) { rig.data = ans[2] === "1"; rigKenwoodMode(); }
  else if (/^ID\d{3}$/.test(ans)) rig.model = KW_IDS[ans.slice(2)] || "";
}

function rigKenwoodMode() {
  const m = rig.kwMode;
  if (!m) return;
  const name = KW_MODES[m] || "";
  rigSetState(null, rig.data && (m === "1" || m === "2") ? `DATA-${name}` : name, KW_LISTEN_MODE[m] || "");
}

/** Icom answers: frames to Band Watch (E0) or to everyone (00, the radio's transceive messages). */
function rigIcomFrame(f) {
  const [, , to, from, cmd] = f;
  if (from === CIV_ME || (to !== CIV_ME && to !== 0x00)) return; // our own commands echoed back
  const addr = from.toString(16).toUpperCase().padStart(2, "0");
  if (addr !== rig.civ) { rig.civ = addr; saveRig(); } // the radio uses a different address: follow it
  rig.model = ICOM_RADIOS[addr] || "";
  if ((cmd === 0x03 || cmd === 0x00) && f.length >= 11) rigSetState(civFreqHz(f.slice(5, 10)));
  else if ((cmd === 0x04 || cmd === 0x01) && f.length >= 7) { rig.icMode = f[5]; rigIcomMode(); }
  else if (cmd === 0x1a && f[5] === 0x06 && f.length >= 8) { rig.data = f[6] === 1; rigIcomMode(); }
}

function rigIcomMode() {
  const m = rig.icMode;
  if (m == null) return;
  const name = ICOM_MODES[m] || "";
  rigSetState(null, rig.data && (m === 0 || m === 1) ? `${name}-D` : name, ICOM_LISTEN_MODE[m] || "");
}

/** Bytes from the radio: split into answers for the radio's make. */
function rigFeed(value) {
  if (rig.kind === "icom") {
    rig.bytes.push(...value);
    for (;;) {
      const start = rig.bytes.indexOf(0xfe);
      if (start < 0) { rig.bytes = []; break; }
      const end = rig.bytes.indexOf(0xfd, start);
      if (end < 0) { rig.bytes = rig.bytes.slice(start); break; }
      let s = start;
      while (rig.bytes[s + 1] === 0xfe && rig.bytes[s + 2] === 0xfe) s++; // FE FE FE … preamble
      const f = rig.bytes.slice(s, end + 1);
      rig.bytes = rig.bytes.slice(end + 1);
      if (f.length >= 6 && f[1] === 0xfe) rigIcomFrame(f);
    }
    if (rig.bytes.length > 200) rig.bytes = [];
  } else {
    rig.buf += (rig.dec || (rig.dec = new TextDecoder())).decode(value, { stream: true });
    let i;
    while ((i = rig.buf.indexOf(";")) >= 0) {
      const ans = rig.buf.slice(0, i).trim();
      rig.buf = rig.buf.slice(i + 1);
      if (rig.kind === "kenwood") rigKenwoodAnswer(ans); else rigYaesuAnswer(ans);
    }
    if (rig.buf.length > 200) rig.buf = "";
  }
  renderRig();
}

/** The radio's dial moved: Band Watch follows it (the Listen panel, scope and band plan). */
function rigFromRadio() {
  if (!rig.read || !rig.hz || Date.now() - rig.lastSet < 1500) return;
  const kHz = rig.hz / 1000;
  const mode = rig.listenMode || listen.mode;
  if (Math.abs(kHz - listen.kHz) < 0.01 && mode === listen.mode) return;
  rig.applying = true;
  try {
    tuneTo(kHz, mode, { quiet: true });
  } finally {
    rig.applying = false;
  }
}

async function rigReadLoop() {
  while (rig.port && rig.port.readable) {
    rig.reader = rig.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await rig.reader.read();
        if (done) break;
        rigFeed(value);
      }
    } catch (e) {
      if (rig.connected) rigLost(`The radio stopped answering: ${e.message || e}`);
      return;
    } finally {
      try { rig.reader.releaseLock(); } catch { /* already released */ }
      rig.reader = null;
    }
    if (!rig.connected) return;
  }
}

/* ---------- Connecting ---------- */

/** Open the radio's COM port. With pick=true the browser asks which port (the first time). */
async function rigConnect(pick = true) {
  if (!rigSupported()) {
    rig.error = "Radio control needs Chrome or Edge on the PC your radio is plugged into.";
    renderRig();
    return false;
  }
  if (rig.connected || rig.busy) return rig.connected;
  rig.busy = true;
  rig.error = "";
  renderRig();
  try {
    let port = null;
    const known = await navigator.serial.getPorts();
    if (known.length && !pick) port = known[0];
    else if (pick) port = await navigator.serial.requestPort();
    if (!port) return false;
    // Yaesu and Kenwood radios use 2 stop bits at 4800 baud and 1 at the faster rates.
    await port.open({ baudRate: rig.baud, dataBits: 8, stopBits: rig.baud === 4800 && rig.kind !== "icom" ? 2 : 1, parity: "none", flowControl: "none" });
    rig.port = port;
    rig.writer = port.writable.getWriter();
    rig.connected = true;
    rig.buf = "";
    rig.bytes = [];
    rig.dec = null;
    rig.model = "";
    rigReadLoop();
    await rigWrite(rigPollCommands(true));
    clearInterval(rig.poll);
    rig.poll = setInterval(() => { if (rig.connected) rigWrite(rigPollCommands()); }, 1000);
    if (typeof showToast === "function") showToast("Radio connected", "Band Watch will tune your radio when you click a spot or the scope.");
    return true;
  } catch (e) {
    if (e && e.name === "NotFoundError") rig.error = ""; // the person closed the port chooser
    else rig.error = `Couldn't open the radio's COM port: ${(e && e.message) || e}. Check that no other program (WSJT-X, a logger) is using it, and that the baud rate matches the radio's menu.`;
    await rigClose();
    return false;
  } finally {
    rig.busy = false;
    renderRig();
  }
}

async function rigClose() {
  rig.connected = false;
  clearInterval(rig.poll);
  rig.poll = null;
  try { if (rig.reader) await rig.reader.cancel(); } catch { /* closed */ }
  try { if (rig.writer) { rig.writer.releaseLock(); } } catch { /* closed */ }
  rig.writer = null;
  try { if (rig.port) await rig.port.close(); } catch { /* closed */ }
  rig.port = null;
}

async function rigDisconnect() {
  await rigClose();
  rig.hz = 0;
  rig.modeName = "";
  rig.listenMode = "";
  rig.data = false;
  rig.kwMode = rig.icMode = null;
  renderRig();
}

function rigLost(why) {
  rig.error = why;
  rigClose().then(renderRig);
}

function fmtRigHz(hz) {
  if (!hz) return "–";
  const s = String(hz).padStart(7, "0");
  return `${Number(s.slice(0, -6)).toLocaleString()}.${s.slice(-6, -3)}.${s.slice(-3)}`;
}

/* ---------- Settings ---------- */

const RIG_BAUD_HINTS = {
  yaesu: "Must match the radio's CAT RATE menu (menu 031 on the FT-991A). 4800 is the FT-991A's factory setting.",
  kenwood: "Must match the radio's USB baud rate menu. The TS-590SG, TS-890 and TS-990 come set to 115200.",
  icom: "Must match the radio's CI-V USB Baud Rate menu. On the IC-7300 and IC-705 \"Auto\" works with any of these.",
};

function renderRigBauds() {
  const sel = $("optRigBaud");
  if (!sel) return;
  const k = rigKind();
  sel.innerHTML = k.bauds.map((b) => `<option value="${b}">${b}${b === k.baud ? " (usual setting)" : ""}</option>`).join("");
  sel.value = String(rig.baud);
  if ($("optRigBaudHint")) $("optRigBaudHint").textContent = RIG_BAUD_HINTS[rig.kind];
}

function rigLabel() {
  return rig.model || (rig.kind === "icom" ? "Icom radio" : rig.kind === "kenwood" ? "Kenwood radio" : "Yaesu radio");
}

function renderRig() {
  const btn = $("rigBtn");
  if (btn) {
    btn.textContent = rig.connected ? `Radio: ${fmtRigHz(rig.hz)} ${rig.modeName}`.trim() : rig.busy ? "Radio…" : "Connect radio";
    btn.classList.toggle("on", rig.connected);
    btn.setAttribute("aria-pressed", String(rig.connected));
    btn.title = rig.connected ? `Your ${rigLabel()} is connected: click to disconnect` : `Connect your ${rigKind().name} radio (USB cable)`;
  }
  const msg = $("optRigMsg");
  if (msg) {
    msg.textContent = rig.error
      || (!rigSupported() ? "Radio control needs Chrome or Edge on the PC your radio is plugged into."
        : rig.connected ? `Connected at ${rig.baud} baud${rig.model ? ` (${rig.model})` : ""}: ${fmtRigHz(rig.hz)} MHz ${rig.modeName}.`.replace(/ \.$/, ".")
          : "Not connected.");
  }
  if ($("optRigConnect")) $("optRigConnect").textContent = rig.connected ? "Disconnect" : "Connect radio";
  if ($("optRigKind")) $("optRigKind").value = rig.kind;
  if ($("optRigBaud") && $("optRigBaud").value !== String(rig.baud)) renderRigBauds();
  const civ = $("optRigCiv");
  if (civ) {
    if (![...civ.options].some((o) => o.value === rig.civ)) civ.insertAdjacentHTML("beforeend", `<option value="${rig.civ}">Other (${rig.civ}h)</option>`);
    civ.value = rig.civ;
  }
  if ($("optRigCivRow")) $("optRigCivRow").hidden = rig.kind !== "icom";
  if ($("optRigCivLabel")) $("optRigCivLabel").hidden = rig.kind !== "icom";
  if ($("optRigDataLabel")) $("optRigDataLabel").textContent = rig.kind === "icom" ? "Use USB-D (data mode) on FT8, FT4, WSPR and other digital frequencies"
    : "Use DATA-USB on FT8, FT4, WSPR and other digital frequencies";
  for (const [id, k] of [["optRigFollow", "follow"], ["optRigRead", "read"], ["optRigData", "dataMode"], ["optRigAuto", "autoConnect"]]) if ($(id)) $(id).checked = rig[k];
}

async function rigReconnect() {
  if (!rig.connected) return;
  await rigDisconnect();
  await rigConnect(false);
}

function setupRig() {
  loadRig();
  const civ = $("optRigCiv");
  if (civ) {
    civ.innerHTML = Object.entries(ICOM_RADIOS).map(([a, n]) => `<option value="${a}">${n} (${a}h)</option>`).join("");
  }
  renderRigBauds();
  const toggle = () => (rig.connected ? rigDisconnect() : rigConnect(true));
  $("rigBtn").addEventListener("click", toggle);
  $("optRigConnect").addEventListener("click", toggle);
  $("optRigKind").addEventListener("change", async () => {
    const k = $("optRigKind").value;
    rig.kind = RIG_KINDS[k] ? k : "yaesu";
    rig.baud = rigKind().baud;
    saveRig();
    renderRigBauds();
    await rigReconnect();
    renderRig();
  });
  $("optRigBaud").addEventListener("change", async () => {
    const b = Number($("optRigBaud").value);
    rig.baud = rigKind().bauds.includes(b) ? b : rigKind().baud;
    saveRig();
    await rigReconnect();
  });
  if (civ) civ.addEventListener("change", async () => {
    rig.civ = /^[0-9A-F]{2}$/.test(civ.value) ? civ.value : "94";
    saveRig();
    await rigReconnect();
  });
  for (const [id, k] of [["optRigFollow", "follow"], ["optRigRead", "read"], ["optRigData", "dataMode"], ["optRigAuto", "autoConnect"]]) {
    $(id).addEventListener("change", () => { rig[k] = $(id).checked; saveRig(); renderRig(); });
  }
  if (rigSupported()) {
    navigator.serial.addEventListener("disconnect", (e) => { if (rig.port && e.target === rig.port) rigLost("The radio's USB cable was unplugged or the radio was switched off."); });
    // Reconnect to the port chosen before, without asking again.
    if (rig.autoConnect) navigator.serial.getPorts().then((ports) => { if (ports.length) rigConnect(false); }).catch(() => {});
  }
  renderRig();
}
