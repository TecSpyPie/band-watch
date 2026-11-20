/* World map and the spot list for the selected band. */
"use strict";

/* ===================== Map and spot list ===================== */

function drawMap() {
  // The "Map" view (spotmap.js) draws the real world map; this file keeps the title and the simple "Bowl" chart.
  if (typeof spotMapActive === "function" && spotMapActive()) {
    const c = app.bands.find((x) => x.b === app.sel);
    $("mapTitle").textContent = c ? `${bandName(c.b)} spots` : "Map";
    spotMapDraw(false);
    return;
  }
  const X = (lon) => lon + 180;
  const Y = (lat) => 90 - lat;
  const sun = subsolarPoint(Date.now());
  let svg = "";

  for (let l = -150; l <= 150; l += 30) svg += `<line x1="${X(l)}" y1="0" x2="${X(l)}" y2="180" stroke="var(--grid)" stroke-width=".4"/>`;
  for (let l = -60; l <= 60; l += 30) svg += `<line x1="0" y1="${Y(l)}" x2="360" y2="${Y(l)}" stroke="var(--grid)" stroke-width=".4"/>`;

  // Night side: terminator line closed off at the pole that is in darkness.
  const dec = Math.abs(sun.dec) < 0.3 ? 0.3 : sun.dec;
  const pts = [];
  for (let l = -180; l <= 180; l += 3) {
    const lat = Math.atan(-Math.cos((l - sun.lon) * RAD) / Math.tan(dec * RAD)) / RAD;
    pts.push(`${X(l)},${Y(lat)}`);
  }
  const edge = dec > 0 ? 180 : 0;
  svg += `<polygon points="${pts.join(" ")} 360,${edge} 0,${edge}" fill="var(--night)"/>`;

  const cur = app.bands.find((x) => x.b === app.sel);
  if (cur) {
    for (const p of cur.sp.slice(0, 400)) {
      svg += `<line x1="${X(app.home.lon)}" y1="${Y(app.home.lat)}" x2="${X(p.lon)}" y2="${Y(p.lat)}" stroke="var(--cool)" stroke-width=".5" opacity=".45"/>` +
        `<circle cx="${X(p.lon)}" cy="${Y(p.lat)}" r="1.6" fill="var(--cool)"/>`;
    }
  }
  if (typeof xotaMapSvg === "function") svg += xotaMapSvg(X, Y);
  if (typeof satMapSvg === "function") svg += satMapSvg(X, Y);
  if (typeof aprsMapSvg === "function") svg += aprsMapSvg(X, Y);
  svg += `<circle cx="${X(app.home.lon)}" cy="${Y(app.home.lat)}" r="3" fill="var(--warm)" stroke="var(--surface)" stroke-width="1"/>`;
  $("map").innerHTML = svg;
  $("mapTitle").textContent = cur ? `${bandName(cur.b)} spots` : "Map";
}

function renderSpotList() {
  const cur = app.bands.find((x) => x.b === app.sel);
  if (!cur || !cur.sp.length) {
    $("spots").innerHTML = `<li><span>${app.spots ? "No spots on this band right now." : "Waiting for live spots."}</span></li>`;
    return;
  }
  $("spots").innerHTML = cur.sp.slice(0, 10).map((p) =>
    `<li><span>${ago(p.t)}, ${callLink(p.c)} (${esc(p.dir)})</span>` +
    `<span>${esc(p.m)}, ${kmText(p.d)}${p.snr != null ? `, ${p.snr} dB` : ""}</span></li>`).join("");
}
