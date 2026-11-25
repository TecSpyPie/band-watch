/* Band Watch by M3vrv: the ATS Mini band scan, the parts that don't need the radio (planned steps, finding the
 * signals, the file). The ATS Mini has no scan command of its own over USB, so Band Watch steps it with its
 * "F<Hz>" command (tune only) and reads the signal level from the status line the radio sends every half second
 * (github.com/esp32-si4732/ats-mini, MIT, docs/source/remote.md). Written for Band Watch, not copied.
 * Works in the browser and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.AtsScan = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_STEPS = 400; // about 3 to 7 minutes on the radio
  // The radio's bands (name, lowest and highest kHz), as in its firmware's Menu.cpp, in the order B steps through.
  const BANDS = [
    ["VHF", 64000, 108000], ["ALL", 150, 30000], ["11M", 25600, 26100], ["13M", 21500, 21900], ["15M", 18900, 19100],
    ["16M", 17400, 18100], ["19M", 15100, 15900], ["22M", 13500, 13900], ["25M", 11000, 13000], ["31M", 9000, 11000],
    ["41M", 7000, 9000], ["49M", 5000, 7000], ["60M", 4000, 5100], ["75M", 3500, 4000], ["90M", 3000, 3500],
    ["MW3", 1700, 3500], ["MW2", 495, 1701], ["MW1", 150, 1800], ["160M", 1800, 2000], ["80M", 3500, 4000],
    ["40M", 7000, 7300], ["30M", 10000, 10200], ["20M", 14000, 14400], ["17M", 18000, 18200], ["15M", 21000, 21500],
    ["12M", 24800, 25000], ["10M", 28000, 29700], ["CB", 25000, 28000],
  ];
  // Ready-made ranges: [label, from kHz, to kHz, step kHz, mode]
  const PRESETS = [
    ["Medium wave (Europe, 9 kHz)", 531, 1602, 9, "AM"],
    ["Medium wave (Americas, 10 kHz)", 530, 1700, 10, "AM"],
    ["49 m broadcast", 5900, 6200, 5, "AM"],
    ["41 m broadcast", 7200, 7600, 5, "AM"],
    ["31 m broadcast", 9400, 9900, 5, "AM"],
    ["25 m broadcast", 11600, 12100, 5, "AM"],
    ["19 m broadcast", 15100, 15800, 5, "AM"],
    ["80 m amateur (LSB)", 3600, 3800, 1, "LSB"],
    ["40 m amateur (LSB)", 7050, 7200, 1, "LSB"],
    ["20 m amateur (USB)", 14100, 14350, 1, "USB"],
    ["CB (UK and CEPT)", 26960, 27410, 5, "AM"],
    ["FM broadcast", 87500, 108000, 100, "FM"],
  ];
  const LISTEN = { FM: "wfm", LSB: "lsb", USB: "usb", AM: "am" };

  /** The radio steps AM in whole kHz, FM in 10 kHz, SSB to the hertz (rounded here to 10 Hz). */
  function grid(mode) {
    return mode === "FM" ? 10000 : mode === "AM" ? 1000 : 10;
  }

  /** The index of the narrowest of the radio's bands that holds the whole range (VHF only for FM), or -1. */
  function bandFor(fromKHz, toKHz, mode) {
    let best = -1;
    BANDS.forEach((b, i) => {
      if (fromKHz < b[1] || toKHz > b[2] || (b[0] === "VHF") !== (mode === "FM")) return;
      if (best < 0 || b[2] - b[1] < BANDS[best][2] - BANDS[best][1]) best = i;
    });
    return best;
  }

  /** The steps of a scan: { points: [Hz], band (index), error }. error is a plain sentence, or "". */
  function plan({ fromKHz, toKHz, stepKHz, mode }) {
    const out = { points: [], band: -1, error: "" };
    fromKHz = Number(fromKHz); toKHz = Number(toKHz); stepKHz = Number(stepKHz);
    if (!["AM", "LSB", "USB", "FM"].includes(mode)) mode = "AM";
    if (!Number.isFinite(fromKHz) || !Number.isFinite(toKHz) || fromKHz <= 0 || toKHz <= 0) { out.error = "Type the frequencies to scan from and to, in kHz."; return out; }
    if (toKHz <= fromKHz) { out.error = "The \"to\" frequency needs to be above the \"from\" frequency."; return out; }
    const g = grid(mode);
    if (!Number.isFinite(stepKHz) || stepKHz * 1000 < g) {
      out.error = mode === "FM" ? "In FM the step needs to be at least 10 kHz." : mode === "AM" ? "In AM the step needs to be at least 1 kHz." : "The step needs to be at least 0.01 kHz.";
      return out;
    }
    if (mode === "FM" && (fromKHz < 64000 || toKHz > 108000)) { out.error = "FM works on the ATS Mini's VHF band only: 64 to 108 MHz."; return out; }
    if (mode !== "FM" && (fromKHz < 150 || toKHz > 30000)) { out.error = "In AM, LSB and USB the ATS Mini covers 150 to 30,000 kHz."; return out; }
    out.band = bandFor(fromKHz, toKHz, mode);
    if (out.band < 0) { out.error = "That range doesn't fit inside one of the radio's bands."; return out; }
    const step = Math.round((stepKHz * 1000) / g) * g;
    const first = Math.ceil((fromKHz * 1000) / g) * g;
    const last = Math.floor((toKHz * 1000) / g) * g;
    const n = Math.floor((last - first) / step) + 1;
    if (n > MAX_STEPS) { out.error = `That's ${n.toLocaleString("en-GB")} steps; Band Watch scans ${MAX_STEPS} at most. Pick a bigger step or a smaller range.`; return out; }
    if (n < 2) { out.error = "That range is smaller than one step."; return out; }
    for (let i = 0; i < n; i++) out.points.push(first + i * step);
    return out;
  }

  /** Is the radio's status line on the step Band Watch asked for? */
  function matches(targetHz, lineHz, mode) {
    return Math.abs(targetHz - lineHz) <= grid(mode) / 2 + (mode === "LSB" || mode === "USB" ? 40 : 0);
  }

  /** The noise level: the middle (median) reading. readings: [{ hz, rssi, snr }] (rssi null = no reading). */
  function noiseFloor(readings) {
    const v = readings.map((r) => r.rssi).filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
    if (!v.length) return null;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  /** The signals: each run of steps at least `above` dB over the noise counts once, at its strongest step.
   * Strongest first, `max` at most: [{ hz, rssi, snr, over }]. */
  function signals(readings, { above = 6, max = 12 } = {}) {
    const floor = noiseFloor(readings);
    if (floor == null) return [];
    const out = [];
    let best = null;
    for (const r of readings) {
      if (!Number.isFinite(r.rssi)) continue; // no reading for this step: don't split a signal in two
      if (r.rssi >= floor + above) {
        if (!best || r.rssi > best.rssi) best = r;
        continue;
      }
      if (best) out.push(best);
      best = null;
    }
    if (best) out.push(best);
    return out
      .map((r) => ({ hz: r.hz, rssi: r.rssi, snr: r.snr, over: Math.round(r.rssi - floor) }))
      .sort((x, y) => y.rssi - x.rssi || x.hz - y.hz)
      .slice(0, max);
  }

  /** A frequency as people say it: "9,650 kHz", "7,074.5 kHz" or "98.5 MHz" for FM. */
  function showFreq(hz, mode) {
    if (mode === "FM") return `${(hz / 1e6).toLocaleString("en-GB", { maximumFractionDigits: 2 })} MHz`;
    return `${(hz / 1000).toLocaleString("en-GB", { maximumFractionDigits: 2 })} kHz`;
  }

  /** The scan as a CSV file for a spreadsheet. */
  function csv(readings, mode) {
    const rows = ["Frequency (kHz),Mode,Signal (dBuV),SNR (dB)"];
    for (const r of readings) rows.push([r.hz / 1000, mode, Number.isFinite(r.rssi) ? r.rssi : "", Number.isFinite(r.snr) ? r.snr : ""].join(","));
    return rows.join("\r\n") + "\r\n";
  }

  /** Roughly how long a scan takes, in seconds (the radio sends a reading every half second). */
  function estimateSeconds(steps, careful) {
    return Math.round(steps * (careful ? 1 : 0.5));
  }

  return { MAX_STEPS, BANDS, PRESETS, LISTEN, grid, bandFor, plan, matches, noiseFloor, signals, showFreq, csv, estimateSeconds };
});
