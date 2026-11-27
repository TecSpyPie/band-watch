/* Band Watch extras, round 1: shack screen, space weather forecast with aurora alert, Morse trainer.
 * Plain JavaScript, loaded after app.js. Reads the page's shared state (app, BANDS, bandName, status) but
 * never changes it, and never touches the radio or the server. */
(function () {
  "use strict";
  if (window.__bwExtras) return;
  window.__bwExtras = true;

  const byId = (id) => document.getElementById(id);
  const mk = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  };
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
  const A = () => (typeof app === "object" && app) ? app : null;
  const nameOf = (b) => (typeof bandName === "function" ? bandName(b) : `${b} m`);
  const statusOf = (x) => (typeof status === "function" ? status(x) : (x.sp.length >= 15 ? "open" : x.sp.length >= 5 ? "marg" : "shut"));
  const WORD = { open: "Open", marg: "Marginal", shut: "Closed", none: "No data" };
  function say(msg) {
    let t = byId("bwxToast");
    if (!t) { t = mk("div", { id: "bwxToast", class: "bwx-toast", role: "status", "aria-live": "polite" }); document.body.append(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(say.t); say.t = setTimeout(() => { t.hidden = true; }, 6000);
  }

  /* ============================== styles ============================== */
  const css = `
.bwx-shack{position:fixed;inset:0;z-index:9000;background:var(--bg);color:var(--text);display:grid;grid-template-rows:auto 1fr auto;padding:max(16px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));gap:12px;cursor:pointer}
.bwx-shack[hidden]{display:none}
.bwx-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;font:600 clamp(18px,3vw,28px) "Barlow Condensed",sans-serif;color:var(--muted)}
.bwx-top b{color:var(--text);font-variant-numeric:tabular-nums}
.bwx-main{display:grid;align-content:center;gap:2vh;text-align:center}
.bwx-best{font:700 clamp(64px,18vw,220px)/.9 "Barlow Condensed",sans-serif;color:var(--cool);margin:0}
.bwx-sub{font:500 clamp(18px,3.4vw,34px)/1.2 Barlow,sans-serif;color:var(--muted);margin:0}
.bwx-row{display:flex;justify-content:center;gap:clamp(8px,2vw,24px);flex-wrap:wrap}
.bwx-band{min-width:clamp(84px,14vw,150px);border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--surface)}
.bwx-band b{display:block;font:700 clamp(26px,5vw,48px)/1 "Barlow Condensed",sans-serif}
.bwx-band small{font-size:clamp(12px,1.6vw,16px);color:var(--muted)}
.bwx-band.open b{color:var(--cool)}.bwx-band.marg b{color:var(--warm)}
.bwx-foot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:14px}
.bwx-panel .bwx-note{font-size:.875rem;color:var(--muted);margin:6px 0}
.bwx-kp{display:flex;align-items:flex-end;gap:2px;height:140px;padding:6px 0 0;border-bottom:1px solid var(--line);overflow-x:auto}
.bwx-kp div{flex:1 0 9px;min-width:9px;background:var(--cool);border-radius:2px 2px 0 0;position:relative;opacity:.95}
.bwx-kp div.past{opacity:.45}
.bwx-kp div.g{background:var(--warm)}
.bwx-kp div.now{outline:2px solid var(--text);outline-offset:1px}
.bwx-kpaxis{display:flex;justify-content:space-between;font-size:.75rem;color:var(--muted);margin-top:4px}
.bwx-facts{display:flex;gap:24px;flex-wrap:wrap;margin:10px 0}
.bwx-facts div b{display:block;font:700 1.9rem/1 "Barlow Condensed",sans-serif}
.bwx-facts div small{color:var(--muted)}
.bwx-ctl{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:8px 0}
.bwx-ctl input[type=number],.bwx-ctl input[type=text],.bwx-ctl select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:5px 8px}
.bwx-ctl input[type=number]{width:70px}
.bwx-answer{font:600 1.25rem/1.2 ui-monospace,Menlo,monospace!important;text-transform:uppercase;width:min(260px,100%)}
.bwx-result{font-weight:600;min-height:1.5em}
.bwx-result.ok{color:var(--cool)}.bwx-result.bad{color:var(--warm)}
.bwx-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(18px + env(safe-area-inset-bottom));z-index:9100;background:var(--text);color:var(--bg);padding:10px 16px;border-radius:8px;max-width:calc(100% - 32px);font-weight:500}
.bwx-toast[hidden]{display:none}
`;
  document.head.append(mk("style", { id: "bwxStyle" }, css));

  /* ============================== panels ============================== */
  function panel(id, title, ...body) {
    return mk("section", { class: "panel bwx-panel", id, "aria-labelledby": id + "T" },
      mk("div", { class: "phead" }, mk("h2", { id: id + "T", text: title })), ...body);
  }
  function placePanels(...els) {
    const after = byId("secAnt") || byId("secSun") || [...document.querySelectorAll(".wrap > section.panel[id]")].pop();
    if (after) after.after(...els); else (document.querySelector(".wrap") || document.body).append(...els);
  }

  /* ============================== 1. shack screen ============================== */
  let shack = null, shackTimer = 0, wake = null;
  function buildShack() {
    shack = mk("div", { class: "bwx-shack", id: "bwxShack", role: "dialog", "aria-modal": "true", "aria-label": "Shack screen", hidden: true, onclick: closeShack },
      mk("div", { class: "bwx-top" }, mk("span", { id: "bwxClock" }), mk("span", { id: "bwxSolar" })),
      mk("div", { class: "bwx-main" }, mk("p", { class: "bwx-sub", id: "bwxLead", text: "Best band now" }), mk("h2", { class: "bwx-best", id: "bwxBest", text: "…" }),
        mk("p", { class: "bwx-sub", id: "bwxWhy" }), mk("div", { class: "bwx-row", id: "bwxRow" })),
      mk("div", { class: "bwx-foot" }, mk("span", { id: "bwxAge" }), mk("span", { text: "Tap anywhere or press Esc to close" })));
    document.body.append(shack);
  }
  function drawShack() {
    const a = A(), now = new Date();
    byId("bwxClock").replaceChildren(mk("b", { text: now.toUTCString().slice(17, 22) }), " UTC · ", now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), " local");
    byId("bwxSolar").textContent = a && a.solar ? `SFI ${Math.round(a.solar.sfi)} · Kp ${a.solar.kp}` : "Solar data loading";
    const bands = a && Array.isArray(a.bands) ? a.bands.filter((x) => !x.none) : [];
    const ranked = [...bands].sort((x, y) => y.sp.length - x.sp.length);
    const best = ranked[0];
    if (!best || !best.sp.length) {
      byId("bwxBest").textContent = a && a.spots ? "Quiet" : "Loading…";
      byId("bwxWhy").textContent = a && a.spots ? "No stations spotted from your square in the last 30 minutes." : "Waiting for live spots.";
    } else {
      byId("bwxBest").textContent = nameOf(best.b);
      const far = [...best.sp].sort((x, y) => (y.d || 0) - (x.d || 0))[0];
      const where = far && far.n ? ` · farthest ${far.n}` : "";
      byId("bwxWhy").textContent = `${best.sp.length} stations heard${where}${best.far ? `, ${Math.round(best.far).toLocaleString()} km` : ""}`;
    }
    byId("bwxRow").replaceChildren(...ranked.slice(0, 6).map((x) => {
      const st = statusOf(x);
      return mk("div", { class: `bwx-band ${st}` }, mk("b", { text: nameOf(x.b) }), mk("small", { text: `${WORD[st] || ""} · ${x.sp.length}` }));
    }));
    const age = a && a.spotsAt ? Math.max(0, Math.round((Date.now() - a.spotsAt) / 6e4)) : null;
    byId("bwxAge").textContent = age == null ? "" : `Spots updated ${age < 1 ? "just now" : `${age} min ago`}${a.feedError || a.spotsStale ? " (last refresh failed)" : ""}`;
  }
  async function openShack() {
    if (!shack) buildShack();
    shack.hidden = false; drawShack();
    clearInterval(shackTimer); shackTimer = setInterval(drawShack, 5000);
    try { if (document.documentElement.requestFullscreen && !document.fullscreenElement) await document.documentElement.requestFullscreen(); } catch { /* not allowed */ }
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request("screen"); } catch { wake = null; }
  }
  function closeShack() {
    if (!shack || shack.hidden) return;
    shack.hidden = true; clearInterval(shackTimer);
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ }
    try { if (wake) wake.release(); } catch { /* ignore */ } wake = null;
  }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeShack(); });
  document.addEventListener("visibilitychange", async () => {
    if (shack && !shack.hidden && document.visibilityState === "visible" && navigator.wakeLock) { try { wake = await navigator.wakeLock.request("screen"); } catch { /* ignore */ } }
  });
  function addShackButton() {
    const after = byId("optBtn");
    const btn = mk("button", { type: "button", class: "lbtn", id: "shackBtn", title: "Full-screen 'best band now' view for a spare tablet or monitor", text: "Shack screen", onclick: openShack });
    if (after) after.before(btn); else document.body.prepend(btn);
  }

  /* ============================== 2. space weather forecast + aurora ============================== */
  const NOAA = "https://services.swpc.noaa.gov";
  const FC_KEY = "bwx-aurora";
  const fc = { rows: null, text: "", err: false, at: 0 };
  const auroraCfg = Object.assign({ on: false, kp: 5, lastAlert: "" }, get(FC_KEY, {}));

  /** Kp needed for aurora to show at this latitude (rough guide from the auroral oval's southern edge). */
  function kpForLat(lat) { return Math.max(1, Math.min(9, Math.round((67 - Math.abs(lat)) / 2))); }

  function parseKp(json) {
    if (!Array.isArray(json)) return [];
    let rows = json;
    if (Array.isArray(json[0])) { const [h, ...rest] = json; rows = rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
    return rows.map((r) => ({ t: Date.parse(String(r.time_tag).replace(" ", "T") + (String(r.time_tag).endsWith("Z") ? "" : "Z")), kp: Number(r.kp), kind: String(r.observed || ""), g: r.noaa_scale || "" }))
      .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.kp));
  }
  function greatestLine(txt) {
    const m = /The greatest expected 3 hr Kp for ([^\n]+?) is ([\d.]+)\s*(\(NOAA Scale\s*\n?\s*(G\d)\))?/.exec(txt || "");
    return m ? { span: m[1], kp: Number(m[2]), g: m[4] || "" } : null;
  }
  function blackoutLine(txt) {
    const r = /R1-R2\s+(\d+)%\s+(\d+)%\s+(\d+)%/.exec(txt || "");
    return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
  }
  async function loadForecast() {
    try {
      const [k, t] = await Promise.all([
        fetch(`${NOAA}/products/noaa-planetary-k-index-forecast.json`, { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); }),
        fetch(`${NOAA}/text/3-day-forecast.txt`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : "")).catch(() => ""),
      ]);
      fc.rows = parseKp(k); fc.text = t; fc.err = false; fc.at = Date.now();
    } catch { fc.err = true; }
    renderForecast(); checkAurora();
  }
  function homeLat() { const a = A(); return a && a.home ? a.home.lat : 53.5; }
  function renderForecast() {
    const box = byId("bwxFcBody"); if (!box) return;
    box.replaceChildren();
    if (!fc.rows) { box.append(mk("p", { class: "bwx-note", text: fc.err ? "NOAA's forecast couldn't be reached. Band Watch will try again in 30 minutes." : "Loading NOAA's forecast…" })); return; }
    const now = Date.now();
    const rows = fc.rows.filter((r) => r.t > now - 24 * 3600e3).slice(0, 40);
    // NOAA sometimes sends an empty or out-of-date file: say so rather than draw nothing (or fail).
    if (!rows.length) { box.append(mk("p", { class: "bwx-note", text: "NOAA's Kp forecast is empty or out of date just now. Band Watch will try again in 30 minutes." })); return; }
    const future = rows.filter((r) => r.t + 3 * 3600e3 > now);
    const peak = future.reduce((m, r) => (r.kp > m.kp ? r : m), { kp: -1 });
    const need = kpForLat(homeLat());
    const g = greatestLine(fc.text), rb = blackoutLine(fc.text);
    const outlook = peak.kp >= need ? `Possible from your latitude (Kp ${need}+ needed)` : peak.kp >= need - 1 ? "Worth watching: close to what your latitude needs" : "Unlikely from your latitude";
    box.append(mk("div", { class: "bwx-facts" },
      mk("div", {}, mk("b", { text: peak.kp >= 0 ? peak.kp.toFixed(1) : "–" }), mk("small", { text: "Highest Kp expected, next 3 days" })),
      mk("div", {}, mk("b", { text: String(need) }), mk("small", { text: `Kp for aurora at ${Math.abs(homeLat()).toFixed(0)}°${homeLat() >= 0 ? "N" : "S"}` })),
      rb ? mk("div", {}, mk("b", { text: `${rb[0]}%` }), mk("small", { text: "Chance of a radio blackout (R1+) today" })) : null));
    box.append(mk("p", { class: "bwx-note" }, mk("b", { text: "Aurora: " }), outlook + ". ",
      peak.kp >= 5 ? "A Kp of 5 or more can bring aurora (Au) contacts on 6 m and 2 m from the UK, and noisy, absorbed HF on the high bands." : "Quiet geomagnetic conditions usually favour the higher HF bands."));
    const bars = mk("div", { class: "bwx-kp", role: "img", "aria-label": `Kp index from 24 hours ago to ${Math.round((rows[rows.length - 1].t - now) / 36e5)} hours ahead. Peak ${peak.kp.toFixed(1)}.` });
    for (const r of rows) {
      const past = r.t + 3 * 3600e3 <= now, cur = r.t <= now && now < r.t + 3 * 3600e3;
      bars.append(mk("div", { class: `${past ? "past" : ""} ${r.kp >= 5 ? "g" : ""} ${cur ? "now" : ""}`, style: `height:${Math.max(3, (r.kp / 9) * 100)}%`,
        title: `${new Date(r.t).toUTCString().slice(5, 22)} UTC · Kp ${r.kp.toFixed(2)}${r.g ? " " + r.g : ""} · ${r.kind}` }));
    }
    box.append(bars, mk("div", { class: "bwx-kpaxis" }, mk("span", { text: "24 h ago" }), mk("span", { text: "now" }), mk("span", { text: "+3 days" })));
    box.append(mk("p", { class: "bwx-note", text: (g ? `NOAA: highest expected Kp for ${g.span} is ${g.kp.toFixed(2)}${g.g ? ` (${g.g} storm)` : ""}. ` : "") + "Faded bars are what was observed; bright bars are the forecast; orange is Kp 5 or more. Source: NOAA SWPC." }));
  }
  function checkAurora() {
    if (!auroraCfg.on) return;
    const a = A(), now = Date.now();
    const cur = a && a.solar ? Number(a.solar.kp) : NaN;
    const soon = (fc.rows || []).filter((r) => r.t > now - 3 * 3600e3 && r.t < now + 24 * 3600e3).reduce((m, r) => Math.max(m, r.kp), -1);
    let msg = "", key = "";
    if (Number.isFinite(cur) && cur >= auroraCfg.kp) { msg = `Kp is ${cur} now. Aurora is possible: try 6 m and 2 m, and look north.`; key = "now:" + new Date().toISOString().slice(0, 13); }
    else if (soon >= auroraCfg.kp) { msg = `NOAA expects Kp ${soon.toFixed(1)} in the next 24 hours. Aurora may be possible.`; key = "soon:" + new Date().toISOString().slice(0, 10); }
    if (!msg || auroraCfg.lastAlert === key) return;
    auroraCfg.lastAlert = key; put(FC_KEY, auroraCfg);
    say("Aurora alert: " + msg);
    try { if ("Notification" in window && Notification.permission === "granted") new Notification("Band Watch aurora alert", { body: msg, tag: "bw-aurora" }); } catch { /* ignore */ }
  }
  function forecastPanel() {
    const on = mk("input", { type: "checkbox", id: "bwxAuOn", checked: auroraCfg.on || null });
    const kp = mk("input", { type: "number", id: "bwxAuKp", min: 1, max: 9, step: 1, value: auroraCfg.kp });
    on.addEventListener("change", async () => {
      auroraCfg.on = on.checked; put(FC_KEY, auroraCfg);
      if (on.checked && "Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* ignore */ } }
      say(on.checked ? `Aurora alert on: you'll be told when Kp reaches ${auroraCfg.kp}.` : "Aurora alert off.");
      checkAurora();
    });
    kp.addEventListener("change", () => { const v = Math.max(1, Math.min(9, Math.round(Number(kp.value) || 5))); kp.value = v; auroraCfg.kp = v; auroraCfg.lastAlert = ""; put(FC_KEY, auroraCfg); checkAurora(); });
    const sug = mk("button", { type: "button", class: "lbtn", text: "Use my latitude", onclick: () => { kp.value = kpForLat(homeLat()); kp.dispatchEvent(new Event("change")); } });
    return panel("secFcst", "Space weather forecast",
      mk("p", { class: "bwx-note", text: "NOAA's 3-day Kp forecast, what it means for aurora where you are, and an alert for when it gets lively." }),
      mk("div", { id: "bwxFcBody" }),
      mk("div", { class: "bwx-ctl" }, mk("label", {}, on, " Aurora alert when Kp reaches "), kp, sug),
      mk("p", { class: "bwx-note", text: "Alerts show on this page and, if you allow it, as a notification while Band Watch is open in a tab or installed app." }));
  }

  /* ============================== 3. Morse trainer ============================== */
  const MORSE = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--",
    N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..",
    0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----.", "/": "-..-.", "?": "..--.." };
  const FALLBACK = ["G4ABC", "M0XYZ", "2E0KCD", "DL1ABC", "EA8RM", "K1TTT", "VK2XY", "JA1ABC", "F5NTX", "ON4UN", "PA3FWM", "OH2BH", "W1AW", "9A1A", "SM5DXR", "LZ1BJ", "EI7CC", "GM3POI", "GW4OGB", "MI0ABC"];
  const KEY = "bwx-cw";
  const cw = Object.assign({ wpm: 18, fwpm: 12, tone: 600, right: 0, tries: 0, source: "live" }, get(KEY, {}));
  let ac = null, playing = null, current = "";
  const CALL_OK = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/;

  function liveCalls() {
    const a = A(); const seen = new Set();
    for (const p of (a && (a.allPairs || a.pairs)) || []) {
      for (const c of [p.c, p.call, p.rx, p.tx]) { const s = String(c || "").toUpperCase(); if (CALL_OK.test(s) && s.length <= 10) seen.add(s); }
    }
    return [...seen];
  }
  function pickCall() {
    const live = cw.source === "live" ? liveCalls() : [];
    const pool = live.length >= 5 ? live : FALLBACK;
    let c; do { c = pool[Math.floor(Math.random() * pool.length)]; } while (pool.length > 1 && c === current);
    return { call: c, live: live.length >= 5 };
  }
  /** Schedules the call in Morse; returns when it ends. Farnsworth: characters at wpm, gaps stretched to fwpm. */
  function schedule(text, startAt) {
    const dot = 1.2 / cw.wpm;
    const f = Math.min(cw.fwpm, cw.wpm);
    const ta = (60 * cw.wpm - 37.2 * f) / (cw.wpm * f); // total extra time per word (ARRL Farnsworth)
    const charGap = f < cw.wpm ? (3 * ta) / 19 : 3 * dot, wordGap = f < cw.wpm ? (7 * ta) / 19 : 7 * dot;
    const osc = ac.createOscillator(), g = ac.createGain();
    osc.type = "sine"; osc.frequency.value = cw.tone; g.gain.value = 0; osc.connect(g).connect(ac.destination);
    let t = startAt; const ramp = 0.005;
    for (const ch of text) {
      if (ch === " ") { t += wordGap; continue; }
      const code = MORSE[ch]; if (!code) continue;
      for (let i = 0; i < code.length; i++) {
        const len = code[i] === "." ? dot : 3 * dot;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + ramp);
        g.gain.setValueAtTime(0.35, t + len - ramp); g.gain.linearRampToValueAtTime(0, t + len);
        t += len + (i < code.length - 1 ? dot : 0);
      }
      t += charGap;
    }
    osc.start(startAt); osc.stop(t + 0.05);
    return { osc, end: t };
  }
  async function play(text) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { say("This browser can't play sound."); return; }
    if (!ac) ac = new AC();
    try { await ac.resume(); } catch { /* ignore */ }
    stop();
    playing = schedule(text, ac.currentTime + 0.08);
  }
  function stop() { if (playing) { try { playing.osc.stop(); } catch { /* already stopped */ } playing = null; } }
  function cwPanel() {
    const wpm = mk("input", { type: "number", id: "bwxWpm", min: 5, max: 40, value: cw.wpm, "aria-label": "Character speed in words per minute" });
    const fwpm = mk("input", { type: "number", id: "bwxFwpm", min: 5, max: 40, value: cw.fwpm, "aria-label": "Overall (Farnsworth) speed in words per minute" });
    const tone = mk("input", { type: "number", id: "bwxTone", min: 300, max: 1000, step: 50, value: cw.tone, "aria-label": "Tone in hertz" });
    const src = mk("select", { id: "bwxSrc", "aria-label": "Where callsigns come from" },
      mk("option", { value: "live", text: "Live callsigns from the spots", selected: cw.source === "live" || null }),
      mk("option", { value: "list", text: "Practice list", selected: cw.source === "list" || null }));
    const answer = mk("input", { type: "text", class: "bwx-answer", id: "bwxAns", maxlength: 12, autocomplete: "off", spellcheck: "false", "aria-label": "What callsign did you hear?", placeholder: "Type what you hear" });
    const result = mk("p", { class: "bwx-result", id: "bwxRes", role: "status", "aria-live": "polite" });
    const score = mk("p", { class: "bwx-note", id: "bwxScore" });
    const showScore = () => { score.textContent = cw.tries ? `Score: ${cw.right} of ${cw.tries} (${Math.round((cw.right / cw.tries) * 100)}%)` : "Score: nothing yet."; };
    const save = () => {
      cw.wpm = Math.max(5, Math.min(40, Math.round(Number(wpm.value) || 18))); wpm.value = cw.wpm;
      cw.fwpm = Math.max(5, Math.min(cw.wpm, Math.round(Number(fwpm.value) || cw.wpm))); fwpm.value = cw.fwpm;
      cw.tone = Math.max(300, Math.min(1000, Math.round(Number(tone.value) || 600))); tone.value = cw.tone;
      cw.source = src.value; put(KEY, cw);
    };
    [wpm, fwpm, tone, src].forEach((el) => el.addEventListener("change", save));
    const next = () => { save(); const p = pickCall(); current = p.call; answer.value = ""; result.textContent = p.live ? "Listen… (a callsign heard on the air in the last 30 minutes)" : "Listen…"; result.className = "bwx-result"; play(current); answer.focus(); };
    const check = (e) => {
      e.preventDefault();
      if (!current) { next(); return; }
      const guess = answer.value.trim().toUpperCase();
      if (!guess) return;
      cw.tries++;
      if (guess === current) { cw.right++; result.textContent = `✓ Correct: ${current}`; result.className = "bwx-result ok"; }
      else { result.textContent = `✗ It was ${current} (you typed ${guess})`; result.className = "bwx-result bad"; }
      put(KEY, cw); showScore(); current = "";
    };
    const form = mk("form", { class: "bwx-ctl", onsubmit: check }, answer,
      mk("button", { type: "submit", class: "lbtn", text: "Check" }),
      mk("button", { type: "button", class: "lbtn", text: "Play again", onclick: () => { if (current) play(current); else next(); } }),
      mk("button", { type: "button", class: "lbtn on", text: "Next callsign", onclick: next }));
    showScore();
    return panel("secCwTrain", "Morse trainer",
      mk("p", { class: "bwx-note", text: "Copy real callsigns by ear. It plays through this device's speaker only and never keys your radio." }),
      mk("div", { class: "bwx-ctl" },
        mk("label", {}, "Speed ", wpm, " wpm"), mk("label", {}, "Spacing ", fwpm, " wpm"), mk("label", {}, "Tone ", tone, " Hz"), src),
      form, result, score,
      mk("p", { class: "bwx-note" }, "Tip: set spacing lower than speed (Farnsworth) to learn the sound of each letter at full speed. ",
        mk("button", { type: "button", class: "lbtn", text: "Reset score", onclick: () => { cw.right = 0; cw.tries = 0; put(KEY, cw); showScore(); } })));
  }

  /* ============================== start ============================== */
  function init() {
    addShackButton();
    placePanels(forecastPanel(), cwPanel());
    renderForecast(); loadForecast();
    setInterval(loadForecast, 30 * 60e3);
    setInterval(checkAurora, 60e3);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();

  // For tests.
  window.BWExtras = { kpForLat, parseKp, greatestLine, blackoutLine, MORSE, openShack, closeShack, liveCalls };
})();
