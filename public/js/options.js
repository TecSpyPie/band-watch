/* Display options, background image, profiles. */
"use strict";

/* ===================== Display options ===================== */

const SCOPE_RES = {
  low: { pxPerBin: 4, maxBins: 150, maxDpr: 1 },
  normal: { pxPerBin: 2, maxBins: 400, maxDpr: 2 },
  high: { pxPerBin: 1, maxBins: 900, maxDpr: 3 },
};
const ACCENTS = [
  ["", "Theme"], ["#0b7285", "Teal"], ["#1c64d8", "Blue"], ["#2f9e44", "Green"], ["#d9480f", "Orange"], ["#ae3ec9", "Purple"], ["#c2255c", "Pink"],
];
const SECTIONS = [
  ["hero", "Best band"], ["clock", "World clock"], ["lookup", "Callsign lookup"], ["solar", "Solar conditions"], ["bands", "Bands table"],
  ["monitor", "Band monitor"], ["map", "Map"], ["scope", "Band scope"], ["panel", "Radio panel"], ["listen", "Listen"], ["sked", "Shortwave stations"], ["decode", "FT8 / FT4 decoder"], ["plan", "UK band plan"],
  ["sun", "Sunspots"], ["activity", "Band activity"],
];
const DEFAULT_SETTINGS = {
  theme: "system", accent: "", text: 100, zoom: 100, width: "1100px", cols: "auto", density: "comfortable",
  scopeRes: "normal", scopeH: "280px", hide: [], modesOff: [], bgDim: 55,
};
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const saved = JSON.parse(load("bw-display"));
    if (saved && typeof saved === "object") {
      settings = { ...DEFAULT_SETTINGS, ...saved, hide: Array.isArray(saved.hide) ? saved.hide : [], modesOff: Array.isArray(saved.modesOff) ? saved.modesOff : [] };
    }
  } catch { /* defaults */ }
}

/** Apply the display options to the page. Colours that depend on the theme are re-read by the scope and map. */
function applySettings() {
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme; else root.dataset.theme = settings.theme;
  root.dataset.density = settings.density;
  root.dataset.cols = settings.cols;
  root.dataset.hide = settings.hide.join(" ");
  root.style.setProperty("--fs", String(settings.text / 100));
  root.style.setProperty("--zoom", String(settings.zoom / 100));
  root.style.setProperty("--maxw", settings.width);
  root.style.setProperty("--scopeh", settings.scopeH);
  if (settings.accent) root.style.setProperty("--cool", settings.accent); else root.style.removeProperty("--cool");
  root.style.setProperty("--bgdim", String(settings.bgDim / 100));
}

function saveSettings() {
  store("bw-display", settings);
  applySettings();
  render();
}

function renderOptions() {
  $("optTheme").value = settings.theme;
  $("optText").value = settings.text;
  $("optTextVal").textContent = `${settings.text}%`;
  $("optZoom").value = settings.zoom;
  $("optZoomVal").textContent = `${settings.zoom}%`;
  $("optWidth").value = settings.width;
  $("optCols").value = settings.cols;
  $("optDensity").value = settings.density;
  $("optScopeRes").value = settings.scopeRes;
  $("optScopeH").value = settings.scopeH;
  $("optDim").value = settings.bgDim;
  $("optDimVal").textContent = `${settings.bgDim}%`;
  $("optBgUrl").value = /^https?:/.test(background.value || "") ? background.value : "";
  $("optBgPresets").innerHTML = BG_PRESETS.map(([name, css]) =>
    `<button type="button" data-bg="${esc(name)}" style="background:${css}" aria-pressed="${background.value === css}" title="${esc(name)}" aria-label="${esc(name)}"></button>`).join("");
  $("optBgPresets").querySelectorAll("button").forEach((b) => {
    b.onclick = () => { setBackground(BG_PRESETS.find(([n]) => n === b.dataset.bg)[1]); renderOptions(); };
  });
  $("optBgNone").disabled = !background.value;
  renderProfiles();
  $("optQuitRow").hidden = !app.desktop;
  renderAbout();
  $("optAccent").innerHTML = ACCENTS.map(([c, name]) => c
    ? `<button type="button" data-c="${c}" style="background:${c}" aria-label="${name}" title="${name}" aria-pressed="${settings.accent === c}"></button>`
    : `<button type="button" class="auto" data-c="" aria-pressed="${!settings.accent}">${name}</button>`).join("");
  $("optAccent").querySelectorAll("button").forEach((b) => { b.onclick = () => { settings.accent = b.dataset.c; saveSettings(); renderOptions(); }; });
  $("optSecs").innerHTML = SECTIONS.map(([k, name]) =>
    `<label><input type="checkbox" data-sec="${k}"${settings.hide.includes(k) ? "" : " checked"}> ${name}</label>`).join("");
  $("optSecs").querySelectorAll("input").forEach((i) => {
    i.onchange = () => {
      const k = i.dataset.sec;
      settings.hide = i.checked ? settings.hide.filter((x) => x !== k) : [...new Set([...settings.hide, k])];
      saveSettings();
    };
  });
}

function setupOptions() {
  loadSettings();
  applySettings();
  $("optBtn").addEventListener("click", () => { renderOptions(); $("optDlg").showModal(); });
  const bind = (id, key, num) => $(id).addEventListener("input", (e) => {
    settings[key] = num ? Number(e.target.value) : e.target.value;
    if (id === "optText") $("optTextVal").textContent = `${settings.text}%`;
    if (id === "optZoom") $("optZoomVal").textContent = `${settings.zoom}%`;
    saveSettings();
  });
  bind("optTheme", "theme"); bind("optText", "text", true); bind("optZoom", "zoom", true); bind("optWidth", "width");
  bind("optCols", "cols"); bind("optDensity", "density"); bind("optScopeRes", "scopeRes"); bind("optScopeH", "scopeH");
  $("optDim").addEventListener("input", (e) => { settings.bgDim = Number(e.target.value); $("optDimVal").textContent = `${settings.bgDim}%`; store("bw-display", settings); applySettings(); });
  $("optReset").addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS, hide: [], modesOff: settings.modesOff };
    saveSettings();
    renderOptions();
  });
  setupBackground();
  setupProfiles();
  $("optQuit").addEventListener("click", quitDesktop);
  $("optForm").addEventListener("submit", (e) => { e.preventDefault(); $("optDlg").close(); });
  $("optDlg").addEventListener("click", (e) => { if (e.target === $("optDlg")) $("optDlg").close(); });
}

/* ===================== Background image ===================== */

const BG_PRESETS = [
  ["Night sky", "radial-gradient(ellipse at 20% 10%, #24427a 0%, #0b1530 45%, #02040c 100%)"],
  ["Aurora", "linear-gradient(160deg, #031d1a 0%, #0b5d4b 35%, #3fc69a 55%, #1d2b5e 80%, #0a0f24 100%)"],
  ["Sunset", "linear-gradient(180deg, #2b1a4a 0%, #a23b5b 45%, #f08a4b 75%, #f7c873 100%)"],
  ["Shack green", "linear-gradient(135deg, #1e3a2b 0%, #3f6b4e 50%, #a7c4a0 100%)"],
  ["Paper", "linear-gradient(180deg, #f6f1e4 0%, #e9dfc8 100%)"],
];
const background = { value: "" }; // a CSS gradient, an https/http URL, or a data: URL of a picture from this PC

function cssUrl(u) { return `url("${String(u).replace(/["\\\n\r]/g, "")}")`; }

function applyBackground() {
  const root = document.documentElement;
  const v = background.value;
  const preset = BG_PRESETS.some(([, css]) => css === v);
  if (!v || (!preset && !/^(https?:\/\/|data:image\/)/.test(v))) { root.classList.remove("has-bg"); root.style.removeProperty("--bgimg"); return; }
  root.style.setProperty("--bgimg", preset ? v : cssUrl(v));
  root.classList.add("has-bg");
}

/** Set (or clear, with "") the background. Returns false if it couldn't be saved (too big for this browser). */
function setBackground(v) {
  background.value = v || "";
  applyBackground();
  try {
    if (v) localStorage.setItem("bw-bg", v); else localStorage.removeItem("bw-bg");
    return true;
  } catch {
    return false;
  }
}

/** Shrink a picture so it fits in the browser's storage: at most 1920 pixels across, as JPEG. */
function pictureToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) { reject(new Error("That file isn't a picture.")); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 1920 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      let q = 0.85, out = c.toDataURL("image/jpeg", q);
      while (out.length > 2.5e6 && q > 0.4) { q -= 0.15; out = c.toDataURL("image/jpeg", q); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That picture couldn't be opened.")); };
    img.src = url;
  });
}

function setupBackground() {
  background.value = load("bw-bg") || "";
  applyBackground();
  const msg = (t) => { $("optBgMsg").textContent = t; };
  $("optBgFile").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    msg("Loading your picture…");
    try {
      const data = await pictureToDataUrl(file);
      msg(setBackground(data) ? `Using ${file.name}.` : "That picture is too big to keep in this browser. It's shown now but won't be remembered.");
    } catch (err) {
      msg(err.message);
    }
    renderOptions();
  });
  $("optBgUrlSet").addEventListener("click", () => {
    const raw = $("optBgUrl").value.trim();
    let u;
    try { u = new URL(raw); } catch { u = null; }
    if (!u || !/^https?:$/.test(u.protocol)) { msg("Enter a web address starting with https://"); return; }
    setBackground(u.href);
    msg("Using the picture from that address. If it doesn't appear, the site may not allow it.");
    renderOptions();
  });
  $("optBgNone").addEventListener("click", () => { setBackground(""); msg("Background removed."); renderOptions(); });
}

/* ===================== Profiles ===================== */

const PROFILE_KEYS = ["bw-display", "bw-grid", "bw-call", "bw-mon", "bw-clocks", "bw-clocks-auto", "bw-locauto", "bw-listen", "bw-sdr", "bw-decode", "bw-bg", "bw-rig", "bw-xota", "bw-log", "bw-wanted"];

function loadProfiles() {
  try { const p = JSON.parse(load("bw-profiles")); return p && typeof p === "object" && !Array.isArray(p) ? p : {}; } catch { return {}; }
}

/** Everything that makes Band Watch yours: display, locator, callsign, watched bands, clocks, listening and background. */
function currentProfile() {
  const data = {};
  for (const k of PROFILE_KEYS) { const v = load(k); if (v != null) data[k] = v; }
  return { v: 1, saved: new Date().toISOString(), data };
}

function saveProfiles(all) {
  try { localStorage.setItem("bw-profiles", JSON.stringify(all)); return true; } catch { return false; }
}

/** Load a profile: write its settings, then reload so every part of the page starts from them. */
function applyProfile(p) {
  if (!p || typeof p !== "object" || typeof p.data !== "object") throw new Error("That isn't a Band Watch profile.");
  for (const k of PROFILE_KEYS) {
    const v = p.data[k];
    try {
      if (typeof v === "string") localStorage.setItem(k, v); else localStorage.removeItem(k);
    } catch { /* too big: skip it */ }
  }
  location.reload();
}

function renderProfiles() {
  const all = loadProfiles();
  const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  $("profList").innerHTML = names.length
    ? names.map((n) => `<li><span><b>${esc(n)}</b> <span class="small muted">${esc((all[n].saved || "").slice(0, 10))}</span></span>` +
      `<span><button type="button" class="ghost" data-load="${esc(n)}">Load</button> <button type="button" class="ghost" data-del="${esc(n)}" aria-label="Delete ${esc(n)}">Delete</button></span></li>`).join("")
    : `<li class="small muted">No saved profiles yet.</li>`;
  $("profList").querySelectorAll("[data-load]").forEach((b) => { b.onclick = () => applyProfile(loadProfiles()[b.dataset.load]); });
  $("profList").querySelectorAll("[data-del]").forEach((b) => {
    b.onclick = () => { const a = loadProfiles(); delete a[b.dataset.del]; saveProfiles(a); renderProfiles(); };
  });
}

function setupProfiles() {
  const msg = (t) => { $("profMsg").textContent = t; };
  $("profSave").addEventListener("click", () => {
    const name = $("profName").value.trim().slice(0, 40);
    if (!name) { msg("Give the profile a name, like “Home” or “Portable”."); return; }
    const all = loadProfiles();
    all[name] = currentProfile();
    if (!saveProfiles(all)) {
      delete all[name].data["bw-bg"];
      msg(saveProfiles(all) ? `Saved “${name}”, without the background picture (too big to store twice).` : "This browser's storage is full.");
    } else {
      msg(`Saved “${name}”.`);
    }
    $("profName").value = "";
    renderProfiles();
  });
  $("profExport").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ bandWatchProfile: currentProfile() }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `band-watch-profile-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    msg("Profile file saved to your downloads.");
  });
  $("profImport").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const j = JSON.parse(await file.text());
      applyProfile(j.bandWatchProfile || j);
    } catch (err) {
      msg(err instanceof SyntaxError ? "That file isn't a Band Watch profile." : err.message);
    }
  });
}

/* ===================== Desktop app ===================== */

async function quitDesktop() {
  try {
    await fetch("/api/quit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch { /* it's stopping */ }
  $("optDlg").close();
  document.body.innerHTML = `<div class="wrap"><h1>Band Watch has stopped</h1><p>You can close this tab. Open Band Watch from the desktop or Start menu to start it again.</p></div>`;
}

/* ---------- About this build ---------- */

// What each version added. The build date of the copy you're running comes from the server.
const VERSION_HISTORY = [
  ["1.24.0", "ClearRX audio: voice filter, CW peak, auto notch, noise reduction and steady volume for your RTL-SDR"],
  ["1.23.0", "A Help guide (the Help button at the top), and step-by-step set-up for the Icom IC-7300"],
  ["1.22.0", "Listen goes with the popped-out radio and plays there; everything looks 3D and sharp"],
  ["1.21.0", "Radio panel: a waterfall under the spectrum, Pop out into its own window, and a 3D glossy look"],
  ["1.20.0", "Radio panel: big frequency display, S-meter, close-up spectrum, band and mode keys and a tuning knob"],
  ["1.19.0", "Shortwave stations on air now, from the EiBi schedule: click one to tune your ATS Mini or radio"],
  ["1.18.0", "ATS Mini: a live digital readout (frequency, S-meter, SNR) over the picture of its screen"],
  ["1.17.0", "Malahit DSP2 support (10 kHz to 2 GHz); ATS Mini live screen fixed for firmware before 2.41; shows which USB port is in use"],
  ["1.16.0", "Own windows: press ⧉ on the scope, map, Listen, ATS Mini and other parts to put them on another screen"],
  ["1.15.0", "ATS Mini panel: a live picture of the radio's screen with buttons, and each radio make keeps to its own USB port"],
  ["1.14.0", "ATS Mini support: pick it in Settings > Radio control and Band Watch changes its band and mode and tunes it for you"],
  ["1.13.1", "rtl_tcp comes with the Windows app, so Listen with your RTL-SDR works straight away (rtl-sdr's GPL licence is in C:\\BandWatch\\COPYING-rtl-sdr.txt)"],
  ["1.13.0", "Icom (CI-V) and Kenwood radio control beside Yaesu; Send to QRZ puts your log straight into your QRZ logbook; Listen starts rtl_tcp for you and shows problems clearly; the Twente WebSDR opens in its own window; an Updates section at the top of Settings, with links to Band Watch on GitHub"],
  ["1.12.3", "On Windows, Band Watch opens in its own window (no address bar or tabs) instead of a browser tab; brighter, glossy colours"],
  ["1.12.2", "Install updates from Settings, About this build; the installer updates your copy in place (no need to uninstall)"],
  ["1.12.1", "SOTA spots removed (SOTA's API terms don't allow AI-written software without approval); POTA checked every two minutes"],
  ["1.12.0", "Yaesu FT-991A radio control over USB; POTA activators on a list, the map and the scope; a logbook with ADIF export and import; wanted alerts; WSPR and CW decoders"],
  ["1.11.1", "Everything in C:\\BandWatch, including the log; install.bat installs there too and removes the old copy in AppData"],
  ["1.11.0", "Live band scope: real spectrum and waterfall from your RTL-SDR, with spotted stations marked; switch back to the spot-based scope any time"],
  ["1.10.0", "RTL-SDR settings: dongle type (Blog V4, V3 with direct sampling, others), sample rate up to 2.4 MS/s, filter widths, squelch, AGC speed, FM de-emphasis; build dates shown here"],
  ["1.9.0", "FT8 and FT4 decoders with a results window; RTL-SDR connection settings and rtl_tcp launcher; one-file Windows installer (BandWatch-Setup.exe) that installs to C:\\BandWatch"],
  ["1.8.0", "RTL-SDR Blog V4 receiver through rtl_tcp, with waterfall and click-to-tune"],
  ["1.7.0", "Windows installer that checks Smart App Control; install page for phones and PCs"],
];

/** "16 Nov 2026, 20:50 UTC", from an ISO date. */
function fmtBuildDate(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

function renderAbout() {
  if (!$("optAbout")) return;
  const page = (document.querySelector('script[src*="app.js?v="]') || {}).src || "";
  const pageVer = (page.match(/v=([\d.]+)/) || [])[1] || "";
  $("abHist").innerHTML = VERSION_HISTORY.map(([v, what]) => `<li><b>${esc(v)}</b>: ${esc(what)}</li>`).join("");
  checkForUpdate();
  getJson("/healthz").then((h) => {
    const b = h.build || {};
    const ago = (iso) => {
      const ms = Date.now() - new Date(iso).getTime();
      if (!Number.isFinite(ms) || ms < 0) return "";
      const days = Math.floor(ms / 86400000);
      return days >= 1 ? ` (${days} day${days === 1 ? "" : "s"} ago)` : "";
    };
    const where = h.desktop ? "Band Watch app on this PC (BandWatch.exe)"
      : b.server === "Node.js" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? "Band Watch on this PC (Node.js)"
      : "Web version";
    const rows = [
      ["Version", h.version || pageVer],
      ["Built", b.date ? fmtBuildDate(b.date) + ago(b.date) : "Not recorded (a development copy)"],
      ["Running as", where],
      b.runtime && ["Server", `${b.server || ""} ${b.runtime}${b.platform ? `, ${b.platform}` : ""}`.trim()],
      b.started && ["Server started", fmtBuildDate(b.started)],
      pageVer && pageVer !== h.version && ["Page files", `${pageVer} (reload the page to update)`],
    ].filter(Boolean);
    $("optAbout").innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");
  }).catch(() => {
    $("optAbout").innerHTML = `<dt>Version</dt><dd>${esc(pageVer || "unknown")}</dd><dt>Built</dt><dd>Couldn't reach the server</dd>`;
  });
}

/* ---------- Updates ---------- */

const updateState = { info: null, installing: false };

/** Ask the server whether there's a newer Band Watch. */
async function checkForUpdate() {
  try {
    const r = await fetch("/api/update", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    updateState.info = await r.json();
  } catch {
    updateState.info = { error: true };
  }
  renderUpdate();
  return updateState.info;
}

function renderUpdate() {
  const el = $("abUpdate");
  if (!el) return;
  const u = updateState.info;
  if (updateState.installing) {
    el.innerHTML = `Installing Band Watch ${esc(updateState.installing)}… Band Watch closes and opens again by itself in a minute or so.`;
    return;
  }
  if (!u) { el.textContent = "Checking for updates…"; return; }
  if (u.error) { el.innerHTML = `Couldn't check for updates just now. <button type="button" class="linkbtn" id="abCheck">Try again</button>`; }
  else if (!u.newer) { el.innerHTML = `You have the newest version. <button type="button" class="linkbtn" id="abCheck">Check again</button>`; }
  else if (u.canInstall) {
    el.innerHTML = `<b>Band Watch ${esc(u.latest)} is available.</b> <button type="button" class="tune" id="abInstall">Install update</button>
      <a href="${esc(u.page)}" target="_blank" rel="noopener noreferrer">What's new</a>`;
  } else {
    el.innerHTML = `<b>Band Watch ${esc(u.latest)} is available.</b> <a href="${esc(u.page)}" target="_blank" rel="noopener noreferrer">Download it</a>
      <span class="small muted">(The web version updates itself: just reload the page.)</span>`;
  }
  if ($("abCheck")) $("abCheck").onclick = () => { updateState.info = null; renderUpdate(); checkForUpdate(); };
  if ($("abInstall")) $("abInstall").onclick = installUpdate;
}

/** The Windows app downloads the new installer from GitHub, checks it, and installs it over this copy. */
async function installUpdate() {
  const u = updateState.info;
  if (!u || !u.canInstall) return;
  $("abInstall").disabled = true;
  $("abInstall").textContent = "Downloading…";
  try {
    const r = await fetch("/api/update/install", { method: "POST", headers: { "X-Band-Watch": "update" } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `the app answered ${r.status}`);
    updateState.installing = d.installing;
    renderUpdate();
    // When the new version answers, reload into it.
    const until = Date.now() + 5 * 60 * 1000;
    const poll = async () => {
      try {
        const h = await (await fetch("/healthz", { cache: "no-store" })).json();
        if (h.version === d.installing) { location.reload(); return; }
      } catch { /* restarting */ }
      if (Date.now() < until) setTimeout(poll, 2000);
    };
    setTimeout(poll, 4000);
  } catch (e) {
    $("abUpdate").innerHTML = `The update didn't work: ${esc(e.message)}. You can <a href="${esc(u.page)}" target="_blank" rel="noopener noreferrer">download it</a> instead.`;
  }
}

/** In the Windows app, look for an update once a day, and mention it. */
function updateNudge() {
  if (!app.desktop) return;
  let last = 0;
  try { last = Number(load("bw-update-checked")) || 0; } catch { /* none */ }
  if (Date.now() - last < 20 * 3600 * 1000) return;
  store("bw-update-checked", String(Date.now()));
  checkForUpdate().then((u) => {
    if (u && u.newer) showToast(`Band Watch ${u.latest} is available`, "Open Settings: Install update is at the top, under Updates.");
  });
}
