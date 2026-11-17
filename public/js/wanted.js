/* Wanted alerts: tell me when a station, country prefix or grid square I want turns up in the spots,
   my decodes or the POTA activators. Optionally, any grid square that isn't in my log yet. */
"use strict";

const WANTED_REPEAT_MS = 30 * 60 * 1000; // the same station on the same band alerts again after 30 minutes
const wanted = { calls: "", grids: "", newGrids: false, sound: true, hits: [], told: new Map() };

function loadWanted() {
  try {
    const s = JSON.parse(load("bw-wanted") || "{}");
    if (typeof s.calls === "string") wanted.calls = s.calls.slice(0, 2000);
    if (typeof s.grids === "string") wanted.grids = s.grids.slice(0, 2000);
    if (typeof s.newGrids === "boolean") wanted.newGrids = s.newGrids;
    if (typeof s.sound === "boolean") wanted.sound = s.sound;
  } catch { /* defaults */ }
}
function saveWanted() {
  store("bw-wanted", { calls: wanted.calls, grids: wanted.grids, newGrids: wanted.newGrids, sound: wanted.sound });
}

const wantedTokens = (text) => String(text || "").toUpperCase().split(/[\s,;]+/).map((t) => t.trim()).filter((t) => /^[A-Z0-9/*]{1,12}$/.test(t));

/** Does a callsign match a wanted entry? "VK*" or "VK" is a prefix, "VP8LP" an exact call. */
function callMatches(call, token) {
  const base = baseCall(call);
  if (token.includes("*")) {
    const re = new RegExp(`^${token.replace(/[^A-Z0-9*/]/g, "").replace(/\*/g, ".*")}$`);
    return re.test(base) || re.test(call);
  }
  const looksLikeCall = /\d/.test(token) && /[A-Z]$/.test(token) && token.length >= 4;
  return looksLikeCall ? base === token || call === token : base.startsWith(token);
}

/** Does a grid square match a wanted entry? "PM" is a field, "PM95" a square, "PM9*" a pattern. */
function gridMatches(grid, token) {
  const g = String(grid || "").toUpperCase();
  if (!/^[A-R]{2}(\d{2})?/.test(g)) return false;
  if (token.includes("*")) return new RegExp(`^${token.replace(/[^A-Z0-9*]/g, "").replace(/\*/g, ".*")}`).test(g);
  return g.startsWith(token);
}

/** Why a station is wanted, or "". */
function wantedReason(call, grid, { canWorkIt = false } = {}) {
  if (app.myCall && baseCall(call) === app.myCall) return ""; // that's you
  for (const t of wantedTokens(wanted.calls)) if (callMatches(call, t)) return `matches ${t}`;
  for (const t of wantedTokens(wanted.grids)) if (gridMatches(grid, t)) return `grid ${String(grid).slice(0, 4).toUpperCase()} matches ${t}`;
  if (wanted.newGrids && canWorkIt && /^[A-R]{2}\d{2}/i.test(grid || "") && typeof workedGrid === "function" && !workedGrid(grid)) {
    return `new grid square ${String(grid).slice(0, 4).toUpperCase()}`;
  }
  return "";
}

/** Look through everything heard just now and alert for anything wanted. */
function checkWanted() {
  if (!wantedTokens(wanted.calls).length && !wantedTokens(wanted.grids).length && !wanted.newGrids) return;
  const found = [];
  // FT8/FT4 decodes: stations you can work right now
  if (typeof dc !== "undefined" && Array.isArray(dc.rows)) {
    for (const r of dc.rows.slice(0, 200)) {
      const who = dcStation(r.text);
      if (!who) continue;
      const kHz = listen.kHz + r.freq / 1000;
      const why = wantedReason(who.call, who.grid, { canWorkIt: true });
      if (why) found.push({ call: who.call, grid: who.grid, kHz, mode: r.mode || "FT8", where: "your decodes", why });
    }
  }
  // POTA activators
  if (typeof xota !== "undefined") {
    for (const x of xota.spots) {
      const why = wantedReason(x.call, x.grid, { canWorkIt: true });
      if (why) found.push({ call: x.call, grid: x.grid, kHz: x.kHz, mode: x.mode, where: `${x.src.toUpperCase()} ${x.ref}`, why });
    }
  }
  // PSK Reporter spots near you (only wanted calls and grids, not "new grid": there are too many)
  for (const p of app.allPairs || []) {
    if (p.t > 10) continue;
    const why = wantedReason(p.c, p.g);
    if (why) found.push({ call: p.c, grid: p.g, kHz: p.fq * 1000, mode: p.m, where: p.dir === "rx" ? "heard near you" : "hearing your area", why });
  }
  const now = Date.now();
  const fresh = [];
  for (const f of found) {
    const key = `${baseCall(f.call)}|${bandForKHz(f.kHz) || Math.round(f.kHz)}`;
    if (now - (wanted.told.get(key) || 0) < WANTED_REPEAT_MS) continue;
    wanted.told.set(key, now);
    fresh.push({ ...f, t: now, band: bandForKHz(f.kHz) });
  }
  if (!fresh.length) return;
  wanted.hits = [...fresh, ...wanted.hits].slice(0, 30);
  const f = fresh[0];
  const more = fresh.length > 1 ? ` (and ${fresh.length - 1} more)` : "";
  const msg = `${f.call}${f.band ? ` on ${f.band} m` : ""} ${f.mode || ""}, ${f.where}: ${f.why}${more}`;
  showToast("Wanted station heard", msg);
  if (wanted.sound) wantedBeep();
  if (typeof monitor !== "undefined" && monitor.notify && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("Band Watch: wanted station", { body: msg, tag: `bw-wanted-${f.call}` }); } catch { /* not allowed */ }
  }
  renderWanted();
}

function wantedBeep() {
  try {
    const ctx = (typeof audio !== "undefined" && audio) || (window.__bwBeep ||= new (window.AudioContext || window.webkitAudioContext)());
    const t = ctx.currentTime;
    for (const [i, f] of [[0, 660], [1, 990]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = f;
      gain.gain.setValueAtTime(0.12, t + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.18 + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.18);
      osc.stop(t + i * 0.18 + 0.17);
    }
  } catch { /* no sound */ }
}

function renderWanted() {
  if (!$("wnCalls")) return;
  if (document.activeElement !== $("wnCalls")) $("wnCalls").value = wanted.calls;
  if (document.activeElement !== $("wnGrids")) $("wnGrids").value = wanted.grids;
  $("wnNew").checked = wanted.newGrids;
  $("wnSound").checked = wanted.sound;
  $("wnHits").innerHTML = wanted.hits.map((h, i) => `<li>${new Date(h.t).toISOString().slice(11, 16)} UTC · ${callLink(h.call)}
      <button type="button" class="tune wntune" data-i="${i}">${(Math.round(h.kHz * 10) / 10).toLocaleString()} kHz ${esc(h.mode || "")}</button>
      <span class="small muted">${esc(h.where)}: ${esc(h.why)}</span></li>`).join("")
    || `<li class="small muted">Nothing wanted heard yet.</li>`;
}

function setupWanted() {
  loadWanted();
  const changed = () => {
    wanted.calls = $("wnCalls").value;
    wanted.grids = $("wnGrids").value;
    wanted.newGrids = $("wnNew").checked;
    wanted.sound = $("wnSound").checked;
    saveWanted();
    checkWanted();
  };
  for (const id of ["wnCalls", "wnGrids"]) $(id).addEventListener("change", changed);
  for (const id of ["wnNew", "wnSound"]) $(id).addEventListener("change", changed);
  $("wnHits").addEventListener("click", (e) => {
    const b = e.target.closest(".wntune");
    const h = b && wanted.hits[Number(b.dataset.i)];
    if (!h) return;
    const m = String(h.mode || "").toUpperCase();
    const data = /^(FT8|FT4|WSPR|JS8|RTTY|PSK|MFSK|OLIVIA|JT65|JT9|Q65|FST4|MSK144|DATA)/.test(m);
    tuneTo(h.kHz, m === "CW" ? "cw" : m === "AM" ? "am" : m === "FM" ? "fm" : data ? "usb" : modeForFreq(h.kHz), { scroll: true });
  });
  renderWanted();
}
