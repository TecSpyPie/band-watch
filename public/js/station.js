/* Station window: transmitting station time, map, listening and QRZ details. */
"use strict";

/* ===================== Station window ===================== */

const station = { call: null, pos: null, tz: null, timer: null, map: null, qrz: null, tune: null };
let leafletPromise = null;

/** Short-path beam heading from a to b, in degrees. */
function bearing(a, b) {
  const p1 = a.lat * RAD, p2 = b.lat * RAD, dl = (b.lon - a.lon) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Points along the great circle from a to b, with longitudes unwrapped so the line doesn't jump at ±180°. */
function greatCircle(a, b, n = 64) {
  const toV = (p) => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
  const va = toV(a), vb = toV(b);
  const dot = Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2]));
  const w = Math.acos(dot);
  const pts = [];
  let prevLon = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const k1 = w < 1e-9 ? 1 - t : Math.sin((1 - t) * w) / Math.sin(w);
    const k2 = w < 1e-9 ? t : Math.sin(t * w) / Math.sin(w);
    const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
    const lat = Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD;
    let lon = Math.atan2(v[1], v[0]) / RAD;
    if (prevLon != null) while (lon - prevLon > 180) lon -= 360;
    if (prevLon != null) while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    pts.push([lat, lon]);
  }
  return pts;
}

function validTimeZone(tz) {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}

/** Work out the station's time zone: QRZ's zone, QRZ's UTC offset, the nearest city, or longitude. */
function stationTimeZone(pos, q) {
  if (q && q.timeZone && validTimeZone(q.timeZone)) return { tz: q.timeZone, note: "Time zone from QRZ." };
  if (q && Number.isFinite(q.gmtOffset)) {
    return { offsetMin: Math.round(q.gmtOffset * 60), note: `QRZ gives UTC${q.gmtOffset >= 0 ? "+" : ""}${q.gmtOffset}${q.dst ? "; daylight saving may add an hour" : ""}.` };
  }
  if (!pos) return null;
  let best = null, bestD = Infinity;
  for (const c of CITIES) {
    if (c.lat == null) continue;
    const d = distanceKm(pos.lat, pos.lon, c.lat, c.lon);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best && bestD < 1500) return { tz: best.tz, note: `Time zone estimated from the station’s location (near ${best.name || best.id}).` };
  const hours = Math.round(pos.lon / 15);
  return { offsetMin: hours * 60, note: "Time zone estimated from the station’s longitude." };
}

function stationSpots(call) {
  return app.pairs.filter((p) => baseCall(p.c) === call || baseCall(p.l || "") === call).sort((a, b) => b.ts - a.ts);
}

function renderStationTime() {
  const now = new Date();
  const z = station.tz;
  if (!z) {
    $("stTime").textContent = "--:--:--";
    $("stDate").textContent = "";
    $("stSun").textContent = "";
    $("stTzNote").textContent = "This station’s location isn’t known yet. Log in to QRZ, or wait for it to be spotted.";
    return;
  }
  let time, date, offset;
  if (z.tz) {
    time = new Intl.DateTimeFormat("en-GB", { timeZone: z.tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(now);
    ({ date, offset } = clockParts(z.tz, now));
  } else {
    const shifted = new Date(now.getTime() + z.offsetMin * 60e3);
    time = shifted.toISOString().slice(11, 19);
    date = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(shifted);
    const h = z.offsetMin / 60;
    offset = `UTC${h >= 0 ? "+" : ""}${Number.isInteger(h) ? h : h.toFixed(1)}`;
  }
  $("stTime").textContent = time;
  $("stDate").textContent = `${date} · ${offset}`;
  if (station.pos) {
    const el = sunElevation(station.pos.lat, station.pos.lon, now.getTime());
    const [label, cls] = el > 6 ? ["Daylight at the station", "day"] : el < -6 ? ["Night at the station", "night"] : ["Greyline at the station", "grey"];
    $("stSun").innerHTML = `<span class="sun ${cls}">${label}</span>`;
  }
  $("stTzNote").textContent = z.note;
}

function loadLeaflet() {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(css);
    const js = document.createElement("script");
    js.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    const timer = setTimeout(() => reject(new Error("timeout")), 8000);
    js.onload = () => { clearTimeout(timer); window.L ? resolve(window.L) : reject(new Error("no Leaflet")); };
    js.onerror = () => { clearTimeout(timer); reject(new Error("blocked")); };
    document.head.appendChild(js);
  }).catch((err) => { leafletPromise = null; throw err; });
  return leafletPromise;
}

/** Simple offline map: grid, night shading, the path and both stations. */
function fallbackMapSvg(home, pos) {
  const X = (lon) => ((lon + 540) % 360), Y = (lat) => 90 - lat;
  let g = `<svg viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`;
  for (let l = 30; l < 360; l += 30) g += `<line x1="${l}" y1="0" x2="${l}" y2="180" stroke="var(--grid)" stroke-width=".4"/>`;
  for (let l = 30; l < 180; l += 30) g += `<line x1="0" y1="${l}" x2="360" y2="${l}" stroke="var(--grid)" stroke-width=".4"/>`;
  // break the line where it wraps around the edge of the map
  let seg = [], d = "";
  greatCircle(home, pos).forEach(([la, lo], i, arr) => {
    const x = X(lo);
    if (i && Math.abs(x - X(arr[i - 1][1])) > 180) { d += `M${seg.join(" L")} `; seg = []; }
    seg.push(`${x.toFixed(1)},${Y(la).toFixed(1)}`);
  });
  d += `M${seg.join(" L")}`;
  g += `<path d="${d}" fill="none" stroke="var(--cool)" stroke-width="1.2"/>`;
  g += `<circle cx="${X(home.lon)}" cy="${Y(home.lat)}" r="3.5" fill="var(--warm)"/><circle cx="${X(pos.lon)}" cy="${Y(pos.lat)}" r="3.5" fill="var(--cool)"/></svg>`;
  return g;
}

async function drawStationMap() {
  const el = $("stMap");
  if (station.map) { station.map.remove(); station.map = null; }
  const pos = station.pos;
  if (!pos) {
    el.innerHTML = `<p class="small muted" style="padding:10px">Location unknown.</p>`;
    $("stPath").textContent = "";
    el.setAttribute("aria-label", "Location unknown");
    return;
  }
  const home = app.home;
  const dist = Math.round(distanceKm(home.lat, home.lon, pos.lat, pos.lon));
  const sp = Math.round(bearing(home, pos));
  $("stPath").innerHTML = `<b>${kmText(dist)}</b> (${Math.round(dist * 0.621371).toLocaleString()} miles) from your locator · ` +
    `beam heading <b>${sp}°</b> short path, ${(sp + 180) % 360}° long path` +
    (pos.loc ? ` · locator ${esc(pos.loc)}` : "") + (pos.src === "grid" ? " (in your grid square)" : pos.src === "qrz" ? " (from QRZ)" : "");
  el.setAttribute("aria-label", `Map showing ${station.call} ${kmText(dist)} away, beam heading ${sp} degrees`);
  el.innerHTML = fallbackMapSvg(home, pos);
  const call = station.call;
  try {
    const L = await loadLeaflet();
    if (station.call !== call || !$("station").open) return;
    el.innerHTML = "";
    const map = L.map(el, { worldCopyJump: true, zoomControl: true, attributionControl: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 12,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);
    const path = greatCircle(home, pos);
    const cool = cssColor("--cool"), warm = cssColor("--warm");
    L.polyline(path, { color: cool, weight: 2 }).addTo(map);
    const end = path[path.length - 1];
    L.circleMarker([home.lat, home.lon], { radius: 6, color: warm, fillColor: warm, fillOpacity: 1 }).addTo(map).bindTooltip("You");
    L.circleMarker(end, { radius: 6, color: cool, fillColor: cool, fillOpacity: 1 }).addTo(map).bindTooltip(call);
    map.fitBounds(L.latLngBounds(path), { padding: [18, 18], maxZoom: 8 });
    station.map = map;
    setTimeout(() => map.invalidateSize(), 50);
  } catch {
    if (station.call === call) $("stPath").insertAdjacentHTML("beforeend", `<br><span class="muted">The street map couldn’t load, so a simple map is shown.</span>`);
  }
}

/** Dial frequency (kHz) and mode for listening to a spot. */
function tuning(p) {
  const kHz = p.fq * 1000;
  const dial = { FT8, FT4, WSPR }[p.mk];
  if (dial && dial[p.band]) return { kHz: Math.round(dial[p.band] * 10000) / 10, mode: "usb", digital: true };
  if (p.mk === "CW") return { kHz: Math.round(kHz * 10) / 10, mode: "cw", digital: false };
  const voice = ["SSB", "AM", "FM"].includes(p.mk);
  const mode = p.mk === "AM" ? "am" : p.mk === "FM" ? "fm" : kHz < 10000 && voice ? "lsb" : "usb";
  return { kHz: Math.round(kHz * 10) / 10, mode, digital: !voice };
}

function renderStationListen(spots) {
  const remote = spots.find((p) => baseCall(p.c) === station.call) || spots[0];
  let note, buttons = "";
  if (remote) {
    const t = tuning(remote);
    note = `Last spotted on ${esc(remote.m || "an unknown mode")} at ${(remote.fq).toFixed(4)} MHz. ` +
      (t.digital ? `${esc(remote.m)} is a data mode, so you’ll hear tones rather than speech; decode them with software such as WSJT-X. ` : "") +
      "Spots don’t carry audio: HamShack tunes a public web receiver to the frequency, which hears whatever reaches it.";
    buttons = `<button type="button" id="stTune">Listen on ${t.kHz.toLocaleString()} kHz ${t.mode.toUpperCase()}</button>`;
    station.tune = t;
  } else {
    note = "No recent spots for this station, so there’s no frequency to tune to. You can still pick a frequency in the Listen panel.";
    station.tune = null;
  }
  buttons += `<a href="http://rx.linkfanel.net/" target="_blank" rel="noopener noreferrer">Find a KiwiSDR near ${esc(station.call)}</a>`;
  $("stListenNote").innerHTML = note;
  $("stListen").innerHTML = buttons;
  const btn = $("stTune");
  if (btn) btn.onclick = () => { const t = station.tune; $("station").close(); tuneTo(t.kHz, t.mode, { open: true, scroll: true }); };
}

function renderStationSpots(spots) {
  $("stSpots").innerHTML = spots.length
    ? spots.slice(0, 6).map((p) => {
      const local = p.l ? ` · ${baseCall(p.c) === station.call ? (p.dir === "hears your grid" ? "heard " : "heard by ") : "with "}${esc(baseCall(p.c) === station.call ? p.l : p.c)}` : "";
      return `<li><span>${ago(p.t)}, ${bandName(p.band)}, ${(p.fq * 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kHz</span>` +
        `<span>${esc(p.m)}${p.snr != null ? `, ${p.snr} dB` : ""}${local}</span></li>`;
    }).join("")
    : `<li><span class="muted">Not spotted from ${esc(grid4())} in the last 30 minutes.</span></li>`;
}

/** Open the station window for a callsign: local time, map, listening links, spots and QRZ details. */
async function openStation(rawCall) {
  const call = baseCall(rawCall);
  if (!call) return;
  station.call = call;
  station.qrz = null;
  const spots = stationSpots(call);
  const remote = spots.find((p) => baseCall(p.c) === call);
  if (remote) station.pos = { lat: remote.lat, lon: remote.lon, loc: remote.g || "", src: "spot" };
  else if (spots.length) station.pos = { lat: app.home.lat, lon: app.home.lon, loc: grid4(), src: "grid" };
  else station.pos = null;
  station.tz = stationTimeZone(station.pos, null);

  const hit = PREFIXES.find(([re]) => re.test(call));
  $("qcTitle").textContent = call;
  $("stSub").textContent = [hit && hit[1], station.pos && station.pos.loc].filter(Boolean).join(" · ");
  $("stFoot").innerHTML = qrzPageLink(call);
  renderStationSpots(spots);
  renderStationListen(spots);
  renderStationTime();
  if (!$("station").open) $("station").showModal();
  clearInterval(station.timer);
  station.timer = setInterval(renderStationTime, 1000);
  drawStationMap();
  loadStationQrz(call);
}

function closeStation() {
  clearInterval(station.timer);
  station.timer = null;
  if (station.map) { station.map.remove(); station.map = null; }
  station.call = null;
}

async function loadStationQrz(call) {
  const body = $("qcBody");
  if (!qrzState.loggedIn) {
    body.innerHTML = `<p class="small muted">Log in to QRZ to see this station’s name, address and QSL details here.</p>` +
      `<div class="dbtns" style="justify-content:flex-start"><button type="button" class="ghost" id="qcLogin">Log in to QRZ</button></div>`;
    $("qcLogin").onclick = () => { $("station").close(); openQrzLogin(); };
    return;
  }
  body.innerHTML = `<p class="muted small">Looking up ${esc(call)} on QRZ…</p>`;
  const r = await qrzLookupCached(call);
  if (station.call !== call) return; // another station was opened meanwhile
  if (!r.ok) {
    body.innerHTML = `<p class="small">${esc(r.body.error || "QRZ could not be reached.")}</p>` +
      (r.status === 401 ? `<div class="dbtns" style="justify-content:flex-start"><button type="button" class="ghost" id="qcLogin">Log in to QRZ</button></div>` : "");
    const btn = $("qcLogin");
    if (btn) btn.onclick = () => { $("station").close(); openQrzLogin(); };
    return;
  }

  const d = r.body;
  station.qrz = d;
  // QRZ's own position and time zone are better than a spot's 4- or 6-character locator.
  if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
    const moved = !station.pos || distanceKm(station.pos.lat, station.pos.lon, d.lat, d.lon) > 20;
    station.pos = { lat: d.lat, lon: d.lon, loc: normaliseLocator(d.grid) || (station.pos && station.pos.loc) || "", src: "qrz" };
    if (moved) drawStationMap();
  }
  station.tz = stationTimeZone(station.pos, d);
  renderStationTime();

  const place = [d.city, d.state, d.country].filter(Boolean).join(", ");
  const qsl = [d.lotw && "LoTW", d.eqsl && "eQSL", d.paperQsl && "Paper"].filter(Boolean).join(", ");
  const rows = [
    ["Name", d.name && (d.nickname ? `${d.name} (${d.nickname})` : d.name)],
    ["Location", place],
    ["Grid", d.grid],
    ["Licence", d.licenceClass],
    ["Zones", [d.cqZone && `CQ ${d.cqZone}`, d.ituZone && `ITU ${d.ituZone}`].filter(Boolean).join(", ")],
    ["QSL", qsl],
    ["QSL manager", d.qslManager],
  ].filter(([, v]) => v);
  $("qcTitle").textContent = d.call || call;
  body.innerHTML =
    (d.image ? `<img src="${esc(d.image)}" alt="Photo for ${esc(d.call)} from QRZ" loading="lazy" referrerpolicy="no-referrer">` : "") +
    (rows.length ? `<dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : `<p class="muted small">QRZ returned no details for this callsign.</p>`) +
    (d.limited ? `<p class="muted small">Some details need a QRZ XML subscription.</p>` : "");
}

function setupQrz() {
  $("qrzBtn").addEventListener("click", openQrzLogin);
  $("qlForm").addEventListener("submit", submitQrzLogin);
  $("qlClose").addEventListener("click", () => $("qrzLogin").close());
  $("qlLogout").addEventListener("click", logoutQrz);
  $("qcClose").addEventListener("click", () => $("station").close());
  $("station").addEventListener("close", closeStation);
  for (const d of [$("qrzLogin"), $("station")]) {
    d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // click outside to close
  }
  // Any callsign link opens the station window. Ctrl/Cmd/Shift-click still opens QRZ.com in a new tab.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.call");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openStation(a.dataset.call);
  });
  qrzRequest("/api/qrz/status").then((r) => { if (r.ok) setQrzState(r.body); }).catch(() => {});
}
