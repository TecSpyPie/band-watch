/* Band Watch by M3vrv: constants, helpers, state, data loading and the main render. */
"use strict";

/* ===================== Constants ===================== */

const BANDS = ["160", "80", "60", "40", "30", "20", "17", "15", "12", "10", "6"];

// Band limits used to sort live spots into bands (widest of the three ITU regions).
const BAND_LIMITS = {
  160: [1.8, 2], 80: [3.5, 4], 60: [5.25, 5.45], 40: [7, 7.3], 30: [10.1, 10.15], 20: [14, 14.35],
  17: [18.068, 18.168], 15: [21, 21.45], 12: [24.89, 24.99], 10: [28, 29.7], 6: [50, 54],
};

// Scope span "Full band" and the band plan strip come from the UK band plan (bandplan.js), in MHz.
const EDGE = Object.fromEntries(BANDS.map((b) => [b, [BANDPLAN[b].lo / 1000, BANDPLAN[b].hi / 1000]]));
const SEG = Object.fromEntries(BANDS.map((b) => [b, BANDPLAN[b].segs.map(([lo, hi, type]) => [type, lo / 1000, hi / 1000])]));
const DIGI = {
  160: [1.835, 1.845], 80: [3.565, 3.58], 60: [5.354, 5.358], 40: [7.035, 7.08], 30: [10.13, 10.145], 20: [14.07, 14.1],
  17: [18.095, 18.111], 15: [21.07, 21.15], 12: [24.91, 24.93], 10: [28.07, 28.19], 6: [50.29, 50.33],
};
const FT8 = { 160: 1.84, 80: 3.573, 60: 5.357, 40: 7.074, 30: 10.136, 20: 14.074, 17: 18.1, 15: 21.074, 12: 24.915, 10: 28.074, 6: 50.313 };
const FT4 = { 80: 3.575, 40: 7.0475, 30: 10.14, 20: 14.08, 17: 18.104, 15: 21.14, 12: 24.919, 10: 28.18, 6: 50.318 };
const WSPR = { 160: 1.8366, 80: 3.5686, 60: 5.2872, 40: 7.0386, 30: 10.1387, 20: 14.0956, 17: 18.1046, 15: 21.0946, 12: 24.9246, 10: 28.1246, 6: 50.293 };
// Occupied bandwidth per mode, in MHz.
const BANDWIDTH = {
  FT8: 5e-5, FT4: 9e-5, WSPR: 6e-6, FST4W: 6e-6, FST4: 3e-5, JT65: 1.8e-4, JT9: 1.6e-5, Q65: 2e-4, MSK144: 2.4e-3,
  CW: 1.2e-4, JS8: 5e-5, PSK: 6e-5, RTTY: 2.5e-4, OLIVIA: 1e-3, CONTESTIA: 1e-3, MFSK: 3e-4, SSTV: 2.5e-3, SSB: 2.7e-3, DV: 1.25e-3, AM: 6e-3, FM: 1.2e-2,
};
const SPANS = [["full", "Full band"], ["cw", "CW"], ["digi", "Digital"], ["ft8", "FT8 3 kHz"]];

const WINDOW_MIN = 30; // spots older than this are ignored
const OPEN_AT = 15;
const MARGINAL_AT = 5;
const REFRESH_MS = 60e3;
const STALE_MS = 15 * 60e3; // older spot data than this is not used for alerts

const STATUS_LABEL = { open: "Open", marg: "Marginal", shut: "Closed", none: "No data" };
const STATUS_RANK = { none: -1, shut: 0, marg: 1, open: 2 };
const RAD = Math.PI / 180;

/* ===================== Small helpers ===================== */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const ago = (m) => (m < 1 ? "just now" : `${m} min ago`);
const kmText = (d) => `${d.toLocaleString()} km`;

/** The home callsign inside a portable call: "EA8/G4ABC/P" -> "G4ABC". */
function baseCall(call) {
  const parts = String(call).toUpperCase().split("/").filter(Boolean);
  return parts.filter((x) => /\d/.test(x) && x.length > 2).sort((a, b) => b.length - a.length)[0] || parts[0] || "";
}
/** A callsign as a link to its QRZ page. A plain click opens the station window instead. */
function callLink(call) {
  const base = baseCall(call);
  return `<a class="call" href="https://www.qrz.com/db/${encodeURIComponent(base)}" target="_blank" rel="noopener noreferrer" data-call="${esc(base)}">${esc(call)}</a>`;
}

function store(key, value) {
  try { localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function load(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function gridToLatLon(g) {
  g = String(g).toUpperCase();
  if (!/^[A-R]{2}\d{2}([A-X]{2})?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (5 / 60) + 2.5 / 60;
    lat += (g.charCodeAt(5) - 65) * (2.5 / 60) + 1.25 / 60;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat, lon };
}

/** Latitude/longitude -> 6-character Maidenhead locator, e.g. IO93fa. */
function latLonToLocator(lat, lon) {
  let x = Math.min(359.9999, Math.max(0, lon + 180));
  let y = Math.min(179.9999, Math.max(0, lat + 90));
  const A = Math.floor(x / 20), B = Math.floor(y / 10);
  x -= A * 20; y -= B * 10;
  const c = Math.floor(x / 2), d = Math.floor(y);
  x -= c * 2; y -= d;
  const e = Math.floor(x * 12), f = Math.floor(y * 24);
  return String.fromCharCode(65 + A, 65 + B) + c + d + String.fromCharCode(97 + e, 97 + f);
}

/** Any locator (4, 6, 8+ characters, any case) -> the 6- or 4-character form Band Watch uses, or "". */
function normaliseLocator(raw) {
  const g = String(raw || "").trim();
  const m6 = g.match(/^([A-Ra-r]{2})(\d{2})([A-Xa-x]{2})/);
  if (m6) return m6[1].toUpperCase() + m6[2] + m6[3].toLowerCase();
  const m4 = g.match(/^([A-Ra-r]{2})(\d{2})/);
  return m4 ? m4[1].toUpperCase() + m4[2] : "";
}

function distanceKm(lat1, lon1, lat2, lon2) {
  const h = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

function subsolarPoint(t) {
  const d = new Date(t);
  const dayOfYear = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const dec = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  const hours = d.getUTCHours() + d.getUTCMinutes() / 60;
  return { dec, lon: -(hours - 12) * 15 };
}

/** Small seeded PRNG (mulberry32), used only for the scope's noise floor. */
function seeded(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ===================== State ===================== */

const app = {
  home: { lat: 53.5, lon: -1 },
  sel: null, // selected band
  userPicked: false, // true once the user has chosen a band
  bands: [], // [{ b, sp: [...], far }]
  solar: null, // { sfi, kp }
  spots: null, // raw spots from the server, or null if none loaded yet
  spotsAt: 0,
  spotsStale: false,
  feedError: false,
  span: "digi",
  cursor: null, // scope cursor, 0..1
  pinned: null, // where the scope was last clicked, 0..1
  zoom: null, // { b, lo, hi } when the scope is zoomed in
  square: "", // 4-character grid square the spots belong to
  pairs: [], // every live path in the window that passes the mode filter
  allPairs: [], // every live path in the window, whatever its mode
  desktop: false, // true when running as BandWatch.exe on this PC
  myCall: "", // the user's own callsign, if they entered one
};

/* ===================== Data ===================== */

const grid4 = () => $("grid").value.trim().toUpperCase().slice(0, 4);

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function refresh() {
  const grid = grid4();
  const [solar, spots] = await Promise.allSettled([getJson("/api/solar"), getJson(`/api/spots?grid=${encodeURIComponent(grid)}`)]);
  if (grid !== grid4()) return; // grid changed while we were waiting

  if (solar.status === "fulfilled" && Number.isFinite(solar.value.sfi)) app.solar = solar.value;

  if (spots.status === "fulfilled" && Array.isArray(spots.value.spots)) {
    markFreshSpots(spots.value.spots);
    app.spots = spots.value.spots;
    app.spotsAt = spots.value.at;
    app.spotsStale = Boolean(spots.value.stale);
    app.feedError = false;
  } else {
    app.feedError = true;
  }

  renderBanner();
  render();
  if (typeof checkWanted === "function") checkWanted();
  if (app.spots && !app.feedError && !app.spotsStale && Date.now() - app.spotsAt < STALE_MS) monitorTick();
  else drawMonitor();
}

const bandOf = (fq) => BANDS.find((b) => fq >= BAND_LIMITS[b][0] && fq <= BAND_LIMITS[b][1]) || null;

function buildBands() {
  const now = Date.now();
  // Every path in the window (one remote station can be heard by several local stations).
  app.allPairs = (app.spots || [])
    .map((p) => ({
      ...p,
      band: bandOf(p.fq),
      mk: modeKey(p.m),
      d: Math.round(distanceKm(app.home.lat, app.home.lon, p.lat, p.lon)),
      t: Math.max(0, Math.floor((now - p.ts) / 6e4)),
    }))
    .filter((p) => p.band && p.t < WINDOW_MIN);
  app.pairs = app.allPairs.filter((p) => modeOn(p.mk));

  app.bands = BANDS.map((b) => {
    if (!app.spots) return { b, sp: [], far: 0, none: true };
    // Band status counts each remote station once per band: keep its newest path.
    const newest = new Map();
    for (const p of app.pairs) {
      if (p.band !== b) continue;
      const k = `${p.c}|${Math.floor(p.fq)}`;
      const prev = newest.get(k);
      if (!prev || p.ts > prev.ts) newest.set(k, p);
    }
    const sp = [...newest.values()].sort((a, c) => a.t - c.t);
    return { b, sp, far: sp.reduce((m, p) => Math.max(m, p.d), 0) };
  });
}

function status(band) {
  if (band.none) return "none";
  const n = band.sp.length;
  return n >= OPEN_AT ? "open" : n >= MARGINAL_AT ? "marg" : "shut";
}

/* ===================== Main render ===================== */

function renderBanner() {
  const el = $("banner");
  if (!app.spots) {
    el.className = "banner err";
    el.textContent = app.feedError
      ? "Live spots could not be loaded from PSK Reporter. Band Watch will keep trying every minute."
      : "Loading live data…";
    return;
  }
  const age = Math.max(0, Math.round((Date.now() - app.spotsAt) / 6e4));
  const problem = app.feedError || app.spotsStale;
  el.className = problem ? "banner err" : "banner live";
  el.textContent = `Live spots for grid ${grid4()}, updated ${age < 1 ? "just now" : `${age} min ago`}.` +
    (problem ? " The latest refresh failed, so these spots may be out of date and alerts are paused." : "") +
    (app.solar ? "" : " Solar data is unavailable right now.");
}

function render() {
  buildBands();
  // Follow the best band until the user picks one themselves.
  if (!app.userPicked || !app.bands.some((x) => x.b === app.sel)) {
    app.sel = app.bands.reduce((a, c) => (c.sp.length > a.sp.length ? c : a), app.bands[0]).b;
  }
  renderHero();
  renderSolar();
  renderTable();
  renderScopeChips();
  drawMap();
  renderSpotList();
  if (typeof renderPlanner === "function") renderPlanner();
  drawScope();
  renderActivity();
  renderModesButton();
  renderPlan();
  renderStations();
  if (sun.data) renderSun();
  updateAutoClocks();
}

function renderHero() {
  const best = app.bands.reduce((a, c) => (c.sp.length > a.sp.length ? c : a), app.bands[0]);
  let html;
  if (!app.spots) {
    html = `<h2 class="big">${app.feedError ? "Live data unavailable" : "Checking the bands…"}</h2>
      <p>${app.feedError ? "PSK Reporter could not be reached. Band status will appear as soon as it answers." : "Fetching the latest spots for your grid square."}</p>`;
  } else if (best.sp.length) {
    html = `<h2 class="big"><span>${best.b} m</span> is your best band right now</h2>
      <p>${best.sp.length.toLocaleString()} stations spotted in the last 30 minutes, the farthest ${kmText(best.far)} away.</p>`;
  } else if (app.allPairs.length && !app.pairs.length) {
    html = `<h2 class="big">Nothing in your chosen modes</h2>
      <p>${app.allPairs.length.toLocaleString()} spots in other modes are hidden by the mode filter. Use the Modes button to show more.</p>`;
  } else {
    html = `<h2 class="big">The bands are quiet</h2>
      <p>No stations spotted from your grid square in the last 30 minutes. Check again in a few minutes.</p>`;
  }
  $("hero").innerHTML = html;
}

function renderSolar() {
  if (!app.solar) {
    $("solar").innerHTML = `<div><b>–</b><small>Solar flux index</small></div><div><b>–</b><small>Kp index</small></div>`;
    return;
  }
  const { sfi, kp } = app.solar;
  const kpLabel = kp < 3 ? "Quiet" : kp < 5 ? "Unsettled" : "Storm";
  $("solar").innerHTML = `<div><b>${Math.round(sfi)}</b><small>Solar flux index</small></div><div><b>${kp}</b><small>Kp index, ${kpLabel}</small></div>`;
}

function renderTable() {
  const max = Math.max(36, ...app.bands.map((x) => x.sp.length));
  $("bands").innerHTML = app.bands.map((x) => {
    const st = status(x);
    const count = x.none ? "–" : x.sp.length;
    const far = x.none ? "–" : x.far ? kmText(x.far) : "none";
    return `<tr tabindex="0" data-b="${x.b}" aria-selected="${x.b === app.sel}">
      <td class="bn">${x.b} m</td>
      <td><span class="bar"><i style="width:${Math.min(100, (x.sp.length / max) * 100)}%"></i></span></td>
      <td>${count}</td><td>${far}</td><td class="st ${st}">${STATUS_LABEL[st]}</td></tr>`;
  }).join("");
  bindActivate("#bands tr", (el) => selectBand(el.dataset.b));
}

function bindActivate(selector, fn) {
  document.querySelectorAll(selector).forEach((el) => {
    el.onclick = () => fn(el);
    el.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(el); }
    };
  });
}

function selectBand(b) {
  app.sel = b;
  app.userPicked = true;
  app.cursor = app.pinned = null;
  render();
}
