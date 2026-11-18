/* Shortwave stations on air now, from the EiBi schedule (eibispace.de, free to use in other software).
   Click a frequency to tune Listen and your radio (the ATS Mini, or any connected radio) there in AM.
   The schedule is read by eibi-data.js; the server fetches it twice a day. */
"use strict";

const SKED_REFETCH = 12 * 60 * 60 * 1000; // the schedule changes a few times a season
const SKED_SHOW = 120; // rows on screen at once
const sked = {
  rows: [], codes: { lang: {}, country: {} }, season: "", at: 0, loading: false, error: "", loaded: false,
  band: "all", lang: "all", find: "", soon: false, util: false, timer: null, tick: null,
};

function loadSked() {
  try {
    const s = JSON.parse(load("bw-sked") || "{}");
    if (typeof s.band === "string") sked.band = s.band;
    if (typeof s.lang === "string") sked.lang = s.lang;
    if (typeof s.soon === "boolean") sked.soon = s.soon;
    if (typeof s.util === "boolean") sked.util = s.util;
  } catch { /* defaults */ }
}
function saveSked() { store("bw-sked", { band: sked.band, lang: sked.lang, soon: sked.soon, util: sked.util }); }

/** Utility stations (ships, weather, time signals, aircraft) and anything else outside the broadcast bands:
 * hidden unless asked for. EiBi codes Morse, teletype and time signals as languages starting with "-". */
function skedUtility(b) {
  return b.utility || b.langs.some((l) => l.startsWith("-")) || !Eibi.bandOf(b.kHz);
}

/** The mode to listen in: AM for broadcasters; what EiBi says for utility voice and data. */
function skedMode(b) {
  if (b.days === "USB" || b.langs.includes("-TY") || b.langs.includes("-HF")) return "usb";
  if (b.days === "LSB") return "lsb";
  if (b.langs.includes("-CW")) return "cw";
  return "am";
}

const skedLangName = (code) => sked.codes.lang[code] || code;
// EiBi uses the ITU's full names; a few are long for a list.
const SKED_SHORT = { G: "United Kingdom", USA: "USA", CHN: "China", KOR: "South Korea", KRE: "North Korea" };
const skedCountry = (itu) => SKED_SHORT[itu] || (sked.codes.country[itu] || itu).replace(/\s*\(.*?\)\s*$/, "");
const skedTime = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}${String(min % 60).padStart(2, "0")}`;

/** What's on now (and, if ticked, starting within the hour), with the filters applied, by frequency. */
function skedShown(now = new Date()) {
  const q = sked.find.trim().toLowerCase();
  const out = [];
  for (const b of sked.rows) {
    if (!sked.util && skedUtility(b)) continue;
    if (sked.band !== "all" && Eibi.bandOf(b.kHz) !== sked.band) continue;
    if (sked.lang !== "all" && !b.langs.includes(sked.lang)) continue;
    if (q && !`${b.station} ${skedCountry(b.itu)} ${b.itu} ${b.langs.map(skedLangName).join(" ")}`.toLowerCase().includes(q)) continue;
    const on = Eibi.onAir(b, now);
    if (on) { out.push({ b, on, soon: null }); continue; }
    if (sked.soon) {
      const s = Eibi.startsIn(b, now, 60);
      if (s != null) out.push({ b, on: false, soon: s });
    }
  }
  return out.sort((x, y) => (x.soon != null) - (y.soon != null) || x.b.kHz - y.b.kHz || x.b.start - y.b.start);
}

function skedLangOptions(now = new Date()) {
  const counts = new Map();
  for (const b of sked.rows) {
    if ((!sked.util && skedUtility(b)) || !Eibi.onAir(b, now)) continue;
    for (const l of b.langs) if (!l.startsWith("-")) counts.set(l, (counts.get(l) || 0) + 1);
  }
  if (sked.lang !== "all" && !counts.has(sked.lang)) counts.set(sked.lang, 0);
  const langs = [...counts.keys()].sort((a, b) => skedLangName(a).localeCompare(skedLangName(b)));
  $("skLang").innerHTML = `<option value="all">All languages</option>${langs.map((l) =>
    `<option value="${esc(l)}">${esc(skedLangName(l))}${counts.get(l) ? ` (${counts.get(l)})` : ""}</option>`).join("")}`;
  $("skLang").value = sked.lang;
}

function renderSked() {
  const list = $("skList");
  if (!list) return;
  $("skBand").value = sked.band;
  $("skSoon").checked = sked.soon;
  $("skUtil").checked = sked.util;
  if (!sked.loaded) {
    list.innerHTML = `<li class="small muted">${sked.error ? "" : "Loading the shortwave schedule…"}</li>`;
    $("skNote").textContent = sked.error ? `Couldn't load the EiBi schedule: ${sked.error}` : "";
    return;
  }
  const now = new Date();
  skedLangOptions(now);
  const shown = skedShown(now);
  const onNow = shown.filter((x) => x.on).length;
  list.innerHTML = shown.slice(0, SKED_SHOW).map(({ b, on, soon }, i) => {
    const langs = b.langs.map(skedLangName).join(", ");
    const tags = (soon != null ? `<span class="sktag soon">in ${soon} min</span>` : "")
      + (on === "irregular" ? ' <span class="sktag" title="On the timetable, but not every week">irregular</span>' : "");
    const days = b.days && !["USB", "LSB"].includes(b.days) ? ` · ${esc(b.days)}` : "";
    const more = [skedCountry(b.itu), b.target ? `to ${b.target}` : ""].filter(Boolean).join(" · ");
    return `<li class="skrow">
      <button type="button" class="tune sktune" data-i="${i}" title="Tune to ${esc(b.station)}">${b.kHz.toLocaleString()} kHz</button>
      <span><span class="skname">${esc(b.station)}</span>${tags ? ` ${tags}` : ""}${langs ? ` <span class="small muted">${esc(langs)}</span>` : ""}</span>
      <span class="skwhen small muted">${skedTime(b.start)}–${skedTime(b.end)} UTC${days}</span>
      <span class="skmore small muted">${esc(more)}</span>
    </li>`;
  }).join("") || `<li class="small muted">Nothing on the air right now with these filters.</li>`;
  list._shown = shown.slice(0, SKED_SHOW);
  const extra = shown.length > SKED_SHOW ? ` The first ${SKED_SHOW} are shown: pick a band or language to see the rest.` : "";
  $("skNote").textContent = `${onNow} on the air now${sked.soon ? `, ${shown.length - onNow} starting within the hour` : ""}.${extra} `
    + "Click a frequency to tune there (AM). Schedule: EiBi, eibispace.de"
    + (sked.error ? ` (couldn't check for a newer copy: ${sked.error})` : ".");
  $("skSeason").textContent = `EiBi schedule, ${sked.season.startsWith("A") ? "summer" : "winter"} season ${sked.season}`;
}

async function refreshSked() {
  if (sked.loading) return;
  sked.loading = true;
  try {
    const r = await fetch("/api/eibi");
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    const d = await r.json();
    sked.rows = Eibi.parseSked(d.csv);
    sked.codes = Eibi.parseCodes(d.readme);
    sked.season = String(d.season || "");
    sked.at = d.at || Date.now();
    sked.loaded = true;
    sked.error = "";
  } catch (e) {
    sked.error = e.message || String(e);
  } finally {
    sked.loading = false;
    renderSked();
  }
}

function setupSked() {
  if (!$("secSked") || typeof Eibi === "undefined") return;
  loadSked();
  $("skBand").innerHTML = `<option value="all">All bands</option>${Eibi.BANDS.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("")}`;
  if (sked.band !== "all" && !Eibi.BANDS.some((b) => b.id === sked.band)) sked.band = "all";
  $("skBand").addEventListener("change", () => { sked.band = $("skBand").value; saveSked(); renderSked(); });
  $("skLang").addEventListener("change", () => { sked.lang = $("skLang").value; saveSked(); renderSked(); });
  $("skSoon").addEventListener("change", () => { sked.soon = $("skSoon").checked; saveSked(); renderSked(); });
  $("skUtil").addEventListener("change", () => { sked.util = $("skUtil").checked; saveSked(); renderSked(); });
  let typing = null;
  $("skFind").addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => { sked.find = $("skFind").value; renderSked(); }, 200); });
  $("skList").addEventListener("click", (e) => {
    const t = e.target.closest(".sktune");
    if (!t) return;
    const x = $("skList")._shown && $("skList")._shown[Number(t.dataset.i)];
    if (x) tuneTo(x.b.kHz, skedMode(x.b), { scroll: false });
  });
  renderSked();
  refreshSked();
  sked.timer = setInterval(() => { if (!document.hidden) refreshSked(); }, SKED_REFETCH);
  // Stations come and go on the hour and half hour: redraw each minute.
  sked.tick = setInterval(() => { if (!document.hidden && sked.loaded) renderSked(); }, 60 * 1000);
}
