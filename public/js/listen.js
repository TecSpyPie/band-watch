/* Listen: tune a public web receiver (WebSDR or KiwiSDR) to a band, frequency and mode.
 * The receiver plays inside Band Watch when the page is served over plain http (BandWatch.exe on this PC),
 * otherwise in its own window. While it's open, clicking the scope, band plan or a spot retunes it. */
"use strict";

const LISTEN_MODES = [["usb", "USB"], ["lsb", "LSB"], ["am", "AM"], ["fm", "FM"], ["cw", "CW"], ["wfm", "WFM (broadcast)"]];
const TWENTE = "http://websdr.ewi.utwente.nl:8901";
const RECEIVERS = {
  twente: { name: "WebSDR, University of Twente (Netherlands), 0–29 MHz", max: 29160, kind: "websdr", base: () => TWENTE },
  websdr: { name: "Another WebSDR (enter its address)", kind: "websdr", base: () => listen.websdrUrl },
  kiwi: { name: "A KiwiSDR (enter its address)", max: 30000, kind: "kiwi", base: () => listen.kiwiUrl },
  rtl: { name: "My RTL-SDR (Blog V4 or any RTL-SDR), through rtl_tcp", get min() { return rtlMinKHz(); }, max: RTL_MAX_KHZ, kind: "rtl", base: () => sdr.addr },
};
const modesFor = (rx) => LISTEN_MODES.filter(([k]) => k !== "wfm" || RECEIVERS[rx].kind === "rtl");

const listen = {
  band: "20", kHz: 14200, mode: "usb", rx: "twente", embed: true,
  kiwiUrl: "", websdrUrl: "", step: 1,
  float: { on: false, x: null, y: null, w: 560, h: 620 }, // the popped-out window, in CSS pixels
  open: false, win: null, url: "",
};
const STEPS = [0.01, 0.1, 0.5, 1, 5, 10];

const canEmbed = () => location.protocol === "http:"; // an https page can't show an http receiver inside it

function loadListen() {
  try {
    const s = JSON.parse(load("bw-listen"));
    if (s && typeof s === "object") {
      for (const k of ["band", "mode", "rx", "kiwiUrl", "websdrUrl"]) if (typeof s[k] === "string") listen[k] = s[k];
      if (Number.isFinite(s.kHz)) listen.kHz = s.kHz;
      if (typeof s.embed === "boolean") listen.embed = s.embed;
      if (STEPS.includes(s.step)) listen.step = s.step;
      if (s.float && typeof s.float === "object") {
        const f = s.float, num = (v) => (Number.isFinite(v) ? v : null);
        listen.float = { on: Boolean(f.on), x: num(f.x), y: num(f.y), w: num(f.w) || 560, h: num(f.h) || 620 };
      }
    }
  } catch { /* defaults */ }
  if (!BANDPLAN[listen.band]) listen.band = "20";
  if (!RECEIVERS[listen.rx]) listen.rx = "twente";
}
function saveListen() {
  const { band, kHz, mode, rx, embed, kiwiUrl, websdrUrl, step, float } = listen;
  store("bw-listen", { band, kHz, mode, rx, embed, kiwiUrl, websdrUrl, step, float });
}

/** A receiver address the user typed: http(s) only, no path tricks. */
function cleanReceiverUrl(raw) {
  try {
    const u = new URL(String(raw).trim().replace(/^(?!https?:\/\/)/i, "http://"));
    if (!/^https?:$/.test(u.protocol) || !u.hostname) return "";
    return `${u.protocol}//${u.host}`;
  } catch { return ""; }
}

function receiverUrl() {
  const rx = RECEIVERS[listen.rx];
  const base = rx.base();
  if (!base) return "";
  const k = Math.round(listen.kHz * 100) / 100;
  if (rx.kind === "kiwi") return `${base}/?f=${k}${listen.mode === "fm" ? "nbfm" : listen.mode}`;
  return `${base}/?tune=${k}${listen.mode}&messageorigin=${encodeURIComponent(location.origin)}`;
}

function bandForKHz(k) {
  return PLAN_BANDS.find((b) => k >= BANDPLAN[b].lo - 1 && k <= BANDPLAN[b].hi + 1) || null;
}

/** Problems with the current choice, or "" if the receiver can tune there. */
function listenProblem() {
  const rx = RECEIVERS[listen.rx];
  if (!(listen.kHz > 0)) return "Enter a frequency in kHz.";
  if (rx.kind === "rtl") {
    if (sdr.available === false) return "The RTL-SDR receiver works in Band Watch on your own PC (the Windows app), not on the website.";
    if (listen.kHz < rx.min || listen.kHz > rx.max) return `The ${DONGLES[sdr.dongle].name} tunes from ${rx.min >= 1000 ? `${rx.min / 1000} MHz` : `${rx.min} kHz`} to 1,766 MHz.`;
    return "";
  }
  if (!rx.base()) return rx.kind === "kiwi" ? "Enter the address of a KiwiSDR, for example http://kiwi.example.org:8073" : "Enter the address of a WebSDR.";
  if (rx.max && listen.kHz > rx.max) {
    return `${rx.name.split(",")[0]} only covers up to ${(rx.max / 1000).toLocaleString()} MHz. ` +
      (listen.kHz >= 50000 ? "For 6 m, try a WebSDR from the list at websdr.org." : "Try a KiwiSDR (most cover up to 30 MHz).");
  }
  return "";
}

function renderListen() {
  $("lsBand").innerHTML = PLAN_BANDS.map((b) => `<option value="${b}"${b === listen.band ? " selected" : ""}>${b} m</option>`).join("");
  if (!modesFor(listen.rx).some(([k]) => k === listen.mode)) listen.mode = "usb";
  $("lsMode").innerHTML = modesFor(listen.rx).map(([k, l]) => `<option value="${k}"${k === listen.mode ? " selected" : ""}>${l}</option>`).join("");
  $("lsRx").innerHTML = Object.entries(RECEIVERS).map(([k, r]) => `<option value="${k}"${k === listen.rx ? " selected" : ""}>${esc(r.name)}</option>`).join("");
  if (document.activeElement !== $("lsFreq")) $("lsFreq").value = listen.kHz;
  const isRtl = RECEIVERS[listen.rx].kind === "rtl";
  $("lsFreq").max = isRtl ? RTL_MAX_KHZ : 60000;
  $("lsRtl").hidden = !isRtl;
  $("lsEmbedRow").hidden = isRtl;
  if (isRtl) renderSdr();
  $("lsKiwiRow").hidden = listen.rx !== "kiwi";
  $("lsWebsdrRow").hidden = listen.rx !== "websdr";
  $("lsKiwi").value = listen.kiwiUrl;
  $("lsWebsdr").value = listen.websdrUrl;
  $("lsEmbed").checked = listen.embed && canEmbed();
  $("lsEmbed").disabled = !canEmbed();
  $("lsEmbedNote").textContent = canEmbed() ? "" : "Web receivers use plain http, so on this secure page they open in their own window. In the Windows app they play inside Band Watch.";

  const p = BANDPLAN[listen.band];
  $("lsPresets").innerHTML = p.centres.map(([k, label]) => `<button type="button" data-k="${k}">${esc(label)} ${k.toLocaleString()}</button>`).join("");
  $("lsPresets").querySelectorAll("button").forEach((b) => { b.onclick = () => tuneTo(Number(b.dataset.k), modeForFreq(Number(b.dataset.k)), { quiet: true }); });

  renderDial();
  renderStations();

  const seg = planSegment(listen.kHz);
  const problem = listenProblem();
  $("lsWhere").innerHTML = `<b>${listen.kHz.toLocaleString()} kHz ${listen.mode.toUpperCase()}</b>` +
    (seg ? ` · ${esc(seg.use)}` : listen.kHz ? " · outside the amateur bands" : "");
  $("lsErr").textContent = problem;
  $("lsGo").disabled = Boolean(problem);
  $("lsGo").textContent = listen.open ? "Retune" : "Listen";
  $("lsStop").hidden = !listen.open;
  $("lsFrame").hidden = isRtl || !(listen.open && listen.embed && canEmbed());
  if (typeof dcRenderTune === "function") dcRenderTune();
}

/** Tune to a frequency (kHz) and mode. Retunes an open receiver; opens one if asked to. */
function tuneTo(kHz, mode, { open = false, scroll = false, quiet = false } = {}) {
  listen.kHz = Math.round(kHz * 100) / 100;
  if (mode) listen.mode = mode;
  listen.band = bandForKHz(listen.kHz) || listen.band;
  saveListen();
  renderListen();
  renderPlan();
  drawScope();
  if (open || listen.open) startListening();
  if (typeof rigTune === "function" && !rig.applying) rigTune(listen.kHz, listen.mode); // your radio follows
  if (scroll && !listen.float.on) $("secListen").scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (!quiet) showToast("Tuned", `${listen.kHz.toLocaleString()} kHz ${listen.mode.toUpperCase()}${listen.open ? "" : ". Press Listen to hear it."}`);
}

function startListening() {
  if (listenProblem()) { renderListen(); return; }
  if (RECEIVERS[listen.rx].kind === "rtl") {
    if (listen.url) { $("lsFrame").src = "about:blank"; listen.url = ""; }
    if (listen.win && !listen.win.closed) listen.win.close();
    listen.win = null;
    listen.open = true;
    if (sdr.running) sdrTune(); else sdrStart().then(renderListen);
    renderListen();
    $("lsErr").textContent = "";
    return;
  }
  if (sdr.running) sdrStop();
  const url = receiverUrl();
  const rx = RECEIVERS[listen.rx];
  const live = rx.kind === "websdr" && listen.open && url.split("?")[0] === listen.url.split("?")[0];
  if (listen.embed && canEmbed()) {
    const frame = $("lsFrame");
    if (live && frame.contentWindow) frame.contentWindow.postMessage(`tune ${listen.kHz}${listen.mode}`, "*");
    else frame.src = url;
    listen.win = null;
  } else {
    if (live && listen.win && !listen.win.closed) {
      listen.win.postMessage(`tune ${listen.kHz}${listen.mode}`, "*");
    } else {
      listen.win = window.open(url, "bandwatch-receiver", "popup,width=1100,height=760");
      if (!listen.win) {
        $("lsErr").innerHTML = `Your browser blocked the receiver window. <a href="${esc(url)}" target="bandwatch-receiver" rel="noopener">Open it here</a>.`;
        return;
      }
    }
  }
  listen.url = url;
  listen.open = true;
  renderListen();
  $("lsErr").textContent = rx.kind === "websdr" ? "Click inside the receiver if you don't hear anything: browsers need a click before they play sound." : "";
}

function stopListening() {
  if (sdr.running) sdrStop();
  $("lsFrame").src = "about:blank";
  if (listen.win && !listen.win.closed) listen.win.close();
  listen.win = null;
  listen.open = false;
  listen.url = "";
  renderListen();
}

/* ---------- Tuning dial, steps and the stations heard on the band ---------- */

const fmtKHz = (k) => k.toLocaleString(undefined, { maximumFractionDigits: 2 });

function renderDial() {
  const p = BANDPLAN[listen.band];
  const d = $("lsSlider");
  d.min = p.lo;
  d.max = p.hi;
  if (document.activeElement !== d) d.value = Math.min(p.hi, Math.max(p.lo, listen.kHz));
  $("lsStep").value = String(listen.step);
}

/** Frequencies to tune to on the current band, from the live spots: one entry per dial frequency and mode. */
function stationTunes() {
  const map = new Map();
  for (const p of app.pairs) {
    if (p.band !== listen.band) continue;
    const t = tuning(p);
    const key = `${t.kHz}|${t.mode}`;
    const e = map.get(key) || { kHz: t.kHz, mode: t.mode, calls: [], modes: new Set(), snr: null };
    const call = baseCall(p.c);
    if (!e.calls.includes(call)) e.calls.push(call);
    e.modes.add(p.m || "?");
    if (p.snr != null && (e.snr == null || p.snr > e.snr)) e.snr = p.snr;
    map.set(key, e);
  }
  return [...map.values()].sort((a, b) => a.kHz - b.kHz);
}

function stationLabel(e) {
  const modes = [...e.modes].join("/");
  const who = e.calls.length === 1 ? e.calls[0] : `${e.calls.length} stations: ${e.calls.slice(0, 3).join(", ")}${e.calls.length > 3 ? "…" : ""}`;
  return `${fmtKHz(e.kHz)} kHz ${e.mode.toUpperCase()} · ${modes} · ${who}${e.snr != null ? `, best ${e.snr} dB` : ""}`;
}

function renderStations() {
  const sel = $("lsStations");
  if (document.activeElement === sel) return; // don't change the list while it's being used
  const list = stationTunes();
  listen.stations = list;
  const here = list.findIndex((e) => Math.abs(e.kHz - listen.kHz) < 0.005);
  sel.innerHTML = `<option value="">${list.length ? `Stations heard on ${listen.band} m (${list.length})` : `No stations spotted on ${listen.band} m right now`}</option>` +
    list.map((e, i) => `<option value="${i}"${i === here ? " selected" : ""}>${esc(stationLabel(e))}</option>`).join("");
  sel.disabled = !list.length;
  $("lsPrev").disabled = !list.some((e) => e.kHz < listen.kHz - 0.005);
  $("lsNext").disabled = !list.some((e) => e.kHz > listen.kHz + 0.005);
}

function tuneStation(e) {
  if (e) tuneTo(e.kHz, e.mode, { quiet: true });
}

function stepTune(dir, steps = 1) {
  tuneTo(listen.kHz + dir * steps * listen.step, null, { quiet: true });
}

/* ---------- Pop out: a window that can be dragged and resized ---------- */

const zoomFactor = () => (settings.zoom || 100) / 100;

function placeFloat() {
  const el = $("secListen");
  const f = listen.float;
  const z = zoomFactor();
  const vw = innerWidth / z, vh = innerHeight / z;
  const w = Math.min(f.w || 560, vw - 8), h = Math.min(f.h || 620, vh - 8);
  const x = f.x == null ? vw - w - 16 : f.x;
  const y = f.y == null ? 72 : f.y;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  el.style.left = `${Math.max(0, Math.min(vw - 120, x))}px`;
  el.style.top = `${Math.max(0, Math.min(vh - 40, y))}px`;
}

function setFloating(on) {
  const el = $("secListen");
  listen.float.on = on;
  el.classList.toggle("floating", on);
  $("lsDock").classList.toggle("on", on);
  $("lsPop").textContent = on ? "Dock" : "Pop out";
  $("lsPop").setAttribute("aria-pressed", String(on));
  if (on) placeFloat();
  else for (const k of ["left", "top", "width", "height"]) el.style[k] = "";
  saveListen();
}

function setupFloating() {
  const el = $("secListen");
  const head = $("lsHead");
  let drag = null;
  head.addEventListener("pointerdown", (e) => {
    if (!listen.float.on || e.target.closest("button, select, input, a")) return;
    const z = zoomFactor();
    drag = { dx: e.clientX / z - el.offsetLeft, dy: e.clientY / z - el.offsetTop };
    head.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    e.preventDefault();
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const z = zoomFactor();
    listen.float.x = e.clientX / z - drag.dx;
    listen.float.y = e.clientY / z - drag.dy;
    placeFloat();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    el.classList.remove("dragging");
    listen.float.x = el.offsetLeft;
    listen.float.y = el.offsetTop;
    saveListen();
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
  // Remember the size after the user resizes the window from its corner.
  if (window.ResizeObserver) {
    let t = 0;
    new ResizeObserver(() => {
      if (!listen.float.on || drag) return;
      clearTimeout(t);
      t = setTimeout(() => { listen.float.w = el.offsetWidth; listen.float.h = el.offsetHeight; saveListen(); }, 300);
    }).observe(el);
  }
  window.addEventListener("resize", () => { if (listen.float.on) placeFloat(); });
  $("lsPop").addEventListener("click", () => setFloating(!listen.float.on));
  $("lsDockBtn").addEventListener("click", () => setFloating(false));
  if (listen.float.on) setFloating(true);
}

function setupTuner() {
  // Hold + or − to keep tuning.
  for (const [id, dir] of [["lsDown", -1], ["lsUp", 1]]) {
    const b = $(id);
    let delay = 0, rep = 0;
    const stop = () => { clearTimeout(delay); clearInterval(rep); };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stepTune(dir);
      delay = setTimeout(() => { rep = setInterval(() => stepTune(dir), 110); }, 420);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) b.addEventListener(ev, stop);
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stepTune(dir); } });
  }
  $("lsStep").addEventListener("change", (e) => { listen.step = Number(e.target.value); saveListen(); });

  // The dial moves the tuned frequency at once and retunes the receiver when it settles.
  let settle = 0;
  $("lsSlider").addEventListener("input", (e) => {
    listen.kHz = Math.round(Number(e.target.value) * 100) / 100;
    $("lsFreq").value = listen.kHz;
    $("lsWhere").innerHTML = `<b>${fmtKHz(listen.kHz)} kHz ${listen.mode.toUpperCase()}</b>`;
    drawScope();
    clearTimeout(settle);
    settle = setTimeout(() => tuneTo(listen.kHz, null, { quiet: true }), 250);
  });
  $("lsSlider").addEventListener("change", () => { clearTimeout(settle); tuneTo(listen.kHz, null, { quiet: true }); });
  // The mouse wheel tunes by one step over the dial or the frequency box.
  for (const id of ["lsSlider", "lsFreq"]) {
    $(id).addEventListener("wheel", (e) => {
      e.preventDefault();
      stepTune(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
  }

  $("lsStations").addEventListener("change", (e) => {
    const s = listen.stations && listen.stations[Number(e.target.value)];
    e.target.blur();
    tuneStation(s);
  });
  $("lsPrev").addEventListener("click", () => tuneStation([...(listen.stations || [])].reverse().find((e) => e.kHz < listen.kHz - 0.005)));
  $("lsNext").addEventListener("click", () => tuneStation((listen.stations || []).find((e) => e.kHz > listen.kHz + 0.005)));
}

function setupListen() {
  setupSdr();
  loadListen();
  setupTuner();
  setupFloating();
  $("lsBand").addEventListener("change", (e) => {
    listen.band = e.target.value;
    const p = BANDPLAN[listen.band];
    const phone = p.segs.find(([, , t]) => t === "all") || p.segs[0];
    const k = listen.mode === "cw" ? p.segs[0][0] + 30 : listen.mode === "fm" ? (p.centres.find(([, l]) => /FM/.test(l)) || [phone[0] + 10])[0] : phone[0] + Math.min(60, (phone[1] - phone[0]) / 2);
    tuneTo(k, listen.mode === "cw" || listen.mode === "fm" ? listen.mode : modeForFreq(k), { quiet: true });
  });
  $("lsFreq").addEventListener("change", (e) => {
    const k = Number(String(e.target.value).replace(",", "."));
    if (k > 0) tuneTo(k < 1000 ? k * 1000 : k, null, { quiet: true }); // MHz typed by mistake
  });
  $("lsMode").addEventListener("change", (e) => tuneTo(listen.kHz, e.target.value, { quiet: true }));
  $("lsRx").addEventListener("change", (e) => {
    listen.rx = e.target.value;
    saveListen();
    if (listen.open) stopListening();
    if (RECEIVERS[listen.rx].kind === "rtl") checkSdr();
    renderListen();
  });
  $("lsKiwi").addEventListener("change", (e) => { listen.kiwiUrl = cleanReceiverUrl(e.target.value); saveListen(); renderListen(); });
  $("lsWebsdr").addEventListener("change", (e) => { listen.websdrUrl = cleanReceiverUrl(e.target.value); saveListen(); renderListen(); });
  $("lsEmbed").addEventListener("change", (e) => {
    const was = listen.open;
    const embed = e.target.checked;
    stopListening();
    listen.embed = embed;
    saveListen();
    if (was) startListening();
    renderListen();
  });
  $("lsGo").addEventListener("click", startListening);
  $("lsStop").addEventListener("click", stopListening);
  renderListen();
}
