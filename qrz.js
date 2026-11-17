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

function reset() {
  sessions.clear();
  lookups.clear();
  attempts.clear();
}

module.exports = { login, logout, status, lookup, reset, QrzError };
