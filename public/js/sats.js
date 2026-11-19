/* Satellites: amateur radio satellites over your locator. Which are up now (where to point, the Doppler-corrected
   frequency to listen on and to send on), the next passes, alerts before a pass and dots on the map.
   Orbits come from CelesTrak (celestrak.org, "amateur" group, JSON). This page fetches them itself, at most once every
   2 hours as CelesTrak asks, and keeps them in this browser; after any refusal it waits 2 hours before asking again.
   Orbit maths: satellite.js (MIT), loaded only when this panel starts. Frequencies: AMSAT's published ones. */
"use strict";

const SAT_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=amateur&FORMAT=json";
const SAT_LIB = "/js/vendor/satellite.esm.js?v=1.28.0";

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
    const name = esc(satName(id));
    const rm = `<button type="button" class="linkbtn satrm" data-id="${id}" title="Take ${name} off the list" aria-label="Remove ${name}">✕</button>`;
    if (!rec) return `<li class="satrow"><span class="satname">${name}</span><span class="small muted">No orbit for this one from CelesTrak.</span>${rm}</li>`;
    const l = SatMath.look(sats.lib, rec, new Date(now), obs);
    if (!l) return `<li class="satrow"><span class="satname">${name}</span><span class="small muted">Can't work out where it is (orbit too old?).</span>${rm}</li>`;
    const radio = SAT_RADIO[id] || [];
    if (l.el > 0) {
      const rate = SatMath.rangeRate(sats.lib, rec, now, obs) || 0;
      // This pass, even if it's lower than "Passes above" (it's up now, so when it sets still matters).
      const p = passes.find((x) => x.id === id && x.aos <= now + 60e3 && x.los >= now)
        || SatMath.passes(sats.lib, rec, obs, now, 3, 0)[0];
      const lines = radio.map((r, i) => satRadioLine(id, i, r, rate)).join("");
      return `<li class="satrow up"><span class="satname">${name}</span>` +
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
    return `<li class="satrow"><span class="satname">${name}</span><span class="small">${when}<span class="muted">${fq}</span></span>${rm}</li>`;
  }).join("") || `<li class="small muted">No satellites chosen. Add one from the list above.</li>`);

  satSet($("satPasses"), passes.filter((p) => p.los > now).slice(0, 12).map((p) =>
    `<tr${p.aos <= now ? ' class="satup"' : ""}><td>${esc(satName(p.id))}</td><td>${p.aos <= now ? "now" : `${satUtc(p.aos)} <span class="muted small">${satIn(p.aos - now)}</span>`}</td>` +
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
    svg += `<g class="satmark${l.el > 0 ? " up" : ""}"><circle cx="${cx}" cy="${cy}" r="2.2"/>` +
      `<text x="${(X(l.lon) + 3).toFixed(1)}" y="${(Y(l.lat) + 1.5).toFixed(1)}">${esc(satName(id))}</text>` +
      `<title>${esc(`${satName(id)}: ${l.el > 0 ? `up now, ${Math.round(l.el)}°` : "below your horizon"}, ${Math.round(l.height)} km high`)}</title></g>`;
  }
  return svg;
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
    if (b) {
      const id = Number(b.dataset.id), i = Number(b.dataset.i);
      if (sats.follow && sats.follow.id === id && sats.follow.i === i) { sats.follow = null; renderSats(); return; }
      sats.follow = { id, i };
      sats.lastTune = 0;
      satFollow(Date.now());
      renderSats();
    }
  });
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
