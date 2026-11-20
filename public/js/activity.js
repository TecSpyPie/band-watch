/* Band activity window: every spot, filterable. */
"use strict";

/* ===================== Band activity window ===================== */

const activity = { band: "all", dir: "all", q: "", mine: false, limit: 100, seen: null, fresh: new Set(), hearMe: null };
const spotKey = (p) => `${p.c}|${p.l || ""}|${p.fq}|${p.ts}`;
const isMine = (p) => Boolean(app.myCall) && (baseCall(p.l || "") === app.myCall || baseCall(p.c) === app.myCall);

/** Remember which spots are new since the previous refresh (none on the first load). */
function markFreshSpots(list) {
  const keys = new Set(list.map(spotKey));
  const firstLoad = !activity.seen;
  activity.fresh = firstLoad ? new Set() : new Set([...keys].filter((k) => !activity.seen.has(k)));
  activity.seen = keys;
  // Tell the user when stations that weren't already hearing them start to.
  const hearMe = new Set(app.myCall ? list.filter((p) => baseCall(p.l || "") === app.myCall && p.dir === "hears your grid").map((p) => p.c) : []);
  const before = activity.hearMe;
  activity.hearMe = hearMe;
  if (firstLoad || !app.myCall || !before) return;
  const calls = [...hearMe].filter((c) => !before.has(c));
  if (calls.length) {
    showToast(`${app.myCall} was heard`, `${calls.length} new station${calls.length === 1 ? "" : "s"}: ${calls.slice(0, 4).join(", ")}${calls.length > 4 ? "…" : ""}`);
  }
}

function renderActivity() {
  const all = app.pairs;
  const counts = {};
  for (const p of all) counts[p.band] = (counts[p.band] || 0) + 1;
  renderMySummary();
  $("actMine").disabled = !app.myCall;
  if (!app.myCall) $("actMine").checked = activity.mine = false;

  $("actBands").innerHTML = [["all", `All (${all.length})`], ...BANDS.map((b) => [b, `${bandName(b)} (${counts[b] || 0})`])]
    .map(([k, l]) => `<button type="button" data-b="${k}" aria-pressed="${k === activity.band}">${l}</button>`).join("");
  $("actBands").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => { activity.band = btn.dataset.b; activity.limit = 100; renderActivity(); };
  });

  const hidden = app.allPairs.length - all.length;
  $("actModes").textContent = hidden ? `Modes: ${hidden.toLocaleString()} spots hidden` : "Modes: all";

  const q = activity.q.toUpperCase();
  const rows = all
    .filter((p) => activity.band === "all" || p.band === activity.band)
    .filter((p) => activity.dir === "all" || p.dir === activity.dir)
    .filter((p) => !activity.mine || isMine(p))
    .filter((p) => !q || p.c.toUpperCase().includes(q) || (p.l || "").toUpperCase().includes(q))
    .sort((a, b) => b.ts - a.ts);

  const shown = rows.slice(0, activity.limit);
  $("actRows").innerHTML = shown.length
    ? shown.map((p) => `<tr class="${[activity.fresh.has(spotKey(p)) && "new", isMine(p) && "mine"].filter(Boolean).join(" ")}">` +
      `<td>${new Date(p.ts).toISOString().slice(11, 16)}</td><td>${callLink(p.c)}</td><td>${bandName(p.band)}</td>` +
      `<td class="num"><button type="button" class="khz" data-k="${tuning(p).kHz}" data-m="${tuning(p).mode}" title="Listen here">${(p.fq * 1000).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</button></td>` +
      `<td>${esc(p.m)}</td><td class="num">${p.snr != null ? `${p.snr} dB` : "–"}</td><td class="num">${kmText(p.d)}</td><td>${esc(p.dir)}</td>` +
      `<td>${p.l ? callLink(p.l) : "–"}${p.l && baseCall(p.l) === app.myCall ? '<span class="you">you</span>' : ""}</td></tr>`).join("")
    : `<tr><td colspan="9" class="muted">${!app.spots ? (app.feedError ? "Live spots are unavailable right now." : "Waiting for live spots…") : "No spots match these filters."}</td></tr>`;

  const fresh = rows.filter((p) => activity.fresh.has(spotKey(p))).length;
  $("actCount").textContent = app.spots
    ? `Showing ${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} spots${fresh ? `, ${fresh} new` : ""}`
    : "";
  $("actMore").hidden = rows.length <= shown.length;
}

function setupActivity() {
  $("actModes").addEventListener("click", (e) => { e.stopPropagation(); $("modesBtn").click(); $("modesBtn").scrollIntoView({ block: "nearest" }); });
  $("actDir").addEventListener("change", (e) => { activity.dir = e.target.value; activity.limit = 100; renderActivity(); });
  $("actQ").addEventListener("input", (e) => { activity.q = e.target.value.trim(); activity.limit = 100; renderActivity(); });
  $("actRows").addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("button.khz");
    if (b) tuneTo(Number(b.dataset.k), b.dataset.m, { open: listen.open });
  });
  $("actMore").addEventListener("click", () => { activity.limit += 100; renderActivity(); });
  $("actMine").addEventListener("change", (e) => { activity.mine = e.target.checked; activity.limit = 100; renderActivity(); });
}

/** One line on how the user's own station is doing. */
function renderMySummary() {
  const el = $("mySummary");
  if (!app.myCall || !app.spots) { el.hidden = true; return; }
  el.hidden = false;
  const mine = app.pairs.filter((p) => baseCall(p.l || "") === app.myCall);
  const hearMe = mine.filter((p) => p.dir === "hears your grid");
  const iHeard = mine.filter((p) => p.dir === "heard in your grid");
  const stations = (list) => new Set(list.map((p) => p.c)).size;
  if (!mine.length) {
    el.innerHTML = `<b>${esc(app.myCall)}</b>: no spots in the last 30 minutes from grid ${esc(grid4())}. ` +
      `Check your grid square is right and that your station reports to PSK Reporter.`;
    return;
  }
  const far = hearMe.reduce((m, p) => (p.d > (m ? m.d : -1) ? p : m), null);
  const bands = [...new Set(hearMe.map((p) => p.band))].sort((a, b) => BANDS.indexOf(a) - BANDS.indexOf(b)).map(bandName);
  el.innerHTML = `<b>${esc(app.myCall)}</b> in the last 30 minutes: ` +
    (hearMe.length
      ? `heard by <b>${stations(hearMe)}</b> station${stations(hearMe) === 1 ? "" : "s"} on ${bands.join(", ")}, the farthest ${callLink(far.c)} at ${kmText(far.d)}`
      : "not heard by anyone yet") +
    (iHeard.length ? `; you heard <b>${stations(iHeard)}</b>.` : ".");
}
