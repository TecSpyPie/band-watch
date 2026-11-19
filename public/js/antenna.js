/* Band Watch by M3vrv: Antenna A/B, comparing two antennas with real reception reports of your own signal.
 * Plain JavaScript, used by the page (window.Antenna) and the tests (require).
 * ANALYSIS ONLY: this never controls the radio and never transmits. You send WSPR with your own software and
 * switch antennas yourself; Band Watch only keeps a log of when you were on which, fetches the reports other
 * stations made of your callsign, and compares them.
 *   assignPeriod()  which antenna was in use for one report (a whole 2-minute slot must fit inside one period)
 *   analyse()       match reports by the same receiving station and band, then average the SNR difference
 *   sectorOf(), distanceBin()  8 compass sectors and 4 distance bands
 *   buildQuery(), parseRows()  the wspr.live question and its answer
 * Reports come from wspr.live (public WSPR database, browser access allowed). PSK Reporter (FT8 and others)
 * needs a server route and is not part of this version. */
(function (root, factory) {
  const rot = (typeof module === "object" && module.exports) ? require("./rotmath.js") : root.RotMath;
  if (typeof module === "object" && module.exports) module.exports = factory(rot);
  else root.Antenna = factory(rot);
})(typeof self !== "undefined" ? self : this, function (RotMath) {
  "use strict";

  const SLOT_MS = 120000;            // a WSPR over lasts 2 minutes
  const MAX_DAYS = 7;                // the longest time window we ask wspr.live about
  const MAX_ROWS = 50000;
  const MIN_PAIRS = 10;              // fewer matched receivers than this: say the result is shaky
  const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const DIST_BANDS = ["under 1000 km", "1000 to 3000 km", "3000 to 8000 km", "over 8000 km"];
  // wspr.live's "band" is the whole MHz of the dial frequency
  const BAND_NAMES = { "-1": "LF", 0: "MF", 1: "160 m", 3: "80 m", 5: "60 m", 7: "40 m", 10: "30 m", 14: "20 m", 18: "17 m",
    21: "15 m", 24: "12 m", 28: "10 m", 50: "6 m", 70: "4 m", 144: "2 m" };
  const BAND_ORDER = Object.keys(BAND_NAMES).map(Number).sort((a, b) => a - b);
  const RAD = Math.PI / 180;

  const bandName = (code) => BAND_NAMES[code] || `${code} MHz`;

  /** Great-circle distance in km (the same formula as the page's distanceKm). */
  function distKm(lat1, lon1, lat2, lon2) {
    const h = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  }

  /** Maidenhead locator (4 or 6 characters) -> { lat, lon } at its centre, or null. */
  function locToLatLon(g) {
    g = String(g || "").trim().toUpperCase();
    if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
    let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
    let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
    if (g.length === 6) {
      lon += (g.charCodeAt(4) - 65) * (5 / 60) + 2.5 / 60;
      lat += (g.charCodeAt(5) - 65) * (2.5 / 60) + 1.25 / 60;
    } else { lon += 1; lat += 0.5; }
    return { lat, lon };
  }

  /** 0..7 (N, NE, E, ...) for a compass bearing in degrees; each sector is 45 degrees wide, centred on its name. */
  function sectorOf(deg) {
    const d = ((Number(deg) % 360) + 360) % 360;
    return Math.floor((d + 22.5) / 45) % 8;
  }

  /** 0..3 for a distance in km: under 1000, 1000 to 3000, 3000 to 8000, over 8000. */
  function distanceBin(km) {
    if (km < 1000) return 0;
    if (km < 3000) return 1;
    if (km <= 8000) return 2;
    return 3;
  }

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;

  /* ---------------------------- the switch log ---------------------------- */

  /** Which antenna was in use for a report that started at t (ms): "A", "B", "both" (periods overlap, can't tell),
   * or null (no period covers the whole slot). A period includes its start and runs up to (not including) its
   * end; an open period (no end) runs to `now`. A report counts only if its whole 2-minute slot fits inside the
   * period, so a swap in the middle of a slot never gives a doubtful report. */
  function assignPeriod(t, periods, now, slotMs = SLOT_MS) {
    let found = null;
    for (const p of periods || []) {
      const end = p.end == null ? now : p.end;
      if (t >= p.start && t + slotMs <= end) {
        if (found && found !== p.ant) return "both";
        found = p.ant;
      }
    }
    return found;
  }

  /** The log after "now on antenna ant": the open period (if any) ends now and a new one starts.
   * Pressing the button for the antenna already in use changes nothing. Returns a new array. */
  function switchTo(periods, ant, now, id) {
    const list = (periods || []).map((p) => ({ ...p }));
    const open = list.find((p) => p.end == null);
    if (open && open.ant === ant) return list;
    if (open) open.end = Math.max(now, open.start);
    list.push({ id: id || `p${now}`, ant, start: now, end: null });
    return list;
  }

  /** Close the open period (if any) at `now`. */
  function stopLog(periods, now) {
    return (periods || []).map((p) => (p.end == null ? { ...p, end: Math.max(now, p.start) } : { ...p }));
  }

  /** Check a typed period. Returns "" if fine, else a plain-English problem. */
  function checkPeriod(ant, start, end, now) {
    if (ant !== "A" && ant !== "B") return "Pick antenna A or B.";
    if (!Number.isFinite(start) || !Number.isFinite(end)) return "Enter a start and an end time (UTC).";
    if (end <= start) return "The end must be after the start.";
    if (end > now + 60000) return "The end is in the future.";
    if (end - start < SLOT_MS) return "A period must be at least 2 minutes (one WSPR over).";
    return "";
  }

  /** "2026-11-19T10:30" (a datetime-local value, read as UTC) -> ms, or NaN. */
  function parseUtc(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s || ""));
    if (!m) return NaN;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  }
  const pad = (n) => String(n).padStart(2, "0");
  /** ms -> "2026-11-19 10:30" in UTC. */
  function fmtUtc(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  /** What the log is read back as from the browser's storage: only well-formed periods survive. */
  function cleanPeriods(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((p) => p && (p.ant === "A" || p.ant === "B") && Number.isFinite(p.start) &&
      (p.end == null || (Number.isFinite(p.end) && p.end >= p.start)))
      .map((p) => ({ id: String(p.id || `p${p.start}`), ant: p.ant, start: p.start, end: p.end == null ? null : p.end }));
  }

  /* ---------------------------- the comparison ---------------------------- */

  /** reports: [{ t (ms), band (wspr.live code), rx, snr, lat, lon, dist, az }]. opts: { now, me: {lat, lon} | null }.
   * Only a receiver that heard you on BOTH antennas on the same band counts as a pair; its average SNR on each
   * antenna is used (so one station that reports a lot doesn't outweigh the rest). */
  function analyse(reports, periods, opts = {}) {
    const now = opts.now == null ? Date.now() : opts.now;
    const me = opts.me || null;
    const groups = new Map();
    const totals = { reports: 0, spotsA: 0, spotsB: 0, unassigned: 0, ambiguous: 0 };
    for (const r of reports || []) {
      totals.reports++;
      const ant = assignPeriod(r.t, periods, now, opts.slotMs);
      if (ant === "both") { totals.ambiguous++; continue; }
      if (!ant) { totals.unassigned++; continue; }
      if (ant === "A") totals.spotsA++; else totals.spotsB++;
      const key = `${r.band}|${r.rx}`;
      let g = groups.get(key);
      if (!g) { g = { band: r.band, rx: r.rx, A: [], B: [], lat: r.lat, lon: r.lon, dist: r.dist, az: r.az }; groups.set(key, g); }
      g[ant].push(r.snr);
    }

    const pairs = [];
    let onlyA = 0, onlyB = 0;
    for (const g of groups.values()) {
      if (g.A.length && g.B.length) {
        const a = mean(g.A), b = mean(g.B);
        let dist = g.dist, az = g.az;
        if (me && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
          dist = distKm(me.lat, me.lon, g.lat, g.lon);
          az = RotMath.bearing(me.lat, me.lon, g.lat, g.lon);
        }
        pairs.push({ band: g.band, rx: g.rx, a, b, diff: b - a, dist, az });
      } else if (g.A.length) onlyA++; else onlyB++;
    }

    const byBand = new Map();
    for (const p of pairs) {
      if (!byBand.has(p.band)) byBand.set(p.band, []);
      byBand.get(p.band).push(p);
    }
    const bands = [...byBand.entries()].sort((x, y) => BAND_ORDER.indexOf(x[0]) - BAND_ORDER.indexOf(y[0]) || x[0] - y[0])
      .map(([band, list]) => ({
        band, label: bandName(band), receivers: list.length,
        avgA: mean(list.map((p) => p.a)), avgB: mean(list.map((p) => p.b)),
        diff: mean(list.map((p) => p.diff)), few: list.length < MIN_PAIRS,
      }));

    const bin = (n, idx) => {
      const out = Array.from({ length: n }, () => []);
      for (const p of pairs) if (Number.isFinite(idx(p))) out[idx(p)].push(p.diff);
      return out.map((l) => ({ n: l.length, diff: l.length ? mean(l) : null }));
    };
    const sectors = bin(8, (p) => (Number.isFinite(p.az) ? sectorOf(p.az) : NaN)).map((s, i) => ({ name: SECTORS[i], ...s }));
    const distances = bin(4, (p) => (Number.isFinite(p.dist) ? distanceBin(p.dist) : NaN)).map((s, i) => ({ name: DIST_BANDS[i], ...s }));

    return {
      bands, sectors, distances,
      totals: { ...totals, matched: pairs.length, onlyA, onlyB },
      overall: pairs.length ? mean(pairs.map((p) => p.diff)) : null,
      tooFew: pairs.length < MIN_PAIRS,
    };
  }

  /** "B better by 2.3 dB" in the user's own words for the antennas. */
  function diffText(diff, nameA, nameB) {
    if (diff == null || !Number.isFinite(diff)) return "no data";
    const a = nameA || "A", b = nameB || "B";
    const v = Math.abs(diff);
    if (v < 0.5) return "about the same (under 0.5 dB apart)";
    return `${diff > 0 ? b : a} better by ${v.toFixed(1)} dB`;
  }

  /* ---------------------------- wspr.live ---------------------------- */

  const CALL_OK = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,6})?$/;
  const sqlTime = (ms) => fmtUtc(ms) + ":00";

  /** The time window to ask about: from the earliest period start to the end of the latest (or now), no longer
   * than 7 days (the latest 7 days if it is longer). Returns { from, to, clamped } or null if there are no periods. */
  function windowOf(periods, now) {
    if (!periods || !periods.length) return null;
    let from = Infinity, to = -Infinity;
    for (const p of periods) { from = Math.min(from, p.start); to = Math.max(to, p.end == null ? now : p.end); }
    const max = MAX_DAYS * 864e5;
    let clamped = false;
    if (to - from > max) { from = to - max; clamped = true; }
    return { from, to, clamped };
  }

  /** The wspr.live address for the reports of `call` between from and to (ms). Throws on a callsign that
   * doesn't look like one (it goes inside the question, so only plain callsign characters are allowed). */
  function buildQuery(call, from, to) {
    const c = String(call || "").trim().toUpperCase();
    if (!CALL_OK.test(c)) throw new Error("Enter your callsign at the top of the page first.");
    const sql = `SELECT time,band,rx_sign,rx_lat,rx_lon,snr,distance,azimuth FROM wspr.rx WHERE tx_sign='${c}' ` +
      `AND time>='${sqlTime(from)}' AND time<='${sqlTime(to)}' ORDER BY time LIMIT ${MAX_ROWS} FORMAT JSONCompact`;
    return "https://db1.wspr.live/?query=" + encodeURIComponent(sql);
  }

  /** wspr.live's JSONCompact answer -> reports. Rows that don't make sense are skipped. */
  function parseRows(json) {
    const out = [];
    const data = json && Array.isArray(json.data) ? json.data : [];
    for (const row of data) {
      if (!Array.isArray(row)) continue;
      const [time, band, rx, lat, lon, snr, dist, az] = row;
      const t = Date.parse(String(time).replace(" ", "T") + "Z");
      if (!Number.isFinite(t) || !rx || !Number.isFinite(Number(snr))) continue;
      out.push({ t, band: Number(band), rx: String(rx), lat: Number(lat), lon: Number(lon), snr: Number(snr), dist: Number(dist), az: Number(az) });
    }
    return out;
  }

  const api = {
    SLOT_MS, MAX_DAYS, MAX_ROWS, MIN_PAIRS, SECTORS, DIST_BANDS,
    bandName, distKm, locToLatLon, sectorOf, distanceBin,
    assignPeriod, switchTo, stopLog, checkPeriod, parseUtc, fmtUtc, cleanPeriods,
    analyse, diffText, windowOf, buildQuery, parseRows,
  };
  if (typeof document === "undefined" || typeof window === "undefined") return api;

  /* ---------------------------- the panel ---------------------------- */

  const KEY = "bw-antab";
  const COOLDOWN_MS = 20000;
  const cache = new Map();           // query address -> { at, reports }; kept in memory only
  let state = { names: { A: "Antenna A", B: "Antenna B" }, periods: [] };
  let lastFetch = 0;
  let busy = false;
  const el = (id) => document.getElementById(id);
  const escH = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ } }
  function restore() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      if (v && typeof v === "object") {
        state.periods = cleanPeriods(v.periods);
        for (const k of ["A", "B"]) if (v.names && typeof v.names[k] === "string" && v.names[k].trim()) state.names[k] = v.names[k].trim().slice(0, 30);
      }
    } catch { /* nothing saved, or storage unavailable */ }
  }
  const nameOf = (a) => state.names[a] || a;

  function renderLog() {
    const open = state.periods.find((p) => p.end == null);
    el("antStatus").textContent = open
      ? `Now logging: ${nameOf(open.ant)} (${open.ant}) since ${fmtUtc(open.start)} UTC.`
      : "Not logging. Press a button when you switch antennas.";
    el("antStop").disabled = !open;
    el("antOnA").classList.toggle("on", Boolean(open && open.ant === "A"));
    el("antOnB").classList.toggle("on", Boolean(open && open.ant === "B"));
    el("antOnA").setAttribute("aria-pressed", String(Boolean(open && open.ant === "A")));
    el("antOnB").setAttribute("aria-pressed", String(Boolean(open && open.ant === "B")));
    const list = [...state.periods].sort((a, b) => b.start - a.start);
    el("antList").innerHTML = list.length ? list.map((p) =>
      `<li><span class="antdot ${p.ant}"></span><b>${escH(nameOf(p.ant))}</b> (${p.ant}) ` +
      `${fmtUtc(p.start)} to ${p.end == null ? "now" : fmtUtc(p.end)} UTC ` +
      `<button type="button" class="lbtn" data-del="${escH(p.id)}" aria-label="Delete this period (${escH(nameOf(p.ant))}, ${fmtUtc(p.start)})">Delete</button></li>`).join("")
      : '<li class="muted">No periods yet.</li>';
    for (const a of ["A", "B"]) {
      el("antOn" + a).textContent = `Now on ${nameOf(a)} (${a})`;
    }
    const sel = el("antManAnt");
    if (sel) { sel.options[0].textContent = `${nameOf("A")} (A)`; sel.options[1].textContent = `${nameOf("B")} (B)`; }
  }

  function showMsg(text, isErr) {
    const m = el("antMsg");
    m.textContent = text || "";
    m.classList.toggle("err", Boolean(isErr));
  }

  function barRow(label, n, diff, max) {
    if (diff == null) return `<div class="antrow"><span class="antlab">${escH(label)}</span><span class="anttrack"></span><span class="antval muted">no data</span></div>`;
    const w = max > 0 ? Math.min(50, (Math.abs(diff) / max) * 50) : 0;
    const side = diff >= 0 ? `left:50%;width:${w}%` : `left:${50 - w}%;width:${w}%`;
    return `<div class="antrow"><span class="antlab">${escH(label)}</span>` +
      `<span class="anttrack" role="img" aria-label="${escH(label)}: ${escH(diffText(diff, nameOf("A"), nameOf("B")))}, ${n} receiver${n === 1 ? "" : "s"}">` +
      `<i class="${diff >= 0 ? "B" : "A"}" style="${side}"></i></span>` +
      `<span class="antval">${diff > 0 ? "+" : ""}${diff.toFixed(1)} dB <span class="muted">(${n})</span></span></div>`;
  }

  function renderResult(res, note) {
    const A = escH(nameOf("A")), B = escH(nameOf("B"));
    const t = res.totals;
    let h = "";
    if (res.tooFew) {
      h += `<p class="mysum warnbox">Only ${t.matched} receiver${t.matched === 1 ? "" : "s"} heard you on both antennas. ` +
        `That is too few to trust (aim for ${MIN_PAIRS} or more). Conditions change from minute to minute, so swap ` +
        `antennas often (every 10 to 20 minutes) and keep going for a few hours.</p>`;
    }
    if (note) h += `<p class="small muted">${escH(note)}</p>`;
    if (res.bands.length) {
      h += `<div class="scroll"><table class="plan"><thead><tr><th>Band</th><th class="num">Receivers that heard both</th>` +
        `<th class="num">Average SNR ${A}</th><th class="num">Average SNR ${B}</th><th>Result (${B} minus ${A})</th></tr></thead><tbody>` +
        res.bands.map((b) => `<tr><td>${escH(b.label)}</td><td class="num">${b.receivers}${b.few ? ' <span class="muted" title="Fewer than 10">(few)</span>' : ""}</td>` +
          `<td class="num">${b.avgA.toFixed(1)} dB</td><td class="num">${b.avgB.toFixed(1)} dB</td>` +
          `<td>${escH(diffText(b.diff, nameOf("A"), nameOf("B")))}</td></tr>`).join("") +
        `</tbody></table></div>`;
      if (res.overall != null) h += `<p><b>All bands together:</b> ${escH(diffText(res.overall, nameOf("A"), nameOf("B")))} (${t.matched} receiver and band pairs).</p>`;
      const maxS = Math.max(0, ...res.sectors.map((s) => (s.diff == null ? 0 : Math.abs(s.diff))), ...res.distances.map((s) => (s.diff == null ? 0 : Math.abs(s.diff))));
      const max = Math.max(1, Math.ceil(maxS));
      h += `<div class="antcharts"><div><h3>By direction from you</h3><div class="antkey"><span><i class="antdot A"></i>${A} better</span><span><i class="antdot B"></i>${B} better</span></div>` +
        res.sectors.map((s) => barRow(s.name, s.n, s.diff, max)).join("") + `</div>` +
        `<div><h3>By distance</h3><div class="antkey"><span><i class="antdot A"></i>${A} better</span><span><i class="antdot B"></i>${B} better</span></div>` +
        res.distances.map((s) => barRow(s.name, s.n, s.diff, max)).join("") + `</div></div>`;
    } else {
      h += `<p>No receiver heard you on both antennas in these periods yet, so there is nothing to compare.</p>`;
    }
    h += `<p class="small muted">Reports found: ${t.reports}. Heard on ${A}: ${t.spotsA}, on ${B}: ${t.spotsB}. ` +
      `Receivers that heard only ${A}: ${t.onlyA}, only ${B}: ${t.onlyB} (left out of the comparison). ` +
      `Not counted: ${t.unassigned} outside your logged periods or across a swap` +
      `${t.ambiguous ? `, ${t.ambiguous} in overlapping periods` : ""}.</p>`;
    el("antOut").innerHTML = h;
  }

  /** THE ONLY PLACE THAT TALKS TO THE INTERNET: one wspr.live question per Compare click, cached in memory.
   * wspr.live allows browser access, so no Band Watch server is involved. Throws a plain-English message. */
  async function fetchReports(call, from, to) {
    const url = buildQuery(call, from, to);
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < 10 * 60000) return { reports: hit.reports, cached: true };
    if (Date.now() - lastFetch < COOLDOWN_MS) throw new Error("Please wait a few seconds before comparing again. wspr.live is a free service run by volunteers.");
    lastFetch = Date.now();
    let r;
    try { r = await fetch(url, { cache: "no-store" }); } catch { throw new Error("Couldn't reach wspr.live just now. Check your connection and try again in a minute."); }
    if (!r.ok) throw new Error("wspr.live couldn't answer just now. Try again in a few minutes.");
    let json;
    try { json = await r.json(); } catch { throw new Error("wspr.live sent an answer Band Watch couldn't read. Try again later."); }
    const reports = parseRows(json);
    cache.set(url, { at: Date.now(), reports, full: reports.length >= MAX_ROWS });
    return { reports, cached: false, full: reports.length >= MAX_ROWS };
  }

  async function compare() {
    if (busy) return;
    const call = (typeof app !== "undefined" && app.myCall) || "";
    if (!call) { showMsg("Enter your callsign at the top of the page first. Band Watch looks up reports of that callsign.", true); return; }
    const now = Date.now();
    const w = windowOf(state.periods, now);
    if (!w) { showMsg("Log at least one period on antenna A and one on B first.", true); return; }
    if (!state.periods.some((p) => p.ant === "A") || !state.periods.some((p) => p.ant === "B")) { showMsg("You need at least one period for each antenna.", true); return; }
    busy = true; el("antGo").disabled = true; showMsg("Fetching your WSPR reports from wspr.live...");
    try {
      const { reports, cached, full } = await fetchReports(call, w.from, w.to);
      const grid = (typeof $ === "function" && $("grid")) ? $("grid").value : "";
      const me = locToLatLon(grid);
      const res = analyse(reports, state.periods, { now, me });
      const notes = [];
      if (w.clamped) notes.push(`Only the latest ${MAX_DAYS} days are used.`);
      if (full) notes.push(`There were more than ${MAX_ROWS} reports; only the earliest ${MAX_ROWS} are used, so shorten the periods.`);
      if (!me) notes.push("Your locator isn't set, so direction and distance come from wspr.live's own figures for each report.");
      if (cached) notes.push("Using the reports fetched a moment ago.");
      showMsg("");
      renderResult(res, notes.join(" "));
    } catch (e) {
      showMsg(e.message || "Something went wrong. Try again.", true);
    } finally { busy = false; el("antGo").disabled = false; }
  }

  function init() {
    if (!el("secAnt")) return;
    restore();
    for (const a of ["A", "B"]) {
      const inp = el("antName" + a);
      inp.value = nameOf(a);
      inp.addEventListener("input", () => { state.names[a] = inp.value.trim().slice(0, 30) || a; save(); renderLog(); });
    }
    const swap = (ant) => { state.periods = switchTo(state.periods, ant, Date.now()); save(); renderLog(); };
    el("antOnA").addEventListener("click", () => swap("A"));
    el("antOnB").addEventListener("click", () => swap("B"));
    el("antStop").addEventListener("click", () => { state.periods = stopLog(state.periods, Date.now()); save(); renderLog(); });
    el("antList").addEventListener("click", (e) => {
      const id = e.target && e.target.getAttribute && e.target.getAttribute("data-del");
      if (!id) return;
      state.periods = state.periods.filter((p) => p.id !== id); save(); renderLog();
    });
    el("antManAdd").addEventListener("click", () => {
      const ant = el("antManAnt").value, s = parseUtc(el("antManFrom").value), e = parseUtc(el("antManTo").value);
      const bad = checkPeriod(ant, s, e, Date.now());
      el("antManErr").textContent = bad;
      if (bad) return;
      state.periods.push({ id: `p${s}-${Math.random().toString(36).slice(2, 6)}`, ant, start: s, end: e });
      save(); renderLog();
    });
    el("antGo").addEventListener("click", compare);
    renderLog();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  return api;
});
