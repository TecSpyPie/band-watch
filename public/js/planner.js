/* Best time to call: for a place you'd like to reach, which bands are likely open at each hour (UTC) today.
   A rough guide from a simple model: today's solar flux, the sun at the points where the signal bounces off
   the ionosphere, and the path length. Live spots near that place (from PSK Reporter) are marked, because
   what's being heard right now beats any prediction. */
"use strict";

const PLAN_PLACES = [
  ["East coast USA", 40.7, -74.0], ["Central USA", 41.9, -87.6], ["West coast USA", 34.1, -118.2], ["Alaska", 61.2, -149.9],
  ["Hawaii", 21.3, -157.9], ["Canada (east)", 45.5, -73.6], ["Caribbean", 18.2, -66.5], ["Mexico", 19.4, -99.1],
  ["Brazil", -23.5, -46.6], ["Argentina", -34.6, -58.4], ["Chile", -33.4, -70.6], ["Falkland Islands", -51.7, -57.9],
  ["Iceland", 64.1, -21.9], ["Scandinavia", 59.3, 18.1], ["Germany", 52.5, 13.4], ["Italy", 41.9, 12.5], ["Spain", 40.4, -3.7],
  ["Canary Islands", 28.1, -15.4], ["Greece", 37.98, 23.7], ["European Russia", 55.8, 37.6], ["Asiatic Russia", 55.0, 82.9],
  ["Middle East", 25.2, 55.3], ["Israel", 31.8, 35.2], ["India", 28.6, 77.2], ["Thailand", 13.8, 100.5], ["China", 39.9, 116.4],
  ["Japan", 35.7, 139.7], ["Philippines", 14.6, 121.0], ["Indonesia", -6.2, 106.8], ["Australia (east)", -33.9, 151.2],
  ["Australia (west)", -31.9, 115.9], ["New Zealand", -36.8, 174.8], ["South Africa", -26.2, 28.0], ["Kenya", -1.3, 36.8],
  ["Nigeria", 6.5, 3.4], ["Egypt", 30.0, 31.2], ["Antarctica (McMurdo)", -77.8, 166.7],
];
const PLANNER_BANDS = [["160", 1.85], ["80", 3.6], ["60", 5.36], ["40", 7.1], ["30", 10.12], ["20", 14.1], ["17", 18.1], ["15", 21.1], ["12", 24.9], ["10", 28.5]];
const planner = { place: "Japan", grid: "" };

function loadPlanner() {
  try {
    const s = JSON.parse(load("bw-plan") || "{}");
    if (PLAN_PLACES.some(([n]) => n === s.place)) planner.place = s.place;
    if (typeof s.grid === "string" && gridToLatLon(s.grid)) planner.grid = s.grid.toUpperCase();
  } catch { /* defaults */ }
}
function savePlanner() {
  store("bw-plan", { place: planner.place, grid: planner.grid });
}

function planTarget() {
  if (planner.grid) {
    const p = gridToLatLon(planner.grid);
    if (p) return { name: `grid ${planner.grid}`, lat: p.lat, lon: p.lon };
  }
  const pl = PLAN_PLACES.find(([n]) => n === planner.place) || PLAN_PLACES[0];
  return { name: pl[0], lat: pl[1], lon: pl[2] };
}

/** A point a fraction f of the way along the great circle from a to b. */
function gcPoint(a, b, f) {
  const R = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a.lat * R, a.lon * R, b.lat * R, b.lon * R];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) / R, lon: Math.atan2(y, x) / R };
}

/**
 * How likely each band is to work on this path at time t: 0 (unlikely) to 1 (good).
 * MUF from a simple F2-layer model at each hop's midpoint (the lowest one limits the path); LUF from daytime
 * absorption. Rough, but it gets the shape of the day right: high bands by day, low bands by night.
 */
function planPath(from, to, t, sfi, kp) {
  const d = distanceKm(from.lat, from.lon, to.lat, to.lon);
  const hops = Math.max(1, Math.ceil(d / 3500));
  const L = d / hops;
  const ssn = Math.max(0, Math.min(250, (sfi - 64) / 0.73));
  const day = 5.5 + 0.045 * ssn, night = 3 + 0.02 * ssn;
  const M = 1.1 + (2.2 * Math.min(L, 3500)) / 3500;
  let muf = Infinity, sunMax = 0, highLat = false;
  for (let h = 0; h < hops; h++) {
    const cp = gcPoint(from, to, (h + 0.5) / hops);
    const s = Math.sin(sunElevation(cp.lat, cp.lon, t) * RAD);
    const k = Math.max(0, Math.min(1, (s + 0.1) / 0.45)) ** 0.5; // the F2 layer is near its daytime level once the sun is ~15 degrees up
    muf = Math.min(muf, (night + (day - night) * k) * M);
    sunMax = Math.max(sunMax, s);
    if (Math.abs(cp.lat) > 55) highLat = true;
  }
  // Daytime D-layer absorption: worse with more hops through it and with more sunspots.
  const luf = 1.2 + (6 + 3 * hops) * Math.max(0, sunMax) ** 0.5 * (0.8 + ssn / 300) * Math.min(1, d / 2500) ** 0.5;
  const storm = kp >= 5 && highLat ? 0.6 : kp >= 4 && highLat ? 0.8 : 1;
  return PLANNER_BANDS.map(([b, f]) => {
    let s;
    if (f > muf) s = Math.max(0, 1 - (f - muf) / (0.15 * muf)) * 0.3;
    else if (f < luf) s = Math.max(0, f / luf) ** 2 * 0.4;
    else s = Math.min(1, 0.6 + (0.4 * (f / muf)) / 0.85) * (f > 0.9 * muf ? 0.8 : 1);
    return { b, s: s * storm };
  });
}

const planLevel = (s) => (s >= 0.7 ? "good" : s >= 0.4 ? "fair" : "poor");

/** Bands where stations within 1,000 km of the place are being heard right now. */
function planHeardNow(to) {
  const heard = {};
  for (const p of app.allPairs || []) {
    if (p.lat == null || p.lon == null || !p.band) continue;
    if (distanceKm(p.lat, p.lon, to.lat, to.lon) <= 1000) heard[p.band] = (heard[p.band] || 0) + 1;
  }
  return heard;
}

/** Runs of true hours in a day, as [start, end) pairs; a run over midnight is one run (e.g. [20, 6]). */
function planRuns(good) {
  const runs = [];
  const start = good.findIndex((g, h) => g && !good[(h + 23) % 24]);
  for (let k = 0, h = start; k < 24; k++, h = (h + 1) % 24) {
    if (good[h] && !good[(h + 23) % 24]) runs.push([h, h]);
    if (good[h]) runs[runs.length - 1][1] = (h + 1) % 24;
  }
  return runs;
}

function renderPlanner() {
  const tb = $("plRows");
  if (!tb) return;
  $("plPlace").value = planner.place;
  if (document.activeElement !== $("plGrid")) $("plGrid").value = planner.grid;
  const to = planTarget();
  const from = app.home;
  const sfi = app.solar ? app.solar.sfi : 100;
  const kp = app.solar ? app.solar.kp : 2;
  const now = new Date();
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const hourNow = now.getUTCHours();
  const grid = [];
  for (let h = 0; h < 24; h++) grid.push(planPath(from, to, day0 + (h + 0.5) * 3600e3, sfi, kp));
  const heard = planHeardNow(to);
  const km = Math.round(distanceKm(from.lat, from.lon, to.lat, to.lon));

  $("plHead").innerHTML = `<th scope="col">Band</th>${Array.from({ length: 24 }, (_, h) => `<th scope="col"${h === hourNow ? ' class="now"' : ""}>${String(h).padStart(2, "0")}</th>`).join("")}`;
  tb.innerHTML = PLANNER_BANDS.map(([b], i) => `<tr><th scope="row">${b} m</th>${grid.map((row, h) => {
    const lv = planLevel(row[i].s);
    const live = h === hourNow && heard[b] ? `<span class="pllive" title="${heard[b]} spot${heard[b] === 1 ? "" : "s"} near ${esc(to.name)} on ${b} m right now">●</span>` : "";
    return `<td class="pl${lv}${h === hourNow ? " now" : ""}" title="${b} m at ${String(h).padStart(2, "0")}:00 UTC: ${lv}">${live}</td>`;
  }).join("")}</tr>`).join("");

  // Plain-English summary: the best bands now, and each good band's best hours.
  const nowRow = grid[hourNow].filter((x) => x.s >= 0.4).sort((a, b) => b.s - a.s);
  const spans = PLANNER_BANDS.map(([b], i) => {
    const good = grid.map((row) => row[i].s >= 0.7);
    if (!good.some(Boolean)) return null;
    if (good.every(Boolean)) return `${b} m all day`;
    return `${b} m ${planRuns(good).map(([a, z]) => `${String(a).padStart(2, "0")}–${String(z).padStart(2, "0")}`).join(" and ")}`;
  }).filter(Boolean);
  const heardBands = Object.keys(heard).sort((a, b) => Number(b) - Number(a));
  $("plSummary").innerHTML = `<b>${esc(to.name)}</b>, ${kmText(km)} away. ` +
    (nowRow.length ? `Best now: <b>${nowRow.slice(0, 3).map((x) => `${x.b} m`).join(", ")}</b>. ` : "Nothing looks likely right now. ") +
    (spans.length ? `Best times today (UTC hours): ${spans.join("; ")}.` : "No band looks good today on this path.") +
    (heardBands.length ? ` <span class="pllivenote">● Heard near there right now on ${heardBands.map((b) => `${b} m`).join(", ")}.</span>` : "");
  $("plNote").textContent = `A rough guide from today's solar flux (${Math.round(sfi)}${app.solar ? "" : ", assumed"}) and where the sun is along the path. ` +
    "Real conditions vary from day to day: the dots show what's actually being heard now.";
}

function setupPlanner() {
  if (!$("plRows")) return;
  loadPlanner();
  $("plPlace").innerHTML = PLAN_PLACES.map(([n]) => `<option>${esc(n)}</option>`).join("");
  $("plPlace").addEventListener("change", () => { planner.place = $("plPlace").value; planner.grid = ""; savePlanner(); renderPlanner(); });
  $("plGrid").addEventListener("change", () => {
    const g = $("plGrid").value.trim().toUpperCase();
    if (g && !gridToLatLon(g)) { $("plNote").textContent = "The grid square should look like PM95 or PM95ab."; return; }
    planner.grid = g;
    savePlanner();
    renderPlanner();
  });
  renderPlanner();
  setInterval(() => { if (!document.hidden) renderPlanner(); }, 5 * 60 * 1000);
}
