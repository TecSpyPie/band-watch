/* Band Watch by M3vrv: the ATS Mini's memory slots, as its firmware sends and takes them over USB
 * (github.com/esp32-si4732/ats-mini, MIT; see docs/source/remote.md). Written for Band Watch, not copied.
 *   "$" lists the slots that hold something, one line each: #01,VHF,107900000,FM  (firmware 2.42 and later add
 *       ",Name" when the slot has a name of up to 9 letters)
 *   "#01,VHF,107900000,FM\r\n" sets slot 1 (band name, frequency in Hz, mode); a frequency of 0 clears it.
 * Works in the browser and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AtsMem = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SLOTS = 99;
  const MODES = ["FM", "LSB", "USB", "AM"];
  const NAME_MAX = 9;
  // The radio's bands (name, lowest and highest kHz), as in its firmware's Menu.cpp. VHF is the only FM band.
  const BANDS = [
    ["VHF", 64000, 108000], ["ALL", 150, 30000], ["11M", 25600, 26100], ["13M", 21500, 21900], ["15M", 18900, 19100],
    ["16M", 17400, 18100], ["19M", 15100, 15900], ["22M", 13500, 13900], ["25M", 11000, 13000], ["31M", 9000, 11000],
    ["41M", 7000, 9000], ["49M", 5000, 7000], ["60M", 4000, 5100], ["75M", 3500, 4000], ["90M", 3000, 3500],
    ["MW3", 1700, 3500], ["MW2", 495, 1701], ["MW1", 150, 1800], ["160M", 1800, 2000], ["80M", 3500, 4000],
    ["40M", 7000, 7300], ["30M", 10000, 10200], ["20M", 14000, 14400], ["17M", 18000, 18200], ["15M", 21000, 21500],
    ["12M", 24800, 25000], ["10M", 28000, 29700], ["CB", 25000, 28000],
  ];
  // Band Watch's listen modes for each of the radio's modes
  const LISTEN = { FM: "wfm", LSB: "lsb", USB: "usb", AM: "am" };

  /** One line of "$": { slot, band, hz, mode, name }, or null if it isn't a memory line. */
  function parseLine(line) {
    const m = /^#(\d{1,2}),([^,]+),(\d+),([A-Z]+)(?:,(.*))?$/.exec(String(line).trim());
    if (!m) return null;
    const slot = Number(m[1]);
    if (slot < 1 || slot > SLOTS || !MODES.includes(m[4])) return null;
    return { slot, band: m[2], hz: Number(m[3]), mode: m[4], name: m[5] === undefined ? "" : m[5] };
  }

  /** Does the frequency fit this band for this mode? (FM only on VHF, and VHF only FM.) */
  function fits(b, hz, mode) {
    const kHz = hz / 1000;
    if (kHz < b[1] || kHz > b[2]) return false;
    return (b[0] === "VHF") === (mode === "FM");
  }

  /** The band to keep a frequency in: the narrowest of the radio's bands that holds it, or "" if none does. */
  function bandFor(hz, mode) {
    let best = null;
    for (const b of BANDS) if (fits(b, hz, mode) && (!best || b[2] - b[1] < best[2] - best[1])) best = b;
    return best ? best[0] : "";
  }

  /** A name the radio takes: printable ASCII (no commas, so a backup reads back), at most 9 characters. */
  function cleanName(s) {
    return String(s || "").replace(/[^\x20-\x7e]|,/g, "").trim().slice(0, NAME_MAX).trim();
  }

  /** Firmware 2.42 and later keep names. version is the radio's "2.45" (or 245). */
  function hasNames(version) {
    const v = Number(version);
    return Number.isFinite(v) && (v >= 100 ? v / 100 : v) >= 2.42;
  }

  /** What's wrong with a slot to write, in plain words, or "" if it's fine. */
  function problem(mem) {
    if (!mem) return "Nothing to save.";
    if (!Number.isInteger(mem.slot) || mem.slot < 1 || mem.slot > SLOTS) return `The slot must be a number from 1 to ${SLOTS}.`;
    if (!MODES.includes(mem.mode)) return "Pick a mode: FM, AM, LSB or USB.";
    if (!Number.isFinite(mem.hz) || mem.hz <= 0) return "Type a frequency.";
    if (mem.mode === "FM" && (mem.hz < 64e6 || mem.hz > 108e6)) return "FM is for 64 to 108 MHz (the VHF band).";
    if (!bandFor(mem.hz, mem.mode)) return "The ATS Mini can't keep that frequency: it covers 150 kHz to 30 MHz, and 64 to 108 MHz FM.";
    return "";
  }

  const pad = (n) => String(n).padStart(2, "0");

  /** The command that writes a slot. Names go only to firmware that keeps them (older firmware would refuse). */
  function command(mem, { names = false } = {}) {
    const band = mem.band || bandFor(mem.hz, mem.mode);
    const name = names ? `,${cleanName(mem.name)}` : "";
    return `#${pad(mem.slot)},${band},${Math.round(mem.hz)},${mem.mode}${name}\r\n`;
  }

  /** The command that empties a slot: its own band and mode, frequency 0. */
  function clearCommand(mem) {
    return `#${pad(mem.slot)},${mem.band},0,${mem.mode}\r\n`;
  }

  /** The first empty slot (1 to 99), or 0 if all are used. */
  function firstFree(list) {
    const used = new Set(list.map((m) => m.slot));
    for (let i = 1; i <= SLOTS; i++) if (!used.has(i)) return i;
    return 0;
  }

  /** A backup file: the same lines the radio sends for "$", so it can be loaded back (here or by other tools). */
  function backupText(list) {
    return [...list].sort((a, b) => a.slot - b.slot)
      .map((m) => `#${pad(m.slot)},${m.band},${m.hz},${m.mode}${m.name ? `,${m.name}` : ""}`).join("\r\n") + (list.length ? "\r\n" : "");
  }

  /** Reads a backup file: memory lines, anything else ignored. The last line for a slot wins. */
  function parseBackup(text) {
    const by = new Map();
    for (const line of String(text).split(/\r?\n/)) {
      const m = parseLine(line);
      if (m && m.hz > 0) by.set(m.slot, m);
    }
    return [...by.values()].sort((a, b) => a.slot - b.slot);
  }

  /** "107.9 MHz" for FM, "9,650 kHz" or "14,230.5 kHz" otherwise. */
  function showFreq(hz, mode) {
    if (mode === "FM") return `${(hz / 1e6).toFixed(hz % 100000 ? 2 : 1)} MHz`;
    const kHz = hz / 1000;
    return `${kHz.toLocaleString("en-GB", { maximumFractionDigits: 3 })} kHz`;
  }

  /** What was typed in the frequency box, in Hz: kHz, or MHz for FM (a number under 200 there). */
  function readFreq(text, mode) {
    const v = Number(String(text).replace(/[\s,]/g, ""));
    if (!Number.isFinite(v) || v <= 0) return NaN;
    if (mode === "FM" && v < 200) return Math.round(v * 1e6);
    return Math.round(v * 1000);
  }

  return { SLOTS, MODES, NAME_MAX, BANDS, LISTEN, parseLine, bandFor, cleanName, hasNames, problem, command, clearCommand, firstFree, backupText, parseBackup, showFreq, readFreq };
});
