/* Logbook map: every contact in the log on a world map, coloured by band, with lines from your station.
   Uses each contact's grid square. Can be saved as a picture to share. */
"use strict";

const LOGMAP_COLOURS = {
  "160m": "#8e44ad", "80m": "#2c5aa0", "60m": "#1f8a8a", "40m": "#1e8f4e", "30m": "#6a9a1f", "20m": "#c99a06",
  "17m": "#d9730d", "15m": "#c0392b", "12m": "#b03a6f", "10m": "#7b4fd6", "6m": "#5d6d7e",
};
const logmap = { band: "all" };

/** Contacts that can go on the map: one point per grid square and band, with how many contacts it stands for. */
function logMapPoints(band = logmap.band) {
  const byKey = new Map();
  for (const q of log.qsos) {
    if (band !== "all" && q.band !== band) continue;
    const pos = q.grid ? gridToLatLon(q.grid) : null;
    if (!pos) continue;
    const key = `${String(q.grid).slice(0, 4).toUpperCase()}|${q.band}`;
    const p = byKey.get(key);
    if (p) { p.n++; if (!p.calls.includes(q.call) && p.calls.length < 5) p.calls.push(q.call); }
    else byKey.set(key, { lat: pos.lat, lon: pos.lon, band: q.band, grid: String(q.grid).slice(0, 4).toUpperCase(), n: 1, calls: [q.call] });
  }
  return [...byKey.values()];
}

function logMapSvg(points) {
  const X = (lon) => lon + 180;
  const Y = (lat) => 90 - lat;
  const home = app.home;
  let svg = landSvg();
  for (let l = -150; l <= 150; l += 30) svg += `<line x1="${X(l)}" y1="0" x2="${X(l)}" y2="180" stroke="var(--grid)" stroke-width=".4"/>`;
  for (let l = -60; l <= 60; l += 30) svg += `<line x1="0" y1="${Y(l)}" x2="360" y2="${Y(l)}" stroke="var(--grid)" stroke-width=".4"/>`;
  for (const p of points) {
    const c = LOGMAP_COLOURS[p.band] || "var(--cool)";
    svg += `<line x1="${X(home.lon)}" y1="${Y(home.lat)}" x2="${X(p.lon)}" y2="${Y(p.lat)}" stroke="${c}" stroke-width=".4" opacity=".35"/>`;
  }
  for (const p of points) {
    const c = LOGMAP_COLOURS[p.band] || "var(--cool)";
    const r = Math.min(4, 1.6 + Math.log2(p.n) * 0.6);
    svg += `<circle cx="${X(p.lon)}" cy="${Y(p.lat)}" r="${r.toFixed(2)}" fill="${c}" stroke="var(--surface)" stroke-width=".4">` +
      `<title>${esc(p.grid)} on ${esc(p.band)}: ${p.calls.map(esc).join(", ")}${p.n > p.calls.length ? "…" : ""} (${p.n} contact${p.n === 1 ? "" : "s"})</title></circle>`;
  }
  svg += `<circle cx="${X(home.lon)}" cy="${Y(home.lat)}" r="3" fill="var(--warm)" stroke="var(--surface)" stroke-width="1"><title>Your station</title></circle>`;
  return svg;
}

function renderLogMap() {
  const el = $("lgMap");
  if (!el) return;
  const bands = [...new Set(log.qsos.map((q) => q.band).filter(Boolean))]
    .sort((a, b) => parseFloat(b) - parseFloat(a));
  if (logmap.band !== "all" && !bands.includes(logmap.band)) logmap.band = "all";
  $("lgMapBands").innerHTML = [["all", "All bands"], ...bands.map((b) => [b, b])]
    .map(([k, l]) => `<button type="button" data-b="${esc(k)}" aria-pressed="${k === logmap.band}">` +
      `${k === "all" ? "" : `<span class="lgdot" style="background:${LOGMAP_COLOURS[k] || "var(--cool)"}"></span>`}${esc(l)}</button>`).join("");
  $("lgMapBands").querySelectorAll("button").forEach((b) => { b.onclick = () => { logmap.band = b.dataset.b; renderLogMap(); }; });

  const points = logMapPoints();
  el.innerHTML = logMapSvg(points);
  const qsos = log.qsos.filter((q) => logmap.band === "all" || q.band === logmap.band);
  const placed = qsos.filter((q) => q.grid && gridToLatLon(q.grid)).length;
  const squares = new Set(points.map((p) => p.grid)).size;
  const missing = qsos.length - placed;
  $("lgMapNote").textContent = !log.qsos.length ? "Log some contacts and they'll appear here."
    : `${placed} contact${placed === 1 ? "" : "s"} in ${squares} grid square${squares === 1 ? "" : "s"}` +
      `${logmap.band === "all" ? "" : ` on ${logmap.band}`}.` +
      (missing ? ` ${missing} ${missing === 1 ? "has" : "have"} no grid square, so ${missing === 1 ? "it isn't" : "they aren't"} shown (add one with Edit).` : "");
  $("lgMapSave").disabled = !placed;
}

/** Save the map as a PNG picture, with a title, for sharing. */
async function saveLogMap() {
  const css = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
  const W = 1440, H = 820;
  const title = `${app.myCall || "My"} contacts${logmap.band === "all" ? "" : ` on ${logmap.band}`}`;
  const inner = logMapSvg(logMapPoints())
    .replace(/var\(--grid\)/g, v("--grid", "#d8dfda")).replace(/var\(--surface\)/g, v("--surface", "#ffffff"))
    .replace(/var\(--warm\)/g, v("--warm", "#a76a00")).replace(/var\(--cool\)/g, v("--cool", "#0b7285"));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 -14 360 205">` +
    `<rect x="0" y="-14" width="360" height="205" fill="${v("--surface", "#ffffff")}"/>` +
    `<text x="4" y="-4" font-family="sans-serif" font-size="8" font-weight="bold" fill="${v("--text", "#14262b")}">${esc(title)}</text>` +
    `<text x="356" y="-4" text-anchor="end" font-family="sans-serif" font-size="5" fill="${v("--muted", "#52666a")}">${esc($("lgMapNote").textContent.split(".")[0])} · Band Watch by M3vrv</text>` +
    `<g>${inner}</g></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  canvas.getContext("2d").drawImage(img, 0, 0, W, H);
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bandwatch-map-${utcDate()}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $("lgMapNote").textContent += ` Saved as ${a.download}.`;
}

function setupLogMap() {
  if (!$("lgMap")) return;
  $("lgMapSave").addEventListener("click", () => { saveLogMap().catch((e) => { $("lgMapNote").textContent = `Couldn't save the picture: ${e.message}`; }); });
  renderLogMap();
}
