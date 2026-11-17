/* Radio control (CAT) for the Yaesu FT-991A and other Yaesu radios with the same commands, over the
   radio's USB cable. Uses the browser's Web Serial (Chrome or Edge on the PC the radio is plugged into).
   Band Watch tunes the radio when you click a spot, the band scope, the band plan or a decoder button,
   and shows the radio's own frequency and mode as you turn the dial. */

const RIG_BAUDS = [4800, 9600, 19200, 38400];
const RIG_DEFAULTS = { baud: 4800, follow: true, read: true, dataMode: true, autoConnect: true };

// FT-991A operating modes (MD0x;): code -> name, and Band Watch's listen modes -> code.
const RIG_MODES = {
  1: "LSB", 2: "USB", 3: "CW-U", 4: "FM", 5: "AM", 6: "RTTY-LSB", 7: "CW-L", 8: "DATA-LSB",
  9: "RTTY-USB", A: "DATA-FM", B: "FM-N", C: "DATA-USB", D: "AM-N", E: "C4FM",
};
const RIG_MODE_FOR = { usb: "2", lsb: "1", cw: "3", am: "5", fm: "4", wfm: "4" };
const RIG_LISTEN_MODE = { 1: "lsb", 2: "usb", 3: "cw", 4: "fm", 5: "am", 6: "lsb", 7: "cw", 8: "lsb", 9: "usb", A: "fm", B: "fm", C: "usb", D: "am", E: "fm" };
const RIG_MIN_HZ = 30000;
const RIG_MAX_HZ = 470000000;

const rig = {
  ...RIG_DEFAULTS,
  port: null, writer: null, reader: null, connected: false, busy: false,
  hz: 0, mode: "", buf: "", poll: null, lastSet: 0, error: "",
};

function rigSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.serial) && typeof navigator.serial.requestPort === "function";
}

function loadRig() {
  try {
    const s = JSON.parse(load("bw-rig") || "{}");
    if (RIG_BAUDS.includes(s.baud)) rig.baud = s.baud;
    for (const k of ["follow", "read", "dataMode", "autoConnect"]) if (typeof s[k] === "boolean") rig[k] = s[k];
  } catch { /* defaults */ }
}

function saveRig() {
  store("bw-rig", { baud: rig.baud, follow: rig.follow, read: rig.read, dataMode: rig.dataMode, autoConnect: rig.autoConnect });
}

/** Is this frequency one of the digital-mode calling frequencies (FT8, FT4, WSPR and the like)? */
function rigIsDigital(kHz) {
  const seg = typeof planSegment === "function" ? planSegment(kHz) : null;
  if (seg && seg.type === "digi") return true;
  const near = (list) => list && Object.values(list).some((f) => Math.abs(f * 1000 - kHz) <= 3);
  return near(typeof FT8 !== "undefined" ? FT8 : null) || near(typeof FT4 !== "undefined" ? FT4 : null) || near(typeof WSPR !== "undefined" ? WSPR : null);
}

/** The CAT command that sets a frequency (Hz) and mode on the radio. */
function rigCommands(hz, mode, kHz) {
  hz = Math.round(hz);
  if (!(hz >= RIG_MIN_HZ && hz <= RIG_MAX_HZ)) return "";
  let code = RIG_MODE_FOR[mode] || "2";
  if (rig.dataMode && (mode === "usb" || mode === "lsb") && rigIsDigital(kHz)) code = mode === "lsb" ? "8" : "C";
  return `FA${String(hz).padStart(9, "0")};MD0${code};`;
}

async function rigWrite(text) {
  if (!rig.writer || !text) return;
  try {
    await rig.writer.write(new TextEncoder().encode(text));
  } catch (e) {
    rigLost(`Couldn't send to the radio: ${e.message || e}`);
  }
}

/** Tune the radio, called whenever Band Watch tunes (tuneTo). */
function rigTune(kHz, mode) {
  if (!rig.connected || !rig.follow) return;
  const cmd = rigCommands(kHz * 1000, mode, kHz);
  if (!cmd) return;
  rig.lastSet = Date.now();
  rigWrite(cmd);
}

/** Answers from the radio: FA (frequency), MD (mode), ?; (didn't understand). */
function rigAnswer(ans) {
  if (/^FA\d{8,9}$/.test(ans)) {
    const hz = Number(ans.slice(2));
    if (hz !== rig.hz) {
      rig.hz = hz;
      rigFromRadio();
    }
  } else if (/^MD0[0-9A-E]$/.test(ans)) {
    const m = ans[3];
    if (m !== rig.mode) {
      rig.mode = m;
      rigFromRadio();
    }
  } else if (/^ID\d{4}$/.test(ans)) {
    rig.id = ans.slice(2);
  }
  renderRig();
}

/** The radio's dial moved: Band Watch follows it (the Listen panel, scope and band plan). */
function rigFromRadio() {
  if (!rig.read || !rig.hz || Date.now() - rig.lastSet < 1500) return;
  const kHz = rig.hz / 1000;
  const mode = RIG_LISTEN_MODE[rig.mode] || listen.mode;
  if (Math.abs(kHz - listen.kHz) < 0.01 && mode === listen.mode) return;
  rig.applying = true;
  try {
    tuneTo(kHz, mode, { quiet: true });
  } finally {
    rig.applying = false;
  }
}

async function rigReadLoop() {
  const dec = new TextDecoder();
  while (rig.port && rig.port.readable) {
    rig.reader = rig.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await rig.reader.read();
        if (done) break;
        rig.buf += dec.decode(value, { stream: true });
        let i;
        while ((i = rig.buf.indexOf(";")) >= 0) {
          rigAnswer(rig.buf.slice(0, i).trim());
          rig.buf = rig.buf.slice(i + 1);
        }
        if (rig.buf.length > 200) rig.buf = "";
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
    // The FT-991A uses 2 stop bits at 4800 baud and 1 at the faster rates.
    await port.open({ baudRate: rig.baud, dataBits: 8, stopBits: rig.baud === 4800 ? 2 : 1, parity: "none", flowControl: "none" });
    rig.port = port;
    rig.writer = port.writable.getWriter();
    rig.connected = true;
    rig.buf = "";
    rigReadLoop();
    await rigWrite("ID;FA;MD0;");
    clearInterval(rig.poll);
    rig.poll = setInterval(() => { if (rig.connected) rigWrite("FA;MD0;"); }, 1000);
    if (typeof showToast === "function") showToast("Radio connected", "Band Watch will tune your radio when you click a spot or the scope.");
    return true;
  } catch (e) {
    if (e && e.name === "NotFoundError") rig.error = ""; // the person closed the port chooser
    else rig.error = `Couldn't open the radio's COM port: ${(e && e.message) || e}. Check that no other program (WSJT-X, a logger) is using it, and that the baud rate matches the radio's CAT RATE menu.`;
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
  rig.mode = "";
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

function renderRig() {
  const btn = $("rigBtn");
  if (btn) {
    btn.textContent = rig.connected ? `Radio: ${fmtRigHz(rig.hz)} ${RIG_MODES[rig.mode] || ""}`.trim() : rig.busy ? "Radio…" : "Connect radio";
    btn.classList.toggle("on", rig.connected);
    btn.setAttribute("aria-pressed", String(rig.connected));
    btn.title = rig.connected ? "Your FT-991A is connected: click to disconnect" : "Connect your Yaesu FT-991A (USB cable)";
  }
  const msg = $("optRigMsg");
  if (msg) {
    msg.textContent = rig.error
      || (!rigSupported() ? "Radio control needs Chrome or Edge on the PC your radio is plugged into."
        : rig.connected ? `Connected at ${rig.baud} baud${rig.id === "0670" ? " (FT-991A)" : ""}: ${fmtRigHz(rig.hz)} MHz ${RIG_MODES[rig.mode] || ""}.`
          : "Not connected.");
  }
  if ($("optRigConnect")) $("optRigConnect").textContent = rig.connected ? "Disconnect" : "Connect radio";
  if ($("optRigBaud")) $("optRigBaud").value = String(rig.baud);
  for (const [id, k] of [["optRigFollow", "follow"], ["optRigRead", "read"], ["optRigData", "dataMode"], ["optRigAuto", "autoConnect"]]) if ($(id)) $(id).checked = rig[k];
}

function setupRig() {
  loadRig();
  const toggle = () => (rig.connected ? rigDisconnect() : rigConnect(true));
  $("rigBtn").addEventListener("click", toggle);
  $("optRigConnect").addEventListener("click", toggle);
  $("optRigBaud").addEventListener("change", async () => {
    const b = Number($("optRigBaud").value);
    rig.baud = RIG_BAUDS.includes(b) ? b : 4800;
    saveRig();
    if (rig.connected) { await rigDisconnect(); await rigConnect(false); }
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
