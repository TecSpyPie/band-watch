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
  theme: "system", look: "classic", accent: "", text: 100, zoom: 100, width: "1100px", cols: "auto", density: "comfortable",
  scopeRes: "normal", scopeH: "280px", hide: [], modesOff: [], bgDim: 55, addons: [], secNav: true,
};
let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const saved = JSON.parse(load("bw-display"));
    if (saved && typeof saved === "object") {
      settings = { ...DEFAULT_SETTINGS, ...saved, hide: Array.isArray(saved.hide) ? saved.hide : [], modesOff: Array.isArray(saved.modesOff) ? saved.modesOff : [],
        addons: Array.isArray(saved.addons) ? saved.addons.filter((a) => typeof a === "string") : [] };
    }
  } catch { /* defaults */ }
}

/** Apply the display options to the page. Colours that depend on the theme are re-read by the scope and map. */
function applySettings() {
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme; else root.dataset.theme = settings.theme;
  // The 3D looks (looks.css); High contrast and Night always stay plain.
  const look = ["rig", "glass", "space"].includes(settings.look) && settings.theme !== "contrast" && settings.theme !== "night" ? settings.look : "";
  if (look) root.dataset.look = look; else delete root.dataset.look;
  root.dataset.density = settings.density;
  root.dataset.cols = settings.cols;
  root.dataset.hide = settings.hide.join(" ");
  root.dataset.addons = (settings.addons || []).join(" ");
  if (settings.secNav === false) root.dataset.secnav = "off"; else delete root.dataset.secnav;
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
  $("optLook").value = settings.look || "classic";
  $("optLookNote").hidden = !(settings.theme === "contrast" || settings.theme === "night") || settings.look === "classic";
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
  $("optSecNav").checked = settings.secNav !== false;
  $("optAddons").querySelectorAll("input[data-addon]").forEach((i) => { i.checked = (settings.addons || []).includes(i.dataset.addon); });
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
    // A new look or theme fades in softly (where the browser can, and not for people who ask for reduced motion)
    const fade = (id === "optLook" || id === "optTheme") && document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (fade) document.startViewTransition(saveSettings).ready.catch(() => {}); // a quicker change skips the last fade: fine
    else saveSettings();
  });
  bind("optTheme", "theme"); bind("optLook", "look"); bind("optText", "text", true);
  for (const id of ["optTheme", "optLook"]) $(id).addEventListener("input", renderOptions); bind("optZoom", "zoom", true); bind("optWidth", "width");
  bind("optCols", "cols"); bind("optDensity", "density"); bind("optScopeRes", "scopeRes"); bind("optScopeH", "scopeH");
  $("optDim").addEventListener("input", (e) => { settings.bgDim = Number(e.target.value); $("optDimVal").textContent = `${settings.bgDim}%`; store("bw-display", settings); applySettings(); });
  $("optSecNav").addEventListener("change", (e) => { settings.secNav = e.target.checked; saveSettings(); });
  $("optReset").addEventListener("click", () => {
    settings = { ...DEFAULT_SETTINGS, hide: [], modesOff: settings.modesOff };
    saveSettings();
    renderOptions();
  });
  // Add-ons: ticking one shows its panel straight away (and takes you to it)
  $("optAddons").addEventListener("change", (e) => {
    const i = e.target.closest("input[data-addon]");
    if (!i) return;
    const k = i.dataset.addon;
    settings.addons = i.checked ? [...new Set([...(settings.addons || []), k])] : (settings.addons || []).filter((x) => x !== k);
    saveSettings();
    const sec = { rotator: "secRot", dv: "secDv" }[k];
    if (i.checked && sec && $(sec)) setTimeout(() => $(sec).scrollIntoView({ behavior: "smooth", block: "start" }), 50);
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

const PROFILE_KEYS = ["bw-display", "bw-grid", "bw-call", "bw-mon", "bw-clocks", "bw-clocks-auto", "bw-locauto", "bw-listen", "bw-sdr", "bw-decode", "bw-bg", "bw-rig", "bw-xota", "bw-sats", "bw-log", "bw-wanted", "bw-repeaters"];

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
  ["1.42.0", "Chat with other Band Watch users, contests this week, who's hearing me and worked maps, log from a spot, space weather forecast with an aurora alert, Morse trainer and a full-screen shack screen"],
  ["1.41.0", "Looks: soft light that follows your mouse, sharper spectrum and screens, smooth motion, cross-fading look changes and a glowing keyboard focus; ClearRX Hiss remover that can learn your noise"],
  ["1.40.0", "Section menu and folding panels, RTTY receiver, Antenna A/B (WSPR, FT8, FT4), live world map, layered Glass look, 2 m and 70 cm with My repeaters, stuck-receiver recovery; ClearRX effects rack and 3D scope"],
  ["1.39.0", "Digital voice add-on: one-click C4FM on a Yaesu radio, BrandMeister (Hoseline, talkgroups, last heard), UK repeater lists, your hotspot's dashboard"],
  ["1.38.0", "CB channels to listen to (UK 27/81 and CEPT), and Help pages on UK licences and exams and good operating"],
  ["1.37.0", "APRS on 2 m: decode packets with your RTL-SDR (144.800 MHz FM or the ISS), stations and weather on the map"],
  ["1.36.0", "Add-ons in Settings; the Rotator add-on: compass dial, point at a locator or callsign (short/long path), follow a satellite"],
  ["1.35.0", "New looks with depth in Settings > Look: Radio front panel, Glass and depth, and Space station (moving stars)"],
  ["1.34.0", "CW keyboard: type and hear Morse as you go (Practice), or send it on the air with break-in, message buttons and Farnsworth spacing"],
  ["1.33.0", "Decode table: choose and resize columns, an on-air Frequency column, times in any time zone with a clock; completed QSOs can log themselves"],
  ["1.32.0", "Send SSTV pictures (any mode, your text on it, preview, countdown), and band checks against the whole UK band plan for all transmitting"],
  ["1.31.0", "SSTV pictures: all the common analogue modes (Martin, Scottie, Robot, PD, Wraase, Pasokon), auto start from the VIS code, slant fix, gallery"],
  ["1.30.0", "Transmit FT8 and FT4 from the Decoder: Reply, Call CQ, automatic QSO messages, Log QSO, Tune and Level, with Enable TX and Stop TX for safety"],
  ["1.29.0", "Click a satellite (map, list or passes) for its card: identifiers, where it is, orbit, a sky chart of the pass, frequencies and next passes"],
  ["1.28.0", "Satellites: the ISS and amateur satellites over your locator, next passes, pass alerts, the map, and Doppler-corrected tuning"],
  ["1.27.0", "RTL-SDR attenuator: ATT (10, 20, 30 dB) on the Radio panel and in Listen, for strong signals"],
  ["1.26.0", "ClearRX 1.2.0: noise blanker, AGC speed, squelch, bass and treble, and a manual notch (used by Band Watch's RTL-SDR sound too)"],
  ["1.25.1", "The Radio panel's S-meter follows the RTL-SDR's signal level (a rough guide) when no radio is connected"],
  ["1.25.0", "Receive controls on the Radio panel: AF/RF gain, AGC, ATT, IPO, NB, DNR and auto notch (Yaesu and Icom)"],
  ["1.24.2", "ClearRX 1.1.0: My radio buttons (RTL-SDR, Yaesu, Icom, ATS Mini, Malahit, Other) pick the right sound input"],
  ["1.24.1", "ClearRX is a separate download (ClearRX-Windows.zip), so the Band Watch installer stays clean"],
  ["1.24.0", "New: ClearRX by M3VRV, a radio audio processor of its own, linked to Band Watch's RTL-SDR sound"],
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

/**
 * Ask the server whether there's a newer Band Watch. fresh (the Check now button) makes the server ask GitHub
 * again rather than use its answer from the last hour (it still asks at most once every 2 minutes).
 */
async function checkForUpdate(fresh = false) {
  try {
    const r = await fetch(fresh ? "/api/update?fresh=1" : "/api/update", { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    updateState.info = await r.json();
  } catch {
    updateState.info = { error: true };
  }
  renderUpdate();
  return updateState.info;
}

/** "Last checked just now" / "Last checked 5 minutes ago (14:02)", from the server's ISO time. */
function updateCheckedText(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const mins = Math.max(0, Math.floor((now - t) / 60000));
  const at = new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (mins < 1) return "Last checked just now.";
  if (mins < 60) return `Last checked ${mins} minute${mins === 1 ? "" : "s"} ago (${at}).`;
  return `Last checked at ${at}.`;
}

function renderUpdate() {
  const el = $("abUpdate");
  if (!el) return;
  const u = updateState.info;
  const btn = $("updCheckNow");
  if (btn) btn.hidden = !!updateState.installing;
  if (updateState.installing) {
    el.innerHTML = `Installing Band Watch ${esc(updateState.installing)}… Band Watch closes and opens again by itself in a minute or so.`;
    return;
  }
  if (!u) { el.textContent = "Checking for updates…"; return; }
  if (u.error) { el.innerHTML = `Couldn't check for updates just now. Try <b>Check now</b> in a minute or two.`; return; }
  let when = esc(updateCheckedText(u.checked));
  if (u.stale && when) when = `GitHub didn't answer just now, so this is from the last check. ${when}`;
  const note = when ? ` <span class="small muted updwhen">${when}</span>` : "";
  if (!u.newer) { el.innerHTML = `You have the newest version.${note}`; }
  else if (u.canInstall) {
    el.innerHTML = `<b>Band Watch ${esc(u.latest)} is available.</b> <button type="button" class="tune" id="abInstall">Install update</button>
      <a href="${esc(u.page)}" target="_blank" rel="noopener noreferrer">What's new</a>${note}`;
  } else {
    el.innerHTML = `<b>Band Watch ${esc(u.latest)} is available.</b> <a href="${esc(u.page)}" target="_blank" rel="noopener noreferrer">Download it</a>
      <span class="small muted">(The web version updates itself: just reload the page.)</span>${note}`;
  }
  if ($("abInstall")) $("abInstall").onclick = installUpdate;
}

/** The Check now button in Settings > Updates. */
async function checkNowClicked() {
  const btn = $("updCheckNow");
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.textContent = "Checking…";
  updateState.info = null;
  renderUpdate();
  try { await checkForUpdate(true); } finally {
    btn.disabled = false;
    btn.textContent = "Check now";
  }
}
if ($("updCheckNow")) $("updCheckNow").addEventListener("click", checkNowClicked);

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
