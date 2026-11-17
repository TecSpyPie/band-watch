/* DX cluster: stations other hams have just reported hearing, from HamQTH.com's free DX cluster API
   (through Band Watch's server, one shared copy a minute). Click a frequency to tune there.
   HamQTH asks apps to say "Data provided by HamQTH.com", so the panel does. */
"use strict";

const DX_REFRESH = 60 * 1000;
const dx = { spots: [], at: 0, loading: false, error: "", timer: null, band: "all", mode: "all", onMap: true };

function loadDx() {
  try {
    const s = JSON.parse(load("bw-dx") || "{}");
    if (typeof s.band === "string") dx.band = s.band;
    if (["all", "cw", "ssb", "digi"].includes(s.mode)) dx.mode = s.mode;
    if (typeof s.onMap === "boolean") dx.onMap = s.onMap;
  } catch { /* defaults */ }
}
function saveDx() {
  store("bw-dx", { band: dx.band, mode: dx.mode, onMap: dx.onMap });
}

const dxKey = (x) => `${x.call}|${Math.round(x.kHz * 10)}|${x.time}`;

function dxShown() {
  return dx.spots.filter((x) => (dx.band === "all" || bandForKHz(x.kHz) === dx.band)
    && (dx.mode === "all" || String(x.mode).toLowerCase() === dx.mode));
}

/** The mode to listen in: CW, or the usual sideband for the band (data modes use USB). */
function dxListenMode(x) {
  if (x.mode === "CW") return "cw";
  if (x.mode === "SSB") return x.kHz < 10000 && !(x.kHz >= 5250 && x.kHz <= 5450) ? "lsb" : "usb";
  if (x.mode === "DIGI") return "usb";
  return modeForFreq(x.kHz);
}

function dxDistance(x) {
  if (x.lat == null || x.lon == null || !app.home) return "";
  return kmText(Math.round(distanceKm(app.home.lat, app.home.lon, x.lat, x.lon)));
}

function renderDx() {
  const list = $("dxList");
  if (!list) return;
  $("dxBand").value = dx.band;
  $("dxMode").value = dx.mode;
  $("dxMap").checked = dx.onMap;
  const shown = dxShown();
  const now = Date.now();
  list.innerHTML = shown.slice(0, 60).map((x) => {
    const min = x.time ? Math.max(0, Math.round((now - Date.parse(x.time)) / 60000)) : null;
    const worked = typeof workedBefore === "function" && workedBefore(x.call);
    return `<li class="xtrow dxrow">
      <span class="xtcall">${callLink(x.call)}</span>
      <button type="button" class="tune dxtune" data-key="${esc(dxKey(x))}" title="Tune to ${esc(x.call)}">${x.kHz.toLocaleString()} kHz ${esc(x.mode === "DIGI" ? "Data" : x.mode)}</button>
      <span class="xtref">${esc(x.country || "")} <button type="button" class="linkbtn dxlog" data-key="${esc(dxKey(x))}">Log</button>${worked ? ' <span class="worked" title="Already in your log">✓ worked</span>' : ""}</span>
      <span class="xtwhere small muted">${[esc(x.cont || ""), dxDistance(x), x.lotw ? "LoTW" : ""].filter(Boolean).join(" · ")}</span>
      <span class="xttime small muted">${min == null ? "" : ago(min)} · spotted by ${esc(x.by)}${x.note ? ` · ${esc(x.note)}` : ""}</span>
    </li>`;
  }).join("") || `<li class="small muted">${dx.loading ? "Loading DX spots…" : dx.error ? "" : "No DX spots with these filters right now."}</li>`;
  $("dxNote").innerHTML = dx.error
    ? `Couldn't load DX spots: ${esc(dx.error)}`
    : `${shown.length} of ${dx.spots.length} spots. Updated every minute. Click a frequency to tune there. ` +
      `Data provided by <a href="https://www.hamqth.com/" target="_blank" rel="noopener noreferrer">HamQTH.com</a>, which is free: register there to support it.`;
}

async function refreshDx() {
  dx.loading = true;
  try {
    const r = await fetch("/api/dx");
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    const d = await r.json();
    dx.spots = Array.isArray(d.spots) ? d.spots : [];
    dx.at = d.at || Date.now();
    dx.error = "";
  } catch (e) {
    dx.error = e.message || String(e);
  } finally {
    dx.loading = false;
    renderDx();
    if (typeof drawMap === "function") drawMap();
  }
}

/** DX spots on the map: small diamonds (selected band only). */
function dxMapSvg(X, Y) {
  if (!dx.onMap) return "";
  let svg = "";
  for (const x of dxShown()) {
    if (x.lat == null || x.lon == null || bandForKHz(x.kHz) !== app.sel) continue;
    const cx = X(x.lon), cy = Y(x.lat);
    svg += `<polygon class="dxmark" points="${cx},${cy - 2.4} ${cx + 2.4},${cy} ${cx},${cy + 2.4} ${cx - 2.4},${cy}"><title>${esc(`${x.call} ${x.kHz} kHz ${x.mode} (DX cluster)`)}</title></polygon>`;
  }
  return svg;
}

function setupDx() {
  if (!$("dxList")) return;
  loadDx();
  const bands = Object.keys(FT8).sort((a, b) => Number(b) - Number(a));
  $("dxBand").innerHTML = `<option value="all">All bands</option>${bands.map((b) => `<option value="${b}">${b} m</option>`).join("")}`;
  $("dxBand").addEventListener("change", () => { dx.band = $("dxBand").value; saveDx(); renderDx(); drawMap(); });
  $("dxMode").addEventListener("change", () => { dx.mode = $("dxMode").value; saveDx(); renderDx(); drawMap(); });
  $("dxMap").addEventListener("change", () => { dx.onMap = $("dxMap").checked; saveDx(); drawMap(); });
  $("dxList").addEventListener("click", (e) => {
    const b = e.target.closest(".dxtune");
    const l = e.target.closest(".dxlog");
    const x = (b || l) && dx.spots.find((s) => dxKey(s) === (b || l).dataset.key);
    if (!x) return;
    if (b) tuneTo(x.kHz, dxListenMode(x), { scroll: false });
    if (l) {
      const mode = x.mode === "CW" ? "CW" : x.mode === "SSB" ? "SSB" : "FT8";
      logPrefill({ call: x.call, kHz: x.kHz, mode, rstS: mode === "CW" ? "599" : mode === "SSB" ? "59" : "", rstR: mode === "CW" ? "599" : mode === "SSB" ? "59" : "",
        grid: x.grid && x.grid.length >= 4 ? x.grid.slice(0, 6) : "" });
    }
  });
  renderDx();
  refreshDx();
  dx.timer = setInterval(() => { if (!document.hidden) refreshDx(); }, DX_REFRESH);
}
