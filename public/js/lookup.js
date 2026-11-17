/* Locator box, callsign lookup and the user's own callsign. */
"use strict";

/* ===================== Grid square and callsign lookup ===================== */

function setGrid() {
  const typed = $("grid").value.trim();
  const value = normaliseLocator(typed);
  const pos = value && value.length === typed.length ? gridToLatLon(value) : null;
  if (!pos) { $("gerr").textContent = "Enter a locator like IO93 or IO93fa"; return; }
  $("grid").value = value;
  $("gerr").textContent = "";
  const square = value.slice(0, 4).toUpperCase();
  const sameSquare = square === app.square;
  app.home = pos;
  app.square = square;
  store("bw-grid", value);
  if (!sameSquare) {
    app.sel = null;
    app.userPicked = false;
    app.spots = null;
    app.feedError = false;
    activity.seen = null;
    activity.fresh = new Set();
    activity.hearMe = null;
    resetMonitorHistory();
    saveMonitor();
    renderBanner();
  }
  render();
  drawMonitor();
  refresh();
}

const PREFIXES = [
  [/^(GW|MW|2W)/, "Wales"], [/^(GM|MM|2M)/, "Scotland"], [/^(GI|MI|2I)/, "Northern Ireland"], [/^(GD|MD|2D)/, "Isle of Man"],
  [/^(GJ|MJ|2J)/, "Jersey"], [/^(GU|MU|2U)/, "Guernsey"], [/^(G|M|2E)/, "England"],
  [/^(DL|DA|DB|DC|DD|DF|DG|DH|DJ|DK|DM|DO|DP|DQ|DR)/, "Germany"], [/^F/, "France"], [/^I/, "Italy"],
  [/^(EA|EB|EC|ED|EE|EF|EG|EH)/, "Spain"], [/^(PA|PB|PC|PD|PE|PF|PG|PH|PI)/, "Netherlands"], [/^ON/, "Belgium"],
  [/^OZ/, "Denmark"], [/^(SM|SA|SB|SC|SD|SE|SF|SG|SH|SI|SJ|SK|SL)/, "Sweden"], [/^(LA|LB|LC)/, "Norway"],
  [/^OH/, "Finland"], [/^TF/, "Iceland"], [/^EI/, "Ireland"], [/^HB/, "Switzerland"], [/^OE/, "Austria"],
  [/^(SP|SQ|SR|SN|3Z)/, "Poland"], [/^OK/, "Czech Republic"], [/^CT/, "Portugal"], [/^(UA|RA|RU|RV|RW|RZ|R\d)/, "Russia"],
  [/^VE/, "Canada"], [/^KH6/, "Hawaii"], [/^(K|W|N|A[A-L])/, "United States"],
  [/^(JA|JE|JF|JG|JH|JI|JJ|JK|JL|JM|JN|JO|JP|JQ|JR|7J|7K|7L|7M|7N)/, "Japan"], [/^VK/, "Australia"], [/^ZL/, "New Zealand"],
  [/^ZS/, "South Africa"], [/^(PY|PP|PQ|PR|PS|PT|PU|PV|PW|PX)/, "Brazil"], [/^LU/, "Argentina"], [/^CE/, "Chile"],
  [/^(BY|BG|BH|BA|BD|BI)/, "China"], [/^VU/, "India"], [/^HS/, "Thailand"],
];
const CALL_RE = /^[A-Z0-9]{1,3}\d[A-Z0-9]{0,3}[A-Z](\/[A-Z0-9]{1,4})?$/;
const PREFIXED_CALL_RE = /^[A-Z0-9]{1,4}\/[A-Z0-9]{1,3}\d[A-Z0-9]{0,3}[A-Z]$/;

function lookupCall(e) {
  e.preventDefault();
  const raw = $("call").value.trim().toUpperCase();
  const out = $("lkout");
  if (!CALL_RE.test(raw) && !PREFIXED_CALL_RE.test(raw)) {
    out.textContent = "That doesn’t look like a callsign. Try something like G4ABC or EA8/G4ABC.";
    return;
  }
  const base = baseCall(raw);
  const hit = PREFIXES.find(([re]) => re.test(base));
  out.innerHTML = `<b>${esc(raw)}</b>: ${hit ? `prefix suggests ${hit[1]}` : "country not recognised from the prefix"}. ` +
    `<a class="call" href="https://www.qrz.com/db/${encodeURIComponent(base)}" target="_blank" rel="noopener noreferrer" data-call="${esc(base)}">View ${esc(base)} on QRZ.com</a>`;
  openStation(base);
}
/* ===================== Your callsign ===================== */

function validCall(raw) {
  return CALL_RE.test(raw) || PREFIXED_CALL_RE.test(raw);
}

function setMyCall(raw, { save = true } = {}) {
  const value = String(raw || "").trim().toUpperCase();
  $("mycall").value = value;
  if (value && !validCall(value)) { $("cerr").textContent = "That doesn’t look like a callsign"; return false; }
  $("cerr").textContent = "";
  const next = value ? baseCall(value) : "";
  if (next !== app.myCall) activity.hearMe = null;
  app.myCall = next;
  if (save) store("bw-call", value);
  renderActivity();
  return true;
}

function setupMyCall() {
  const saved = load("bw-call");
  if (saved && validCall(saved)) setMyCall(saved, { save: false });
  $("mycall").addEventListener("change", (e) => setMyCall(e.target.value));
}
