/* HamShack extras, round 2: quick log from a spot, worked map (grids and countries), contest calendar,
 * "heard me" map. Plain JavaScript, loaded after extras.js. Uses the page's own logbook (log, logPrefill),
 * spots (app) and land outline (BWLand). Never touches the radio. */
(function () {
  "use strict";
  if (window.__bwRound2) return;
  window.__bwRound2 = true;

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
  const SVGNS = "http://www.w3.org/2000/svg";
  const sv = (tag, attrs) => { const el = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v)); return el; };
  const A = () => (typeof app === "object" && app ? app : null);
  const nameOf = (b) => (typeof bandName === "function" ? bandName(b) : `${b} m`);
  const qsos = () => (typeof log === "object" && log && Array.isArray(log.qsos) ? log.qsos : []);
  const myCall = () => { const a = A(); return String((a && a.myCall) || (byId("mycall") && byId("mycall").value) || "").trim().toUpperCase(); };
  const homeOf = () => { const a = A(); return a && a.home ? a.home : { lat: 53.5, lon: -1 }; };

  const css = `
.bwq-log{margin-left:6px;font:500 .72rem Barlow,sans-serif;color:var(--cool);background:none;border:1px solid var(--line);border-radius:4px;padding:0 5px;cursor:pointer;vertical-align:baseline}
.bwq-log:hover{border-color:var(--cool)}
.bwm-map{width:100%;height:auto;display:block;background:var(--surface);border:1px solid var(--line);border-radius:8px}
.bwm-land{fill:var(--grid);stroke:none}
.bwm-gridsq{fill:var(--cool);opacity:.75}
.bwm-home{fill:var(--text);stroke:var(--surface);stroke-width:.6}
.bwm-path{stroke:var(--cool);stroke-width:.35;opacity:.45;fill:none}
.bwm-stats{display:flex;gap:24px;flex-wrap:wrap;margin:10px 0}
.bwm-stats div b{display:block;font:700 1.9rem/1 "Barlow Condensed",sans-serif}
.bwm-stats div small{color:var(--muted)}
.bwm-chips{display:flex;flex-wrap:wrap;gap:4px;margin:8px 0}
.bwm-chips span{font-size:.8125rem;border:1px solid var(--line);border-radius:999px;padding:1px 9px;background:var(--surface)}
.bwm-chips button{font:500 .8125rem Barlow,sans-serif;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;padding:3px 10px;cursor:pointer}
.bwm-chips button[aria-pressed="true"]{background:var(--cool);border-color:var(--cool);color:var(--bg)}
.bwk-list{list-style:none;margin:6px 0;padding:0}
.bwk-list li{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.bwk-list li.on{box-shadow:inset 3px 0 0 var(--warm);padding-left:8px}
.bwk-when{color:var(--muted);font-variant-numeric:tabular-nums}
.bwk-tag{font-size:.72rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--warm);margin-right:6px}
`;
  document.head.append(mk("style", { id: "bwr2Style" }, css));

  function panel(id, title, ...body) {
    return mk("section", { class: "panel bwx-panel", id, "aria-labelledby": id + "T" },
      mk("div", { class: "phead" }, mk("h2", { id: id + "T", text: title })), ...body);
  }
  const note = (text) => mk("p", { class: "bwx-note", style: "font-size:.875rem;color:var(--muted);margin:6px 0", text });

  /** An equirectangular world map (360 x 180 user units) with the land outline. */
  function worldSvg(label) {
    const svg = sv("svg", { class: "bwm-map", viewBox: "0 0 360 180", role: "img", "aria-label": label });
    let d = "";
    try {
      for (const ring of (window.BWLand ? window.BWLand.rings() : [])) {
        d += "M" + ring.map(([lon, lat]) => `${(lon + 180).toFixed(1)},${(90 - lat).toFixed(1)}`).join("L") + "Z";
      }
    } catch { /* no outline: plain background */ }
    if (d) svg.append(sv("path", { class: "bwm-land", d, "fill-rule": "evenodd" }));
    return svg;
  }
  const X = (lon) => lon + 180, Y = (lat) => 90 - lat;

  /* ============================== 1. quick log from a spot ============================== */
  const LOGGABLE = new Set(["SSB", "CW", "FT8", "FT4", "WSPR", "AM", "FM", "RTTY", "PSK31", "JS8", "SSTV"]);
  function newestPair(call) {
    const a = A(); let best = null;
    for (const p of (a && a.allPairs) || []) if (p.c === call && (!best || p.ts > best.ts)) best = p;
    return best;
  }
  function quickLog(call) {
    if (typeof logPrefill !== "function") return;
    const p = newestPair(call);
    const mode = p ? String(p.m || "").toUpperCase().replace(/^PSK$/, "PSK31") : "";
    logPrefill({ call, kHz: p ? p.fq * 1000 : undefined, mode: LOGGABLE.has(mode) ? mode : undefined, grid: p ? p.g : "",
      rstR: p && p.snr != null ? String(p.snr) : "", note: p ? "Logged from a HamShack spot" : "" });
  }
  function addLogButtons(root) {
    if (!root || typeof logPrefill !== "function") return;
    const rows = root.id === "spots" ? root.querySelectorAll("li") : root.querySelectorAll("tr");
    for (const row of rows) {
      if (row.querySelector(".bwq-log")) continue;
      const link = row.querySelector("a.call[data-call]"); if (!link) continue;
      const call = link.textContent.trim().toUpperCase(); // the full call, as spotted
      const btn = mk("button", { type: "button", class: "bwq-log", title: `Open the logbook with ${call} filled in`, "aria-label": `Log a contact with ${call}`, text: "Log",
        onclick: (e) => { e.preventDefault(); e.stopPropagation(); quickLog(call); } });
      link.after(btn);
    }
  }
  function watchLists() {
    for (const id of ["spots", "actRows"]) {
      const el = byId(id); if (!el) continue;
      addLogButtons(el);
      new MutationObserver(() => addLogButtons(el)).observe(el, { childList: true });
    }
  }

  /* ============================== 2. worked map ============================== */
  // Common DXCC-style prefixes -> country, most specific first. Not a full DXCC list; unknown prefixes count as "Other".
  const COUNTRY = [
    [/^(GW|MW|2W)/, "Wales"], [/^(GM|MM|2M)/, "Scotland"], [/^(GI|MI|2I)/, "Northern Ireland"], [/^(GD|MD|2D)/, "Isle of Man"],
    [/^(GJ|MJ|2J)/, "Jersey"], [/^(GU|MU|2U)/, "Guernsey"], [/^(G|M|2E)/, "England"], [/^EI|^EJ/, "Ireland"],
    [/^(DA|DB|DC|DD|DF|DG|DH|DJ|DK|DL|DM|DN|DO|DP|DQ|DR)/, "Germany"], [/^(F|TM)/, "France"], [/^(I|IU|IZ)/, "Italy"],
    [/^(EA6|EB6|EC6|ED6|EH6)/, "Balearic Is."], [/^(EA8|EB8|EC8|ED8|EH8)/, "Canary Is."], [/^(EA|EB|EC|ED|EE|EF|EG|EH)/, "Spain"],
    [/^CT3/, "Madeira"], [/^CU/, "Azores"], [/^CT|^CS/, "Portugal"], [/^(PA|PB|PC|PD|PE|PF|PG|PH|PI)/, "Netherlands"],
    [/^O[NOPQRST]/, "Belgium"], [/^LX/, "Luxembourg"], [/^OZ|^5[PQ]/, "Denmark"], [/^OY/, "Faroe Is."], [/^OX/, "Greenland"],
    [/^(SM|SA|SB|SC|SD|SE|SF|SG|SH|SI|SJ|SK|SL|7S|8S)/, "Sweden"], [/^(LA|LB|LC|LD|LE|LF|LG|LH|LI|LJ|LK|LL|LM|LN)/, "Norway"],
    [/^OH0/, "Aland Is."], [/^O[FGHIJ]/, "Finland"], [/^TF/, "Iceland"], [/^HB0/, "Liechtenstein"], [/^HB|^HE/, "Switzerland"], [/^OE/, "Austria"],
    [/^(SP|SQ|SN|SO|3Z|HF)/, "Poland"], [/^OK|^OL/, "Czech Republic"], [/^OM/, "Slovakia"], [/^HA|^HG/, "Hungary"],
    [/^Y[O-R]/, "Romania"], [/^LZ/, "Bulgaria"], [/^S5/, "Slovenia"], [/^9A/, "Croatia"], [/^E7/, "Bosnia-Herzegovina"],
    [/^YU|^YT/, "Serbia"], [/^4O/, "Montenegro"], [/^Z3/, "North Macedonia"], [/^ZA/, "Albania"], [/^S[V-Z]5/, "Dodecanese"],
    [/^SV9|^SX9/, "Crete"], [/^S[V-Z]|^J4/, "Greece"], [/^5B|^C4|^H2|^P3/, "Cyprus"], [/^9H/, "Malta"], [/^T7/, "San Marino"],
    [/^HV/, "Vatican"], [/^3A/, "Monaco"], [/^C3/, "Andorra"], [/^ZB/, "Gibraltar"], [/^TA|^TC|^YM/, "Turkey"],
    [/^ES/, "Estonia"], [/^YL/, "Latvia"], [/^LY/, "Lithuania"], [/^EW|^EU/, "Belarus"], [/^U[R-Z]|^E[M-O]/, "Ukraine"],
    [/^ER/, "Moldova"], [/^4[JK]/, "Azerbaijan"], [/^4L/, "Georgia"], [/^EK/, "Armenia"], [/^UN|^U[N-Q]/, "Kazakhstan"],
    [/^(UA9|UA0|RA9|RA0|R[0-9A-Z]9|R[0-9A-Z]0|U[A-I]9|U[A-I]0)/, "Asiatic Russia"], [/^(UA|RA|RU|RV|RW|RX|RZ|R\d|U[A-I])/, "European Russia"],
    [/^4X|^4Z/, "Israel"], [/^JY/, "Jordan"], [/^OD/, "Lebanon"], [/^HZ|^7Z|^8Z/, "Saudi Arabia"], [/^A6/, "UAE"], [/^A7/, "Qatar"],
    [/^A9/, "Bahrain"], [/^9K/, "Kuwait"], [/^A4/, "Oman"], [/^EP|^EQ/, "Iran"], [/^YI/, "Iraq"], [/^AP/, "Pakistan"],
    [/^VU|^AT|^8T|^8U/, "India"], [/^4S/, "Sri Lanka"], [/^S2/, "Bangladesh"], [/^9N/, "Nepal"], [/^HS|^E2/, "Thailand"],
    [/^XV|^3W/, "Vietnam"], [/^9M2|^9M4/, "West Malaysia"], [/^9M6|^9M8/, "East Malaysia"], [/^9V/, "Singapore"],
    [/^Y[B-H]/, "Indonesia"], [/^D[U-Z]|^4[D-I]/, "Philippines"], [/^BV/, "Taiwan"], [/^VR/, "Hong Kong"], [/^XX9/, "Macao"],
    [/^B/, "China"], [/^H[LM]|^D[S-T]|^6[K-N]/, "South Korea"], [/^J[A-S]|^7[J-N]|^8[J-N]/, "Japan"], [/^UA0|^R0/, "Asiatic Russia"],
    [/^VK9N/, "Norfolk I."], [/^VK|^AX/, "Australia"], [/^ZL|^ZM/, "New Zealand"], [/^FK/, "New Caledonia"], [/^FO/, "French Polynesia"],
    [/^KH6|^NH6|^WH6|^AH6/, "Hawaii"], [/^KL7|^NL7|^WL7|^AL7/, "Alaska"], [/^KP4|^NP4|^WP4|^KP3|^NP3/, "Puerto Rico"], [/^KH2/, "Guam"],
    [/^(K|W|N|A[A-L])/, "United States"], [/^V[A-G]|^VO|^VY|^C[F-K]|^CY|^CZ|^X[J-O]/, "Canada"], [/^X[A-I]|^4[A-C]|^6[D-J]/, "Mexico"],
    [/^TI|^TE/, "Costa Rica"], [/^TG|^TD/, "Guatemala"], [/^HP|^H[O-P]|^3E|^3F/, "Panama"], [/^YN|^H6|^H7/, "Nicaragua"],
    [/^HR|^HQ/, "Honduras"], [/^YS|^HU/, "El Salvador"], [/^V3/, "Belize"], [/^CO|^CM|^CL|^T4/, "Cuba"], [/^6Y/, "Jamaica"],
    [/^HI/, "Dominican Rep."], [/^HH/, "Haiti"], [/^8P/, "Barbados"], [/^9Y|^9Z/, "Trinidad & Tobago"], [/^J3/, "Grenada"],
    [/^J6/, "St Lucia"], [/^J7/, "Dominica"], [/^J8/, "St Vincent"], [/^V2/, "Antigua"], [/^V4/, "St Kitts & Nevis"],
    [/^C6/, "Bahamas"], [/^VP9/, "Bermuda"], [/^VP5/, "Turks & Caicos"], [/^ZF/, "Cayman Is."], [/^PJ2|^PJ4/, "Curacao/Bonaire"],
    [/^P4/, "Aruba"], [/^FM/, "Martinique"], [/^FG/, "Guadeloupe"], [/^FY/, "French Guiana"], [/^PZ/, "Suriname"], [/^8R/, "Guyana"],
    [/^Y[V-Y]|^4M/, "Venezuela"], [/^HK|^HJ|^5[JK]/, "Colombia"], [/^HC|^HD/, "Ecuador"], [/^O[A-C]/, "Peru"], [/^CP/, "Bolivia"],
    [/^ZP/, "Paraguay"], [/^C[V-X]/, "Uruguay"], [/^CE0Y|^CE0Z/, "Easter I."], [/^C[A-E]|^3G|^XQ|^XR/, "Chile"],
    [/^L[O-W]|^AY|^AZ/, "Argentina"], [/^P[P-Y]|^Z[V-Z]/, "Brazil"], [/^VP8/, "Falkland Is."],
    [/^CN|^5C|^5D|^5E|^5F|^5G/, "Morocco"], [/^7X/, "Algeria"], [/^3V|^TS/, "Tunisia"], [/^5A/, "Libya"], [/^SU|^SS/, "Egypt"],
    [/^ST/, "Sudan"], [/^ET/, "Ethiopia"], [/^5Z|^5Y/, "Kenya"], [/^5H|^5I/, "Tanzania"], [/^5X/, "Uganda"], [/^9X/, "Rwanda"],
    [/^Z2/, "Zimbabwe"], [/^9J/, "Zambia"], [/^7Q/, "Malawi"], [/^C9/, "Mozambique"], [/^A2/, "Botswana"], [/^V5/, "Namibia"],
    [/^Z[R-U]|^S8/, "South Africa"], [/^7P/, "Lesotho"], [/^3DA/, "Eswatini"], [/^5R/, "Madagascar"], [/^3B8/, "Mauritius"],
    [/^FR/, "Reunion"], [/^S7/, "Seychelles"], [/^D4/, "Cape Verde"], [/^6W/, "Senegal"], [/^C5/, "Gambia"], [/^9L/, "Sierra Leone"],
    [/^EL|^5L|^6Z/, "Liberia"], [/^TU/, "Cote d'Ivoire"], [/^9G/, "Ghana"], [/^5V/, "Togo"], [/^TY/, "Benin"], [/^5N/, "Nigeria"],
    [/^TJ/, "Cameroon"], [/^TR/, "Gabon"], [/^TN/, "Congo"], [/^9Q|^9O|^9P|^9R|^9S|^9T/, "DR Congo"], [/^D2|^D3/, "Angola"],
    [/^ZD7/, "St Helena"], [/^ZD8/, "Ascension I."], [/^ZD9/, "Tristan da Cunha"], [/^3Y/, "Bouvet / Peter I"], [/^KC4|^DP0/, "Antarctica"],
  ];
  function countryOf(call) {
    let c = String(call || "").toUpperCase();
    const parts = c.split("/");
    if (parts.length > 1) { // EA8/G4ABC -> EA8; G4ABC/P -> G4ABC
      const pre = parts.find((p) => p.length <= 4 && /[A-Z]/.test(p) && !/^(P|M|MM|AM|QRP|A)$/.test(p) && p !== parts.reduce((a, b) => (b.length > a.length ? b : a)));
      c = pre || parts.reduce((a, b) => (b.length > a.length ? b : a));
    }
    for (const [re, name] of COUNTRY) if (re.test(c)) return name;
    return "Other";
  }
  const worked = { band: "all" };
  function renderWorked() {
    const box = byId("bwmBody"); if (!box) return;
    const all = qsos();
    const list = worked.band === "all" ? all : all.filter((q) => String(q.band || "").replace(/m$/i, "") === worked.band || q.band === worked.band);
    const grids = new Set(), countries = new Map();
    for (const q of list) {
      const g = String(q.grid || "").slice(0, 4).toUpperCase(); if (/^[A-R]{2}\d{2}$/.test(g)) grids.add(g);
      const k = countryOf(q.call); countries.set(k, (countries.get(k) || 0) + 1);
    }
    const bandsInLog = [...new Set(all.map((q) => String(q.band || "")).filter(Boolean))];
    box.replaceChildren();
    if (!all.length) { box.append(note("Your logbook is empty. Log some contacts (or import an ADIF file in the Logbook panel) and they'll show here.")); return; }
    box.append(mk("div", { class: "bwm-chips", role: "group", "aria-label": "Band" },
      ["all", ...bandsInLog].map((b) => mk("button", { type: "button", "aria-pressed": worked.band === b ? "true" : "false", text: b === "all" ? "All bands" : b, onclick: () => { worked.band = b; renderWorked(); } }))));
    const known = [...countries.keys()].filter((k) => k !== "Other").length;
    box.append(mk("div", { class: "bwm-stats" },
      mk("div", {}, mk("b", { text: String(list.length) }), mk("small", { text: "Contacts" })),
      mk("div", {}, mk("b", { text: String(known) }), mk("small", { text: "Countries" })),
      mk("div", {}, mk("b", { text: String(grids.size) }), mk("small", { text: "Grid squares" }))));
    const svg = worldSvg(`Map of ${grids.size} grid squares worked`);
    for (const g of grids) {
      const lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2, lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
      const r = sv("rect", { class: "bwm-gridsq", x: X(lon), y: Y(lat + 1), width: 2, height: 1 });
      r.append(Object.assign(sv("title"), { textContent: g }));
      svg.append(r);
    }
    const h = homeOf(); svg.append(sv("circle", { class: "bwm-home", cx: X(h.lon), cy: Y(h.lat), r: 2.2 }));
    box.append(svg);
    const sorted = [...countries.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    box.append(mk("div", { class: "bwm-chips", "aria-label": "Countries worked" }, sorted.map(([k, n]) => mk("span", { text: `${k} ${n}` }))));
    box.append(note("Squares are 4-character grid squares from contacts with a locator. Countries come from callsign prefixes; it's a guide, not an official DXCC count."));
  }

  /* ============================== 3. contest calendar ============================== */
  const contests = { data: null, err: false };
  async function loadContests() {
    try { const r = await fetch("/api/contests", { cache: "no-store" }); if (!r.ok) throw new Error(r.status); contests.data = await r.json(); contests.err = false; }
    catch { contests.err = true; }
    renderContests();
  }
  function fmtRange(c) {
    if (!c.start) return c.when;
    const s = new Date(c.start), e = new Date(c.end);
    const day = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
    const hm = (d) => d.toISOString().slice(11, 16).replace(":", "");
    return day(s) === day(e) ? `${day(s)} ${hm(s)}–${hm(e)}Z` : `${day(s)} ${hm(s)}Z – ${day(e)} ${hm(e)}Z`;
  }
  function renderContests() {
    const box = byId("bwkBody"); if (!box) return;
    box.replaceChildren();
    const d = contests.data;
    if (!d) { box.append(note(contests.err ? "The contest calendar couldn't be reached. HamShack will try again later." : "Loading contests…")); return; }
    const now = Date.now(), horizon = now + 8 * 24 * 3600e3;
    const list = d.contests.filter((c) => !c.start || (c.end > now && c.start < horizon)).sort((a, b) => (a.start || 0) - (b.start || 0)).slice(0, 40);
    const ul = mk("ul", { class: "bwk-list" });
    for (const c of list) {
      const on = c.start && c.start <= now && now < c.end;
      const soon = c.start && c.start > now && c.start - now < 3 * 3600e3;
      ul.append(mk("li", { class: on ? "on" : "" },
        mk("span", {}, on ? mk("span", { class: "bwk-tag", text: "On now" }) : soon ? mk("span", { class: "bwk-tag", text: `In ${Math.max(1, Math.round((c.start - now) / 6e4))} min` }) : null,
          mk("a", { href: c.link, target: "_blank", rel: "noopener noreferrer", text: c.name })),
        mk("span", { class: "bwk-when", text: fmtRange(c) })));
    }
    if (!list.length) box.append(note("No contests in the next 8 days."));
    else box.append(ul);
    box.append(mk("p", { class: "bwx-note", style: "font-size:.8125rem;color:var(--muted)" },
      "From the ", mk("a", { href: d.link || "https://www.contestcalendar.com/", target: "_blank", rel: "noopener noreferrer", text: "WA7BNM Contest Calendar" }),
      ". Times are UTC. Check each contest's rules page before you take part.", d.stale ? " (Couldn't refresh just now; this list may be a few hours old.)" : ""));
  }

  /* ============================== 4. heard-me map ============================== */
  const heard = { mins: 60, data: null, err: "", busy: false };
  const SNR_COL = (s) => (s >= 0 ? "var(--cool)" : s >= -10 ? "color-mix(in srgb,var(--cool) 70%,var(--warm))" : "var(--warm)");
  async function loadHeard() {
    const call = myCall();
    if (!call) { heard.data = null; heard.err = "Enter your callsign at the top of the page to see who's hearing you."; renderHeard(); return; }
    heard.busy = true; renderHeard();
    try {
      const r = await fetch(`/api/myreports?call=${encodeURIComponent(call)}&mins=${heard.mins}`, { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "PSK Reporter couldn't be reached.");
      heard.data = d; heard.err = "";
    } catch (e) { heard.err = e.message || "PSK Reporter couldn't be reached."; }
    heard.busy = false; renderHeard();
  }
  function renderHeard() {
    const box = byId("bwhBody"); if (!box) return;
    box.replaceChildren();
    box.append(mk("div", { class: "bwm-chips", role: "group", "aria-label": "Time window" },
      [[15, "15 min"], [60, "1 hour"], [360, "6 hours"], [1440, "24 hours"]].map(([m, t]) => mk("button", { type: "button", "aria-pressed": heard.mins === m ? "true" : "false", text: t, onclick: () => { heard.mins = m; loadHeard(); } })),
      mk("button", { type: "button", text: heard.busy ? "Checking…" : "Refresh", disabled: heard.busy || null, onclick: loadHeard })));
    if (heard.err) { box.append(note(heard.err)); return; }
    const d = heard.data; if (!d) { box.append(note("Loading reports…")); return; }
    const h = homeOf();
    const byRx = new Map();
    for (const r of d.reports || []) { const prev = byRx.get(r.c); if (!prev || r.snr > prev.snr) byRx.set(r.c, r); }
    const rx = [...byRx.values()].map((r) => ({ ...r, d: Math.round(distKm(h.lat, h.lon, r.lat, r.lon)), band: bandOfMHz(r.fq) }));
    const far = rx.reduce((m, r) => (r.d > (m ? m.d : -1) ? r : m), null);
    const bands = [...new Set(rx.map((r) => r.band).filter(Boolean))];
    box.append(mk("div", { class: "bwm-stats" },
      mk("div", {}, mk("b", { text: String(rx.length) }), mk("small", { text: "Stations heard you" })),
      mk("div", {}, mk("b", { text: far ? `${far.d.toLocaleString()} km` : "–" }), mk("small", { text: far ? `Farthest: ${far.c}` : "Farthest" })),
      mk("div", {}, mk("b", { text: bands.length ? bands.map(nameOf).join(", ") : "–" }), mk("small", { text: "Bands" }))));
    const svg = worldSvg(`Map of ${rx.length} stations that heard ${d.call}`);
    for (const r of rx) svg.append(sv("line", { class: "bwm-path", x1: X(h.lon), y1: Y(h.lat), x2: X(r.lon), y2: Y(r.lat) }));
    for (const r of rx) {
      const c = sv("circle", { cx: X(r.lon), cy: Y(r.lat), r: 1.7, fill: SNR_COL(r.snr), stroke: "var(--surface)", "stroke-width": 0.3 });
      c.append(Object.assign(sv("title"), { textContent: `${r.c} ${r.g} · ${r.m} ${r.band ? nameOf(r.band) : ""} · ${r.snr} dB · ${r.d.toLocaleString()} km` }));
      svg.append(c);
    }
    svg.append(sv("circle", { class: "bwm-home", cx: X(h.lon), cy: Y(h.lat), r: 2.2 }));
    box.append(svg);
    box.append(note(rx.length
      ? "Each dot is a station that decoded your FT8 or FT4 signal (best report per station). Blue is strong, orange is weak. The dark dot is you. Hover a dot for details. From PSK Reporter."
      : `No FT8 or FT4 reports of ${d.call} in this window. Call CQ for a few minutes, then refresh. Reports can take a few minutes to appear on PSK Reporter.`));
  }
  function distKm(a, b, c, d) { const R = Math.PI / 180, x = Math.sin((c - a) * R / 2) ** 2 + Math.cos(a * R) * Math.cos(c * R) * Math.sin((d - b) * R / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }
  function bandOfMHz(f) {
    if (typeof bandOf === "function") { try { return bandOf(f); } catch { /* fall through */ } }
    const L = { 160: [1.8, 2], 80: [3.5, 4], 60: [5.25, 5.45], 40: [7, 7.3], 30: [10.1, 10.15], 20: [14, 14.35], 17: [18.068, 18.168], 15: [21, 21.45], 12: [24.89, 24.99], 10: [28, 29.7], 6: [50, 54], 2: [144, 146] };
    return Object.keys(L).find((b) => f >= L[b][0] && f <= L[b][1]) || null;
  }

  /* ============================== start ============================== */
  function place(...els) {
    const after = byId("secChat") || byId("secCwTrain") || byId("secFcst") || byId("secAnt");
    if (after) after.after(...els); else (document.querySelector(".wrap") || document.body).append(...els);
  }
  function init() {
    place(
      panel("secHeard", "Who's hearing me", note("A map of the stations that have decoded your FT8 or FT4 signal, from PSK Reporter. It only reads reports and never transmits."), mk("div", { id: "bwhBody" })),
      panel("secWorked", "Worked map", note("Countries and grid squares from your HamShack logbook."), mk("div", { id: "bwmBody" })),
      panel("secContests", "Contests this week", mk("div", { id: "bwkBody" })));
    watchLists();
    renderWorked(); renderContests(); renderHeard();
    loadContests(); loadHeard();
    setInterval(loadContests, 60 * 60e3);
    setInterval(renderContests, 60e3);
    setInterval(() => { if (document.visibilityState === "visible") loadHeard(); }, 5 * 60e3);
    // Keep the worked map in step with the logbook (it is saved under "bw-log").
    let sig = "";
    setInterval(() => { const s = `${qsos().length}|${qsos()[0] ? qsos()[0].id : ""}`; if (s !== sig) { sig = s; renderWorked(); } }, 3000);
    const mc = byId("mycall"); if (mc) mc.addEventListener("change", () => setTimeout(loadHeard, 50));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.BWRound2 = { countryOf, quickLog, renderWorked, loadHeard, loadContests };
})();
