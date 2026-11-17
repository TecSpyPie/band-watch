/* Logbook: contacts kept in this browser, logged by hand or with one click from a decode, a POTA
   activator or a callsign lookup. Exports and imports ADIF for LoTW, eQSL, QRZ and other loggers,
   and sends contacts straight to the user's QRZ logbook. */
"use strict";

const LOG_KEY = "bw-log";
const LOG_MODES = ["SSB", "CW", "FT8", "FT4", "WSPR", "AM", "FM", "RTTY", "PSK31", "JS8", "SSTV", "DIGITALVOICE"];
// ADIF puts some modes under a parent mode with a submode.
const ADIF_SUBMODE = { FT4: "MFSK", JS8: "MFSK", PSK31: "PSK" };
const log = { qsos: [], search: "", editing: null };

function loadLog() {
  try {
    const v = JSON.parse(load(LOG_KEY) || "[]");
    log.qsos = Array.isArray(v) ? v.filter((q) => q && typeof q.call === "string") : [];
  } catch { log.qsos = []; }
}
function saveLog() {
  store(LOG_KEY, log.qsos);
}

const pad = (n, w = 2) => String(n).padStart(w, "0");
const utcDate = (d = new Date()) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
const utcTime = (d = new Date()) => `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
const LOG_CALL_RE = /^[A-Z0-9]{1,4}(\/[A-Z0-9]{1,4})?[0-9][A-Z0-9]{0,6}(\/[A-Z0-9]{1,4})?$/;

function logBand(kHz) {
  const b = bandForKHz(Number(kHz));
  return b ? `${b}m` : "";
}

/** Has this callsign (or this callsign at this park/summit) been logged? */
function workedBefore(call, ref) {
  const base = baseCall(call);
  return log.qsos.some((q) => baseCall(q.call) === base && (!ref || q.ref === ref));
}
/** Has any contact been logged in this 4-character grid square? */
function workedGrid(grid) {
  const g = String(grid || "").slice(0, 4).toUpperCase();
  return Boolean(g) && log.qsos.some((q) => String(q.grid || "").slice(0, 4).toUpperCase() === g);
}

/** Fill in the log form (from a decode, an activator or a lookup) and bring it into view. */
function logPrefill(f = {}) {
  const set = (id, v) => { if (v != null && v !== "") $(id).value = v; };
  $("lgForm").reset();
  log.editing = null;
  set("lgCall", String(f.call || "").toUpperCase());
  set("lgKHz", f.kHz != null ? Math.round(f.kHz * 100) / 100 : listen.kHz);
  $("lgMode").value = LOG_MODES.includes(f.mode) ? f.mode : logModeFromListen();
  set("lgSent", f.rstS);
  set("lgRcvd", f.rstR);
  set("lgGrid", f.grid);
  set("lgName", f.name);
  set("lgQth", f.qth);
  set("lgRef", f.ref);
  set("lgNote", f.note);
  $("lgDate").value = "";
  $("lgTime").value = "";
  $("lgSave").textContent = "Log it";
  renderLog();
  $("secLog").scrollIntoView({ behavior: "smooth", block: "nearest" });
  $(f.call ? "lgSent" : "lgCall").focus({ preventScroll: true });
}

function logModeFromListen() {
  if (typeof rigIsDigital === "function" && rigIsDigital(listen.kHz)) {
    const kHz = listen.kHz;
    if (Object.values(FT4).some((f) => Math.abs(f * 1000 - kHz) < 3)) return "FT4";
    return "FT8";
  }
  return { cw: "CW", am: "AM", fm: "FM" }[listen.mode] || "SSB";
}

function logSubmit(e) {
  e.preventDefault();
  const call = $("lgCall").value.trim().toUpperCase();
  const msg = $("lgMsg");
  if (!LOG_CALL_RE.test(call)) { msg.textContent = "Enter the other station's callsign, e.g. G4ABC."; $("lgCall").focus(); return; }
  const kHz = Number($("lgKHz").value);
  if (!(kHz >= 100 && kHz <= 1300000)) { msg.textContent = "Enter the frequency in kHz, e.g. 14074."; $("lgKHz").focus(); return; }
  const now = new Date();
  const date = ($("lgDate").value || "").replace(/-/g, "") || utcDate(now);
  const time = ($("lgTime").value || "").replace(":", "") || utcTime(now);
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) { msg.textContent = "Date and time should look like 2026-11-17 and 14:05 (UTC)."; return; }
  const g = $("lgGrid").value.trim();
  const grid = g.slice(0, 4).toUpperCase() + g.slice(4).toLowerCase(); // IO93fx
  if (grid && !/^[A-R]{2}\d{2}([A-X]{2})?$/.test(grid.toUpperCase())) { msg.textContent = "The grid square should look like IO93 or IO93fx."; $("lgGrid").focus(); return; }
  const q = {
    id: log.editing || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    call, date, time, kHz, band: logBand(kHz), mode: $("lgMode").value,
    rstS: $("lgSent").value.trim().slice(0, 8), rstR: $("lgRcvd").value.trim().slice(0, 8), grid,
    name: $("lgName").value.trim().slice(0, 60), qth: $("lgQth").value.trim().slice(0, 60),
    ref: $("lgRef").value.trim().toUpperCase().slice(0, 24), note: $("lgNote").value.trim().slice(0, 200),
  };
  if (log.editing) log.qsos = log.qsos.map((x) => (x.id === log.editing ? (x.qrz ? { ...q, qrz: x.qrz } : q) : x));
  else log.qsos.unshift(q);
  const isNew = !log.editing;
  log.qsos.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  saveLog();
  msg.textContent = `${log.editing ? "Updated" : "Logged"} ${call} on ${q.band || `${kHz} kHz`} ${q.mode}.`;
  log.editing = null;
  $("lgForm").reset();
  $("lgKHz").value = listen.kHz;
  $("lgMode").value = logModeFromListen();
  $("lgSave").textContent = "Log it";
  renderLog();
  if (typeof renderXota === "function") renderXota();
  if (typeof checkWanted === "function") checkWanted();
  if (isNew && qrzlog.auto && qrzlog.key) qrzSend([q], { quiet: true });
}

function logEdit(id) {
  const q = log.qsos.find((x) => x.id === id);
  if (!q) return;
  logPrefill(q);
  log.editing = id;
  $("lgDate").value = `${q.date.slice(0, 4)}-${q.date.slice(4, 6)}-${q.date.slice(6)}`;
  $("lgTime").value = `${q.time.slice(0, 2)}:${q.time.slice(2)}`;
  $("lgSave").textContent = "Save changes";
}

function logDelete(id) {
  const q = log.qsos.find((x) => x.id === id);
  if (!q) return;
  log.qsos = log.qsos.filter((x) => x.id !== id);
  saveLog();
  $("lgMsg").innerHTML = `Deleted ${esc(q.call)}. <button type="button" class="linkbtn" id="lgUndo">Undo</button>`;
  $("lgUndo").onclick = () => {
    log.qsos.push(q);
    log.qsos.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
    saveLog();
    $("lgMsg").textContent = `Restored ${q.call}.`;
    renderLog();
  };
  renderLog();
}

function renderLog() {
  const tb = $("lgRows");
  if (!tb) return;
  const s = log.search.trim().toUpperCase();
  const rows = s ? log.qsos.filter((q) => [q.call, q.grid, q.ref, q.name, q.qth, q.band, q.mode].some((v) => String(v || "").toUpperCase().includes(s))) : log.qsos;
  tb.innerHTML = rows.slice(0, 100).map((q) => `<tr>
      <td>${q.date.slice(0, 4)}-${q.date.slice(4, 6)}-${q.date.slice(6)} ${q.time.slice(0, 2)}:${q.time.slice(2)}</td>
      <td>${callLink(q.call)}${q.qrz ? ' <span class="qrzsent" title="Sent to your QRZ logbook">QRZ ✓</span>' : ""}</td><td>${esc(q.band || "")}</td><td>${Number(q.kHz).toLocaleString()}</td><td>${esc(q.mode)}</td>
      <td>${esc(q.rstS || "")}${q.rstR ? ` / ${esc(q.rstR)}` : ""}</td><td>${esc(q.grid || "")}</td>
      <td>${esc([q.name, q.ref, q.note].filter(Boolean).join(" · "))}</td>
      <td class="lgact"><button type="button" class="linkbtn" data-edit="${esc(q.id)}">Edit</button>
        <button type="button" class="linkbtn" data-del="${esc(q.id)}" aria-label="Delete ${esc(q.call)}">Delete</button></td>
    </tr>`).join("") || `<tr><td colspan="9" class="muted small">${log.qsos.length ? "No contacts match." : "No contacts logged yet. Click Log on a decode or an activator, or fill in the form."}</td></tr>`;
  const calls = new Set(log.qsos.map((q) => baseCall(q.call)));
  const grids = new Set(log.qsos.map((q) => String(q.grid || "").slice(0, 4)).filter(Boolean));
  renderQrzLog();
  $("lgCount").textContent = log.qsos.length
    ? `${log.qsos.length} contact${log.qsos.length === 1 ? "" : "s"}, ${calls.size} station${calls.size === 1 ? "" : "s"}, ${grids.size} grid square${grids.size === 1 ? "" : "s"}${rows.length < log.qsos.length ? ` (${rows.length} shown)` : ""}`
    : "";
}

/* ---------- ADIF ---------- */

const adifField = (name, value) => {
  const v = String(value == null ? "" : value);
  return v ? `<${name}:${new TextEncoder().encode(v).length}>${v} ` : "";
};

function toAdif(qsos) {
  return adifHeader() + qsos.map(adifRecord).join("\n") + "\n";
}

function adifHeader() {
  return `Band Watch by M3vrv logbook export\n${adifField("ADIF_VER", "3.1.4")}${adifField("PROGRAMID", "Band Watch")}${adifField("PROGRAMVERSION", (document.querySelector('script[src*="app.js?v="]')?.src.match(/v=([\d.]+)/) || [])[1] || "")}${adifField("CREATED_TIMESTAMP", `${utcDate()} ${utcTime()}00`)}<EOH>\n`;
}

/** One contact as an ADIF record, ending <EOR>. */
function adifRecord(q) {
    const parent = ADIF_SUBMODE[q.mode];
    const sota = /^[A-Z0-9]{1,4}\/[A-Z]{2}-\d{3}$/.test(q.ref || "");
    return [
      adifField("CALL", q.call), adifField("QSO_DATE", q.date), adifField("TIME_ON", q.time),
      adifField("BAND", q.band), adifField("FREQ", (Number(q.kHz) / 1000).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")),
      adifField("MODE", parent || q.mode), parent ? adifField("SUBMODE", q.mode) : "",
      adifField("RST_SENT", q.rstS), adifField("RST_RCVD", q.rstR), adifField("GRIDSQUARE", q.grid),
      adifField("NAME", q.name), adifField("QTH", q.qth),
      q.ref && sota ? adifField("SOTA_REF", q.ref) : "",
      q.ref && !sota ? adifField("SIG", "POTA") + adifField("SIG_INFO", q.ref) + adifField("POTA_REF", q.ref) : "",
      adifField("COMMENT", q.note), adifField("STATION_CALLSIGN", app.myCall || ""), adifField("MY_GRIDSQUARE", ($("grid") && $("grid").value) || ""),
      "<EOR>",
    ].join("");
}

/** Read an ADIF (.adi) file into contacts. Lengths are in bytes, as ADIF says. */
function fromAdif(text) {
  const bytes = new TextEncoder().encode(text);
  const dec = new TextDecoder();
  const out = [];
  let rec = {};
  let i = 0;
  const eoh = text.search(/<eoh>/i);
  if (eoh >= 0) i = new TextEncoder().encode(text.slice(0, eoh + 5)).length;
  while (i < bytes.length) {
    const lt = bytes.indexOf(60, i); // <
    if (lt < 0) break;
    const gt = bytes.indexOf(62, lt); // >
    if (gt < 0) break;
    const tag = dec.decode(bytes.slice(lt + 1, gt));
    i = gt + 1;
    if (/^eor$/i.test(tag)) {
      if (rec.CALL) out.push(rec);
      rec = {};
      continue;
    }
    const m = /^([^:]+):(\d+)/.exec(tag);
    if (!m) continue;
    const len = Number(m[2]);
    rec[m[1].toUpperCase()] = dec.decode(bytes.slice(i, i + len)).trim();
    i += len;
  }
  return out.map((r) => {
    const kHz = r.FREQ ? Math.round(Number(r.FREQ) * 1000 * 100) / 100 : null;
    const mode = (r.SUBMODE && LOG_MODES.includes(r.SUBMODE.toUpperCase()) ? r.SUBMODE : r.MODE || "").toUpperCase();
    return {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      call: String(r.CALL).toUpperCase(), date: (r.QSO_DATE || "").slice(0, 8), time: (r.TIME_ON || "").slice(0, 4),
      kHz: kHz && Number.isFinite(kHz) ? kHz : 0, band: (r.BAND || (kHz ? logBand(kHz) : "")).toLowerCase(), mode: mode || "SSB",
      rstS: r.RST_SENT || "", rstR: r.RST_RCVD || "", grid: (r.GRIDSQUARE || "").slice(0, 4).toUpperCase() + (r.GRIDSQUARE || "").slice(4, 6).toLowerCase(),
      name: r.NAME || "", qth: r.QTH || "", ref: (r.SOTA_REF || r.POTA_REF || (r.SIG === "POTA" ? r.SIG_INFO : "") || "").toUpperCase(),
      note: r.COMMENT || r.NOTES || "",
    };
  }).filter((q) => /^\d{8}$/.test(q.date) && /^\d{4}$/.test(q.time));
}

function logExport() {
  if (!log.qsos.length) { $("lgMsg").textContent = "Nothing to export yet."; return; }
  const blob = new Blob([toAdif(log.qsos)], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bandwatch-log-${utcDate()}.adi`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  $("lgMsg").textContent = `Exported ${log.qsos.length} contacts as ${a.download}. Upload it to LoTW (through TQSL), eQSL, QRZ Logbook or Club Log.`;
}

async function logImport(file) {
  if (!file) return;
  const text = await file.text();
  const got = fromAdif(text);
  const have = new Set(log.qsos.map((q) => `${baseCall(q.call)}|${q.date}|${q.time}|${q.band}|${q.mode}`));
  const fresh = got.filter((q) => !have.has(`${baseCall(q.call)}|${q.date}|${q.time}|${q.band}|${q.mode}`));
  log.qsos.push(...fresh);
  log.qsos.sort((a, b) => `${b.date}${b.time}`.localeCompare(`${a.date}${a.time}`));
  saveLog();
  $("lgMsg").textContent = `Imported ${fresh.length} contact${fresh.length === 1 ? "" : "s"} from ${file.name}${got.length > fresh.length ? ` (${got.length - fresh.length} already in the log)` : ""}.`;
  renderLog();
  if (typeof renderXota === "function") renderXota();
}

/* ---------- Sending contacts to the QRZ Logbook ---------- */
// The QRZ Logbook API key is kept in this browser and sent with each request through Band Watch's
// server (QRZ doesn't let web pages call it directly). QRZ needs a subscription for its Logbook API.

const QRZLOG_STORE = "bw-qrzlog";
const qrzlog = { key: "", auto: false, busy: false, book: "" };

function loadQrzLog() {
  try {
    const v = JSON.parse(load(QRZLOG_STORE) || "{}");
    if (typeof v.key === "string") qrzlog.key = v.key;
    qrzlog.auto = v.auto === true;
    if (typeof v.book === "string") qrzlog.book = v.book;
  } catch { /* none yet */ }
}

function saveQrzLog() {
  store(QRZLOG_STORE, { key: qrzlog.key, auto: qrzlog.auto, book: qrzlog.book });
}

async function qrzLogCall(action, adif) {
  const res = await fetch("/api/qrz/logbook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: qrzlog.key, action, adif }),
  });
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new Error(body.error || `Band Watch's server answered ${res.status}.`);
  return body;
}

const qrzAuthText = "QRZ didn't accept that API key. Copy it again from your QRZ logbook's Settings page. QRZ's Logbook API also needs a QRZ subscription.";

/** Check the key with QRZ and show which logbook it belongs to. */
async function qrzCheckKey() {
  const msg = $("qlMsg");
  const key = $("qlKey").value.trim().toUpperCase();
  if (!key) { msg.textContent = "Paste your QRZ Logbook API key first."; return; }
  qrzlog.key = key;
  saveQrzLog();
  msg.textContent = "Checking with QRZ…";
  try {
    const r = await qrzLogCall("status");
    if (r.ok) {
      const i = r.info || {};
      qrzlog.book = i.BOOK_NAME || i.CALLSIGN || i.OWNER || "";
      saveQrzLog();
      msg.textContent = `QRZ accepted the key${qrzlog.book ? ` for the logbook ${qrzlog.book}` : ""}${i.COUNT ? ` (${Number(i.COUNT).toLocaleString()} contacts in it)` : ""}.`;
    } else {
      msg.textContent = r.auth ? qrzAuthText : `QRZ said: ${r.reason || r.result}.`;
    }
  } catch (e) {
    msg.textContent = e.message;
  }
  renderQrzLog();
}

/** Send contacts to QRZ one at a time. Each one sent is marked, so it's never sent twice. */
async function qrzSend(list, { quiet = false } = {}) {
  const msg = $("lgMsg");
  if (!qrzlog.key) { msg.textContent = "Add your QRZ Logbook API key first (Send to QRZ settings, below)."; $("qlBox").open = true; return; }
  if (qrzlog.busy) return;
  const todo = list.filter((q) => !q.qrz);
  if (!todo.length) { if (!quiet) msg.textContent = "Every contact is already in your QRZ logbook."; return; }
  qrzlog.busy = true;
  renderQrzLog();
  let sent = 0, dupes = 0, failed = 0, lastReason = "";
  try {
    for (const q of todo) {
      if (!quiet) msg.textContent = `Sending to QRZ: ${sent + dupes + failed + 1} of ${todo.length}…`;
      let r;
      try {
        r = await qrzLogCall("insert", adifRecord(q));
      } catch (e) {
        failed++; lastReason = e.message;
        if (/could not be reached|Too many/.test(e.message)) break;
        continue;
      }
      if (r.ok) { q.qrz = r.logid || "ok"; sent++; }
      else if (r.duplicate) { q.qrz = "dup"; dupes++; }
      else if (r.auth) { failed++; lastReason = qrzAuthText; break; }
      else { failed++; lastReason = `QRZ said: ${r.reason || r.result}`; }
      saveLog();
    }
  } finally {
    qrzlog.busy = false;
    saveLog();
    renderLog();
  }
  const parts = [];
  if (sent) parts.push(`Sent ${sent} contact${sent === 1 ? "" : "s"} to your QRZ logbook`);
  if (dupes) parts.push(`${dupes} ${dupes === 1 ? "was" : "were"} already there`);
  if (failed) parts.push(`${failed} couldn't be sent. ${lastReason}`);
  const text = parts.join("; ").replace(/([^.])$/, "$1.");
  if (!quiet || failed) msg.textContent = text;
  else if (sent) msg.textContent += " Sent to QRZ.";
  if (failed && typeof showToast === "function" && quiet) showToast("QRZ Logbook", text);
}

function renderQrzLog() {
  if (!$("qlKey")) return;
  const unsent = log.qsos.filter((q) => !q.qrz).length;
  const btn = $("lgQrz");
  btn.textContent = qrzlog.busy ? "Sending to QRZ…" : unsent && qrzlog.key ? `Send ${unsent} to QRZ` : "Send to QRZ";
  btn.disabled = qrzlog.busy;
  if (document.activeElement !== $("qlKey")) $("qlKey").value = qrzlog.key;
  $("qlAuto").checked = qrzlog.auto;
}

function setupQrzLog() {
  loadQrzLog();
  $("lgQrz").addEventListener("click", () => qrzSend(log.qsos));
  $("qlCheck").addEventListener("click", qrzCheckKey);
  $("qlKey").addEventListener("change", () => { qrzlog.key = $("qlKey").value.trim().toUpperCase(); qrzlog.book = ""; saveQrzLog(); renderQrzLog(); });
  $("qlAuto").addEventListener("change", () => { qrzlog.auto = $("qlAuto").checked; saveQrzLog(); });
  $("qlForget").addEventListener("click", () => {
    qrzlog.key = ""; qrzlog.book = ""; qrzlog.auto = false; saveQrzLog();
    $("qlKey").value = "";
    $("qlMsg").textContent = "Band Watch has forgotten your QRZ Logbook key.";
    renderQrzLog();
  });
}

function setupLog() {
  loadLog();
  $("lgMode").innerHTML = LOG_MODES.map((m) => `<option>${m}</option>`).join("");
  $("lgKHz").value = listen.kHz;
  $("lgMode").value = logModeFromListen();
  $("lgForm").addEventListener("submit", logSubmit);
  $("lgForm").addEventListener("reset", () => { log.editing = null; $("lgSave").textContent = "Log it"; });
  $("lgSearch").addEventListener("input", () => { log.search = $("lgSearch").value; renderLog(); });
  $("lgExport").addEventListener("click", logExport);
  $("lgImportBtn").addEventListener("click", () => $("lgImport").click());
  $("lgImport").addEventListener("change", () => { logImport($("lgImport").files[0]); $("lgImport").value = ""; });
  setupQrzLog();
  $("lgNow").addEventListener("click", () => { $("lgKHz").value = listen.kHz; $("lgMode").value = logModeFromListen(); });
  $("lgRows").addEventListener("click", (e) => {
    const ed = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-del]");
    if (ed) logEdit(ed.dataset.edit);
    if (del) logDelete(del.dataset.del);
  });
  renderLog();
}
