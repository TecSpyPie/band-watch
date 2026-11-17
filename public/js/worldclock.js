/* World clock, with an option to follow the busiest areas. */
"use strict";

/* ===================== World clock ===================== */

const CITIES = [
  { id: "UTC", name: "UTC", tz: "UTC" },
  { id: "local", name: "Your time" },
  { id: "London", tz: "Europe/London", lat: 51.5, lon: -0.13 },
  { id: "New York", tz: "America/New_York", lat: 40.71, lon: -74.01 },
  { id: "Chicago", tz: "America/Chicago", lat: 41.88, lon: -87.63 },
  { id: "Denver", tz: "America/Denver", lat: 39.74, lon: -104.99 },
  { id: "Los Angeles", tz: "America/Los_Angeles", lat: 34.05, lon: -118.24 },
  { id: "Anchorage", tz: "America/Anchorage", lat: 61.22, lon: -149.9 },
  { id: "Honolulu", tz: "Pacific/Honolulu", lat: 21.31, lon: -157.86 },
  { id: "São Paulo", tz: "America/Sao_Paulo", lat: -23.55, lon: -46.63 },
  { id: "Buenos Aires", tz: "America/Argentina/Buenos_Aires", lat: -34.6, lon: -58.38 },
  { id: "Reykjavík", tz: "Atlantic/Reykjavik", lat: 64.15, lon: -21.94 },
  { id: "Berlin", tz: "Europe/Berlin", lat: 52.52, lon: 13.4 },
  { id: "Johannesburg", tz: "Africa/Johannesburg", lat: -26.2, lon: 28.05 },
  { id: "Moscow", tz: "Europe/Moscow", lat: 55.76, lon: 37.62 },
  { id: "Dubai", tz: "Asia/Dubai", lat: 25.2, lon: 55.27 },
  { id: "New Delhi", tz: "Asia/Kolkata", lat: 28.61, lon: 77.21 },
  { id: "Bangkok", tz: "Asia/Bangkok", lat: 13.76, lon: 100.5 },
  { id: "Beijing", tz: "Asia/Shanghai", lat: 39.9, lon: 116.4 },
  { id: "Tokyo", tz: "Asia/Tokyo", lat: 35.68, lon: 139.69 },
  { id: "Sydney", tz: "Australia/Sydney", lat: -33.87, lon: 151.21 },
  { id: "Auckland", tz: "Pacific/Auckland", lat: -36.85, lon: 174.76 },
  { id: "Vancouver", tz: "America/Vancouver", lat: 49.28, lon: -123.12 },
  { id: "Mexico City", tz: "America/Mexico_City", lat: 19.43, lon: -99.13 },
  { id: "Bogotá", tz: "America/Bogota", lat: 4.71, lon: -74.07 },
  { id: "Lima", tz: "America/Lima", lat: -12.05, lon: -77.04 },
  { id: "Madrid", tz: "Europe/Madrid", lat: 40.42, lon: -3.7 },
  { id: "Rome", tz: "Europe/Rome", lat: 41.9, lon: 12.5 },
  { id: "Stockholm", tz: "Europe/Stockholm", lat: 59.33, lon: 18.07 },
  { id: "Warsaw", tz: "Europe/Warsaw", lat: 52.23, lon: 21.01 },
  { id: "Istanbul", tz: "Europe/Istanbul", lat: 41.01, lon: 28.98 },
  { id: "Cairo", tz: "Africa/Cairo", lat: 30.04, lon: 31.24 },
  { id: "Lagos", tz: "Africa/Lagos", lat: 6.52, lon: 3.38 },
  { id: "Nairobi", tz: "Africa/Nairobi", lat: -1.29, lon: 36.82 },
  { id: "Singapore", tz: "Asia/Singapore", lat: 1.35, lon: 103.82 },
  { id: "Seoul", tz: "Asia/Seoul", lat: 37.57, lon: 126.98 },
  { id: "Perth", tz: "Australia/Perth", lat: -31.95, lon: 115.86 },
];
const AUTO_CITIES = 4; // how many busy cities to show in "Busiest areas" mode
let clockAuto = false;
let autoCounts = {}; // city id -> stations near it
const DEFAULT_CLOCKS = ["UTC", "local", "New York", "Tokyo", "Sydney"];
let clocks = DEFAULT_CLOCKS.slice();

function cityInfo(id) {
  const c = CITIES.find((x) => x.id === id);
  if (!c) return null;
  if (id !== "local") return c;
  let tz;
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { tz = "UTC"; }
  return { ...c, tz: tz || "UTC", lat: app.home.lat, lon: app.home.lon };
}

/** Sun elevation in degrees at a place and time. */
function sunElevation(lat, lon, t) {
  const sun = subsolarPoint(t);
  const h = (lon - sun.lon) * RAD;
  const s = Math.sin(lat * RAD) * Math.sin(sun.dec * RAD) + Math.cos(lat * RAD) * Math.cos(sun.dec * RAD) * Math.cos(h);
  return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
}

function clockParts(tz, now) {
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(now);
  let offset = "";
  try {
    offset = new Intl.DateTimeFormat("en-GB", { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(now).find((p) => p.type === "timeZoneName").value.replace("GMT", "UTC");
  } catch { /* older browser */ }
  if (offset === "UTC") offset = "UTC+0";
  return { time, date, offset };
}

/** The cities nearest to the most stations in the current spots, busiest first. */
function busiestCities() {
  const places = CITIES.filter((c) => c.lat != null);
  const stations = new Map();
  for (const p of app.pairs) if (!stations.has(p.c)) stations.set(p.c, p);
  const counts = {};
  for (const p of stations.values()) {
    let best = null, bestD = Infinity;
    for (const c of places) {
      const d = distanceKm(p.lat, p.lon, c.lat, c.lon);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) counts[best.id] = (counts[best.id] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, AUTO_CITIES);
  return { ids: top.map(([id]) => id), counts: Object.fromEntries(top) };
}

const shownClocks = () => (clockAuto ? ["UTC", "local", ...busiestCities().ids] : clocks);

/** In "Busiest areas" mode, redraw the clocks when the busiest cities or their counts change. */
function updateAutoClocks() {
  if (!clockAuto) return;
  const { ids, counts } = busiestCities();
  const key = JSON.stringify(counts);
  if (key !== JSON.stringify(autoCounts) || ids.join() !== Object.keys(autoCounts).join()) {
    autoCounts = counts;
    renderWorldClock();
  }
}

function renderWorldClock() {
  if (clockAuto) autoCounts = busiestCities().counts;
  $("wclock").innerHTML = shownClocks().map((id) => {
    const c = cityInfo(id);
    if (!c) return "";
    const removable = id !== "UTC" && !clockAuto;
    const n = clockAuto ? autoCounts[id] : null;
    return `<div class="wcc" data-id="${esc(id)}"><div class="city">${esc(c.name || c.id)}</div>` +
      `<div class="t" data-part="time"></div><div class="d" data-part="date"></div><div class="sun" data-part="sun"></div>` +
      (n ? `<div class="wact">${n.toLocaleString()} station${n === 1 ? "" : "s"} nearby</div>` : "") +
      (removable ? `<button type="button" class="rm" data-rm="${esc(id)}" aria-label="Remove ${esc(c.name || c.id)}">×</button>` : "") + `</div>`;
  }).join("");
  $("wclock").querySelectorAll("[data-rm]").forEach((btn) => {
    btn.onclick = () => { clocks = clocks.filter((x) => x !== btn.dataset.rm); store("bw-clocks", clocks); renderWorldClock(); };
  });
  const options = CITIES.filter((c) => !clocks.includes(c.id));
  $("wcAdd").innerHTML = `<option value="">Add a city…</option>` + options.map((c) => `<option value="${esc(c.id)}">${esc(c.name || c.id)}</option>`).join("");
  $("wcAdd").disabled = clockAuto || !options.length;
  $("wcAuto").checked = clockAuto;
  tickWorldClock();
}

function tickWorldClock() {
  const now = new Date();
  document.querySelectorAll("#wclock .wcc").forEach((card) => {
    const c = cityInfo(card.dataset.id);
    if (!c) return;
    const { time, date, offset } = clockParts(c.tz, now);
    card.querySelector('[data-part="time"]').textContent = time;
    card.querySelector('[data-part="date"]').textContent = `${date} · ${offset}`;
    const sunEl = card.querySelector('[data-part="sun"]');
    if (c.lat == null) { sunEl.textContent = ""; sunEl.className = "sun"; return; }
    const el = sunElevation(c.lat, c.lon, now.getTime());
    const [label, cls] = el > 6 ? ["Daylight", "day"] : el < -6 ? ["Night", "night"] : ["Greyline", "grey"];
    sunEl.textContent = label;
    sunEl.className = `sun ${cls}`;
  });
}

function setupWorldClock() {
  try {
    const saved = JSON.parse(load("bw-clocks"));
    if (Array.isArray(saved)) clocks = ["UTC", ...saved.filter((id) => id !== "UTC" && CITIES.some((c) => c.id === id))];
  } catch { /* keep defaults */ }
  clockAuto = load("bw-clocks-auto") === "1";
  $("wcAdd").addEventListener("change", (e) => {
    const id = e.target.value;
    if (id && !clocks.includes(id)) { clocks.push(id); store("bw-clocks", clocks); }
    renderWorldClock();
  });
  $("wcAuto").addEventListener("change", (e) => {
    clockAuto = e.target.checked;
    store("bw-clocks-auto", clockAuto ? "1" : "0");
    autoCounts = {};
    renderWorldClock();
  });
  renderWorldClock();
}
