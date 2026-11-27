// QRZ.com XML data service: sign in, look up callsigns, sign out.
// The user's password is sent once to QRZ to get a session key and is never stored.
// The browser only ever holds an opaque, HttpOnly session cookie; the QRZ key stays on the server.
"use strict";

const crypto = require("crypto");
const clock = require("./clock.js");

const QRZ_URL = process.env.BW_QRZ_URL || "https://xmldata.qrz.com/xml/current/";
const AGENT = "BandWatch-M3VRV-1.2";
const SESSION_TTL = 24 * 3600e3;
const SESSIONS_MAX = 500;
const LOOKUP_TTL = 3600e3;
const LOGIN_WINDOW = 15 * 60e3;
const LOGIN_MAX = 10; // attempts per address per window

const sessions = new Map(); // sid -> { key, user, sub, t }
const lookups = new Map(); // `${sid}|${call}` -> { t, data }
const attempts = new Map(); // ip -> [timestamps]

class QrzError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]).trim();

/** Child elements of the first <tag>…</tag> block as a flat object. */
function block(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return null;
  const out = {};
  for (const [, k, v] of m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)) out[k] = decode(v);
  return out;
}

async function callQrz(params) {
  const res = await fetch(`${QRZ_URL}?${new URLSearchParams({ ...params, agent: AGENT })}`, {
    headers: { "User-Agent": AGENT },
    signal: AbortSignal.timeout(15e3),
  });
  if (!res.ok) throw new QrzError(502, "QRZ.com could not be reached");
  const xml = await res.text();
  return { session: block(xml, "Session") || {}, callsign: block(xml, "Callsign") };
}

function tooManyAttempts(ip) {
  const now = clock.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < LOGIN_WINDOW);
  list.push(now);
  attempts.set(ip, list);
  if (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
  return list.length > LOGIN_MAX;
}

function prune() {
  const now = clock.now();
  for (const [sid, s] of sessions) if (now - s.t > SESSION_TTL) sessions.delete(sid);
  while (sessions.size > SESSIONS_MAX) sessions.delete(sessions.keys().next().value);
  for (const [k, v] of lookups) if (now - v.t > LOOKUP_TTL) lookups.delete(k);
}

async function login(username, password, ip) {
  username = String(username || "").trim();
  password = String(password || "");
  if (!username || !password || username.length > 64 || password.length > 128) {
    throw new QrzError(400, "Enter your QRZ username and password.");
  }
  if (tooManyAttempts(ip)) throw new QrzError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");

  const { session } = await callQrz({ username, password });
  if (!session.Key) {
    const msg = session.Error || "QRZ did not accept that username and password.";
    throw new QrzError(401, /password|username|not found/i.test(msg) ? "QRZ did not accept that username and password." : msg);
  }
  prune();
  const sid = crypto.randomBytes(24).toString("hex");
  const info = { key: session.Key, user: username.toUpperCase(), sub: session.SubExp || "", t: clock.now() };
  sessions.set(sid, info);
  return { sid, ...publicInfo(info) };
}

function publicInfo(s) {
  const subscriber = Boolean(s.sub) && !/non-subscriber/i.test(s.sub);
  return { loggedIn: true, user: s.user, subscriber, subscription: s.sub };
}

function status(sid) {
  const s = sid && sessions.get(sid);
  if (!s || clock.now() - s.t > SESSION_TTL) return { loggedIn: false };
  return publicInfo(s);
}

function logout(sid) {
  if (!sid) return;
  sessions.delete(sid);
  for (const k of lookups.keys()) if (k.startsWith(`${sid}|`)) lookups.delete(k);
}

async function lookup(sid, rawCall) {
  const s = sid && sessions.get(sid);
  if (!s) throw new QrzError(401, "Sign in to QRZ to look up callsigns here.");
  const call = String(rawCall || "").trim().toUpperCase();
  if (!/\d/.test(call) || call.length > 20 || !/^[A-Z0-9/]+$/.test(call)) throw new QrzError(400, "That doesn’t look like a callsign.");

  const cacheKey = `${sid}|${call}`;
  const hit = lookups.get(cacheKey);
  if (hit && clock.now() - hit.t < LOOKUP_TTL) return hit.data;

  const { session, callsign } = await callQrz({ s: s.key, callsign: call });
  if (!callsign) {
    const err = session.Error || "";
    if (/session|key/i.test(err)) {
      logout(sid);
      throw new QrzError(401, "Your QRZ session has ended. Sign in again.");
    }
    if (/not found/i.test(err)) throw new QrzError(404, `${call} was not found on QRZ.`);
    throw new QrzError(502, err || "QRZ returned no data.");
  }

  const c = callsign;
  const name = [c.fname, c.name].filter(Boolean).join(" ");
  const data = {
    call: c.call || call,
    name: name || null,
    nickname: c.nickname || null,
    city: c.addr2 || null,
    state: c.state || null,
    country: c.country || c.land || null,
    grid: c.grid || null,
    lat: c.lat ? Number(c.lat) : null,
    lon: c.lon ? Number(c.lon) : null,
    licenceClass: c.class || null,
    cqZone: c.cqzone || null,
    ituZone: c.ituzone || null,
    qslManager: c.qslmgr || null,
    lotw: c.lotw === "1",
    eqsl: c.eqsl === "1",
    paperQsl: c.mqsl === "1",
    image: /^https:\/\//.test(c.image || "") ? c.image : null,
    timeZone: c.TimeZone || null,
    gmtOffset: c.GMTOffset != null && c.GMTOffset !== "" && Number.isFinite(Number(c.GMTOffset)) ? Number(c.GMTOffset) : null,
    dst: c.DST ? c.DST.toUpperCase() === "Y" : null,
    limited: !publicInfo(s).subscriber,
    message: session.Message || null,
  };
  lookups.set(cacheKey, { t: clock.now(), data });
  return data;
}

/* ---------- QRZ Logbook: send contacts to the user's own QRZ logbook ---------- */
// The browser keeps the user's QRZ Logbook API key and sends it with each request; it is passed
// straight to QRZ and never stored or logged here. QRZ's API needs a QRZ subscription to insert.

const QRZ_LOG_URL = process.env.BW_QRZLOG_URL || "https://logbook.qrz.com/api";
const LOG_WINDOW = 60e3;
const LOG_MAX = 120; // requests per address per minute
const logCalls = new Map(); // ip -> [timestamps]

function tooManyLogCalls(ip) {
  const now = clock.now();
  const list = (logCalls.get(ip) || []).filter((t) => now - t < LOG_WINDOW);
  list.push(now);
  logCalls.set(ip, list);
  if (logCalls.size > 5000) logCalls.delete(logCalls.keys().next().value);
  return list.length > LOG_MAX;
}

/** Ask QRZ about a logbook key (STATUS) or add one ADIF record to it (INSERT). */
async function logbook(rawKey, rawAction, rawAdif, ip) {
  const key = String(rawKey || "").trim().toUpperCase();
  const action = String(rawAction || "").trim().toUpperCase();
  const adif = String(rawAdif || "");
  if (!/^[A-Z0-9-]{8,64}$/.test(key)) throw new QrzError(400, "That doesn’t look like a QRZ Logbook API key. It looks like ABCD-1234-EF56-7890.");
  if (action !== "STATUS" && action !== "INSERT") throw new QrzError(400, "Unknown logbook action.");
  if (action === "INSERT" && (!adif || adif.length > 4000 || !/<call:\d+>/i.test(adif) || !/<eor>/i.test(adif))) {
    throw new QrzError(400, "That contact couldn’t be read.");
  }
  if (tooManyLogCalls(ip)) throw new QrzError(429, "Too many QRZ Logbook requests. Wait a minute and try again.");
  const form = new URLSearchParams({ KEY: key, ACTION: action });
  if (action === "INSERT") form.set("ADIF", adif);
  let text;
  try {
    const res = await fetch(QRZ_LOG_URL, {
      method: "POST",
      headers: { "User-Agent": AGENT, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(20e3),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = (await res.text()).slice(0, 20000);
  } catch {
    throw new QrzError(502, "QRZ Logbook could not be reached. Try again in a minute.");
  }
  return parseLogbookReply(text);
}

/** QRZ answers name=value pairs joined with &: RESULT, REASON, COUNT, LOGID (or LOGIDS) and, for STATUS, the book's details. */
function parseLogbookReply(text) {
  const p = new URLSearchParams(String(text).trim());
  const result = (p.get("RESULT") || "").toUpperCase();
  const reason = (p.get("REASON") || "").slice(0, 300);
  const info = {};
  let n = 0;
  for (const [k, v] of p) {
    if (n >= 30 || /^(RESULT|REASON|KEY)$/i.test(k) || !/^[A-Z_]{1,40}$/i.test(k)) continue;
    info[k.toUpperCase()] = v.slice(0, 200);
    n++;
  }
  return {
    ok: result === "OK" || result === "REPLACE",
    result: result || "FAIL",
    reason: reason || (result ? "" : "QRZ gave an answer HamShack didn’t understand."),
    duplicate: /duplicate/i.test(reason),
    auth: result === "AUTH" || /invalid api key|access key|not authorized|no such key/i.test(reason),
    logid: p.get("LOGID") || p.get("LOGIDS") || null,
    count: p.has("COUNT") ? Number(p.get("COUNT")) : null,
    info,
  };
}

function reset() {
  sessions.clear();
  lookups.clear();
  attempts.clear();
  logCalls.clear();
}

module.exports = { login, logout, status, lookup, logbook, reset, QrzError };
