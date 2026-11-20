/* The "Map" view of the <band> spots panel: a real world map (land outline from vendor/land110.js, no map tiles, no
   network) drawn on a canvas. Your station, a dot for every spot on the selected band with a curved great-circle line
   to it, coloured by signal strength and fading with age, the day and night sides of the Earth, and the satellites,
   POTA activators and APRS stations that the panel can show. It is fed by the same spot data as the rest of the page
   (nothing new is asked of PSK Reporter). The maths is in mapmath.js. */
"use strict";

/* ===================== Spots map ===================== */

const spotmap = {
  v: MapMath.newView(), // zoom and where the middle of the picture is
  w: 0, h: 0, // size in CSS pixels, from the last draw
  items: [], // what can be pointed at: { x, y, r, kind: "spot" | "sat" | "mark", ... }
  hover: null, pinned: null,
  pointers: new Map(), drag: null, pinch: null,
  colors: null, raf: 0, anim: 0, dwell: 0,
};
const SPOTMAP_KEY = "bw-mapview";

/** "map" (the world map) or "bowl" (the simple chart without coastlines). */
function spotMapMode() {
  return load(SPOTMAP_KEY) === "bowl" ? "bowl" : "map";
}
const spotMapActive = () => spotMapMode() === "map" && Boolean($("spotmap"));

/** The theme's colours as the canvas needs them ("rgb(...)" text), read through the page so every theme works. */
function spotMapColors() {
  const cv = $("spotmap");
  const win = (cv && cv.ownerDocument.defaultView) || window;
  const probe = $("spotprobe");
  const read = (name, fallback) => {
    if (!probe) return fallback;
    probe.style.color = "";
    probe.style.color = `var(${name})`;
    return win.getComputedStyle(probe).color || fallback;
  };
  const c = {
    surface: read("--surface", "#fff"), line: read("--line", "#999"), text: read("--text", "#000"), muted: read("--muted", "#666"),
    cool: read("--cool", "#08c"), warm: read("--warm", "#c80"), night: read("--night", "rgba(0,0,0,.3)"), grid: read("--grid", "#ccc"),
  };
  const mix = (a, b, t) => MapMath.mixRgb(a, b, t) || b;
  c.land = mix(c.surface, c.muted, 0.3);
  c.coast = mix(c.surface, c.muted, 0.7);
  // signal strength: grey for "no report", then weak -> strong from the muted colour through the cool one to the warm one
  c.levels = [c.muted, mix(c.muted, c.cool, 0.4), c.cool, mix(c.cool, c.warm, 0.55), c.warm];
  return c;
}

/** The window the map is in now: the main one, or its own window (⧉). Its frames and pixel density are the ones that count. */
const spotMapWin = () => ($("spotmap") && $("spotmap").ownerDocument.defaultView) || window;

function spotMapSize() {
  const cv = $("spotmap");
  const win = cv.ownerDocument.defaultView || window;
  const dpr = Math.min(win.devicePixelRatio || 1, 3);
  const w = Math.max(1, Math.round(cv.clientWidth)), h = Math.max(1, Math.round(cv.clientHeight));
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  spotmap.w = w; spotmap.h = h;
  return { cv, w, h, dpr };
}

function spotMapSchedule() {
  const win = spotMapWin();
  if (spotmap.raf) {
    if (spotmap.rafWin === win) return;
    try { spotmap.rafWin.cancelAnimationFrame(spotmap.raf); } catch { /* that window has closed */ } // the map moved window: a frame asked of the old one never comes
  }
  spotmap.rafWin = win;
  spotmap.raf = win.requestAnimationFrame(() => { spotmap.raf = 0; spotMapDraw(true); });
}

/** Follow size changes in whichever window the map is in (the main window, or its own window after ⧉). */
function spotMapWatch(cv) {
  const win = cv.ownerDocument.defaultView || window;
  if (spotmap.watchWin === win) return;
  if (spotmap.ro) spotmap.ro.disconnect();
  if (spotmap.watchWin) spotmap.watchWin.removeEventListener("resize", spotMapSchedule);
  spotmap.watchWin = win;
  win.addEventListener("resize", spotMapSchedule);
  if (win.ResizeObserver) { spotmap.ro = new win.ResizeObserver(() => spotMapSchedule()); spotmap.ro.observe(cv.parentElement); }
}

/** Draw the map. `keepColors` skips re-reading the theme (used while the pointer moves). */
function spotMapDraw(keepColors) {
  if (!spotMapActive()) return;
  const cur = app.bands.find((x) => x.b === app.sel);
  const { cv, w, h, dpr } = spotMapSize();
  spotMapWatch(cv);
  if (cv.clientWidth < 2) return; // hidden (folded panel, other tab)
  if (!keepColors || !spotmap.colors) spotmap.colors = spotMapColors();
  const c = spotmap.colors;
  spotmap.v = MapMath.clampView(spotmap.v, w, h);
  const V = spotmap.v;
  const P = (lat, lon) => MapMath.project(V, lat, lon, w, h);
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = c.surface;
  ctx.fillRect(0, 0, w, h);

  // the world, clipped to its own edges
  const tl = P(90, -180), br = P(-90, 180);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.clip();

  if (typeof BWLand !== "undefined") {
    ctx.beginPath();
    for (const ring of BWLand.rings()) {
      let first = true;
      for (const [lon, lat] of ring) {
        const p = P(lat, lon);
        if (first) { ctx.moveTo(p.x, p.y); first = false; } else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = c.land;
    ctx.fill("evenodd");
    ctx.strokeStyle = c.coast;
    ctx.lineWidth = 0.7;
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  // graticule every 30 degrees
  ctx.strokeStyle = c.grid;
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let l = -150; l <= 150; l += 30) { const a = P(90, l), b = P(-90, l); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  for (let l = -60; l <= 60; l += 30) { const a = P(l, -180), b = P(l, 180); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  ctx.stroke();

  // night side, and the Sun
  const sun = subsolarPoint(Date.now());
  ctx.beginPath();
  MapMath.nightPolygon(sun, 2).forEach(([lon, lat], i) => { const p = P(lat, lon); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
  ctx.closePath();
  ctx.fillStyle = c.night;
  ctx.fill();
  const sp = P(sun.dec, sun.lon);
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, 5, 0, 6.2832);
  ctx.fillStyle = c.warm;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = c.surface;
  ctx.lineWidth = 1.2;
  ctx.stroke();

  spotmap.items = [];
  const home = app.home;
  const spots = cur ? cur.sp.slice(0, 400) : [];
  const now = Date.now();
  const ranked = spots.map((p) => {
    const age = Math.max(0, (now - p.ts) / 6e4);
    return { p, age, lvl: MapMath.snrBucket(p.snr), fade: MapMath.ageFade(age, WINDOW_MIN) };
  }).sort((a, b) => a.lvl - b.lvl || b.age - a.age); // strong and fresh last, so they end up on top

  // great-circle lines from you to each station
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of ranked) {
    const segs = MapMath.greatCircle(home, s.p, 3);
    ctx.strokeStyle = c.levels[s.lvl];
    ctx.globalAlpha = 0.5 * s.fade;
    ctx.lineWidth = s.lvl >= 3 ? 1.4 : 1;
    ctx.beginPath();
    for (const seg of segs) seg.forEach(([lon, lat], i) => { const q = P(lat, lon); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); });
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // POTA activators, APRS stations (small marks), satellites (a dot and a name)
  const marks = [];
  if (typeof xotaMapPoints === "function") for (const m of xotaMapPoints()) marks.push({ ...m, shape: "tri" });
  if (typeof aprsMapPoints === "function") for (const m of aprsMapPoints()) marks.push({ ...m, shape: "dia" });
  for (const m of marks) {
    const q = P(m.lat, m.lon);
    if (q.x < -8 || q.y < -8 || q.x > w + 8 || q.y > h + 8) continue;
    ctx.beginPath();
    if (m.shape === "tri") { ctx.moveTo(q.x, q.y - 5); ctx.lineTo(q.x - 4.5, q.y + 3.5); ctx.lineTo(q.x + 4.5, q.y + 3.5); } else { ctx.moveTo(q.x, q.y - 4.5); ctx.lineTo(q.x + 4.5, q.y); ctx.lineTo(q.x, q.y + 4.5); ctx.lineTo(q.x - 4.5, q.y); }
    ctx.closePath();
    ctx.fillStyle = c.text;
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.surface;
    ctx.lineWidth = 1;
    ctx.stroke();
    spotmap.items.push({ x: q.x, y: q.y, r: 8, kind: "mark", tip: m.tip });
  }

  // the stations: dot size and colour show the signal, faintness shows age
  const view = spotmap.hover || spotmap.pinned;
  for (const s of ranked) {
    const q = P(s.p.lat, s.p.lon);
    if (q.x < -8 || q.y < -8 || q.x > w + 8 || q.y > h + 8) continue;
    const r = 2.6 + s.lvl * 0.75;
    ctx.beginPath();
    ctx.arc(q.x, q.y, r, 0, 6.2832);
    ctx.globalAlpha = 0.35 + 0.65 * s.fade;
    ctx.fillStyle = c.levels[s.lvl];
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.surface;
    ctx.lineWidth = 1;
    ctx.stroke();
    s.x = q.x; s.y = q.y; s.r = r; s.kind = "spot";
    spotmap.items.push(s);
    if (view && view.p === s.p) { ctx.beginPath(); ctx.arc(q.x, q.y, r + 3, 0, 6.2832); ctx.strokeStyle = c.text; ctx.lineWidth = 1.6; ctx.stroke(); }
  }

  // callsigns, once zoomed in far enough to read them
  if (V.zoom >= 2.5) {
    ctx.font = '600 11px Barlow, "Segoe UI", sans-serif';
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = c.surface;
    ctx.fillStyle = c.text;
    let n = 0;
    for (const s of [...ranked].reverse()) {
      if (s.x == null || s.x < 0 || s.y < 0 || s.x > w || s.y > h) continue;
      if (++n > 60) break;
      ctx.strokeText(s.p.c, s.x + s.r + 3, s.y);
      ctx.fillText(s.p.c, s.x + s.r + 3, s.y);
    }
  }

  // satellites
  const sats = typeof satMapPoints === "function" ? satMapPoints() : [];
  ctx.font = '600 11px Barlow, "Segoe UI", sans-serif';
  ctx.textBaseline = "middle";
  for (const m of sats) {
    const q = P(m.lat, m.lon);
    if (q.x < -8 || q.y < -8 || q.x > w + 8 || q.y > h + 8) continue;
    ctx.beginPath();
    ctx.arc(q.x, q.y, 4, 0, 6.2832);
    ctx.fillStyle = m.up ? c.warm : c.muted;
    ctx.fill();
    ctx.strokeStyle = c.surface;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeText(m.name, q.x + 7, q.y);
    ctx.fillStyle = m.up ? c.warm : c.muted;
    ctx.fillText(m.name, q.x + 7, q.y);
    spotmap.items.push({ x: q.x, y: q.y, r: 9, kind: "sat", id: m.id, tip: `${m.name}: ${m.tip}. Click for details.` });
  }

  // you
  const hp = P(home.lat, home.lon);
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, 8, 0, 6.2832);
  ctx.strokeStyle = c.warm;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hp.x, hp.y, 4.5, 0, 6.2832);
  ctx.fillStyle = c.warm;
  ctx.fill();
  ctx.strokeStyle = c.surface;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.font = '700 11px Barlow, "Segoe UI", sans-serif';
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.surface;
  ctx.strokeText(app.myCall || "You", hp.x + 12, hp.y);
  ctx.fillStyle = c.text;
  ctx.fillText(app.myCall || "You", hp.x + 12, hp.y);
  spotmap.items.push({ x: hp.x, y: hp.y, r: 10, kind: "mark", tip: `Your station${app.myCall ? `, ${app.myCall}` : ""}: grid ${grid4()}` });
  ctx.restore();

  // frame, and a note when there is nothing to show
  ctx.strokeStyle = c.line;
  ctx.lineWidth = 1;
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, br.x - tl.x - 1, br.y - tl.y - 1);
  if (!spots.length) {
    const msg = app.spots ? "No spots on this band right now." : "Waiting for live spots.";
    ctx.font = '600 13px Barlow, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 4;
    ctx.strokeStyle = c.surface;
    ctx.strokeText(msg, w / 2, h - 14);
    ctx.fillStyle = c.text;
    ctx.fillText(msg, w / 2, h - 14);
    ctx.textAlign = "left";
  }
  cv.style.touchAction = V.zoom > 1.01 ? "none" : "pan-y"; // zoomed in: the map takes the finger; whole world: the page scrolls
  cv.setAttribute("aria-label", cur
    ? `World map of ${bandName(cur.b)} spots: ${spots.length} station${spots.length === 1 ? "" : "s"}, ${cur.far ? `the farthest ${kmText(cur.far)} away` : "none heard yet"}. The list below has the same stations. Plus and minus zoom, arrow keys move, 0 resets.`
    : "World map of spots");
  spotMapLegend();
}

function spotMapLegend() {
  const el = $("spotLegend");
  if (!el || !spotmap.colors) return;
  const lv = spotmap.colors.levels;
  el.innerHTML = MapMath.SNR_LABELS.map((n, i) =>
    `<span title="${esc(MapMath.SNR_RANGES[i])}"><i style="background:${lv[i]}"></i>${n}</span>`).join("") +
    `<span class="smfade">Fainter lines are older spots</span>`;
}

/* ---------- Pointing ---------- */

function spotMapAt(e) {
  const cv = $("spotmap");
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top, r };
}

function spotMapTip(it) {
  if (it.kind === "spot") {
    const p = it.p;
    const bear = MapMath.bearing(app.home.lat, app.home.lon, p.lat, p.lon);
    const km = Math.round(MapMath.distanceKm(app.home.lat, app.home.lon, p.lat, p.lon));
    const age = Math.round(it.age);
    return `<b>${callLink(p.c)}</b> <span class="muted">${esc(p.band ? bandName(p.band) : "")}, ${esc(p.m)}</span>` +
      `<br>${kmText(km)}, bearing ${Math.round(bear)}° ${MapMath.compass(bear)}` +
      `<br>${p.snr != null ? `${p.snr} dB (${MapMath.SNR_LABELS[it.lvl].toLowerCase()})` : "no signal report"}, ${ago(age)}` +
      (p.dir ? `<br><span class="muted">${esc(p.dir)}</span>` : "");
  }
  return esc(it.tip || "");
}

function spotMapShowTip(it, pinned) {
  const tip = $("spotTip");
  if (!tip) return;
  if (!it) { tip.hidden = true; return; }
  tip.innerHTML = spotMapTip(it);
  tip.style.pointerEvents = pinned ? "auto" : "none";
  tip.hidden = false;
  const box = tip.parentElement;
  const bw = box.clientWidth, bh = box.clientHeight;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = it.x + 14, y = it.y - th - 10;
  if (x + tw > bw - 4) x = it.x - tw - 14;
  if (y < 4) y = it.y + 14;
  tip.style.left = `${Math.max(4, Math.min(x, bw - tw - 4))}px`;
  tip.style.top = `${Math.max(4, Math.min(y, bh - th - 4))}px`;
}

/** The hover card (callsign, country, QRZ), the one every callsign on the page gets, placed at a dot. Main window only. */
function spotMapHoverCard(it) {
  if (it.kind !== "spot" || typeof showHover !== "function" || !hover.el || $("spotmap").ownerDocument !== document) return;
  const cv = $("spotmap");
  const proxy = {
    dataset: { call: baseCall(it.p.c) },
    getBoundingClientRect: () => { const r = cv.getBoundingClientRect(); return { left: r.left + it.x, right: r.left + it.x, top: r.top + it.y - it.r, bottom: r.top + it.y + it.r }; },
  };
  clearTimeout(hover.hideTimer);
  showHover(proxy);
  spotMapShowTip(null);
}

function spotMapSetHover(it) {
  if (it === spotmap.hover) return;
  spotmap.hover = it;
  clearTimeout(spotmap.dwell);
  const cv = $("spotmap");
  cv.style.cursor = it && it.kind !== "mark" ? "pointer" : "";
  if (!it) {
    if (spotmap.pinned) spotMapShowTip(spotmap.pinned, true); else spotMapShowTip(null);
    if (typeof hover !== "undefined" && hover.el && !hover.el.hidden) { clearTimeout(hover.hideTimer); hover.hideTimer = setTimeout(hideHover, 250); }
  } else {
    spotMapShowTip(it, false);
    if (it.kind === "spot") spotmap.dwell = setTimeout(() => spotMapHoverCard(it), 700);
  }
  spotMapSchedule();
}

function spotMapAnimate(to) {
  const win = spotMapWin();
  win.cancelAnimationFrame(spotmap.anim);
  const from = { ...spotmap.v };
  const target = MapMath.clampView(to, spotmap.w, spotmap.h);
  const t0 = win.performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 220), e = 1 - (1 - k) ** 3;
    spotmap.v = { zoom: from.zoom + (target.zoom - from.zoom) * e, lon: from.lon + (target.lon - from.lon) * e, lat: from.lat + (target.lat - from.lat) * e };
    spotMapDraw(true);
    if (k < 1) spotmap.anim = win.requestAnimationFrame(step);
  };
  spotmap.anim = win.requestAnimationFrame(step);
}

function spotMapZoomBy(f) {
  spotMapAnimate(MapMath.zoomAt(spotmap.v, f, spotmap.w / 2, spotmap.h / 2, spotmap.w, spotmap.h));
}

function spotMapClickItem(it, e) {
  spotmap.pinned = it;
  spotMapShowTip(it, true);
  spotMapSchedule();
  if (it.kind === "sat" && typeof openSatCard === "function") openSatCard(Number(it.id));
  else if (it.kind === "spot" && e.pointerType !== "touch") {
    const call = baseCall(it.p.c);
    if (e.ctrlKey || e.metaKey || e.shiftKey) window.open(`https://www.qrz.com/db/${encodeURIComponent(call)}`, "_blank", "noopener,noreferrer");
    else if (typeof openStation === "function") { try { window.focus(); } catch { /* another window */ } openStation(call); }
  }
}

function setupSpotMapInput(cv) {
  cv.addEventListener("pointerdown", (e) => {
    try { cv.setPointerCapture(e.pointerId); } catch { /* the pointer has gone */ }
    const at = spotMapAt(e);
    spotmap.pointers.set(e.pointerId, { x: at.x, y: at.y });
    spotMapWin().cancelAnimationFrame(spotmap.anim);
    if (spotmap.pointers.size === 1) spotmap.drag = { id: e.pointerId, x: at.x, y: at.y, moved: false };
    else if (spotmap.pointers.size === 2) {
      const [a, b] = [...spotmap.pointers.values()];
      spotmap.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      spotmap.drag = null;
    }
  });
  cv.addEventListener("pointermove", (e) => {
    const at = spotMapAt(e);
    const known = spotmap.pointers.get(e.pointerId);
    if (known) {
      let px = known.x, py = known.y;
      known.x = at.x; known.y = at.y;
      if (spotmap.pinch && spotmap.pointers.size >= 2) {
        const [a, b] = [...spotmap.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        let v = MapMath.panBy(spotmap.v, mx - spotmap.pinch.mx, my - spotmap.pinch.my, spotmap.w, spotmap.h);
        v = MapMath.zoomAt(v, d / spotmap.pinch.d, mx, my, spotmap.w, spotmap.h);
        spotmap.v = v;
        spotmap.pinch = { d, mx, my };
        spotMapSchedule();
        return;
      }
      const dr = spotmap.drag;
      if (dr && dr.id === e.pointerId) {
        if (!dr.moved && Math.hypot(at.x - dr.x, at.y - dr.y) < 4) return;
        if (!dr.moved) { dr.moved = true; spotmap.pinned = null; spotMapSetHover(null); spotMapShowTip(null); cv.style.cursor = "grabbing"; px = dr.x; py = dr.y; }
        spotmap.v = MapMath.panBy(spotmap.v, at.x - px, at.y - py, spotmap.w, spotmap.h);
        spotMapSchedule();
        return;
      }
    }
    if (e.pointerType === "touch") return;
    spotMapSetHover(MapMath.nearest(spotmap.items, at.x, at.y, 10));
  });
  const end = (e) => {
    const dr = spotmap.drag;
    spotmap.pointers.delete(e.pointerId);
    if (spotmap.pointers.size < 2) spotmap.pinch = null;
    if (dr && dr.id === e.pointerId) {
      spotmap.drag = null;
      cv.style.cursor = "";
      if (!dr.moved && e.type === "pointerup") {
        const at = spotMapAt(e);
        const it = MapMath.nearest(spotmap.items, at.x, at.y, e.pointerType === "touch" ? 16 : 10);
        if (it) spotMapClickItem(it, e);
        else { spotmap.pinned = null; spotMapShowTip(null); spotMapSchedule(); }
      }
    }
  };
  cv.addEventListener("pointerup", end);
  cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch" && !spotmap.drag) spotMapSetHover(null); });
  cv.addEventListener("wheel", (e) => {
    const at = spotMapAt(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
    if (spotmap.v.zoom <= MapMath.MIN_ZOOM + 0.001 && dy > 0) return; // already the whole world: let the page scroll
    e.preventDefault();
    spotMapWin().cancelAnimationFrame(spotmap.anim);
    spotmap.v = MapMath.zoomAt(spotmap.v, Math.exp(-dy * 0.0018), at.x, at.y, spotmap.w, spotmap.h);
    spotMapShowTip(null);
    spotMapSchedule();
  }, { passive: false });
  cv.addEventListener("dblclick", (e) => { e.preventDefault(); spotmap.pinned = null; spotMapShowTip(null); spotMapAnimate(MapMath.newView()); });
  cv.addEventListener("keydown", (e) => {
    const step = 40;
    const pan = (dx, dy) => { spotmap.v = MapMath.panBy(spotmap.v, dx, dy, spotmap.w, spotmap.h); spotMapSchedule(); };
    if (e.key === "+" || e.key === "=") spotMapZoomBy(1.6);
    else if (e.key === "-" || e.key === "_") spotMapZoomBy(1 / 1.6);
    else if (e.key === "0" || e.key === "Home") spotMapAnimate(MapMath.newView());
    else if (e.key === "ArrowLeft") pan(step, 0);
    else if (e.key === "ArrowRight") pan(-step, 0);
    else if (e.key === "ArrowUp") pan(0, step);
    else if (e.key === "ArrowDown") pan(0, -step);
    else if (e.key === "Escape") { spotmap.pinned = null; spotMapShowTip(null); spotMapSchedule(); return; }
    else return;
    e.preventDefault();
  });
}

/* ---------- Map / Bowl ---------- */

function spotMapApplyMode() {
  const map = spotMapMode() === "map";
  if ($("spotmapbox")) $("spotmapbox").hidden = !map;
  $("map").hidden = map;
  const ctl = $("mapView");
  if (ctl) for (const b of ctl.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === (map ? "map" : "bowl")));
  if (typeof drawMap === "function") drawMap();
}

function setupSpotMap() {
  const cv = $("spotmap");
  if (!cv || typeof BWLand === "undefined") { if ($("spotmapbox")) $("spotmapbox").hidden = true; return; }
  setupSpotMapInput(cv);
  for (const b of $("mapView").querySelectorAll("button")) {
    b.addEventListener("click", () => { store(SPOTMAP_KEY, b.dataset.v); spotMapApplyMode(); });
  }
  $("mapZoomIn").addEventListener("click", () => spotMapZoomBy(1.6));
  $("mapZoomOut").addEventListener("click", () => spotMapZoomBy(1 / 1.6));
  $("mapZoomReset").addEventListener("click", () => { spotmap.pinned = null; spotMapShowTip(null); spotMapAnimate(MapMath.newView()); });
  const redraw = () => { spotmap.colors = null; spotMapSchedule(); };
  window.addEventListener("resize", () => spotMapSchedule()); // (spotMapWatch follows a pop-out window too)
  try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redraw); } catch { /* old browser */ }
  new MutationObserver(redraw).observe(document.documentElement, { attributes: true }); // theme, colours and looks
  // the Sun moves and spots age even when no new data arrives: redraw twice a minute while the map can be seen
  setInterval(() => { if (!document.hidden && spotMapActive()) spotMapDraw(false); }, 30e3);
  spotMapApplyMode();
}
