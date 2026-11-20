/* Parks on the air: live POTA activators, on a list, the map and the band scope.
   Click one to tune Listen (and your radio, if it's connected) to them.
   (No SOTA: SOTA's API terms don't allow AI-written software like this without their approval.) */
"use strict";

const XOTA_REFRESH = 2 * 60 * 1000; // POTA is volunteer-run: every two minutes is plenty
const xota = {
  spots: [], failed: [], at: 0, loading: false, error: "", timer: null,
  src: "both", band: "all", mode: "all", alerts: false, onMap: true, seen: null,
};

function loadXota() {
  try {
    const s = JSON.parse(load("bw-xota") || "{}");
    if (typeof s.band === "string") xota.band = s.band;
    if (["all", "cw", "ssb", "data"].includes(s.mode)) xota.mode = s.mode;
    if (typeof s.alerts === "boolean") xota.alerts = s.alerts;
    if (typeof s.onMap === "boolean") xota.onMap = s.onMap;
  } catch { /* defaults */ }
}
function saveXota() {
  store("bw-xota", { band: xota.band, mode: xota.mode, alerts: xota.alerts, onMap: xota.onMap });
}

/** CW, SSB or data, from the mode the spotter wrote. */
function xotaKind(mode) {
  const m = String(mode || "").toUpperCase();
  if (m === "CW") return "cw";
  if (["SSB", "USB", "LSB", "AM", "FM"].includes(m)) return "ssb";
  if (m) return "data";
  return "";
}

/** The mode to listen in for a spot. */
function xotaListenMode(spot) {
  const m = String(spot.mode || "").toUpperCase();
  if (m === "CW") return "cw";
  if (m === "AM") return "am";
  if (m === "FM") return "fm";
  if (m === "LSB") return "lsb";
  if (m === "SSB") return spot.kHz < 10000 && !(spot.kHz >= 5250 && spot.kHz <= 5450) ? "lsb" : "usb";
  if (m === "USB" || xotaKind(m) === "data") return "usb";
  return modeForFreq(spot.kHz);
}

const xotaKey = (x) => `${x.src}|${x.call}|${x.ref}|${Math.round(x.kHz)}`;

function xotaShown() {
  return xota.spots.filter((x) => (xota.src === "both" || x.src === xota.src)
    && (xota.band === "all" || bandForKHz(x.kHz) === xota.band)
    && (xota.mode === "all" || xotaKind(x.mode) === xota.mode));
}

function xotaLink(x) {
  const url = x.src === "pota"
    ? `https://pota.app/#/park/${encodeURIComponent(x.ref)}`
    : `https://www.sotadata.org.uk/en/summit/${x.ref.split("/").map(encodeURIComponent).join("/")}`;
  return `<a href="${url}" target="_blank" rel="noopener noreferrer">${esc(x.ref)}</a>`;
}

function xotaDistance(x) {
  if (x.lat == null || x.lon == null || !app.home) return "";
  return kmText(Math.round(distanceKm(app.home.lat, app.home.lon, x.lat, x.lon)));
}

function renderXota() {
  const list = $("xtList");
  if (!list) return;
  $("xtBand").value = xota.band;
  $("xtMode").value = xota.mode;
  $("xtAlerts").checked = xota.alerts;
  $("xtMap").checked = xota.onMap;
  const shown = xotaShown();
  const now = Date.now();
  list.innerHTML = shown.slice(0, 60).map((x) => {
    const min = x.time ? Math.max(0, Math.round((now - Date.parse(x.time)) / 60000)) : null;
    const where = [x.name, x.loc].filter(Boolean).join(" · ");
    return `<li class="xtrow" data-key="${esc(xotaKey(x))}">
      <span class="xtsrc ${x.src}">${x.src.toUpperCase()}</span>
      <span class="xtcall">${callLink(x.call)}</span>
      <button type="button" class="tune xttune" data-key="${esc(xotaKey(x))}" title="Tune to ${esc(x.call)}">${x.kHz.toLocaleString()} kHz ${esc(x.mode || "")}</button>
      <span class="xtref">${xotaLink(x)} <button type="button" class="linkbtn xtlog" data-key="${esc(xotaKey(x))}">Log</button>${typeof workedBefore === "function" && workedBefore(x.call, x.ref) ? ' <span class="worked" title="Already in your log at this park or summit">✓ worked</span>' : ""}</span>
      <span class="xtwhere small muted">${esc(where)}${xotaDistance(x) ? ` · ${xotaDistance(x)}` : ""}</span>
      <span class="xttime small muted">${min == null ? "" : ago(min)}${x.note ? ` · ${esc(x.note)}` : ""}</span>
    </li>`;
  }).join("") || `<li class="small muted">${xota.loading ? "Loading activators…" : "No activators on the air right now with these filters."}</li>`;
  const counts = `${shown.length} of ${xota.spots.length} activators`;
  $("xtNote").textContent = xota.error
    ? `Couldn't load POTA spots: ${xota.error}`
    : `${counts}${xota.failed.length ? ` (${xota.failed.map((f) => f.toUpperCase()).join(" and ")} not available just now)` : ""}. Updated every two minutes. Click a frequency to tune there.`;
}

async function refreshXota() {
  xota.loading = true;
  try {
    const r = await fetch("/api/xota");
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    const d = await r.json();
    xota.spots = Array.isArray(d.spots) ? d.spots : [];
    xota.failed = Array.isArray(d.failed) ? d.failed : [];
    xota.at = d.at || Date.now();
    xota.error = "";
    xotaAlertNew();
  } catch (e) {
    xota.error = e.message || String(e);
  } finally {
    xota.loading = false;
    renderXota();
    if (typeof drawMap === "function") drawMap();
    if (typeof drawScope === "function") drawScope();
    if (typeof checkWanted === "function") checkWanted();
  }
}

/** A toast for each activator that's new since the last update (not on the first load). */
function xotaAlertNew() {
  const keys = new Set(xota.spots.map(xotaKey));
  const first = xota.seen === null;
  const fresh = first ? [] : xotaShown().filter((x) => !xota.seen.has(xotaKey(x)));
  xota.seen = new Set([...(xota.seen || []), ...keys]);
  if (!xota.alerts || !fresh.length) return;
  const x = fresh[0];
  const more = fresh.length > 1 ? ` (and ${fresh.length - 1} more)` : "";
  showToast(`New ${x.src.toUpperCase()} activator`, `${x.call} at ${x.ref}, ${x.kHz.toLocaleString()} kHz ${x.mode}${more}`);
}

function xotaTune(key) {
  const x = xota.spots.find((s) => xotaKey(s) === key);
  if (!x) return;
  tuneTo(x.kHz, xotaListenMode(x), { scroll: false });
}

/** Activators on the map: green triangles (selected band only). */
function xotaMapSvg(X, Y) {
  if (!xota.onMap) return "";
  let svg = "";
  for (const x of xotaShown()) {
    if (x.lat == null || x.lon == null || bandForKHz(x.kHz) !== app.sel) continue;
    const cx = X(x.lon), cy = Y(x.lat);
    svg += `<polygon class="xtmark ${x.src}" points="${cx},${cy - 2.6} ${cx - 2.3},${cy + 1.6} ${cx + 2.3},${cy + 1.6}"><title>${esc(`${x.call} ${x.ref} ${x.kHz} kHz ${x.mode}`)}</title></polygon>`;
  }
  return svg;
}

/** The same activators as plain points, for the spots map (Map view). */
function xotaMapPoints() {
  if (!xota.onMap) return [];
  return xotaShown().filter((x) => x.lat != null && x.lon != null && bandForKHz(x.kHz) === app.sel)
    .map((x) => ({ lat: x.lat, lon: x.lon, tip: `${x.call} at ${x.ref}, ${x.kHz} kHz ${x.mode}` }));
}

/** Activators on the band scope: a small flag above the spectrum at their frequency. */
function xotaScopeMarks(g, lo, hi, fx, top, colour) {
  for (const x of xotaShown()) {
    const mhz = x.kHz / 1000;
    if (mhz < lo || mhz > hi) continue;
    const px = fx(mhz);
    g.fillStyle = colour;
    g.fillRect(px - 0.5, top, 1, 9);
    g.beginPath(); g.moveTo(px, top); g.lineTo(px + 6, top + 3); g.lineTo(px, top + 6); g.closePath(); g.fill();
    g.fillText(x.call, px + 8, top + 8);
  }
}

function setupXota() {
  loadXota();
  const bands = BANDS.filter((b) => FT8[b]);
  $("xtBand").innerHTML = `<option value="all">All bands</option>${bands.map((b) => `<option value="${b}">${bandName(b)}</option>`).join("")}`;
  $("xtBand").addEventListener("change", () => { xota.band = $("xtBand").value; saveXota(); renderXota(); drawMap(); drawScope(); });
  $("xtMode").addEventListener("change", () => { xota.mode = $("xtMode").value; saveXota(); renderXota(); drawMap(); drawScope(); });
  $("xtAlerts").addEventListener("change", () => { xota.alerts = $("xtAlerts").checked; saveXota(); });
  $("xtMap").addEventListener("change", () => { xota.onMap = $("xtMap").checked; saveXota(); drawMap(); });
  $("xtList").addEventListener("click", (e) => {
    const b = e.target.closest(".xttune");
    if (b) xotaTune(b.dataset.key);
    const l = e.target.closest(".xtlog");
    if (l) {
      const x = xota.spots.find((s) => xotaKey(s) === l.dataset.key);
      if (x) {
        const kind = xotaKind(x.mode);
        logPrefill({ call: x.call, kHz: x.kHz, mode: kind === "cw" ? "CW" : kind === "ssb" ? (["AM", "FM"].includes(x.mode) ? x.mode : "SSB") : (LOG_MODES.includes(x.mode) ? x.mode : "FT8"),
          rstS: kind === "cw" ? "599" : kind === "ssb" ? "59" : "", rstR: kind === "cw" ? "599" : kind === "ssb" ? "59" : "",
          grid: x.grid ? x.grid.slice(0, 6) : "", ref: x.ref, qth: x.name });
      }
    }
  });
  renderXota();
  refreshXota();
  xota.timer = setInterval(() => { if (!document.hidden) refreshXota(); }, XOTA_REFRESH);
}
