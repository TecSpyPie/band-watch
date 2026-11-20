/* Callsign hover card: rest the pointer on (or tab to) any callsign to see who it is. */
"use strict";

const hover = { el: null, call: null, showTimer: 0, hideTimer: 0 };

function hoverSpotLine(call) {
  const spots = app.allPairs.filter((p) => baseCall(p.c) === call || baseCall(p.l || "") === call).sort((a, b) => b.ts - a.ts);
  if (!spots.length) return `<p class="small muted">Not spotted from ${esc(grid4())} in the last 30 minutes.</p>`;
  const p = spots[0];
  const remote = baseCall(p.c) === call;
  return `<p class="small">Last spot ${ago(p.t)}: <b>${bandName(p.band)}</b>, ${(p.fq * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz, ` +
    `${esc(p.m)}${p.snr != null ? `, ${p.snr} dB` : ""}${remote ? `, ${kmText(p.d)} away` : ""}` +
    `${spots.length > 1 ? ` <span class="muted">(${spots.length} spots)</span>` : ""}</p>`;
}

function hoverLocalTime(call, q) {
  const remote = app.allPairs.find((p) => baseCall(p.c) === call);
  const pos = q && Number.isFinite(q.lat) ? { lat: q.lat, lon: q.lon } : remote ? { lat: remote.lat, lon: remote.lon } : null;
  const z = stationTimeZone(pos, q);
  if (!z) return "";
  const now = new Date();
  const time = z.tz
    ? new Intl.DateTimeFormat("en-GB", { timeZone: z.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)
    : new Date(now.getTime() + z.offsetMin * 60e3).toISOString().slice(11, 16);
  return `<span class="hctime" title="${esc(z.note)}">${time} local</span>`;
}

async function showHover(a) {
  const call = a.dataset.call;
  if (!call) return;
  hover.call = call;
  const card = hover.el;
  const hit = PREFIXES.find(([re]) => re.test(call));
  const head = (q) => `<div class="hchead"><b>${esc((q && q.call) || call)}</b>${hoverLocalTime(call, q)}</div>` +
    `<div class="small muted">${esc([hit && hit[1], q && q.grid].filter(Boolean).join(" · ") || "Country not known from the prefix")}</div>`;
  const foot = `<p class="small muted hcfoot">Click for the station window · Ctrl-click for QRZ.com</p>`;
  const body = (q) => {
    if (!qrzState.loggedIn) return `<p class="small muted">Log in to QRZ to see name and location here.</p>`;
    if (!q) return `<p class="small muted">Looking up on QRZ…</p>`;
    if (q.error) return `<p class="small muted">${esc(q.error)}</p>`;
    const place = [q.city, q.state, q.country].filter(Boolean).join(", ");
    const qsl = [q.lotw && "LoTW", q.eqsl && "eQSL", q.paperQsl && "paper"].filter(Boolean).join(", ");
    return `<div class="hcqrz">${q.image ? `<img src="${esc(q.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<div>` +
      (q.name ? `<div><b>${esc(q.name)}</b></div>` : "") + (place ? `<div class="small">${esc(place)}</div>` : "") +
      (q.licenceClass ? `<div class="small muted">Licence: ${esc(q.licenceClass)}</div>` : "") +
      (qsl ? `<div class="small muted">QSL: ${esc(qsl)}</div>` : "") + `</div></div>`;
  };
  const draw = (q) => {
    if (hover.call !== call) return;
    card.innerHTML = head(q) + hoverSpotLine(call) + body(q) + foot;
    placeHover(a);
  };
  draw(null);
  card.hidden = false;
  placeHover(a);
  if (qrzState.loggedIn) {
    const r = await qrzLookupCached(call);
    draw(r.ok ? r.body : { error: r.body.error || "QRZ could not be reached." });
  }
}

function placeHover(a) {
  const card = hover.el;
  const r = a.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  let x = r.left, y = r.bottom + 6;
  if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
  if (y + h > innerHeight - 8) y = r.top - h - 6;
  card.style.left = `${Math.max(8, x)}px`;
  card.style.top = `${Math.max(8, y)}px`;
}

function hideHover() {
  clearTimeout(hover.showTimer);
  hover.call = null;
  if (hover.el) hover.el.hidden = true;
}

function setupHover() {
  hover.el = $("hovercard");
  const callOf = (t) => t && t.closest && t.closest("a.call");
  const arm = (a) => {
    clearTimeout(hover.hideTimer);
    clearTimeout(hover.showTimer);
    if (hover.call === a.dataset.call && !hover.el.hidden) return;
    hover.showTimer = setTimeout(() => showHover(a), 350);
  };
  const disarm = () => {
    clearTimeout(hover.showTimer);
    clearTimeout(hover.hideTimer);
    hover.hideTimer = setTimeout(hideHover, 250);
  };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const a = callOf(e.target);
    if (a) arm(a);
    else if (hover.el.contains(e.target)) clearTimeout(hover.hideTimer);
  });
  document.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    if (callOf(e.target) || hover.el.contains(e.target)) disarm();
  });
  document.addEventListener("focusin", (e) => { const a = callOf(e.target); if (a) arm(a); });
  document.addEventListener("focusout", (e) => { if (callOf(e.target)) disarm(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideHover(); });
  document.addEventListener("click", hideHover, true);
  window.addEventListener("scroll", () => { if (!hover.el.hidden) { hover.el.hidden = true; hover.call = null; } }, { passive: true });
}
