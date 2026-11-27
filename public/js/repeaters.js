/* My repeaters: a small list of 2 m and 70 cm repeaters you type in (or import from a file you downloaded yourself),
 * with distance and beam heading from your locator, and a Tune button that sets your radio or RTL-SDR to the
 * repeater's OUTPUT frequency to listen.
 *
 * Receive only. Tune sets a frequency and a listening mode, nothing else: HamShack never sets a repeater's shift
 * or tone on your radio, never keys the radio and has no transmit path here. (Setting the shift or a tone would only
 * be needed to transmit through a repeater, so it is left out on purpose.)
 *
 * Data: nothing is bundled. HamShack ships no repeater list, and doesn't fetch one from ukrepeater.net, Hearham,
 * RepeaterBook or anyone else. The list is what you typed, or a file you chose, read in your browser and never
 * uploaded. The quick links just open those sites' own pages in a new tab.
 *
 * The pure parts (RptMath) are used by the page and by the tests (test/repeaters.test.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RptMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // UK amateur allocations this list accepts (MHz): 2 m 144-146 and 70 cm 430-440.
  const ALLOCATIONS = [["2 m", 144, 146], ["70 cm", 430, 440]];
  const MODES = ["FM", "DMR", "C4FM", "D-STAR"];
  const MAX_LIST = 1000;
  const MAX_FILE_BYTES = 2 * 1024 * 1024;
  const CTCSS = [67.0, 69.3, 71.9, 74.4, 77.0, 79.7, 82.5, 85.4, 88.5, 91.5, 94.8, 97.4, 100.0, 103.5, 107.2, 110.9, 114.8,
    118.8, 123.0, 127.3, 131.8, 136.5, 141.3, 146.2, 151.4, 156.7, 159.8, 162.2, 165.5, 167.9, 171.3, 173.8, 177.3, 179.9,
    183.5, 186.2, 189.9, 192.8, 196.6, 199.5, 203.5, 206.5, 210.7, 218.1, 225.7, 229.1, 233.6, 241.8, 250.3, 254.1];

  const r4 = (n) => Math.round(n * 1e4) / 1e4;

  /** "2 m" or "70 cm" if mhz is inside a UK allocation, else "". */
  function bandOf(mhz) {
    mhz = Number(mhz);
    if (!Number.isFinite(mhz)) return "";
    const b = ALLOCATIONS.find(([, lo, hi]) => mhz >= lo && mhz <= hi);
    return b ? b[0] : "";
  }

  /** The repeater's input frequency (what you would transmit on to use it): output plus shift. */
  const inputOf = (r) => r4(Number(r.out) + Number(r.offset || 0));

  /* ---------- Locators, distance, bearing ---------- */

  /** 4 or 6 character Maidenhead locator -> { loc, lat, lon } (centre of the square), or null. */
  function locatorPos(raw) {
    const m = String(raw || "").trim().match(/^([A-Ra-r]{2})(\d{2})(?:([A-Xa-x]{2}))?(?:\d{2}(?:[A-Xa-x]{2})?)?$/);
    if (!m) return null;
    const f = m[1].toUpperCase(), s = m[3] ? m[3].toLowerCase() : "";
    let lon = (f.charCodeAt(0) - 65) * 20 - 180 + Number(m[2][0]) * 2;
    let lat = (f.charCodeAt(1) - 65) * 10 - 90 + Number(m[2][1]);
    if (s) {
      lon += (s.charCodeAt(0) - 97) * (5 / 60) + 2.5 / 60;
      lat += (s.charCodeAt(1) - 97) * (2.5 / 60) + 1.25 / 60;
    } else { lon += 1; lat += 0.5; }
    return { loc: f + m[2] + s, lat, lon };
  }

  const RAD = Math.PI / 180;
  /** Great-circle distance in km and the beam heading (degrees from north) from a to b ({lat, lon}). */
  function distBearing(a, b) {
    const h = Math.sin(((b.lat - a.lat) * RAD) / 2) ** 2 +
      Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(((b.lon - a.lon) * RAD) / 2) ** 2;
    const km = 12742 * Math.asin(Math.sqrt(h));
    const y = Math.sin((b.lon - a.lon) * RAD) * Math.cos(b.lat * RAD);
    const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos((b.lon - a.lon) * RAD);
    return { km: Math.round(km), bearing: Math.round(((Math.atan2(y, x) / RAD) + 360) % 360) % 360 };
  }
  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

  /** Each repeater with its distance and bearing from home ({lat, lon}) when it has a locator, nearest first;
   * repeaters without a locator (or with no home) come last, by callsign. Does not change the list given. */
  function sortNearest(list, home) {
    const out = list.map((r) => {
      const p = home && Number.isFinite(home.lat) ? locatorPos(r.loc) : null;
      return p ? { ...r, ...distBearing(home, p) } : { ...r, km: null, bearing: null };
    });
    out.sort((a, b) => (a.km == null) - (b.km == null) || (a.km ?? 0) - (b.km ?? 0) || String(a.call).localeCompare(String(b.call)) || a.out - b.out);
    return out;
  }

  /* ---------- Fields and checking ---------- */

  function cleanMode(raw) {
    const s = String(raw == null ? "" : raw).toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!s) return "FM";
    if (["dmr", "dmrtier2", "tier2", "brandmeister"].includes(s)) return "DMR";
    if (["c4fm", "ysf", "fusion", "systemfusion", "yaesu", "wiresx"].includes(s)) return "C4FM";
    if (["dstar", "dst", "d", "dstarrepeater"].includes(s)) return "D-STAR";
    if (["fm", "nfm", "analogue", "analog", "narrowfm", "wfm"].includes(s)) return "FM";
    return "";
  }

  /** A CTCSS tone (Hz) as a number from the standard list, "" for none, or null if it isn't a standard tone. */
  function cleanCtcss(raw) {
    const t = String(raw == null ? "" : raw).replace(/hz/i, "").replace(",", ".").trim();
    if (!t || t === "0" || /^(none|off|-)$/i.test(t)) return "";
    const n = Number(t);
    return Number.isFinite(n) && CTCSS.includes(Math.round(n * 10) / 10) ? Math.round(n * 10) / 10 : null;
  }

  const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);

  /** Check and tidy one repeater. in: { call, out, offset, ctcss, code, mode, loc, town, notes }.
   * -> { ok, errors: [plain English], clean } */
  function validate(r) {
    const errors = [];
    const call = clip(r.call, 14).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9/-]{2,13}$/.test(call)) errors.push("Enter the repeater's callsign, for example GB3XX.");
    const out = Number(String(r.out).replace(",", "."));
    if (r.out === "" || r.out == null || !Number.isFinite(out)) errors.push("Enter the output frequency in MHz, for example 145.6.");
    else if (!bandOf(out)) errors.push("The output frequency must be in the UK 2 m (144–146 MHz) or 70 cm (430–440 MHz) band.");
    let offset = r.offset === "" || r.offset == null ? 0 : Number(String(r.offset).replace(",", "."));
    if (!Number.isFinite(offset)) { errors.push("The shift must be a number in MHz, like -0.6 or 1.6."); offset = 0; }
    if (Math.abs(offset) > 10) errors.push("The shift looks too big. Enter it in MHz, like -0.6 or 1.6.");
    else if (Number.isFinite(out) && bandOf(out) && offset && bandOf(out + offset) !== bandOf(out)) errors.push("The input frequency (output plus shift) must be in the same band as the output.");
    const ctcss = cleanCtcss(r.ctcss);
    if (ctcss === null) errors.push("That isn't a standard CTCSS tone. Try one like 82.5 or 118.8, or leave it empty.");
    const mode = cleanMode(r.mode);
    if (!mode) errors.push("Mode must be FM, DMR, C4FM or D-STAR.");
    let loc = "";
    if (clip(r.loc, 12)) {
      const p = locatorPos(clip(r.loc, 12));
      if (!p) errors.push("That locator doesn't look right. Use 4 or 6 characters, like IO93 or IO93fa, or leave it empty.");
      else loc = p.loc;
    }
    return {
      ok: !errors.length, errors,
      clean: { call, out: r4(out), offset: r4(offset), ctcss: ctcss === null ? "" : ctcss, code: clip(r.code, 14), mode: mode || "FM", loc, town: clip(r.town, 40), notes: clip(r.notes, 200) },
    };
  }

  /* ---------- CSV import ---------- */

  /** Split CSV text into rows of cells. Handles quotes, "" inside quotes, CRLF, a byte-order mark and , ; or tab. */
  function parseCsv(text) {
    text = String(text == null ? "" : text).replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const count = (ch) => { let n = 0, q = false; for (const c of first) { if (c === '"') q = !q; else if (c === ch && !q) n++; } return n; };
    const delim = [",", ";", "\t"].map((d) => [d, count(d)]).sort((a, b) => b[1] - a[1])[0];
    const sep = delim[1] ? delim[0] : ",";
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"' && !cell) q = true;
      else if (c === sep) { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    return { rows, delimiter: sep };
  }

  // Column names we recognise, best match first. A header is lower-cased with everything but letters and digits removed.
  // "TX" / "output" mean the repeater's own transmitter (the one you listen to); "RX" / "input" is what it listens on.
  const FIELDS = {
    call: ["callsign", "call", "repeatercall", "repeatercallsign", "repeater", "rptr", "ident"],
    out: ["output", "outputmhz", "outputfreq", "outputfrequency", "repeateroutput", "rptoutput", "txfreq", "txfrequency", "txmhz", "tx", "downlink", "frequency", "frequencymhz", "freq", "freqmhz", "qrg"],
    inp: ["input", "inputmhz", "inputfreq", "inputfrequency", "repeaterinput", "rptinput", "rxfreq", "rxfrequency", "rxmhz", "rx", "uplink"],
    offset: ["offset", "shift", "split", "offsetmhz"],
    duplex: ["duplex"],
    ctcss: ["ctcss", "ctcssfreq", "ctcsstone", "rtonefreq", "ctonefreq", "tonefreq", "toneinhz", "pltone", "pl", "txtone", "tone"],
    code: ["dcs", "dcscode", "dtcs", "dtcscode", "colourcode", "colorcode", "cc"],
    mode: ["mode", "modes", "type", "modulation", "operatingmode"],
    loc: ["locator", "gridlocator", "gridsquare", "grid", "qthlocator", "qthloc", "maidenhead", "loc"],
    town: ["town", "city", "nearesttown", "location", "qth", "site", "place", "area", "locality"],
    notes: ["notes", "note", "comment", "comments", "remarks", "description"],
  };
  const norm = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  /** Which column holds what: headers -> { field: columnIndex }. Each column is used once. */
  function matchColumns(headers) {
    const h = headers.map(norm);
    const used = new Set(), map = {};
    for (const [field, names] of Object.entries(FIELDS)) {
      for (const n of names) {
        const i = h.findIndex((x, k) => x === n && !used.has(k));
        if (i >= 0) { map[field] = i; used.add(i); break; }
      }
    }
    return map;
  }

  /** A frequency cell -> MHz. Accepts "145.600", "145,600" (with a ; file), "145.6 MHz", 145600 (kHz) or 145600000 (Hz). */
  function parseMhz(raw, decimalComma) {
    let t = String(raw == null ? "" : raw).trim().replace(/mhz/i, "").trim();
    if (!t) return NaN;
    if (decimalComma || /^\d+,\d{1,4}$/.test(t)) t = t.replace(",", ".");
    t = t.replace(/\s/g, "");
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return NaN;
    return n >= 1e6 ? n / 1e6 : n >= 1e4 ? n / 1e3 : n;
  }

  /** A shift cell -> signed MHz, or NaN. 0.6, -0.6, "+1.6", "-600 kHz" and 600 (kHz) all work; duplex gives the sign. */
  function parseShift(raw, duplex, decimalComma) {
    let t = String(raw == null ? "" : raw).trim().toLowerCase();
    const d = String(duplex == null ? "" : duplex).trim().toLowerCase();
    if (!t && !d) return 0;
    if (/^(off|none|simplex)$/.test(d) && !t) return 0;
    const khz = /khz/.test(t);
    t = t.replace(/[a-z]/g, "").replace(/\s/g, "");
    if (decimalComma || /^[+-]?\d+,\d{1,4}$/.test(t)) t = t.replace(",", ".");
    let n = t ? Number(t) : NaN;
    if (!t) return /^[+-]$/.test(d) ? NaN : 0;
    if (!Number.isFinite(n)) return NaN;
    if (khz || Math.abs(n) >= 10) n /= 1000;
    const explicit = /^[+-]/.test(t);
    if (!explicit && d === "-") n = -Math.abs(n);
    else if (!explicit && d === "+") n = Math.abs(n);
    return r4(n);
  }

  /** The CSV text -> { repeaters, skipped: [{ line, reason }], matched: { field: header }, headers, error }.
   * Rows outside 2 m / 70 cm, without a callsign or output, or that fail the checks are skipped with the reason. */
  function importCsv(text) {
    const none = { repeaters: [], skipped: [], matched: {}, headers: [], error: "" };
    if (String(text || "").length > MAX_FILE_BYTES) return { ...none, error: "That file is too big for a repeater list (over 2 MB)." };
    const { rows, delimiter } = parseCsv(text);
    if (rows.length < 2) return { ...none, error: "I couldn't find any rows in that file. It should be a CSV with a header row." };
    const headers = rows[0].map((x) => x.trim());
    const map = matchColumns(headers);
    const matched = Object.fromEntries(Object.entries(map).map(([f, i]) => [f, headers[i]]));
    if (map.out == null && !(map.inp != null && map.offset != null)) {
      return { ...none, headers, matched, error: "I couldn't find a frequency column. Name it Output, TX or Frequency (MHz)." };
    }
    const comma = delimiter !== ",";
    const cell = (r, f) => (map[f] == null ? "" : String(r[map[f]] == null ? "" : r[map[f]]).trim());
    const repeaters = [], skipped = [];
    for (let n = 1; n < rows.length; n++) {
      const r = rows[n], line = n + 1;
      if (repeaters.length >= MAX_LIST) { skipped.push({ line, reason: `Only the first ${MAX_LIST} repeaters are kept.` }); break; }
      let out = parseMhz(cell(r, "out"), comma);
      const inp = parseMhz(cell(r, "inp"), comma);
      let offset = parseShift(cell(r, "offset"), cell(r, "duplex"), comma);
      if (Number.isFinite(out) && Number.isFinite(inp)) offset = r4(inp - out);
      else if (!Number.isFinite(out) && Number.isFinite(inp) && Number.isFinite(offset)) out = r4(inp - offset);
      if (!Number.isFinite(out)) { skipped.push({ line, reason: "No usable frequency." }); continue; }
      if (!Number.isFinite(offset)) offset = 0;
      // The tone column is sometimes a setting name ("Tone", "TSQL"), not a number: ignore those.
      const toneRaw = cell(r, "ctcss");
      const v = validate({
        call: cell(r, "call"), out, offset, ctcss: /^[\d.,\s]*(hz)?$/i.test(toneRaw) ? toneRaw : "",
        code: cell(r, "code"), mode: cell(r, "mode") || "FM", loc: cell(r, "loc"), town: cell(r, "town"), notes: cell(r, "notes"),
      });
      if (!v.ok && v.errors.length === 1 && /standard CTCSS/.test(v.errors[0])) { v.ok = true; v.clean.ctcss = ""; } // keep it, drop the odd tone
      if (!v.ok && v.errors.length === 1 && /Mode must be/.test(v.errors[0])) { v.ok = true; v.clean.mode = "FM"; }
      if (!v.ok) { skipped.push({ line, reason: v.errors[0] }); continue; }
      repeaters.push({ ...v.clean, imported: true });
    }
    return { repeaters, skipped, matched, headers, error: "" };
  }

  /** Split fresh repeaters into those to add and those already in the list (same callsign and output). */
  function mergeNew(existing, fresh) {
    const key = (r) => `${String(r.call).toUpperCase()}|${r4(r.out)}`;
    const have = new Set(existing.map(key));
    const add = [], dupes = [];
    for (const r of fresh) { if (have.has(key(r))) dupes.push(r); else { have.add(key(r)); add.push(r); } }
    return { add, dupes };
  }

  /** What Tune does for a repeater: the kHz and listening mode, or null if it's out of band. Receive only. */
  function tuneTarget(r) {
    if (!r || !bandOf(r.out)) return null;
    return { kHz: Math.round(Number(r.out) * 1e6) / 1e3, mode: "fm" };
  }

  const MAX_COUNT = MAX_LIST;
  return { ALLOCATIONS, MODES, CTCSS, MAX_LIST: MAX_COUNT, MAX_FILE_BYTES, bandOf, inputOf, locatorPos, distBearing, compass, sortNearest, cleanMode, cleanCtcss, validate, parseCsv, matchColumns, parseMhz, parseShift, importCsv, mergeNew, tuneTarget };
});

/* ---------- The panel (browser only) ---------- */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const KEY = "bw-repeaters";
  const rpt = window.rpt = { list: [], editing: "", pending: null, delArm: "" };

  const rpLoad = () => {
    try {
      const v = JSON.parse(load(KEY) || "[]");
      rpt.list = (Array.isArray(v) ? v : []).slice(0, RptMath.MAX_LIST)
        .map((r) => { const c = RptMath.validate(r); return c.ok ? { ...c.clean, id: String(r.id || ""), imported: Boolean(r.imported) } : null; })
        .filter(Boolean);
      rpt.list.forEach((r) => { if (!r.id) r.id = rpNewId(); });
    } catch { rpt.list = []; }
  };
  const rpSave = () => store(KEY, rpt.list);
  const rpNewId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const rpNote = (s) => { $("rpNote").textContent = s; };
  const rpHome = () => (app && app.home && Number.isFinite(app.home.lat) ? app.home : null);

  const toneText = (r) => [r.ctcss ? `${r.ctcss} Hz` : "", r.code].filter(Boolean).join(" · ") || "–";
  const shiftText = (r) => (r.offset ? `${r.offset > 0 ? "+" : "−"}${Math.abs(r.offset)}` : "none");
  const mhzText = (n) => Number(n).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

  function rpRender() {
    const home = rpHome();
    const rows = RptMath.sortNearest(rpt.list, home);
    $("rpCount").textContent = rows.length ? `${rows.length} saved` : "";
    $("rpHome").textContent = $("grid").value ? `Distances are from your locator, ${$("grid").value.trim()}.` : "Set your locator at the top of the page to see distances.";
    $("rpRows").innerHTML = rows.map((r) => `<tr data-id="${esc(r.id)}">` +
      `<td><b>${esc(r.call)}</b>${r.imported ? ' <span class="muted small" title="Imported from a file">imported</span>' : ""}</td>` +
      `<td class="num">${mhzText(r.out)}</td><td class="num" title="Input ${mhzText(RptMath.inputOf(r))} MHz">${shiftText(r)}</td>` +
      `<td>${esc(toneText(r))}</td><td>${esc(r.mode)}</td>` +
      `<td class="wrapcell">${esc([r.town, r.loc].filter(Boolean).join(" · ") || "–")}${r.notes ? `<br><span class="muted small">${esc(r.notes)}</span>` : ""}</td>` +
      `<td class="num">${r.km == null ? "–" : `${r.km.toLocaleString()} km, ${String(r.bearing).padStart(3, "0")}° ${RptMath.compass(r.bearing)}`}</td>` +
      `<td class="rpact"><button type="button" class="ghost" data-act="tune" aria-label="Tune to ${esc(r.call)} output, ${mhzText(r.out)} MHz">Tune</button>` +
      `<button type="button" class="ghost" data-act="edit" aria-label="Edit ${esc(r.call)}">Edit</button>` +
      `<button type="button" class="ghost" data-act="del" aria-label="Delete ${esc(r.call)}">${rpt.delArm === r.id ? "Sure?" : "Delete"}</button></td></tr>`).join("");
    $("rpEmpty").hidden = rows.length > 0;
    $("rpTable").hidden = rows.length === 0;
  }

  function rpFill(r) {
    $("rpCall").value = r ? r.call : ""; $("rpOut").value = r ? r.out : ""; $("rpOff").value = r && r.offset ? r.offset : "";
    $("rpCtcss").value = r ? r.ctcss : ""; $("rpCode").value = r ? r.code : ""; $("rpMode").value = r ? r.mode : "FM";
    $("rpLoc").value = r ? r.loc : ""; $("rpTown").value = r ? r.town : ""; $("rpNotes").value = r ? r.notes : "";
    rpt.editing = r ? r.id : "";
    $("rpSave").textContent = r ? "Save changes" : "Add repeater";
    $("rpCancel").hidden = !r;
    $("rpErr").textContent = "";
  }

  /** Tune for listening: the repeater's OUTPUT frequency, in FM. Same path as every other tune (tuneTo): a connected
   * radio follows (frequency and mode only), and an open RTL-SDR retunes. Nothing here sets shift or tone or transmits. */
  window.rptTune = function rptTune(r) {
    const t = RptMath.tuneTarget(r);
    if (!t) { rpNote("That frequency isn't in the 2 m or 70 cm band, so I haven't tuned."); return false; }
    tuneTo(t.kHz, t.mode, { quiet: true });
    const where = rig.connected && rig.follow ? "Your radio is on it." :
      listen.rx === "rtl" ? (listen.open ? "Your RTL-SDR is on it." : "Press Listen to hear it on your RTL-SDR.") :
        "Connect your radio, or choose My RTL-SDR in Listen, to hear it.";
    rpNote(`Tuned to ${r.call} output, ${mhzText(r.out)} MHz, FM. ${where}` +
      (r.mode !== "FM" ? ` This is a ${r.mode} repeater: HamShack can't decode it, so set that mode on your radio.` : "") +
      " Listening only: the shift and tone aren't set and nothing is sent.");
    return true;
  };

  function rpImportText(text, name) {
    const res = RptMath.importCsv(text);
    const box = $("rpPreview");
    if (res.error) { rpt.pending = null; box.hidden = false; box.innerHTML = `<p class="small">${esc(res.error)}</p>`; $("rpImpGo").hidden = true; return; }
    const { add, dupes } = RptMath.mergeNew(rpt.list, res.repeaters);
    const room = Math.max(0, RptMath.MAX_LIST - rpt.list.length);
    rpt.pending = add.slice(0, room);
    const cols = Object.entries(res.matched).map(([f, h]) => `${esc(h)} → ${f === "inp" ? "input" : f}`).join(", ");
    box.hidden = false;
    box.innerHTML = `<p class="small"><b>${rpt.pending.length}</b> repeater${rpt.pending.length === 1 ? "" : "s"} ready to add from ${esc(name || "your file")}` +
      `${dupes.length ? `, ${dupes.length} already in your list` : ""}${res.skipped.length ? `, ${res.skipped.length} skipped` : ""}.</p>` +
      `<p class="small muted">Columns used: ${cols || "none"}. “Output” or “TX” is the repeater's transmitter, the one you listen to.</p>` +
      (res.skipped.length ? `<details class="small"><summary>Why some rows were skipped</summary><ul>${res.skipped.slice(0, 10).map((s) => `<li>Row ${s.line}: ${esc(s.reason)}</li>`).join("")}${res.skipped.length > 10 ? `<li>…and ${res.skipped.length - 10} more.</li>` : ""}</ul></details>` : "");
    $("rpImpGo").hidden = !rpt.pending.length;
    $("rpImpGo").textContent = `Add ${rpt.pending.length} to My repeaters`;
  }

  window.setupRepeaters = function setupRepeaters() {
    if (!$("secRpt")) return;
    rpLoad();
    $("rpMode").innerHTML = RptMath.MODES.map((m) => `<option>${m}</option>`).join("");
    $("rpTones").innerHTML = RptMath.CTCSS.map((t) => `<option value="${t}"></option>`).join("");
    rpFill(null);
    rpRender();
    $("rpForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const v = RptMath.validate({
        call: $("rpCall").value, out: $("rpOut").value, offset: $("rpOff").value, ctcss: $("rpCtcss").value, code: $("rpCode").value,
        mode: $("rpMode").value, loc: $("rpLoc").value, town: $("rpTown").value, notes: $("rpNotes").value,
      });
      if (!v.ok) { $("rpErr").textContent = v.errors.join(" "); return; }
      const prev = rpt.list.find((r) => r.id === rpt.editing);
      if (prev) Object.assign(prev, v.clean);
      else if (rpt.list.length >= RptMath.MAX_LIST) { $("rpErr").textContent = `The list is full (${RptMath.MAX_LIST}). Delete some first.`; return; } else rpt.list.push({ ...v.clean, id: rpNewId(), imported: false });
      rpSave(); rpFill(null); rpRender();
      rpNote(prev ? "Saved." : "Added. Press Tune to listen to its output.");
    });
    $("rpCancel").addEventListener("click", () => { rpFill(null); });
    $("rpRows").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const id = b.closest("tr").dataset.id, r = rpt.list.find((x) => x.id === id);
      if (!r) return;
      if (b.dataset.act === "tune") rptTune(r);
      else if (b.dataset.act === "edit") { rpFill(r); $("rpCall").focus(); }
      else if (rpt.delArm === id) { rpt.list = rpt.list.filter((x) => x.id !== id); rpt.delArm = ""; if (rpt.editing === id) rpFill(null); rpSave(); rpRender(); rpNote(`${r.call} deleted.`); } else { rpt.delArm = id; rpRender(); }
    });
    document.addEventListener("click", (e) => { if (rpt.delArm && !e.target.closest("button[data-act=del]")) { rpt.delArm = ""; rpRender(); } });
    $("grid").addEventListener("change", rpRender);
    // Import: the file is read here in the browser with FileReader and never sent anywhere.
    $("rpFile").addEventListener("change", () => {
      const f = $("rpFile").files[0];
      if (!f) return;
      if (f.size > RptMath.MAX_FILE_BYTES) { rpt.pending = null; $("rpImpGo").hidden = true; $("rpPreview").hidden = false; $("rpPreview").innerHTML = "<p class=\"small\">That file is too big for a repeater list (over 2 MB).</p>"; return; }
      const fr = new FileReader();
      fr.onload = () => rpImportText(String(fr.result || ""), f.name);
      fr.onerror = () => { $("rpPreview").hidden = false; $("rpPreview").innerHTML = '<p class="small">I couldn\'t read that file.</p>'; };
      fr.readAsText(f);
    });
    $("rpImpGo").addEventListener("click", () => {
      if (!rpt.pending || !rpt.pending.length) return;
      const n = rpt.pending.length;
      rpt.list.push(...rpt.pending.map((r) => ({ ...r, id: rpNewId(), imported: true })));
      rpt.pending = null; rpSave(); rpRender();
      $("rpPreview").hidden = true; $("rpImpGo").hidden = true; $("rpFile").value = "";
      rpNote(`Added ${n} repeater${n === 1 ? "" : "s"} from your file.`);
    });
  };
}
