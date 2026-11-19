/* APRS in the Decoder panel: the packets heard (newest first), the stations with their latest report, and dots on
   the world map. Decoding is in aprs.js, in the decoder's worker. */
"use strict";

const aprsui = { packets: [], stations: new Map(), onMap: true };
const APRS_KHZ = { eu: 144800, iss: 145825 };

function aprsOnPacket(m) {
  const p = m.p;
  p.at = m.at;
  if (p.lat != null && p.lon != null && app.home) {
    p.km = Math.round(distanceKm(app.home.lat, app.home.lon, p.lat, p.lon));
    p.bearing = typeof RotMath !== "undefined" ? Math.round(RotMath.bearing(app.home.lat, app.home.lon, p.lat, p.lon)) : null;
  }
  aprsui.packets.unshift(p);
  aprsui.packets = aprsui.packets.slice(0, 300);
  const old = aprsui.stations.get(p.from) || {};
  aprsui.stations.set(p.from, { ...old, ...p, heard: (old.heard || 0) + 1 });
  dcSetStatus(`APRS: ${aprsui.packets.length} packet${aprsui.packets.length === 1 ? "" : "s"} from ${aprsui.stations.size} station${aprsui.stations.size === 1 ? "" : "s"}; last from ${p.from}.`);
  renderAprs();
  if (aprsui.onMap && p.lat != null && typeof drawMap === "function") drawMap();
}

function aprsDetail(p) {
  const bits = [];
  if (p.type === "weather" && p.wx) {
    const w = p.wx;
    if (w.tempC != null) bits.push(`${w.tempC} °C`);
    if (w.windKmh != null) bits.push(`wind ${w.windKmh} km/h from ${w.windDir}°`);
    if (w.humidity != null) bits.push(`${w.humidity}% humidity`);
    if (w.pressureHpa != null) bits.push(`${w.pressureHpa} hPa`);
  }
  if (p.speedKmh) bits.push(`${p.speedKmh} km/h heading ${p.course}°`);
  if (p.altM != null) bits.push(`${p.altM} m up`);
  if (p.status) bits.push(p.status);
  if (p.type === "message") bits.push(`to ${p.to}: ${p.msg}`);
  if (p.comment) bits.push(p.comment);
  return bits.join(" · ");
}

const APRS_TYPE = { position: "Position", weather: "Weather", status: "Status", message: "Message", other: "Other" };

function renderAprs() {
  const tb = $("aprsRows");
  if (!tb) return;
  const t = (ms) => new Date(ms).toISOString().slice(11, 19);
  tb.innerHTML = aprsui.packets.slice(0, 150).map((p) => `<tr>
      <td>${t(p.at)}</td><td>${callLink(p.from.split("-")[0])}${p.from.includes("-") ? `<span class="muted">-${esc(p.from.split("-")[1])}</span>` : ""}</td>
      <td>${APRS_TYPE[p.type] || esc(p.type)}${p.micE ? ' <span class="muted small">Mic-E</span>' : ""}</td>
      <td>${p.km != null ? `${p.km.toLocaleString()} km${p.bearing != null ? ` · ${p.bearing}°` : ""}` : ""}</td>
      <td class="aprsdet">${esc(aprsDetail(p))}${p.path && p.path.length ? ` <span class="muted small">via ${esc(p.path.join(","))}</span>` : ""}</td></tr>`).join("")
    || `<tr><td colspan="5" class="small muted">${dc.running ? "Listening… APRS packets come every few seconds to minutes, depending on how busy it is near you." : "Press Start decoding."}</td></tr>`;
  $("aprsCount").textContent = aprsui.stations.size ? `${aprsui.stations.size} station${aprsui.stations.size === 1 ? "" : "s"} heard` : "";
}

/** Stations with a position, on the world map: small orange diamonds. */
function aprsMapSvg(X, Y) {
  if (!aprsui.onMap || dc.mode !== "APRS") return "";
  let s = "";
  for (const st of aprsui.stations.values()) {
    if (st.lat == null) continue;
    const x = X(st.lon), y = Y(st.lat);
    s += `<g class="aprsmark"><polygon points="${x},${y - 2.4} ${x + 2.4},${y} ${x},${y + 2.4} ${x - 2.4},${y}"/><title>${esc(`${st.from}: ${aprsDetail(st) || APRS_TYPE[st.type]}`)}</title></g>`;
  }
  return s;
}

function setupAprs() {
  if (!$("dcAprs")) return;
  $("aprsMap").checked = aprsui.onMap;
  $("aprsMap").addEventListener("change", () => { aprsui.onMap = $("aprsMap").checked; if (typeof drawMap === "function") drawMap(); });
  $("aprsClear").addEventListener("click", () => { aprsui.packets = []; aprsui.stations.clear(); renderAprs(); if (typeof drawMap === "function") drawMap(); });
  $("aprsIss").addEventListener("click", () => {
    if (RECEIVERS[listen.rx].kind !== "rtl") { listen.rx = "rtl"; saveListen(); }
    tuneTo(APRS_KHZ.iss, "fm", { quiet: true });
  });
  renderAprs();
}
