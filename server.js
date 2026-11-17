// Band Watch by M3vrv: server.
// Serves the static page from ./public and these JSON endpoints:
//   GET  /api/solar            -> { sfi, kp, at }          (NOAA SWPC, cached 15 min)
//   GET  /api/spots?grid=IO93  -> { grid, spots[], at }    (PSK Reporter, cached 5 min per grid)
//   GET  /api/xota             -> { spots[], at, failed[] } POTA activators (cached 2 min)
//   GET  /api/dx               -> { spots[], at, source }   DX cluster spots from HamQTH.com (cached 1 min)
//   GET  /api/update           -> { current, latest, newer, page, canInstall } (GitHub releases, cached 1 hour)
//   GET  /api/sun              -> sunspot regions, sunspot number, X-rays, solar wind, NOAA scales (cached 30 min)
//   GET  /api/qrz/status       -> { loggedIn, user, subscriber }
//   POST /api/qrz/login        <- { username, password }   (sets an HttpOnly session cookie)
//   POST /api/qrz/logout
//   GET  /api/qrz/lookup?call=G4ABC
//   POST /api/qrz/logbook      <- { key, action: "status"|"insert", adif } -> { ok, result, reason, duplicate, auth, logid, count, info }
//                                 (QRZ Logbook API; the key comes from the browser each time and is never stored)
//   GET  /api/sdr                         -> { available }   (RTL-SDR bridge; on this PC only)
//   GET  /api/sdr/stream?addr=host:port   -> raw I/Q bytes from rtl_tcp (header X-SDR-Session)
//   POST /api/sdr/cmd                     <- { session, cmd, value }  (an rtl_tcp command)
//   GET/POST /api/sdr/launch, POST /api/sdr/launch/stop   (start rtl_tcp on this PC for the user)
"use strict";

const http = require("http");
const net = require("net");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const qrz = require("./qrz.js");
const clock = require("./clock.js");
const VERSION = require("./package.json").version;
const BUILD_DATE = (() => { try { return require("./build-info.json").date || ""; } catch { return ""; } })();
const STARTED = new Date().toISOString().replace(/\.\d+Z$/, "Z");

const PUBLIC_DIR = path.join(__dirname, "public");
const USER_AGENT = `BandWatch-M3VRV/${VERSION} (amateur radio propagation monitor)`;
const SOLAR_TTL = 15 * 60e3;
const SPOTS_TTL = 5 * 60e3;
const SUN_TTL = 30 * 60e3;
const CACHE_MAX = 200;

// Upstream addresses can be pointed elsewhere for testing.
const NOAA = (process.env.BW_NOAA_URL || "https://services.swpc.noaa.gov").replace(/\/$/, "");
const NOAA_FLUX = `${NOAA}/json/f107_cm_flux.json`;
const NOAA_KP = `${NOAA}/json/planetary_k_index_1m.json`;
const PSK_QUERY = process.env.BW_PSK_URL || "https://retrieve.pskreporter.info/query";
const POTA_URL = process.env.BW_POTA_URL || "https://api.pota.app/spot/activator";
// SOTA spots are not used: SOTA's API terms don't allow AI-written software without their approval.
const XOTA_TTL = 2 * 60 * 1000;
// HamQTH's DX cluster API: free, no key; it asks apps not to call more often than every 15 seconds,
// and to tell users "Data provided by HamQTH.com". One shared copy a minute for everyone.
const DX_URL = process.env.BW_DX_URL || "https://www.hamqth.com/api/v2/spots";
const DX_TTL = 60 * 1000;
const UPDATE_URL = process.env.BW_UPDATE_URL || "https://api.github.com/repos/TecSpyPie/band-watch/releases/latest";
const UPDATE_TTL = 60 * 60 * 1000;
const TEST_HOOKS = process.env.BW_TEST === "1";
// The RTL-SDR bridge connects to rtl_tcp on this PC or the local network, so it is only switched
// on where Band Watch runs on the user's own PC (start-bandwatch.bat sets BW_SDR=1), never online.
const SDR_ON = process.env.BW_SDR === "1" || TEST_HOOKS;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".zip": "application/zip",
};

/* ---------- Cache: TTL, request coalescing, stale-on-error, size cap ---------- */

const cache = new Map(); // key -> { t, data }
const inflight = new Map(); // key -> Promise

async function cached(key, ttl, load) {
  const hit = cache.get(key);
  if (hit && clock.now() - hit.t < ttl) return hit.data;
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const data = await load();
      cache.delete(key); // re-insert so Map order tracks recency
      cache.set(key, { t: clock.now(), data });
      while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
      return data;
    } catch (err) {
      if (hit) return { ...hit.data, stale: true };
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

function clearCache() {
  cache.clear();
  inflight.clear();
}

/* ---------- POTA activators ---------- */

/** "2026-11-17T02:50:00" (UTC without a zone) or with one -> ISO string, or "". */
function utcTime(t) {
  const s = String(t || "").trim();
  if (!s) return "";
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}
const str = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);

/** One POTA spot (api.pota.app/spot/activator) in Band Watch's shape. */
function potaSpot(r) {
  const kHz = num(r.frequency);
  const lat = num(r.latitude), lon = num(r.longitude);
  return {
    src: "pota", call: str(r.activator, 20).toUpperCase(), kHz, mode: str(r.mode, 12).toUpperCase(),
    ref: str(r.reference, 20), name: str(r.parkName || r.name), loc: str(r.locationDesc, 40),
    grid: str(r.grid6 || r.grid4, 8), lat: lat != null && lon != null ? lat : null, lon: lat != null && lon != null ? lon : null,
    time: utcTime(r.spotTime), by: str(r.spotter, 20).toUpperCase(), note: str(r.comments, 200),
  };
}

async function getXota() {
  return cached("xota", XOTA_TTL, async () => {
    const load = async (url, fn) => {
      const rows = await (await fetchOk(url, 20000)).json();
      if (!Array.isArray(rows)) throw new Error("not a list");
      return rows.filter((r) => r && typeof r === "object").map(fn);
    };
    const spots = (await load(POTA_URL, potaSpot))
      .filter((x) => x.call && /^[A-Z0-9/]{3,20}$/.test(x.call) && x.kHz > 100 && x.kHz < 1.3e6)
      .sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0))
      .slice(0, 400);
    return { spots, at: clock.now(), failed: [] };
  });
}

/** DX cluster spots (HamQTH API v2), with the station's position where HamQTH knows it. */
async function getDx() {
  return cached("dx", DX_TTL, async () => {
    const d = await (await fetchOk(`${DX_URL}?limit=200&include=locations`, 20000)).json();
    if (!d || !Array.isArray(d.spots)) throw new Error("HamQTH returned no spots");
    const locs = new Map((Array.isArray(d.locations) ? d.locations : [])
      .filter((l) => l && typeof l === "object").map((l) => [str(l.call, 20).toUpperCase(), l]));
    const spots = d.spots.filter((r) => r && typeof r === "object").map((r) => {
      const call = str(r.dxcall, 20).toUpperCase();
      const l = locs.get(call) || {};
      const lat = num(l.lat), lon = num(l.lon);
      const ok = lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
      return {
        call, kHz: num(r.freq), mode: str(r.mode, 8).toUpperCase(), by: str(r.spotter, 20).toUpperCase(),
        note: str(r.comment, 120), time: utcTime(r.time), country: str(r.country, 40), cont: str(r.continent, 2).toUpperCase(),
        lotw: r.lotw === true, grid: str(l.grid, 8), lat: ok ? lat : null, lon: ok ? lon : null,
      };
    }).filter((x) => /^[A-Z0-9/]{3,20}$/.test(x.call) && x.kHz > 100 && x.kHz < 1.3e6)
      .sort((a, b) => (b.time > a.time ? 1 : b.time < a.time ? -1 : 0))
      .slice(0, 200);
    return { spots, at: clock.now(), source: "HamQTH.com" };
  });
}

/* ---------- Updates ---------- */

/** Is version a ("1.12.2" or "v1.12.2") newer than b? */
function newerVersion(a, b) {
  const pa = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(a)), pb = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(b));
  if (!pa || !pb) return false;
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]);
  return false;
}

/** The newest release on GitHub. This server only reports it: installing is done by the Windows app. */
async function getUpdate() {
  const rel = await cached("update", UPDATE_TTL, async () => {
    const r = await (await fetchOk(UPDATE_URL, 20000)).json();
    const latest = String(r.tag_name || "").replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error("no version number");
    return { latest, page: String(r.html_url || "") };
  });
  return { current: VERSION, latest: rel.latest, newer: newerVersion(rel.latest, VERSION), page: rel.page, canInstall: false };
}

/* ---------- Helpers ---------- */

async function fetchOk(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res;
}

/** Maidenhead locator (4, 6 or more chars) -> centre of the square, or null. */
function locatorToLatLon(loc) {
  let g = String(loc || "").toUpperCase();
  if (/^[A-R]{2}\d{2}[A-X]{2}/.test(g)) g = g.slice(0, 6);
  else if (/^[A-R]{2}\d{2}/.test(g)) g = g.slice(0, 4);
  else return null;

  let lon = (g.charCodeAt(0) - 65) * 20 - 180 + Number(g[2]) * 2;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90 + Number(g[3]);
  if (g.length === 6) {
    lon += (g.charCodeAt(4) - 65) * (5 / 60) + 2.5 / 60;
    lat += (g.charCodeAt(5) - 65) * (2.5 / 60) + 1.25 / 60;
  } else {
    lon += 1;
    lat += 0.5;
  }
  return { lat: +lat.toFixed(3), lon: +lon.toFixed(3) };
}

/** Most recent record in a NOAA array (not guaranteed to be sorted). */
function latestByTime(rows, field) {
  let best = null;
  for (const r of rows || []) {
    const v = r && r[field];
    if (v == null || v === "" || !Number.isFinite(Number(v))) continue; // Number(null) is 0, so check first
    if (!best || String(r.time_tag) > String(best.time_tag)) best = r;
  }
  return best;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decodeXml(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);
}

function parseAttrs(s) {
  const out = {};
  s.replace(/(\w+)="([^"]*)"/g, (_, k, v) => {
    out[k] = decodeXml(v);
  });
  return out;
}

/**
 * Turn PSK Reporter XML into one spot per path (remote station, local station, MHz), newest kept.
 * "Remote" is the far end of the path: the receiver when the sender is in our grid,
 * otherwise the sender. "Local" (l) is the station in our grid.
 */
function parsePskXml(xml, grid) {
  const byKey = new Map();
  for (const m of xml.matchAll(/<receptionReport\s([^>]*?)\/?>/g)) {
    const a = parseAttrs(m[1]);
    const senderInGrid = (a.senderLocator || "").toUpperCase().startsWith(grid);
    const call = senderInGrid ? a.receiverCallsign : a.senderCallsign;
    const local = (senderInGrid ? a.senderCallsign : a.receiverCallsign) || "";
    const remoteLoc = String((senderInGrid ? a.receiverLocator : a.senderLocator) || "");
    const pos = locatorToLatLon(remoteLoc);
    const fq = Number(a.frequency) / 1e6;
    const ts = Number(a.flowStartSeconds) * 1000;
    if (!call || !pos || !(fq > 0) || !(ts > 0)) continue;

    const key = `${call}|${local}|${Math.floor(fq)}`;
    const prev = byKey.get(key);
    if (prev && prev.ts >= ts) continue;

    const snr = a.sNR === undefined || a.sNR === "" ? null : Number(a.sNR);
    byKey.set(key, {
      c: call,
      l: local,
      g: remoteLoc.slice(0, 6),
      lat: pos.lat,
      lon: pos.lon,
      fq: +fq.toFixed(6),
      m: a.mode || "",
      snr: Number.isFinite(snr) ? snr : null,
      ts,
      dir: senderInGrid ? "hears your grid" : "heard in your grid",
    });
  }
  return [...byKey.values()];
}

/* ---------- Data sources ---------- */

function getSolar() {
  return cached("solar", SOLAR_TTL, async () => {
    const [fluxRes, kpRes] = await Promise.all([fetchOk(NOAA_FLUX, 20e3), fetchOk(NOAA_KP, 20e3)]);
    const flux = latestByTime(await fluxRes.json(), "flux");
    const kp = latestByTime(await kpRes.json(), "kp_index");
    if (!flux || !kp) throw new Error("NOAA returned no usable data");
    return { sfi: Math.round(Number(flux.flux)), kp: Math.round(Number(kp.kp_index)), at: clock.now() };
  });
}

function getSpots(grid) {
  return cached(`spots:${grid}`, SPOTS_TTL, async () => {
    const q = new URLSearchParams({
      modify: "grid",
      callsign: grid,
      flowStartSeconds: "-1800",
      rronly: "1",
      noactive: "1",
      rptlimit: "3000",
    });
    const res = await fetchOk(`${PSK_QUERY}?${q}`, 30e3);
    return { grid, spots: parsePskXml(await res.text(), grid), at: clock.now() };
  });
}

/** Sunspot regions and space weather. Only the region list is required; the rest is best effort. */
function getSun() {
  return cached("sun", SUN_TTL, async () => {
    const json = async (p) => (await fetchOk(`${NOAA}/${p}`, 25e3)).json();
    const optional = (p) => json(p).catch(() => null);
    const [regions, ssn, flares, scales, wind] = await Promise.all([
      json("json/solar_regions.json"),
      optional("json/solar-cycle/swpc_observed_ssn.json"),
      optional("json/goes/primary/xray-flares-latest.json"),
      optional("products/noaa-scales.json"),
      optional("products/summary/solar-wind-speed.json"),
    ]);
    return summariseSun({ regions, ssn, flares, scales, wind });
  });
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Shape NOAA's sunspot and space weather feeds into one small object. */
function summariseSun({ regions, ssn, flares, scales, wind }) {
  if (!Array.isArray(regions) || !regions.length) throw new Error("NOAA returned no sunspot regions");
  const date = regions.reduce((d, r) => (String(r.observed_date || "") > d ? String(r.observed_date) : d), "");
  const today = regions
    .filter((r) => String(r.observed_date) === date && num(r.latitude) != null && num(r.longitude) != null)
    .map((r) => ({
      region: num(r.region),
      lat: num(r.latitude),
      lon: num(r.longitude),
      location: r.location || "",
      area: num(r.area),
      spots: num(r.number_spots),
      spotClass: r.spot_class || null,
      magClass: r.mag_class || null,
      flares: { c: num(r.c_xray_events) || 0, m: num(r.m_xray_events) || 0, x: num(r.x_xray_events) || 0 },
      prob: { c: num(r.c_flare_probability), m: num(r.m_flare_probability), x: num(r.x_flare_probability) },
      first: r.first_date || null,
    }))
    .sort((a, b) => (b.area || 0) - (a.area || 0) || (a.region || 0) - (b.region || 0));

  let lastSsn = null;
  for (const r of Array.isArray(ssn) ? ssn : []) {
    if (num(r.swpc_ssn) != null && (!lastSsn || String(r.Obsdate) > String(lastSsn.Obsdate))) lastSsn = r;
  }
  const flare = Array.isArray(flares) && flares[0] ? flares[0] : null;
  const now = scales && scales["0"];
  const w = Array.isArray(wind) && wind[0] ? wind[0] : null;
  return {
    date,
    regions: today,
    ssn: lastSsn ? num(lastSsn.swpc_ssn) : null,
    ssnDate: lastSsn ? String(lastSsn.Obsdate).slice(0, 10) : null,
    xray: flare ? { now: flare.current_class || null, flare: flare.max_class || null, flareAt: flare.max_time || null } : null,
    scales: now ? { R: String(now.R?.Scale ?? "0"), S: String(now.S?.Scale ?? "0"), G: String(now.G?.Scale ?? "0") } : null,
    wind: w ? num(w.proton_speed) : null,
    at: clock.now(),
  };
}

/* ---------- HTTP ---------- */

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
};

function sendJson(res, code, body, extraHeaders) {
  res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": MIME[".json"], "Cache-Control": "no-store", ...extraHeaders });
  res.end(JSON.stringify(body));
}

const COOKIE = "bw_qrz";

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

function sessionCookie(req, value, maxAge) {
  // Secure everywhere except plain-HTTP local testing.
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ""));
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local ? "" : "; Secure"}`;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
}

/** Read a small JSON request body. Only JSON is accepted, which also blocks cross-site form posts. */
function readJson(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) {
      return reject(new qrz.QrzError(415, "Expected JSON."));
    }
    let size = 0;
    let tooBig = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) tooBig = true; // keep draining so we can still answer
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) return reject(new qrz.QrzError(413, "Request too large."));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new qrz.QrzError(400, "Invalid JSON.")); }
    });
    req.on("error", reject);
  });
}

async function handleQrz(req, res, url) {
  const sid = readCookie(req, COOKIE);
  const route = `${req.method} ${url.pathname}`;
  try {
    if (route === "GET /api/qrz/status") return sendJson(res, 200, qrz.status(sid));
    if (route === "POST /api/qrz/login") {
      const body = await readJson(req);
      const result = await qrz.login(body.username, body.password, clientIp(req));
      const { sid: newSid, ...info } = result;
      if (sid) qrz.logout(sid);
      return sendJson(res, 200, info, { "Set-Cookie": sessionCookie(req, newSid, 86400) });
    }
    if (route === "POST /api/qrz/logout") {
      qrz.logout(sid);
      return sendJson(res, 200, { loggedIn: false }, { "Set-Cookie": sessionCookie(req, "", 0) });
    }
    if (route === "GET /api/qrz/lookup") return sendJson(res, 200, await qrz.lookup(sid, url.searchParams.get("call")));
    if (route === "POST /api/qrz/logbook") {
      const body = await readJson(req, 8192);
      return sendJson(res, 200, await qrz.logbook(body.key, body.action, body.adif, clientIp(req)));
    }
    if (/^\/api\/qrz\/(login|logout|logbook)$/.test(url.pathname)) return sendJson(res, 405, { error: "method not allowed" });
    return sendJson(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof qrz.QrzError) return sendJson(res, err.status, { error: err.message });
    console.error(`${url.pathname}: ${err.message}`);
    return sendJson(res, 502, { error: "QRZ.com could not be reached." });
  }
}

/* ---------- RTL-SDR bridge: browser <-> rtl_tcp ---------- */

// rtl_tcp commands Band Watch may send: frequency, sample rate, gain mode, gain, ppm,
// RTL AGC, gain by index, bias tee.
const SDR_COMMANDS = new Set([0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x09, 0x0d, 0x0e]); // 0x09: direct sampling (Blog V3 on HF)
const SDR_MAX_SESSIONS = 2;
const sdrSessions = new Map(); // id -> socket

/** "host:port" -> { host, port } if it is this PC or a private (home network) address, else null. */
function parseSdrAddr(addr) {
  const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(String(addr || "").trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  if (host === "localhost") return { host: "127.0.0.1", port };
  const ip = host.split(".").map(Number);
  if (ip.length !== 4 || ip.some((n, i) => !/^\d{1,3}$/.test(host.split(".")[i]) || n > 255)) return null;
  const [a, b] = ip;
  const ok = a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  return ok ? { host, port } : null;
}

/* An rtl_tcp that Band Watch started for the user ("Start rtl_tcp for me"). */
let rtlProc = null;
const rtlStatus = () => (rtlProc
  ? { running: !rtlProc.exited, path: rtlProc.path, args: rtlProc.args, output: rtlProc.output.slice(), exit: rtlProc.exitMsg || "" }
  : { running: false });

/** The rtl_tcp program to run: the one given, or one next to Band Watch or on the PATH. */
function findRtlTcp(given) {
  const g = String(given || "").trim().replace(/^"|"$/g, "");
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
  if (g) {
    if (!/^rtl_tcp(\.exe)?$/i.test(path.basename(g))) return { error: "That isn't rtl_tcp: choose the rtl_tcp.exe from the RTL-SDR Blog drivers." };
    return isFile(g) ? { path: g } : { error: `rtl_tcp wasn't found at ${g}.` };
  }
  const dirs = [path.join(__dirname, ".."), __dirname, ...String(process.env.PATH || "").split(path.delimiter)];
  for (const d of dirs) for (const n of ["rtl_tcp.exe", "rtl_tcp"]) if (d && isFile(path.join(d, n))) return { path: path.join(d, n) };
  return { error: "Band Watch couldn't find rtl_tcp. Enter where rtl_tcp.exe is, in Settings > RTL-SDR receiver." };
}

function launchRtlTcp(res, body) {
  const port = body.port;
  const device = body.device;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(device) || device < 0 || device > 9) {
    return sendJson(res, 400, { error: "Port must be 1-65535 and device 0-9." });
  }
  const found = findRtlTcp(body.path);
  if (found.error) return sendJson(res, 404, { error: found.error });
  const args = ["-a", "127.0.0.1", "-p", String(port), "-d", String(device)];
  if (rtlProc && !rtlProc.exited) {
    if (rtlProc.path === found.path && rtlProc.args.join(" ") === args.join(" ")) return sendJson(res, 200, rtlStatus());
    rtlProc.child.kill();
  }
  let child;
  try {
    child = spawn(found.path, args, { cwd: path.dirname(found.path), windowsHide: true });
  } catch (err) {
    return sendJson(res, 502, { error: `rtl_tcp couldn't start: ${err.message}.` });
  }
  const proc = { child, path: found.path, args, output: [], exited: false, exitMsg: "" };
  const add = (d) => { for (const line of String(d).split(/\r?\n/)) if (line.trim()) proc.output.push(line); proc.output = proc.output.slice(-30); };
  child.stdout.on("data", add);
  child.stderr.on("data", add);
  child.on("error", (err) => { proc.exited = true; proc.exitMsg = `rtl_tcp couldn't start: ${err.message}. Windows (Smart App Control) may have blocked it.`; });
  child.on("exit", (code, sig) => { proc.exited = true; proc.exitMsg = proc.exitMsg || (sig ? `rtl_tcp stopped (${sig}).` : `rtl_tcp stopped (exit code ${code}).`); });
  rtlProc = proc;
  return sendJson(res, 200, rtlStatus());
}
process.on("exit", () => { if (rtlProc && !rtlProc.exited) rtlProc.child.kill(); });

/** Requests must carry this header, which other web sites can't add without the browser asking first. */
const sdrHeaderOk = (req) => req.headers["x-band-watch"] === "sdr";

function handleSdr(req, res, url) {
  if (!SDR_ON) return sendJson(res, 404, { error: "The RTL-SDR receiver works in Band Watch on your own PC." });
  if (req.method === "GET" && url.pathname === "/api/sdr") return sendJson(res, 200, { available: true });
  if (!sdrHeaderOk(req)) return sendJson(res, 403, { error: "missing X-Band-Watch header" });

  if (req.method === "GET" && url.pathname === "/api/sdr/stream") {
    const target = parseSdrAddr(url.searchParams.get("addr"));
    if (!target) return sendJson(res, 400, { error: "Use this PC or a home-network address, for example 127.0.0.1:1234." });
    if (sdrSessions.size >= SDR_MAX_SESSIONS) return sendJson(res, 429, { error: "The receiver is already open in another window." });
    const id = crypto.randomBytes(16).toString("hex");
    const sock = net.connect(target.port, target.host);
    let started = false;
    const done = () => { sdrSessions.delete(id); sock.destroy(); };
    sock.setTimeout(8000, () => {
      if (!started) { sendJson(res, 504, { error: `rtl_tcp at ${target.host}:${target.port} didn't answer.` }); done(); }
    });
    sock.on("connect", () => {
      started = true;
      sock.setTimeout(0);
      sock.setNoDelay(true);
      sdrSessions.set(id, sock);
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-SDR-Session": id });
      sock.pipe(res);
    });
    sock.on("error", (err) => {
      if (!started) sendJson(res, 502, { error: `Couldn't connect to rtl_tcp at ${target.host}:${target.port} (${err.code || err.message}). Is rtl_tcp running?` });
      else res.destroy();
      done();
    });
    sock.on("end", () => { res.end(); done(); });
    req.on("close", done);
    res.on("close", done);
    return undefined;
  }

  if (req.method === "GET" && url.pathname === "/api/sdr/launch") return sendJson(res, 200, rtlStatus());
  if (req.method === "POST" && url.pathname === "/api/sdr/launch/stop") {
    if (rtlProc && !rtlProc.exited) rtlProc.child.kill();
    return sendJson(res, 200, { running: false });
  }
  if (req.method === "POST" && url.pathname === "/api/sdr/launch") {
    return readJson(req, 2048).then((body) => launchRtlTcp(res, body), (err) => sendJson(res, err.status || 400, { error: err.message }));
  }
  if (req.method === "POST" && url.pathname === "/api/sdr/cmd") {
    return readJson(req, 512).then((body) => {
      const sock = sdrSessions.get(String(body.session || ""));
      const cmd = Number(body.cmd);
      const value = Number(body.value);
      if (!sock) return sendJson(res, 404, { error: "The receiver isn't connected." });
      if (!SDR_COMMANDS.has(cmd) || !Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff || (cmd === 0x09 && (value < 0 || value > 2))) {
        return sendJson(res, 400, { error: "bad command" });
      }
      const buf = Buffer.alloc(5);
      buf[0] = cmd;
      buf.writeUInt32BE(value >>> 0, 1);
      sock.write(buf);
      return sendJson(res, 200, { ok: true });
    }, (err) => sendJson(res, err.status || 400, { error: err.message }));
  }
  return sendJson(res, 404, { error: "not found" });
}

// Pages served without their .html ending.
const PAGES = { "/": "index.html", "/install": "install.html", "/decodes": "decodes.html" };
// Files that must be checked for updates on every visit.
const NO_CACHE = new Set(["index.html", "install.html", "decodes.html", "sw.js", "manifest.webmanifest"]);
// Optional downloads offered by the install page, kept next to server.js in ./download.
const DOWNLOAD_DIR = process.env.BW_DOWNLOAD_DIR || path.join(__dirname, "download");
const DOWNLOADS = new Set(["BandWatch-Windows.zip", "BandWatch-Setup.exe"]);

function sendDownload(req, res, name) {
  if (!DOWNLOADS.has(name)) return sendJson(res, 404, { error: "not found" });
  const file = path.join(DOWNLOAD_DIR, name);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return sendJson(res, 404, { error: "not found" });
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": MIME[path.extname(name)] || "application/octet-stream",
      "Content-Length": st.size, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "public, max-age=300" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function sendStatic(res, pathname, method) {
  const rel = PAGES[pathname] || pathname.slice(1);
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 404, { error: "not found" });
  fs.readFile(file, (err, buf) => {
    if (err) return sendJson(res, 404, { error: "not found" });
    const type = MIME[path.extname(file)] || "application/octet-stream";
    const cache = NO_CACHE.has(rel) ? "no-cache" : "public, max-age=300";
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": type, "Cache-Control": cache });
    res.end(method === "HEAD" ? undefined : buf);
  });
}

async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/qrz/")) return handleQrz(req, res, url);
  if (url.pathname === "/api/sdr" || url.pathname.startsWith("/api/sdr/")) return handleSdr(req, res, url);
  if (TEST_HOOKS && req.method === "POST" && url.pathname === "/api/test/reset") { resetAll(); return sendJson(res, 200, { ok: true }); }
  if (TEST_HOOKS && req.method === "POST" && url.pathname === "/api/test/advance") {
    clock.advance(Number(url.searchParams.get("ms")) || 0);
    return sendJson(res, 200, { ok: true });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, 405, { error: "method not allowed" });
  try {
    if (url.pathname === "/healthz") {
      return sendJson(res, 200, {
        ok: true, version: VERSION,
        build: { date: BUILD_DATE, server: "Node.js", runtime: process.version, platform: `${process.platform}/${process.arch}`, started: STARTED },
      });
    }
    if (url.pathname === "/api/sun") return sendJson(res, 200, await getSun());
    if (url.pathname === "/api/solar") return sendJson(res, 200, await getSolar());
    if (url.pathname === "/api/xota") return sendJson(res, 200, await getXota());
    if (url.pathname === "/api/dx") return sendJson(res, 200, await getDx());
    if (url.pathname === "/api/update") return sendJson(res, 200, await getUpdate());
    if (url.pathname === "/api/spots") {
      const grid = String(url.searchParams.get("grid") || "").toUpperCase().slice(0, 4);
      if (!/^[A-R]{2}\d{2}$/.test(grid)) return sendJson(res, 400, { error: "grid must look like IO93" });
      return sendJson(res, 200, await getSpots(grid));
    }
    if (url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "not found" });
    if (url.pathname.startsWith("/download/")) return sendDownload(req, res, url.pathname.slice(10));
    return sendStatic(res, url.pathname, req.method);
  } catch (err) {
    console.error(`${url.pathname}: ${err.message}`);
    return sendJson(res, 502, { error: "upstream feed unavailable" });
  }
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res);
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 8080;
  const host = process.env.HOST || undefined; // e.g. 127.0.0.1 on a PC, so no firewall prompt
  createServer().listen(port, host, () => console.log(`Band Watch by M3vrv listening on ${host || "all interfaces"}:${port}`));
}

function resetAll() {
  clearCache();
  qrz.reset();
  clock.resetClock();
}

module.exports = { VERSION, createServer, parsePskXml, locatorToLatLon, latestByTime, summariseSun, clearCache, resetAll };
