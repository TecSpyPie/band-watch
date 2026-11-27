/* Satellites: amateur radio satellites over your locator. Which are up now (where to point, the Doppler-corrected
   frequency to listen on and to send on), the next passes, alerts before a pass and dots on the map.
   Orbits come from CelesTrak (celestrak.org, "amateur" group, JSON). This page fetches them itself, at most once every
   2 hours as CelesTrak asks, and keeps them in this browser; after any refusal it waits 2 hours before asking again.
   Orbit maths: satellite.js (MIT), loaded only when this panel starts. Frequencies: AMSAT's published ones. */
"use strict";

const SAT_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=json";
const SAT_LIB = "/js/vendor/satellite.esm.js?v=1.44.2";

/* Frequencies for well-known birds (MHz). down/up: a number, or [low, high] for a linear transponder (passband);
   inverting transponders go down as the uplink goes up. AMSAT's status page says which are working this week. */
const SAT_RADIO = {
  25544: [
    { what: "FM voice (crew contacts)", down: 145.800, up: 145.200, mode: "fm", note: "Region 1 uplink" },
    { what: "APRS digipeater", down: 145.825, up: 145.825, mode: "fm" },
  ],
  27607: [{ what: "FM repeater", down: 436.795, up: 145.850, mode: "fm", note: "67.0 Hz tone" }],
  22825: [{ what: "FM repeater", down: 436.795, up: 145.850, mode: "fm" }],
  7530: [{ what: "Linear, mode B (SSB, CW)", down: [145.925, 145.975], up: [432.125, 432.175], mode: "usb", inverting: true }],
  39444: [
    { what: "Linear (SSB, CW)", down: [145.950, 145.970], up: [435.130, 435.150], mode: "usb", inverting: true },
    { what: "Telemetry beacon", down: 145.935, mode: "usb" },
  ],
  44909: [{ what: "Linear (SSB, CW)", down: [435.610, 435.670], up: [145.935, 145.995], mode: "usb", inverting: true }],
  53109: [{ what: "Digipeater", down: 435.310, up: 435.310, mode: "usb" }],
};
// Shown until you choose your own: the popular FM and linear birds.
const SAT_DEFAULT = [25544, 27607, 22825, 7530, 39444, 44909, 53109];
const SAT_SHORT = { 25544: "ISS", 44909: "RS-44" };
// Callsigns the satellite (or its crew) use on the air, where there are well-known ones.
const SAT_CALLS = { 25544: "NA1SS, RS0ISS, OR4ISS, DP0ISS, IR0ISS (APRS digipeater: RS0ISS, ARISS)" };
// OSCAR prefixes: who looks after the satellite.
const OSCAR_WHO = { AO: "AMSAT-OSCAR", SO: "Saudi-OSCAR", IO: "Italy-OSCAR", PO: "Philippines-OSCAR", FO: "Fuji-OSCAR",
  RS: "Radio Sputnik", JO: "Japan-OSCAR", LO: "LEO-OSCAR", CO: "CubeSat-OSCAR", EO: "Emirates-OSCAR", HO: "Hope-OSCAR",
  TO: "Tevel-OSCAR", QO: "Qatar-OSCAR", XW: "Xi Wang (Hope)", CAS: "Chinese Amateur Satellite" };

const sats = {
  lib: null, gp: [], at: 0, fail: 0, error: "", loading: false,
  picked: SAT_DEFAULT.slice(), minEl: 10, alerts: false, onMap: true,
  recs: new Map(), // NORAD id -> satrec
  passes: [], passesAt: 0, passesFor: "",
  alerted: new Set(), // "id|aos" already told about
  follow: null, // { id, i } the frequency Listen and the radio follow
  lastTune: 0, timer: null,
};

function loadSats() {
  try {
    const s = JSON.parse(load("bw-sats") || "{}");
    if (Array.isArray(s.picked)) sats.picked = s.picked.map(Number).filter((n) => n > 0).slice(0, 30);
    if ([0, 10, 20, 30].includes(s.minEl)) sats.minEl = s.minEl;
    if (typeof s.alerts === "boolean") sats.alerts = s.alerts;
    if (typeof s.onMap === "boolean") sats.onMap = s.onMap;
  } catch { /* defaults */ }
  try {
    const c = JSON.parse(load("bw-satgp") || "null");
    if (c && Array.isArray(c.data)) { sats.gp = c.data; sats.at = Number(c.at) || 0; }
    sats.fail = Number(load("bw-satfail")) || 0;
  } catch { /* nothing saved */ }
}
function saveSats() {
  store("bw-sats", { picked: sats.picked, minEl: sats.minEl, alerts: sats.alerts, onMap: sats.onMap });
}

/** The satellite's short name: "SO-50" from "SAUDISAT 1C (SO-50)", "ISS" for the space station. */
function satName(id) {
  if (SAT_SHORT[id]) return SAT_SHORT[id];
  const g = sats.gp.find((x) => x.NORAD_CAT_ID === id);
  if (!g) return `#${id}`;
  const m = /\(([^)]+)\)\s*$/.exec(g.OBJECT_NAME);
  return m ? m[1] : g.OBJECT_NAME;
}

function satRec(id) {
  if (sats.recs.has(id)) return sats.recs.get(id);
  const g = sats.gp.find((x) => x.NORAD_CAT_ID === id);
  const rec = g && sats.lib ? SatMath.satrecFor(sats.lib, g) : null;
  if (rec) sats.recs.set(id, rec);
  return rec;
}

function satObs() {
  return SatMath.observer(app.home.lat, app.home.lon);
}

/** Ask CelesTrak for new orbits, only if the saved ones are 2 hours old (and not within 2 hours of a refusal). */
async function satFetch() {
  if (!SatMath.shouldFetch(sats.gp.length ? { at: sats.at, data: sats.gp } : null, sats.fail, Date.now())) return;
  sats.loading = true;
  renderSats();
  try {
    const r = await fetch(SAT_URL, { cache: "no-store" });
    if (!r.ok) throw new Error(`CelesTrak answered ${r.status}`);
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) throw new Error("CelesTrak sent no satellites");
    sats.gp = d.filter((x) => x && Number.isFinite(x.NORAD_CAT_ID) && x.OBJECT_NAME);
    sats.at = Date.now();
    sats.recs.clear();
    sats.passesAt = 0;
    sats.error = "";
    store("bw-satgp", { at: sats.at, data: sats.gp });
  } catch (e) {
    sats.fail = Date.now();
    store("bw-satfail", String(sats.fail));
    sats.error = e.message || String(e);
  } finally {
    sats.loading = false;
  }
}

/** Next passes of the chosen satellites, worked out again every 5 minutes or when your locator changes. */
function satPasses(now) {
  const key = `${app.home.lat.toFixed(3)},${app.home.lon.toFixed(3)}|${sats.picked.join(",")}|${sats.minEl}|${sats.at}`;
  if (key === sats.passesFor && now - sats.passesAt < 5 * 60e3) return sats.passes;
  const obs = satObs();
  const all = [];
  for (const id of sats.picked) {
    const rec = satRec(id);
    if (!rec) continue;
    for (const p of SatMath.passes(sats.lib, rec, obs, now, 24, sats.minEl)) all.push({ id, ...p });
  }
  all.sort((a, b) => a.aos - b.aos);
  sats.passes = all;
  sats.passesAt = now;
  sats.passesFor = key;
  return all;
}

const satUtc = (t) => `${new Date(t).toISOString().slice(11, 16)}`;
function satIn(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `in ${m} min`;
  return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
const satMhz = (f) => f.toFixed(3);
const satMid = (f) => (Array.isArray(f) ? (f[0] + f[1]) / 2 : f);
function satBand(f) {
  return Array.isArray(f) ? `${satMhz(f[0])}–${satMhz(f[1])}` : satMhz(f);
}

/** One frequency line for a satellite that's up: what you'd hear and where to send, Doppler included. */
function satRadioLine(id, i, r, rate) {
  const down = satMid(r.down);
  const hear = SatMath.dopplerDown(down, rate);
  const following = sats.follow && sats.follow.id === id && sats.follow.i === i;
  let s = `<div class="satfq"><span class="small">${esc(r.what)}:</span> `;
  s += `<button type="button" class="tune sattune" data-id="${id}" data-i="${i}" title="Tune Listen and your radio here, and keep following the Doppler shift">` +
    `${following ? "▶ " : ""}${satMhz(hear)} MHz</button>`;
  s += ` <span class="small muted">(${satBand(r.down)} ${Array.isArray(r.down) ? "passband" : "down"}`;
  if (r.up != null) {
    const send = SatMath.dopplerUp(satMid(r.up), rate);
    s += `, send ${r.up === r.down ? "on" : "up"} ${Array.isArray(r.up) ? `${satMhz(send)} (middle of ${satBand(r.up)})` : satMhz(send)}`;
  }
  if (r.note) s += `, ${esc(r.note)}`;
  if (r.inverting) s += ", inverting";
  s += ")</span></div>";
  return s;
}

function renderSats() {
  const list = $("satList");
  if (!list) return;
  $("satMinEl").value = String(sats.minEl);
  $("satAlerts").checked = sats.alerts;
  $("satMap").checked = sats.onMap;
  const now = Date.now();
  if (!sats.lib || !sats.gp.length) {
    satSet(list, `<li class="small muted">${sats.loading || !sats.lib ? "Loading satellite orbits…"
      : `No satellite orbits yet${sats.error ? ` (${esc(sats.error)})` : ""}.`}</li>`);
    satSet($("satPasses"), "");
    satNote(now);
    return;
  }
  const obs = satObs();
  const passes = satPasses(now);
  satSet(list, sats.picked.map((id) => {
    const rec = satRec(id);
    const plain = esc(satName(id));
    const name = `<button type="button" class="linkbtn satname satinfo" data-id="${id}" title="Everything about ${plain}">${plain}</button>`;
    const rm = `<button type="button" class="linkbtn satrm" data-id="${id}" title="Take ${plain} off the list" aria-label="Remove ${plain}">✕</button>`;
    if (!rec) return `<li class="satrow">${name}<span class="small muted">No orbit for this one from CelesTrak.</span>${rm}</li>`;
    const l = SatMath.look(sats.lib, rec, new Date(now), obs);
    if (!l) return `<li class="satrow">${name}<span class="small muted">Can't work out where it is (orbit too old?).</span>${rm}</li>`;
    const radio = SAT_RADIO[id] || [];
    if (l.el > 0) {
      const rate = SatMath.rangeRate(sats.lib, rec, now, obs) || 0;
      // This pass, even if it's lower than "Passes above" (it's up now, so when it sets still matters).
      const p = passes.find((x) => x.id === id && x.aos <= now + 60e3 && x.los >= now)
        || SatMath.passes(sats.lib, rec, obs, now, 3, 0)[0];
      const lines = radio.map((r, i) => satRadioLine(id, i, r, rate)).join("");
      return `<li class="satrow up">${name}` +
        `<span class="satnow"><b>Up now</b>: point ${Math.round(l.az)}° ${SatMath.compass(l.az)}, ${Math.round(l.el)}° up, ` +
        `${(Math.round(l.range / 10) * 10).toLocaleString()} km away, ${rate < 0 ? "coming towards you" : "going away"}` +
        `${p && p.los ? `. Sets ${satIn(p.los - now)} (${satUtc(p.los)} UTC) in the ${SatMath.compass(p.losAz)}` : ""}.</span>${rm}` +
        `${lines ? `<div class="satfqs">${lines}</div>` : ""}</li>`;
    }
    const next = passes.find((x) => x.id === id && x.aos > now);
    const when = next
      ? `Next pass ${satIn(next.aos - now)}, ${satUtc(next.aos)} UTC, up to ${Math.round(next.maxEl)}°, ${SatMath.compass(next.aosAz)} to ${SatMath.compass(next.losAz)}`
      : `No pass above ${sats.minEl}° in the next 24 hours`;
    const fq = radio.length ? ` · ${radio.map((r) => `${esc(r.what)} ${satBand(r.down)}`).join(", ")} MHz` : "";
    return `<li class="satrow">${name}<span class="small">${when}<span class="muted">${fq}</span></span>${rm}</li>`;
  }).join("") || `<li class="small muted">No satellites chosen. Add one from the list above.</li>`);

  satSet($("satPasses"), passes.filter((p) => p.los > now).slice(0, 12).map((p) =>
    `<tr${p.aos <= now ? ' class="satup"' : ""}><td><button type="button" class="linkbtn satinfo" data-id="${p.id}">${esc(satName(p.id))}</button></td><td>${p.aos <= now ? "now" : `${satUtc(p.aos)} <span class="muted small">${satIn(p.aos - now)}</span>`}</td>` +
    `<td>${Math.round(p.maxEl)}°</td><td>${SatMath.compass(p.aosAz)} → ${SatMath.compass(p.losAz)}</td>` +
    `<td>${Math.max(1, Math.round((p.los - p.aos) / 60000))} min</td></tr>`).join("") ||
    `<tr><td colspan="5" class="small muted">No passes above ${sats.minEl}° in the next 24 hours.</td></tr>`);
  satNote(now);
}

/** Only touch the page when something changed, so a button isn't swapped out from under a click. */
function satSet(el, html) {
  if (el && el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
}

function satNote(now) {
  const note = $("satNote");
  if (!note) return;
  const age = sats.at ? Math.round((now - sats.at) / 60000) : null;
  let s = sats.error ? `Couldn't get new orbits from CelesTrak (${sats.error}); trying again in 2 hours. ` : "";
  if (age != null) s += `Orbits from CelesTrak, ${age < 1 ? "just now" : age < 120 ? `${age} min ago` : `${Math.round(age / 60)} hours ago`}. `;
  s += "Click a frequency to tune Listen and your radio there; it follows the Doppler shift until you click it again.";
  note.textContent = s;
}

/** A toast 5 minutes before each pass (once per pass), if you asked for them. */
function satAlerts(now) {
  if (!sats.alerts) return;
  for (const p of sats.passes) {
    const key = `${p.id}|${Math.round(p.aos / 60000)}`;
    if (p.upAtStart || sats.alerted.has(key)) continue;
    const lead = p.aos - now;
    if (lead > 0 && lead <= 5 * 60e3) {
      sats.alerted.add(key);
      showToast(`${satName(p.id)} rises ${satIn(lead)}`,
        `${satUtc(p.aos)} UTC in the ${SatMath.compass(p.aosAz)}, up to ${Math.round(p.maxEl)}°, for ${Math.round((p.los - p.aos) / 60000)} min`);
    }
  }
}

/** Keep Listen (and the radio, through Listen) on the Doppler-corrected downlink while you follow a satellite. */
function satFollow(now) {
  const f = sats.follow;
  if (!f) return;
  const rec = satRec(f.id);
  const r = (SAT_RADIO[f.id] || [])[f.i];
  const obs = satObs();
  const l = rec && SatMath.look(sats.lib, rec, new Date(now), obs);
  if (!r || !l || l.el <= 0) { sats.follow = null; return; }
  if (now - sats.lastTune < 2000) return;
  const rate = SatMath.rangeRate(sats.lib, rec, now, obs) || 0;
  const kHz = Math.round(SatMath.dopplerDown(satMid(r.down), rate) * 1e4) / 10;
  sats.lastTune = now;
  if (typeof tuneTo === "function" && (typeof listen === "undefined" || Math.abs(listen.kHz - kHz) >= 0.1)) tuneTo(kHz, r.mode, { quiet: true });
}

/** Chosen satellites on the world map: a purple dot with its name. */
function satMapSvg(X, Y) {
  if (!sats.onMap || !sats.lib || !sats.gp.length) return "";
  const now = new Date();
  let svg = "";
  for (const id of sats.picked) {
    const rec = satRec(id);
    const l = rec && SatMath.look(sats.lib, rec, now, satObs());
    if (!l) continue;
    const cx = X(l.lon).toFixed(1), cy = Y(l.lat).toFixed(1);
    svg += `<g class="satmark${l.el > 0 ? " up" : ""}" data-sat="${id}" role="button" tabindex="0" aria-label="${esc(satName(id))}: click for details">` +
      `<circle class="sathit" cx="${cx}" cy="${cy}" r="6"/><circle cx="${cx}" cy="${cy}" r="2.2"/>` +
      `<text x="${(X(l.lon) + 3).toFixed(1)}" y="${(Y(l.lat) + 1.5).toFixed(1)}">${esc(satName(id))}</text>` +
      `<title>${esc(`${satName(id)}: ${l.el > 0 ? `up now, ${Math.round(l.el)}°` : "below your horizon"}, ${Math.round(l.height)} km high. Click for details.`)}</title></g>`;
  }
  return svg;
}

/** The same satellites as plain points, for the spots map (Map view): [{ id, name, lat, lon, up, tip }]. */
function satMapPoints() {
  if (!sats.onMap || !sats.lib || !sats.gp.length) return [];
  const now = new Date();
  const out = [];
  for (const id of sats.picked) {
    const rec = satRec(id);
    const l = rec && SatMath.look(sats.lib, rec, now, satObs());
    if (!l) continue;
    out.push({ id, name: satName(id), lat: l.lat, lon: l.lon, up: l.el > 0,
      tip: `${l.el > 0 ? `up now, ${Math.round(l.el)}° above your horizon` : "below your horizon"}, ${Math.round(l.height)} km high` });
  }
  return out;
}

/* ---------- The card you get by clicking a satellite (in the list, the passes table or on the map) ---------- */

const satCard = { id: null, timer: null, passes: [], passesAt: 0 };

function satGp(id) {
  return sats.gp.find((x) => x.NORAD_CAT_ID === id) || null;
}

/** "AO-7" -> "AMSAT-OSCAR 7"; null if the name isn't an OSCAR-style number. */
function satOscar(short) {
  const m = /^([A-Z]{2,3})-(\d+)$/.exec(short);
  if (!m || !OSCAR_WHO[m[1]]) return null;
  return `${OSCAR_WHO[m[1]]} ${m[2]}`;
}

function openSatCard(id) {
  if (!sats.lib || !satGp(id)) return;
  satCard.id = id;
  satCard.passesAt = 0;
  for (const k of ["siNow", "siOrbit", "siSky", "siSkyNote", "siRadio", "siPasses"]) delete $(k).dataset.html;
  renderSatCard();
  const d = $("satInfo");
  if (!d.open) d.showModal();
  clearInterval(satCard.timer);
  satCard.timer = setInterval(renderSatCard, 1000);
}

function closeSatCard() {
  clearInterval(satCard.timer);
  satCard.timer = null;
  satCard.id = null;
}

const satDay = (t) => {
  const d = new Date(t), today = new Date();
  if (d.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)) return "Today";
  if (d.toISOString().slice(0, 10) === new Date(today.getTime() + 864e5).toISOString().slice(0, 10)) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
};
const satKm = (km) => `${Math.round(km).toLocaleString()} km`;

/** The round sky chart: horizon at the edge, overhead in the middle, north at the top; the pass's path on it. */
function satSkySvg(track, now, upNow) {
  const R = 100;
  let s = `<circle class="horizon" r="${R}"/>`;
  for (const el of [30, 60]) s += `<circle class="ring" r="${(R * (90 - el)) / 90}"/>`;
  s += `<line class="ring" x1="${-R}" y1="0" x2="${R}" y2="0"/><line class="ring" x1="0" y1="${-R}" x2="0" y2="${R}"/>`;
  s += `<text class="lbl" x="0" y="${-R - 9}">N</text><text class="lbl" x="${R + 9}" y="0">E</text>` +
    `<text class="lbl" x="0" y="${R + 9}">S</text><text class="lbl" x="${-R - 9}" y="0">W</text>` +
    `<text class="lbl" x="4" y="${(-R * 60) / 90 + 6}" style="text-anchor:start;font-size:8px">30°</text>` +
    `<text class="lbl" x="4" y="${(-R * 30) / 90 + 6}" style="text-anchor:start;font-size:8px">60°</text>`;
  if (track.length > 1) {
    const pts = (list) => list.map((p) => { const q = SatMath.skyXY(p.az, p.el, R); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(" ");
    const gone = track.filter((p) => p.t <= now), ahead = track.filter((p) => p.t >= now);
    if (upNow && gone.length > 1) s += `<polyline class="track gone" points="${pts(gone)}"/>`;
    s += `<polyline class="track" points="${pts(upNow ? ahead : track)}"/>`;
    const a = SatMath.skyXY(track[0].az, 0, R), b = SatMath.skyXY(track[track.length - 1].az, 0, R);
    const tl = (q, t) => `<text class="tlbl" x="${(q.x * 1.0).toFixed(1)}" y="${(q.y + (q.y < 0 ? -7 : 12)).toFixed(1)}" style="text-anchor:${q.x > 30 ? "end" : q.x < -30 ? "start" : "middle"}">${satUtc(t)}</text>`;
    s += `<circle class="end" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="3.5"/>${tl(a, track[0].t)}`;
    s += `<rect class="end" x="${(b.x - 3).toFixed(1)}" y="${(b.y - 3).toFixed(1)}" width="6" height="6"/>${tl(b, track[track.length - 1].t)}`;
  }
  if (upNow) {
    const cur = track.find((p) => p.t >= now) || track[track.length - 1];
    if (cur) { const q = SatMath.skyXY(cur.az, cur.el, R); s += `<circle class="now" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="6"/>`; }
  }
  return s;
}

function renderSatCard() {
  const id = satCard.id;
  if (id == null || !sats.lib) return;
  const g = satGp(id);
  const rec = satRec(id);
  const now = Date.now();
  const obs = satObs();
  const short = satName(id);
  const o = g ? SatMath.orbitInfo(g) : null;
  $("siTitle").textContent = short;
  $("siSub").textContent = g && g.OBJECT_NAME !== short ? g.OBJECT_NAME : "";

  const l = rec && SatMath.look(sats.lib, rec, new Date(now), obs);
  if (!l) {
    satSet($("siNow"), `<p class="muted">HamShack can't work out where ${esc(short)} is from the orbit CelesTrak has (it may have come down, or the numbers are too old).</p>`);
    return;
  }
  if (now - satCard.passesAt > 60e3) {
    satCard.passes = SatMath.passes(sats.lib, rec, obs, now - 30 * 60e3, 72, 0);
    satCard.passesAt = now;
  }
  const passes = satCard.passes.filter((p) => p.los > now);
  const up = l.el > 0;
  const rate = up ? SatMath.rangeRate(sats.lib, rec, now, obs) || 0 : 0;
  const reach = SatMath.footprintKm(l.height);
  const dist = Math.round(distanceKm(app.home.lat, app.home.lon, l.lat, l.lon) / 10) * 10;
  const ns = (v, p, n) => `${Math.abs(v).toFixed(1)}° ${v >= 0 ? p : n}`;

  // Right now
  let now$ = `<dl>`;
  now$ += `<dt>Where</dt><dd><b class="${up ? "warm" : ""}">${up ? "Up in your sky" : "Below your horizon"}</b></dd>`;
  if (up) {
    now$ += `<dt>Point</dt><dd>${Math.round(l.az)}° ${SatMath.compass(l.az)}, ${Math.round(l.el)}° up</dd>`;
    now$ += `<dt>Distance</dt><dd>${satKm(Math.round(l.range / 10) * 10)}, ${rate < 0 ? "coming towards you" : "going away"} at ${Math.abs(rate).toFixed(1)} km/s</dd>`;
  } else {
    now$ += `<dt>Direction</dt><dd>${Math.round(l.az)}° ${SatMath.compass(l.az)}, ${Math.round(-l.el)}° below the horizon</dd>`;
  }
  now$ += `<dt>Over</dt><dd>${ns(l.lat, "N", "S")}, ${ns(l.lon, "E", "W")} (${latLonToLocator(l.lat, l.lon).slice(0, 4)}), ${satKm(dist)} from you</dd>`;
  now$ += `<dt>Height</dt><dd>${satKm(l.height)}</dd>`;
  if (l.speed) now$ += `<dt>Speed</dt><dd>${l.speed.toFixed(2)} km/s (${Math.round(l.speed * 3600).toLocaleString()} km/h)</dd>`;
  now$ += `<dt>Reach</dt><dd>It can hear stations up to ${satKm(Math.round(reach / 10) * 10)} from the point below it, so stations about ${satKm(Math.round((reach * 2) / 100) * 100)} apart can work each other through it</dd>`;
  now$ += `</dl>`;
  satSet($("siNow"), now$);

  // Identifiers and orbit
  let orb = `<dl>`;
  orb += `<dt>Name</dt><dd>${esc(short)}${satOscar(short) ? ` (${esc(satOscar(short))})` : ""}</dd>`;
  if (g && g.OBJECT_NAME !== short) orb += `<dt>Full name</dt><dd>${esc(g.OBJECT_NAME)}</dd>`;
  orb += `<dt>NORAD number</dt><dd>${id}</dd>`;
  if (g && g.OBJECT_ID) orb += `<dt>International ID</dt><dd>${esc(g.OBJECT_ID)}${o && o.launched ? ` (launched ${o.launched})` : ""}</dd>`;
  if (SAT_CALLS[id]) orb += `<dt>Callsigns</dt><dd>${esc(SAT_CALLS[id])}</dd>`;
  if (o) {
    const flat = Math.abs(o.apogeeKm - o.perigeeKm) < 40;
    orb += `<dt>One lap</dt><dd>${Math.round(o.periodMin)} min (${(1440 / o.periodMin).toFixed(1)} laps a day)</dd>`;
    orb += `<dt>Orbit height</dt><dd>${flat ? `about ${satKm(Math.round((o.apogeeKm + o.perigeeKm) / 20) * 10)}` : `${satKm(o.perigeeKm)} to ${satKm(o.apogeeKm)}`}</dd>`;
    orb += `<dt>Tilt</dt><dd>${o.inclination.toFixed(1)}°: it goes as far as ${Math.round(o.inclination > 90 ? 180 - o.inclination : o.inclination)}° north and south${o.inclination > 95 ? " (a polar orbit, so it passes everywhere)" : ""}</dd>`;
    if (Number.isFinite(o.epoch)) {
      const h = Math.round((now - o.epoch) / 3600e3);
      orb += `<dt>Orbit data</dt><dd>${h < 1 ? "under an hour" : h < 48 ? `${h} hours` : `${Math.round(h / 24)} days`} old${h > 24 * 7 ? " (old, so times may be a few minutes out)" : ""}</dd>`;
    }
  }
  orb += `</dl>`;
  satSet($("siOrbit"), orb);

  // Sky chart: this pass if it's up, otherwise the next one above "Passes above" (or simply the next one)
  const p = up ? passes[0] : passes.find((q) => q.maxEl >= sats.minEl) || passes[0];
  const track = p ? SatMath.skyTrack(sats.lib, rec, obs, p.aos, p.los, Math.max(5e3, Math.round((p.los - p.aos) / 120))) : [];
  satSet($("siSky"), satSkySvg(track, now, up));
  satSet($("siSkyNote"), p
    ? (up
      ? `<b>This pass</b>: rose ${satUtc(p.aos)} in the ${SatMath.compass(p.aosAz)}, highest ${Math.round(p.maxEl)}° at ${satUtc(p.tca)}, sets ${satUtc(p.los)} (${satIn(p.los - now)}) in the ${SatMath.compass(p.losAz)}. The orange dot is where it is now.`
      : `<b>Next pass</b> ${satIn(p.aos - now)}: rises ${satUtc(p.aos)} UTC in the ${SatMath.compass(p.aosAz)} (●), highest ${Math.round(p.maxEl)}° at ${satUtc(p.tca)}, sets ${satUtc(p.los)} in the ${SatMath.compass(p.losAz)} (■).`)
    : "No pass over your locator in the next 3 days.");

  // Radio
  const radio = SAT_RADIO[id] || [];
  satSet($("siRadio"), radio.length
    ? radio.map((r, i) => (up ? satRadioLine(id, i, r, rate)
      : `<div class="satfq small"><b>${esc(r.what)}</b>: listen ${satBand(r.down)} MHz${r.up != null ? `, send ${satBand(r.up)} MHz` : ""}` +
        `${r.note ? `, ${esc(r.note)}` : ""}${r.inverting ? ", inverting" : ""} (${esc(String(r.mode).toUpperCase())})</div>`)).join("") +
      (up ? `<p class="small muted">Click a frequency to tune there and follow the Doppler shift.</p>` : `<p class="small muted">When it's up, the frequencies here include the Doppler shift, and you can click one to tune there.</p>`)
    : `<p class="small muted">HamShack doesn't have frequencies for this one. AMSAT's status page and the satellite's own website list them.</p>`);

  // Next passes
  satSet($("siPasses"), passes.slice(0, 8).map((q) =>
    `<tr${q.aos <= now ? ' class="satup"' : ""}><td>${satDay(q.aos)}</td><td>${q.aos <= now ? "now" : `${satUtc(q.aos)} <span class="muted small">${satIn(q.aos - now)}</span>`}</td>` +
    `<td>${Math.round(q.maxEl)}°</td><td>${SatMath.compass(q.aosAz)} → ${SatMath.compass(q.losAz)}</td><td>${Math.max(1, Math.round((q.los - q.aos) / 60000))} min</td></tr>`).join("") ||
    `<tr><td colspan="5" class="small muted">No passes in the next 3 days.</td></tr>`);

  satSet($("siFoot"), `More: <a href="https://www.amsat.org/status/" target="_blank" rel="noopener noreferrer">AMSAT status</a> · ` +
    `<a href="https://www.n2yo.com/satellite/?s=${id}" target="_blank" rel="noopener noreferrer">N2YO live map</a> · ` +
    `<a href="https://celestrak.org/satcat/table-satcat.php?CATNR=${id}" target="_blank" rel="noopener noreferrer">CelesTrak catalogue</a>`);
}

/** Start or stop following a satellite's Doppler-corrected frequency. */
function satToggleFollow(id, i) {
  if (sats.follow && sats.follow.id === id && sats.follow.i === i) sats.follow = null;
  else { sats.follow = { id, i }; sats.lastTune = 0; satFollow(Date.now()); }
  renderSats();
  if (satCard.id != null) renderSatCard();
}

function satFillAdd() {
  const add = $("satAdd");
  const others = sats.gp.filter((g) => !sats.picked.includes(g.NORAD_CAT_ID))
    .map((g) => ({ id: g.NORAD_CAT_ID, name: satName(g.NORAD_CAT_ID) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  add.innerHTML = `<option value="">Add a satellite…</option>${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join("")}`;
}

let satTick = 0;
function satLoop() {
  if (!sats.lib) return;
  const now = Date.now();
  satFollow(now);
  if (document.hidden) return;
  renderSats();
  satAlerts(now);
  if (sats.onMap && ++satTick % 10 === 0 && typeof drawMap === "function") drawMap();
}

async function setupSats() {
  if (!$("secSats")) return;
  loadSats();
  $("satMinEl").addEventListener("change", () => { sats.minEl = Number($("satMinEl").value) || 0; saveSats(); renderSats(); });
  $("satAlerts").addEventListener("change", () => { sats.alerts = $("satAlerts").checked; saveSats(); });
  $("satMap").addEventListener("change", () => { sats.onMap = $("satMap").checked; saveSats(); if (typeof drawMap === "function") drawMap(); });
  $("satAdd").addEventListener("change", () => {
    const id = Number($("satAdd").value);
    if (id && !sats.picked.includes(id)) { sats.picked.push(id); saveSats(); satFillAdd(); renderSats(); drawMap(); }
  });
  $("satList").addEventListener("click", (e) => {
    const rm = e.target.closest(".satrm");
    if (rm) {
      const id = Number(rm.dataset.id);
      sats.picked = sats.picked.filter((x) => x !== id);
      if (sats.follow && sats.follow.id === id) sats.follow = null;
      saveSats(); satFillAdd(); renderSats(); drawMap();
      return;
    }
    const b = e.target.closest(".sattune");
    if (b) { satToggleFollow(Number(b.dataset.id), Number(b.dataset.i)); return; }
    const n = e.target.closest(".satinfo");
    if (n) openSatCard(Number(n.dataset.id));
  });
  $("satPasses").addEventListener("click", (e) => {
    const n = e.target.closest(".satinfo");
    if (n) openSatCard(Number(n.dataset.id));
  });
  // A satellite's dot on the world map opens its card too (click, or Enter/Space on the keyboard).
  const mapOpen = (e) => {
    const m = e.target.closest && e.target.closest("[data-sat]");
    if (!m) return;
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    openSatCard(Number(m.dataset.sat));
  };
  $("map").addEventListener("click", mapOpen);
  $("map").addEventListener("keydown", mapOpen);
  $("siRadio").addEventListener("click", (e) => {
    const b = e.target.closest(".sattune");
    if (b) satToggleFollow(Number(b.dataset.id), Number(b.dataset.i));
  });
  $("siClose").addEventListener("click", () => $("satInfo").close());
  $("satInfo").addEventListener("close", closeSatCard);
  renderSats();
  try {
    sats.lib = await import(SAT_LIB);
  } catch (e) {
    sats.error = `the orbit maths didn't load (${e.message || e})`;
    satSet($("satList"), `<li class="small muted">Satellites aren't available: ${esc(sats.error)}.</li>`);
    return;
  }
  await satFetch();
  satFillAdd();
  renderSats();
  if (typeof drawMap === "function") drawMap();
  sats.timer = setInterval(satLoop, 1000);
  // New orbits every couple of hours, for a page left open all day.
  setInterval(() => { if (!document.hidden) satFetch().then(() => { satFillAdd(); renderSats(); }); }, 10 * 60e3);
}
