/* Radio control (CAT) over the radio's USB cable, for Yaesu (FT-991A, FT-710, FTDX10, FTDX101),
   Kenwood (TS-590, TS-890, TS-990, TS-480, TS-2000) and Icom (IC-7300, IC-705, IC-7610, IC-9700 and
   other CI-V radios). Uses the browser's Web Serial (Chrome or Edge on the PC the radio is plugged into).
   Band Watch tunes the radio when you click a spot, the band scope, the band plan or a decoder button,
   and shows the radio's own frequency and mode as you turn the dial. */

const RIG_KINDS = {
  yaesu: { name: "Yaesu", bauds: [4800, 9600, 19200, 38400], baud: 4800 },
  kenwood: { name: "Kenwood", bauds: [4800, 9600, 19200, 38400, 57600, 115200], baud: 115200 },
  icom: { name: "Icom", bauds: [4800, 9600, 19200, 38400, 57600, 115200], baud: 115200 },
  atsmini: { name: "ATS Mini", bauds: [115200, 9600], baud: 115200 },
  // Malahit DSP2 (and DSP1/3): its "Malahit CAT" USB port speaks the Kenwood TS-480 command set.
  malahit: { name: "Malahit", bauds: [115200, 57600, 38400, 19200, 9600], baud: 115200 },
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

/* ATS Mini (the SI4732 pocket receiver, firmware 2.34 or later with Settings > USB Port > Ad hoc).
   Its "ad hoc" commands are single letters: B/b next/previous band, M/m next/previous mode, t turns its
   status line on and off (one line every half second), and F<Hz> sets a frequency inside the current band.
   The bands, in the order B steps through them, as in the radio's firmware (Menu.cpp), in kHz. */
const ATS_BANDS = [
  ["VHF", 64000, 108000], ["ALL", 150, 30000], ["11M", 25600, 26100], ["13M", 21500, 21900], ["15M", 18900, 19100],
  ["16M", 17400, 18100], ["19M", 15100, 15900], ["22M", 13500, 13900], ["25M", 11000, 13000], ["31M", 9000, 11000],
  ["41M", 7000, 9000], ["49M", 5000, 7000], ["60M", 4000, 5100], ["75M", 3500, 4000], ["90M", 3000, 3500],
  ["MW3", 1700, 3500], ["MW2", 495, 1701], ["MW1", 150, 1800], ["160M", 1800, 2000], ["80M", 3500, 4000],
  ["40M", 7000, 7300], ["30M", 10000, 10200], ["20M", 14000, 14400], ["17M", 18000, 18200], ["15M", 21000, 21500],
  ["12M", 24800, 25000], ["10M", 28000, 29700], ["CB", 25000, 28000],
];
const ATS_HAM = ["160M", "80M", "40M", "30M", "20M", "17M", "15M", "12M", "10M"];
const ATS_MODE_ORDER = ["LSB", "USB", "AM"]; // the order M steps through them (FM is only on the VHF band)
const ATS_LISTEN_MODE = { FM: "wfm", LSB: "lsb", USB: "usb", AM: "am" };

const rig = {
  ...RIG_DEFAULTS,
  port: null, writer: null, reader: null, connected: false, busy: false,
  hz: 0, modeName: "", listenMode: "", data: false, model: "", buf: "", bytes: [], poll: null, lastSet: 0, error: "",
  meter: null, meterAt: 0, // the S-meter: dB above or below S9 (S9 = 0, S1 = -48, S9+60 = 60), and when it was read
  ats: null,
};

const atsFresh = () => ({ raw: new Uint8Array(0), hex: "", shotCmd: "", shotFails: 0, shotWanted: false, shotSize: 0, shotAt: 0, nextShot: 0, shots: 0, band: -1, bandName: "", mode: "", seq: null, waitSeq: null, sentAt: 0, lastLine: 0, toggledAt: 0, want: null, note: "", version: "", rssi: 0, snr: 0 });
rig.ats = atsFresh();

function rigSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.serial) && typeof navigator.serial.requestPort === "function";
}

const rigKind = () => RIG_KINDS[rig.kind] || RIG_KINDS.yaesu;
const rigKenwoodLike = () => rig.kind === "kenwood" || rig.kind === "malahit";

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
  const [lo, hi] = rig.kind === "malahit" ? [10000, 2000000000] : [RIG_MIN_HZ, RIG_MAX_HZ]; // the Malahit: 10 kHz to 2 GHz
  if (!(hz >= lo && hz <= hi)) return "";
  const ssb = mode === "usb" || mode === "lsb";
  const digital = rig.dataMode && ssb && rigIsDigital(kHz);
  if (rigKenwoodLike()) {
    const da = rig.kind === "kenwood" && rig.dataMode && ssb ? (digital ? "DA1;" : "DA0;") : "";
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
  if (rig.kind === "atsmini") return "";
  if (rig.kind === "malahit") return "FA;MD;"; // a receiver: no data mode
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

/* ---------- ATS Mini ---------- */

const atsInBand = (i, kHz) => i >= 0 && kHz >= ATS_BANDS[i][1] && kHz <= ATS_BANDS[i][2];

/** Which band the status line means ("15M" is in the list twice: the one holding the frequency). */
function atsBandIndex(name, kHz) {
  const all = ATS_BANDS.map((b, i) => (b[0] === name ? i : -1)).filter((i) => i >= 0);
  return all.find((i) => atsInBand(i, kHz)) ?? all[0] ?? -1;
}

/** The band to tune kHz in: the one the radio is on if it fits, else the amateur band, else VHF or ALL. */
function atsPickBand(kHz) {
  const a = rig.ats;
  if (atsInBand(a.band, kHz)) return a.band;
  const ham = ATS_BANDS.findIndex((b, i) => ATS_HAM.includes(b[0]) && atsInBand(i, kHz));
  if (ham >= 0) return ham;
  if (atsInBand(0, kHz)) return 0;
  if (atsInBand(1, kHz)) return 1;
  return -1;
}

function atsSend(s) {
  rig.lastSet = Date.now();
  rig.ats.sentAt = Date.now();
  rig.ats.waitSeq = rig.ats.seq; // wait for a status line after this one before the next step
  rigWrite(s);
}

/** Tune the ATS Mini: change band and mode a step at a time if needed, then set the frequency. */
function atsTune(hz, mode, band = -1) {
  rig.ats.want = { hz: Math.round(hz), mode, band, t: Date.now() }; // band: one of ATS_BANDS to use, or -1 to pick one
  rig.ats.note = "";
  atsStep();
}

function atsStep() {
  const a = rig.ats;
  const w = a.want;
  if (!w || a.band < 0 || !rig.connected) return;
  if (a.waitSeq != null && a.seq === a.waitSeq && Date.now() - a.sentAt < 1500) return; // the radio hasn't caught up yet
  a.waitSeq = null;
  if (Date.now() - w.t > 8000) { a.want = null; a.note = "The ATS Mini didn't follow. Is Settings > USB Port set to Ad hoc?"; renderRig(); return; }
  const kHz = w.hz / 1000;
  const target = w.band >= 0 && atsInBand(w.band, kHz) ? w.band : atsPickBand(kHz);
  if (target < 0) {
    a.want = null;
    a.note = `The ATS Mini can't tune ${kHz.toLocaleString()} kHz (it covers 150 kHz to 30 MHz, and 64 to 108 MHz FM).`;
    renderRig();
    return;
  }
  if (target !== a.band) {
    const n = ATS_BANDS.length;
    const up = (target - a.band + n) % n;
    atsSend(up <= n / 2 ? "B".repeat(up) : "b".repeat(n - up));
    return;
  }
  if (target !== 0) { // VHF is FM only
    const want = w.mode === "lsb" ? "LSB" : w.mode === "usb" || w.mode === "cw" ? "USB" : "AM";
    const from = ATS_MODE_ORDER.indexOf(a.mode);
    if (from >= 0 && a.mode !== want) {
      const steps = (ATS_MODE_ORDER.indexOf(want) - from + 3) % 3;
      atsSend(steps === 2 ? "m" : "M");
      return;
    }
  }
  a.want = null;
  if (Math.abs(w.hz - rig.hz) >= 10) atsSend(`F${w.hz}\r\n`);
}

/** One line from the ATS Mini: its status (15 fields, every half second) or an error. */
function atsLine(line) {
  const a = rig.ats;
  if (/^Error:/i.test(line)) {
    const said = line.replace(/^Error:\s*/i, "");
    if (typeof atsMemError === "function" && atsMemError(said)) return; // about a memory slot being saved
    a.note = `The ATS Mini said: ${said}.`;
    return;
  }
  if (line[0] === "#" && typeof atsMemLine === "function" && atsMemLine(line)) return; // a memory slot
  const f = line.split(",");
  if (f.length < 15 || !/^\d+$/.test(f[0]) || !/^\d+$/.test(f[1])) return;
  const mode = f[5];
  const ssb = mode === "LSB" || mode === "USB";
  const hz = mode === "FM" ? Number(f[1]) * 10000 : Number(f[1]) * 1000 + (ssb ? Number(f[2]) || 0 : 0);
  a.lastLine = Date.now();
  a.version = `${Math.floor(Number(f[0]) / 100)}.${String(Number(f[0]) % 100).padStart(2, "0")}`;
  a.band = atsBandIndex(f[4], hz / 1000);
  a.bandName = f[4];
  a.mode = mode;
  a.rssi = Number(f[10]);
  if (Number.isFinite(a.rssi)) rigSetMeter(a.rssi - 34); // dBµV: S9 is about 34 dBµV on the SI4732
  a.snr = Number(f[11]);
  a.seq = f[14];
  rig.model = "ATS Mini";
  // The ATS Mini has no CW mode: listening to CW on USB, Band Watch stays on CW.
  const listenMode = ssb && typeof listen !== "undefined" && listen.mode === "cw" ? "cw" : ATS_LISTEN_MODE[mode] || "";
  rigSetState(hz, mode, listenMode);
  atsStep();
  if (typeof atsScanLine === "function") atsScanLine(hz, a.rssi, a.snr); // a band scan reading
}

/** Every second: if the status lines stopped (or never started), switch them on with "t". */
function atsWatch() {
  const a = rig.ats;
  if (a.shotWanted) {
    if (Date.now() - a.shotAt < 6000) return;
    a.shotWanted = false; a.shotSize = 0; a.raw = new Uint8Array(0); a.hex = ""; // the picture never came
    a.shotFails++;
    a.shotCmd = a.shotCmd === "c" ? "C" : "c"; // try the other way of asking for it
    a.screenNote = a.shotFails >= 4 ? "The ATS Mini isn't sending its screen. Updating its firmware may help (see the ATS Mini manual)." : "";
  }
  if (Date.now() - Math.max(a.lastLine, a.toggledAt) > 2500) { a.toggledAt = Date.now(); rigWrite("t"); }
  atsStep();
}

/** Tune the radio, called whenever Band Watch tunes (tuneTo). */
function rigTune(kHz, mode) {
  if (!rig.connected || !rig.follow) return;
  if (rig.kind === "atsmini") { atsTune(kHz * 1000, mode); return; }
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

/* ---------- S-meter ----------
   Asked for by the Radio panel while it's on screen. Each make counts differently; all are turned into dB
   from S9 (6 dB per S-unit below it). Kenwood-style radios and the Malahit use scales that differ by model,
   so their meter isn't read. */

/** The command that asks for the S-meter, or "" if this radio's meter can't be read. */
function rigMeterCommand() {
  if (!rig.connected) return "";
  if (rig.kind === "yaesu") return "SM0;";
  if (rig.kind === "icom") return civFrame(0x15, 0x02);
  return ""; // the ATS Mini sends its signal level by itself; Kenwood-style and Malahit: not read
}
/** Can Band Watch show this radio's S-meter? */
function rigHasMeter() {
  return rig.connected && (rig.kind === "yaesu" || rig.kind === "icom" || rig.kind === "atsmini");
}
/** Yaesu SM0 reading (0-255; S9 at 130, S9+60 at 255) -> dB from S9. */
function yaesuMeterDb(raw) {
  return raw <= 130 ? (raw / 130) * 54 - 54 : ((raw - 130) / 125) * 60;
}
/** Icom 15 02 reading (0-255; S9 at 120, S9+60 at 241) -> dB from S9. */
function icomMeterDb(raw) {
  return raw <= 120 ? (raw / 120) * 54 - 54 : Math.min(60, ((raw - 120) / 121) * 60);
}
function rigSetMeter(db) {
  rig.meter = Math.max(-54, Math.min(60, db));
  rig.meterAt = Date.now();
}
/** dB from S9 -> "S7", "S9", "S9+20". */
function sUnits(db) {
  if (db > 2) return `S9+${Math.round(db / 10) * 10}`.replace(/\+0$/, "");
  return `S${Math.max(0, Math.min(9, Math.round(9 + db / 6)))}`;
}

/** Yaesu answers: FA (frequency), MD0 (mode), ID (model), SM0 (S-meter), ?; (didn't understand). */
function rigYaesuAnswer(ans) {
  if (/^SM0\d{3}$/.test(ans)) rigSetMeter(yaesuMeterDb(Number(ans.slice(3))));
  else if (/^FA\d{8,9}$/.test(ans)) rigSetState(Number(ans.slice(2)));
  else if (/^MD0[0-9A-E]$/.test(ans)) rigSetState(null, RIG_MODES[ans[3]] || "", RIG_LISTEN_MODE[ans[3]] || "");
  else if (/^ID\d{4}$/.test(ans)) rig.model = YAESU_IDS[ans.slice(2)] || "";
  else if (typeof rxYaesuAnswer === "function") rxYaesuAnswer(ans); // the Radio panel's receive controls
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
  else if (cmd === 0x15 && f[5] === 0x02 && f.length >= 9) {
    const bcd = (b) => (b >> 4) * 10 + (b & 15);
    rigSetMeter(icomMeterDb(bcd(f[6]) * 100 + bcd(f[7])));
  } else if (typeof rxIcomFrame === "function") rxIcomFrame(f); // the Radio panel's receive controls
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
  } else if (rig.kind === "atsmini") {
    atsFeed(value);
  } else {
    rig.buf += (rig.dec || (rig.dec = new TextDecoder())).decode(value, { stream: true });
    let i;
    while ((i = rig.buf.indexOf(";")) >= 0) {
      const ans = rig.buf.slice(0, i).trim();
      rig.buf = rig.buf.slice(i + 1);
      if (rigKenwoodLike()) rigKenwoodAnswer(ans); else rigYaesuAnswer(ans);
    }
    if (rig.buf.length > 200) rig.buf = "";
  }
  renderRig();
}

/** The radio's dial moved: Band Watch follows it (the Listen panel, scope and band plan). */
function rigFromRadio() {
  if (!rig.read || !rig.hz || Date.now() - rig.lastSet < 1500 || (rig.ats && rig.ats.want)) return;
  if (typeof atsScanBusy === "function" && atsScanBusy()) return; // a band scan is stepping the radio
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

const ESPRESSIF_VID = 0x303a; // the ATS Mini's ESP32-S3 USB port
// Makers of the USB chips radios use, to say which port Band Watch is on (browsers don't tell a page the COM number).
const USB_MAKERS = { 0x303a: "Espressif (ATS Mini)", 0x10c4: "Silicon Labs CP210x", 0x0403: "FTDI", 0x1a86: "CH340", 0x067b: "Prolific", 0x0483: "STM32", 0x0c26: "Icom", 0x0b28: "Kenwood" };

/** "Silicon Labs CP210x (USB 10C4:EA60)" for the port in use, or "" if the browser doesn't say. */
function rigPortName(port) {
  try {
    const { usbVendorId: v, usbProductId: p } = port.getInfo();
    if (v == null) return "";
    const id = `USB ${v.toString(16).toUpperCase().padStart(4, "0")}:${(p ?? 0).toString(16).toUpperCase().padStart(4, "0")}`;
    return USB_MAKERS[v] ? `${USB_MAKERS[v]} (${id})` : id;
  } catch { return ""; }
}

/** Could this port be the chosen make of radio? The ATS Mini is an Espressif USB device; the others never are. */
function rigPortFits(port) {
  let vid;
  try { vid = port.getInfo().usbVendorId; } catch { /* no info */ }
  if (vid == null) return true;
  return rig.kind === "atsmini" ? vid === ESPRESSIF_VID : vid !== ESPRESSIF_VID;
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
    if (!pick) port = known.find(rigPortFits) || null;
    else if (pick) port = await navigator.serial.requestPort();
    if (!port) {
      if (!pick && known.length) rig.error = `Press Connect radio and pick your ${rigKind().name}'s port.`;
      return false;
    }
    // Yaesu and Kenwood radios use 2 stop bits at 4800 baud and 1 at the faster rates.
    await port.open({ baudRate: rig.baud, dataBits: 8, stopBits: rig.baud === 4800 && rig.kind !== "icom" ? 2 : 1, parity: "none", flowControl: "none" });
    rig.port = port;
    rig.portName = rigPortName(port);
    rig.writer = port.writable.getWriter();
    rig.connected = true;
    rig.buf = "";
    rig.bytes = [];
    rig.dec = null;
    rig.model = "";
    rig.ats = atsFresh();
    if (rig.kind === "atsmini") rig.ats.toggledAt = Date.now() - 1300; // switch its status line on after ~1 s if it isn't
    rigReadLoop();
    await rigWrite(rigPollCommands(true));
    if (typeof rxPollTick === "function") rxPollTick(true);
    clearInterval(rig.poll);
    rig.poll = setInterval(() => { if (!rig.connected) return; if (rig.kind === "atsmini") atsWatch(); else { rigWrite(rigPollCommands()); if (typeof rxPollTick === "function") rxPollTick(); } }, 1000);
    if (typeof showToast === "function") showToast(rig.kind === "atsmini" ? "ATS Mini connected" : "Radio connected", "Band Watch will tune your radio when you click a spot or the scope.");
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
  rig.meter = null;
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
  malahit: "Any of these works over the Malahit's own USB port. Pick its \"Malahit CAT\" port when the browser asks (Windows may need the Malahit USB CAT driver from malahiteam.com).",
  icom: "Must match the radio's CI-V USB Baud Rate menu. On the IC-7300 and IC-705 \"Auto\" works with any of these.",
  atsmini: "115200 is right for the ATS Mini. On the radio, set Settings > USB Port to Ad hoc (firmware 2.34 or later).",
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
  if (rig.kind === "atsmini") return "ATS Mini";
  if (rig.kind === "malahit") return "Malahit";
  return rig.model || (rig.kind === "icom" ? "Icom radio" : rig.kind === "kenwood" ? "Kenwood radio" : "Yaesu radio");
}

function renderRig() {
  if (typeof renderRx === "function") renderRx(); // the Radio panel's receive controls
  const btn = $("rigBtn");
  if (btn) {
    btn.textContent = rig.connected ? `Radio: ${fmtRigHz(rig.hz)} ${rig.modeName}`.trim() : rig.busy ? "Radio…" : "Connect radio";
    btn.classList.toggle("on", rig.connected);
    btn.setAttribute("aria-pressed", String(rig.connected));
    btn.title = rig.connected ? `Your ${rigLabel()} is connected: click to disconnect` : `Connect your ${rigKind().name} radio (USB cable)`;
  }
  const msg = $("optRigMsg");
  if (msg) {
    const a = rig.ats;
    const ats = rig.kind === "atsmini" && rig.connected && !rig.error
      ? (a.lastLine ? `Connected to the ATS Mini${a.version ? ` (firmware ${a.version})` : ""}: ${fmtRigHz(rig.hz)} MHz ${rig.modeName}, band ${a.bandName}. Signal ${a.rssi} dBµV, SNR ${a.snr} dB.${rig.portName ? ` Port: ${rig.portName}.` : ""}${a.note ? ` ${a.note}` : ""}`
        : "Connected. Waiting for the ATS Mini to answer… If nothing happens, on the radio set Settings > USB Port to Ad hoc.")
      : "";
    msg.textContent = ats || rig.error
      || (!rigSupported() ? "Radio control needs Chrome or Edge on the PC your radio is plugged into."
        : rig.connected ? `Connected at ${rig.baud} baud${rig.model ? ` (${rig.model})` : ""}: ${fmtRigHz(rig.hz)} MHz ${rig.modeName}.`.replace(/ \.$/, ".") + (rig.portName ? ` Port: ${rig.portName}.` : "")
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
  if ($("optRigData")) $("optRigData").closest(".chkrow").hidden = rig.kind === "atsmini" || rig.kind === "malahit";
  if ($("optRigDataLabel")) $("optRigDataLabel").textContent = rig.kind === "icom" ? "Use USB-D (data mode) on FT8, FT4, WSPR and other digital frequencies"
    : "Use DATA-USB on FT8, FT4, WSPR and other digital frequencies";
  for (const [id, k] of [["optRigFollow", "follow"], ["optRigRead", "read"], ["optRigData", "dataMode"], ["optRigAuto", "autoConnect"]]) if ($(id)) $(id).checked = rig[k];
  renderAts();
  if (typeof renderPanel === "function") renderPanel();
}

async function rigReconnect() {
  if (!rig.connected) return;
  await rigDisconnect();
  await rigConnect(false);
}

function setupRig() {
  loadRig();
  setupAts();
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
    const was = rig.connected;
    await rigDisconnect(); // a different make is a different port: never reuse the old radio's
    rig.error = "";
    if (was || rig.autoConnect) await rigConnect(false); // a port this make used before, if there is one
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

/* ---------- ATS Mini: its screen, and its buttons ---------- */

const atsShot = { live: true, bright: 100, contrast: 100, colour: "blue", readout: true, readoutAt: "bottom" };
// The drawn screen's colours: [heading, frequency]
const ATS_COLOURS = { blue: ["#9cf", "#fff"], green: ["#7e7", "#bfb"], amber: ["#fc6", "#ffd28a"], white: ["#ddd", "#fff"] };

function atsSaveView() {
  store("bw-ats", { live: atsShot.live, bright: atsShot.bright, contrast: atsShot.contrast, colour: atsShot.colour, readout: atsShot.readout, readoutAt: atsShot.readoutAt });
}

/** Brightness and contrast for the picture (the radio's own light is the Light buttons). */
function atsApplyView() {
  const c = $("atsScreen");
  if (c) c.style.filter = atsShot.bright === 100 && atsShot.contrast === 100 ? "" : `brightness(${atsShot.bright}%) contrast(${atsShot.contrast}%)`;
  if ($("atsBright")) $("atsBright").value = String(atsShot.bright);
  if ($("atsContrast")) $("atsContrast").value = String(atsShot.contrast);
  if ($("atsColour")) $("atsColour").value = atsShot.colour;
  if ($("atsReadout")) $("atsReadout").checked = atsShot.readout;
  if ($("atsReadoutAt")) $("atsReadoutAt").value = atsShot.readoutAt;
  const ov = $("atsOverlay");
  if (ov) {
    const [head, main] = ATS_COLOURS[atsShot.colour] || ATS_COLOURS.blue;
    ov.style.setProperty("--atsov-head", head);
    ov.style.setProperty("--atsov-main", main);
    ov.classList.toggle("top", atsShot.readoutAt === "top");
  }
  atsReadout();
}

/** S-units from the signal in dBµV (HF: S9 = 50 µV = 34 dBµV, 6 dB an S-unit). */
function atsSUnits(dbuv) {
  const over = dbuv - 34;
  if (over > 0) return `S9+${Math.round(over / 10) * 10 || ""}`.replace(/\+$/, "");
  return `S${Math.max(0, Math.min(9, Math.round(9 + over / 6)))}`;
}

/** The digital readout over the live picture: frequency, band, mode, S-meter and SNR. */
function atsReadout() {
  const ov = $("atsOverlay");
  if (!ov) return;
  const a = rig.ats;
  const show = atsShot.readout && atsShot.live && rig.connected && rig.kind === "atsmini" && !!a.lastLine;
  ov.hidden = !show;
  if (!show) return;
  const fm = rig.modeName === "FM";
  $("atsOvFreq").textContent = fm ? `${(rig.hz / 1e6).toFixed(2)} MHz` : `${fmtRigHz(rig.hz)} MHz`;
  $("atsOvBand").textContent = a.bandName;
  $("atsOvMode").textContent = rig.modeName;
  $("atsOvSnr").textContent = `SNR ${a.snr} dB`;
  $("atsOvS").textContent = `${atsSUnits(a.rssi)} · ${a.rssi} dBµV`;
  // S0 to S9 fills 60 %, S9+60 the rest
  const pct = a.rssi <= 34 ? Math.max(0, (9 + (a.rssi - 34) / 6) / 9) * 60 : 60 + Math.min(40, ((a.rssi - 34) / 60) * 40);
  $("atsOvBar").style.width = `${pct.toFixed(1)}%`;
  $("atsOvBar").style.setProperty("--atsov-bar", a.rssi > 34 ? "#e64" : a.rssi > 20 ? "#4c4" : "#cc4");
}

/** Bytes from the ATS Mini: text lines, and (after "c") a picture of its screen as a binary RGB565 BMP. */
function atsFeed(value) {
  const a = rig.ats;
  let raw = new Uint8Array(a.raw.length + value.length);
  raw.set(a.raw);
  raw.set(value, a.raw.length);
  if (a.shotWanted && a.shotCmd === "C") { a.raw = new Uint8Array(0); atsFeedHex(raw); return; }
  for (;;) {
    if (a.shotSize) {
      if (raw.length < a.shotSize) break;
      atsShowScreen(raw.subarray(0, a.shotSize));
      raw = raw.subarray(a.shotSize);
      atsShotDone();
      continue;
    }
    if (a.shotWanted) {
      const i = atsFindBmp(raw);
      if (i >= 0) {
        atsText(raw.subarray(0, i));
        raw = raw.subarray(i);
        if (raw.length < 26) break; // the rest of the header is on its way
        const w = raw[18] | (raw[19] << 8), h = raw[22] | (raw[23] << 8);
        const size = (raw[2] | (raw[3] << 8) | (raw[4] << 16) | (raw[5] << 24)) >>> 0;
        if (w > 0 && h > 0 && w <= 640 && h <= 480 && size === 66 + w * h * 2) { a.shotSize = size; continue; }
        raw = raw.subarray(2); // "BM" that wasn't a picture
        continue;
      }
    }
    const nl = raw.lastIndexOf(10);
    if (nl >= 0) { atsText(raw.subarray(0, nl + 1)); raw = raw.subarray(nl + 1); }
    break;
  }
  a.raw = raw.length > 300000 ? new Uint8Array(0) : raw.slice();
}

/** The older picture command "C" sends the same BMP as hex digits, in lines. */
function atsFeedHex(bytes) {
  const a = rig.ats;
  let text = new TextDecoder().decode(bytes);
  if (!a.hex) {
    const i = text.toLowerCase().indexOf("424d"); // "BM"
    if (i < 0) { // not started yet: anything before it is ordinary lines (keep a little in case "424d" is split)
      const nl = text.lastIndexOf("\n");
      if (nl >= 0) { atsText(new TextEncoder().encode(text.slice(0, nl + 1))); text = text.slice(nl + 1); }
      a.hexPending = (a.hexPending || "") + text;
      if (a.hexPending.length > 8) {
        const j = a.hexPending.toLowerCase().indexOf("424d");
        if (j < 0) { a.hexPending = a.hexPending.slice(-3); return; }
        text = a.hexPending.slice(j); a.hexPending = "";
      } else return;
    } else {
      atsText(new TextEncoder().encode(text.slice(0, i)));
      text = text.slice(i);
    }
  }
  a.hex += text.replace(/[^0-9a-fA-F]/g, "");
  if (a.hex.length < 12) return;
  const size = parseInt(a.hex.slice(10, 12) + a.hex.slice(8, 10) + a.hex.slice(6, 8) + a.hex.slice(4, 6), 16);
  if (!(size > 66 && size < 1000000)) { a.hex = ""; return; }
  if (a.hex.length < size * 2) return;
  const bmp = new Uint8Array(size);
  for (let k = 0; k < size; k++) bmp[k] = parseInt(a.hex.substr(k * 2, 2), 16);
  a.hex = "";
  atsShowScreen(bmp);
  atsShotDone();
}

/** Where a picture starts: "BM" followed by a 40-byte BITMAPINFOHEADER (or too few bytes yet to tell). */
function atsFindBmp(raw) {
  for (let i = 0; i + 1 < raw.length; i++) {
    if (raw[i] !== 0x42 || raw[i + 1] !== 0x4d) continue;
    if (raw.length < i + 15 || raw[i + 14] === 40) return i;
  }
  return -1;
}

function atsText(bytes) {
  if (!bytes.length) return;
  for (const line of new TextDecoder().decode(bytes).split("\n")) if (line.trim()) atsLine(line.trim());
}

/** Draw the BMP (RGB565, rows bottom-up) on the panel's canvas. */
function atsShowScreen(bmp) {
  const a = rig.ats;
  const w = bmp[18] | (bmp[19] << 8), h = bmp[22] | (bmp[23] << 8);
  const off = bmp[10] | (bmp[11] << 8);
  const c = $("atsScreen");
  if (!c) return;
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
  c.style.imageRendering = ""; // the radio's own pixels: crisp blocks (style.css)
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let row = 0; row < h; row++) {
    const y = h - 1 - row;
    let o = off + row * w * 2;
    let p = y * w * 4;
    for (let x = 0; x < w; x++, o += 2, p += 4) {
      const v = bmp[o] | (bmp[o + 1] << 8);
      d[p] = (((v >> 11) & 31) * 527 + 23) >> 6;
      d[p + 1] = (((v >> 5) & 63) * 259 + 33) >> 6;
      d[p + 2] = ((v & 31) * 527 + 23) >> 6;
      d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  a.shots++;
  a.shotFails = 0;
  a.screenNote = "";
}

/** After a picture the radio's status line is off: turn it back on. */
function atsShotDone() {
  const a = rig.ats;
  a.shotWanted = false;
  a.shotSize = 0;
  a.toggledAt = Date.now();
  a.lastLine = Date.now();
  rigWrite("t");
}

/** Ask for a picture of the screen every 1.5 s while the panel is showing and nothing else is going on. */
function atsScreenTick() {
  const a = rig.ats;
  if (rig.kind !== "atsmini" || !rig.connected || !a.lastLine) return;
  if (!atsShot.live) { atsDrawSim(); return; }
  if (a.shotWanted || a.want || document.visibilityState === "hidden" || $("secAts").hidden) return;
  if (typeof atsMemBusy === "function" && atsMemBusy()) return; // reading or saving memory slots
  if (typeof atsScanBusy === "function" && atsScanBusy()) return; // a band scan needs every status line
  if (Date.now() < a.nextShot) return;
  a.nextShot = Date.now() + 1500;
  if (!a.shotCmd) a.shotCmd = Number(a.version) >= 2.41 ? "c" : "C"; // "c" (binary, quicker) came in firmware 2.41
  a.shotWanted = true;
  a.shotAt = Date.now();
  a.hex = "";
  a.hexPending = "";
  if (a.shotCmd === "C") a.nextShot = Date.now() + 2500; // hex is twice the size: ask a little less often
  rigWrite(a.shotCmd);
}

/** Without the live picture: a simple screen drawn from the radio's status line. */
function atsDrawSim() {
  const c = $("atsScreen");
  if (!c) return;
  const a = rig.ats;
  // Drawn at twice the size and shown smooth, so the text stays sharp when the screen is shown big.
  if (c.width !== 640) c.width = 640;
  if (c.height !== 340) c.height = 340;
  c.style.imageRendering = "auto";
  const g = c.getContext("2d");
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.fillStyle = "#000";
  g.fillRect(0, 0, 320, 170);
  if (!rig.connected) return;
  const [head, main] = ATS_COLOURS[atsShot.colour] || ATS_COLOURS.blue;
  g.fillStyle = head;
  g.font = "bold 16px system-ui, sans-serif";
  g.fillText(`${a.bandName || ""}  ${rig.modeName || ""}`, 12, 26);
  g.fillStyle = main;
  g.font = "bold 34px system-ui, sans-serif";
  const fm = rig.modeName === "FM";
  g.fillText(fm ? `${(rig.hz / 1e6).toFixed(2)} MHz` : `${(rig.hz / 1000).toLocaleString(undefined, { minimumFractionDigits: rig.modeName === "AM" ? 0 : 3, maximumFractionDigits: 3 })} kHz`, 12, 86);
  // Signal: 0 to 127 dBµV, shown up to 70
  const level = Math.max(0, Math.min(1, a.rssi / 70));
  g.fillStyle = "#333";
  g.fillRect(12, 112, 296, 14);
  g.fillStyle = level > 0.6 ? "#4c4" : level > 0.3 ? "#cc4" : "#c84";
  g.fillRect(12, 112, Math.round(296 * level), 14);
  g.fillStyle = "#aaa";
  g.font = "14px system-ui, sans-serif";
  g.fillText(`Signal ${a.rssi} dBµV   SNR ${a.snr} dB`, 12, 150);
}

function renderAts() {
  const sec = $("secAts");
  if (!sec) return;
  sec.hidden = rig.kind !== "atsmini";
  if (sec.hidden) return;
  const a = rig.ats;
  $("atsState").textContent = rig.connected
    ? (a.lastLine ? `${fmtRigHz(rig.hz)} MHz ${rig.modeName} · ${a.bandName} · Signal ${a.rssi} dBµV, SNR ${a.snr} dB${a.version ? ` · firmware ${a.version}` : ""}` : "Connected, waiting for the radio…")
    : rig.busy ? "Connecting…" : "Not connected";
  $("atsConnect").textContent = rig.connected ? "Disconnect" : "Connect";
  atsReadout();
  if (typeof renderAtsMem === "function") renderAtsMem();
  if (typeof renderAtsScan === "function") renderAtsScan();
  for (const b of sec.querySelectorAll("[data-ats]")) b.disabled = !rig.connected;
  $("atsScreenMsg").textContent = !rig.connected
    ? (rig.error || "Connect the ATS Mini to see its screen here. On the radio, set Settings > USB Port to Ad hoc first.")
    : a.screenNote || (atsShot.live ? (a.shots ? "Live picture of the radio's screen." : "Getting the radio's screen…") : "Band Watch's own view, from the radio's status. Tick Live screen for the real picture.");
}

function setupAts() {
  if (!$("secAts")) return;
  try {
    const s = JSON.parse(load("bw-ats") || "{}");
    if (typeof s.live === "boolean") atsShot.live = s.live;
    if (Number.isFinite(s.bright)) atsShot.bright = Math.max(50, Math.min(160, s.bright));
    if (Number.isFinite(s.contrast)) atsShot.contrast = Math.max(50, Math.min(200, s.contrast));
    if (ATS_COLOURS[s.colour]) atsShot.colour = s.colour;
    if (typeof s.readout === "boolean") atsShot.readout = s.readout;
    if (s.readoutAt === "top" || s.readoutAt === "bottom") atsShot.readoutAt = s.readoutAt;
  } catch { /* defaults */ }
  atsApplyView();
  $("atsBright").addEventListener("input", () => { atsShot.bright = Number($("atsBright").value); atsApplyView(); atsSaveView(); });
  $("atsContrast").addEventListener("input", () => { atsShot.contrast = Number($("atsContrast").value); atsApplyView(); atsSaveView(); });
  $("atsColour").addEventListener("change", () => { atsShot.colour = ATS_COLOURS[$("atsColour").value] ? $("atsColour").value : "blue"; atsApplyView(); atsSaveView(); });
  $("atsReadout").addEventListener("change", () => { atsShot.readout = $("atsReadout").checked; atsApplyView(); atsSaveView(); });
  $("atsReadoutAt").addEventListener("change", () => { atsShot.readoutAt = $("atsReadoutAt").value === "top" ? "top" : "bottom"; atsApplyView(); atsSaveView(); });
  $("atsViewReset").addEventListener("click", () => { Object.assign(atsShot, { bright: 100, contrast: 100, colour: "blue" }); atsApplyView(); atsSaveView(); });
  $("atsLive").checked = atsShot.live;
  $("atsLive").addEventListener("change", () => {
    atsShot.live = $("atsLive").checked;
    atsSaveView();
    rig.ats.nextShot = 0;
    renderAts();
  });
  $("atsConnect").addEventListener("click", () => (rig.connected ? rigDisconnect() : rigConnect(true)));
  $("atsPort").addEventListener("click", async () => { await rigDisconnect(); rigConnect(true); });
  for (const b of $("secAts").querySelectorAll("[data-ats]")) {
    b.addEventListener("click", () => {
      if (!rig.connected) return;
      rigWrite(b.dataset.ats);
      rig.ats.nextShot = Date.now() + 250; // show the result soon
    });
  }
  $("atsSave").addEventListener("click", () => {
    $("atsScreen").toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `ats-mini-screen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    });
  });
  setInterval(atsScreenTick, 250);
  if (typeof setupAtsMem === "function") setupAtsMem();
  if (typeof setupAtsScan === "function") setupAtsScan();
  renderAts();
}
