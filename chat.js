// Band Watch chat: a small public chat for Band Watch users, one General room plus one room per band.
//   GET  /api/chat?room=general&since=<id>  -> { room, rooms[], messages[{ id, call, text, t }], last }
//   POST /api/chat  <- { room, call, text } -> { ok, message }
// Messages are plain text (the page shows them as text, never HTML), at most 300 characters, from a
// callsign-shaped name. Each address may post once every 3 seconds and 12 times a minute. The newest 200
// messages per room are kept for 48 hours, in memory and in a small JSON file so a restart keeps them.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOMS = ["general", "160", "80", "60", "40", "30", "20", "17", "15", "12", "10", "6", "2", "70"];
const KEEP = 200;
const MAX_AGE_MS = 48 * 3600e3;
const MAX_TEXT = 300;
const GAP_MS = 3000;
const PER_MIN = 12;
const REPORTS_TO_REMOVE = 3; // different people who must report a message before it comes down
const REPORTS_PER_MIN = 10;
const CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$|^[A-Z0-9]{1,4}\/[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,4}(\/[A-Z0-9]{1,4})?$/;
const FILE = process.env.BW_CHAT_FILE || path.join(os.tmpdir(), "bandwatch-chat.json");
const HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "Content-Type": "application/json", "Cache-Control": "no-store" };

let now = () => Date.now();
const rooms = new Map(ROOMS.map((r) => [r, []]));
let nextId = 1;
const posts = new Map(); // ip -> [times]
const reportsBy = new Map(); // ip -> [times]
const removed = new Map(ROOMS.map((r) => [r, []])); // room -> [{ id, t }]: messages taken down after reports
// Reporters are kept as salted hashes, never as addresses; the salt is new each start, so nothing links back.
const SALT = crypto.randomBytes(16).toString("hex");
const who = (ip) => crypto.createHash("sha256").update(SALT + ip).digest("hex").slice(0, 16);

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    for (const r of ROOMS) {
      const list = Array.isArray(raw.rooms && raw.rooms[r]) ? raw.rooms[r] : [];
      rooms.set(r, list.filter((m) => m && Number.isInteger(m.id) && typeof m.text === "string" && typeof m.call === "string").slice(-KEEP));
    }
    nextId = Math.max(1, Number(raw.nextId) || 1, ...[...rooms.values()].flat().map((m) => m.id + 1));
  } catch { /* no file yet, or unreadable: start empty */ }
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const data = JSON.stringify({ nextId, rooms: Object.fromEntries(rooms) });
    fs.writeFile(FILE + ".tmp", data, (err) => { if (!err) fs.rename(FILE + ".tmp", FILE, () => {}); });
  }, 1000);
  if (saveTimer.unref) saveTimer.unref();
}
load();

function prune(list) {
  const cut = now() - MAX_AGE_MS;
  while (list.length && (list.length > KEEP || list[0].t < cut)) list.shift();
}

/** What goes out to people reading: never who reported it. */
const pub = (m) => ({ id: m.id, call: m.call, text: m.text, t: m.t });

function send(res, code, body) { res.writeHead(code, HEADERS); res.end(JSON.stringify(body)); }

function ipOf(req) { return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || (req.socket && req.socket.remoteAddress) || "?"; }

function readBody(req, limit = 2048) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] || ""))) return reject(Object.assign(new Error("Expected JSON."), { code: 415 }));
    let size = 0, big = false; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) big = true; else chunks.push(c); });
    req.on("end", () => {
      if (big) return reject(Object.assign(new Error("Message too large."), { code: 413 }));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("Bad JSON."), { code: 400 })); }
    });
    req.on("error", reject);
  });
}

/** Tidies a message: no control characters, single-spaced lines, at most 300 characters. */
function cleanText(s) {
  return String(s == null ? "" : s).normalize("NFC")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT);
}

function rateLimited(ip) {
  const t = now();
  const list = (posts.get(ip) || []).filter((x) => t - x < 60e3);
  if (list.length && t - list[list.length - 1] < GAP_MS) return "Slow down a little: one message every 3 seconds.";
  if (list.length >= PER_MIN) return "That's a lot of messages. Wait a minute, then carry on.";
  list.push(t); posts.set(ip, list);
  if (posts.size > 5000) posts.delete(posts.keys().next().value);
  return "";
}

async function handle(req, res, url) {
  try {
    const room = String(url.searchParams.get("room") || "general").toLowerCase();
    if (req.method === "GET" || req.method === "HEAD") {
      if (!rooms.has(room)) return send(res, 400, { error: "Unknown room." });
      const list = rooms.get(room); prune(list);
      const since = Number(url.searchParams.get("since")) || 0;
      const messages = list.filter((m) => m.id > since).slice(-100).map(pub);
      const gone = removed.get(room).filter((x) => now() - x.t < MAX_AGE_MS).map((x) => x.id);
      return send(res, 200, { room, rooms: ROOMS, messages, removed: gone, last: list.length ? list[list.length - 1].id : 0 });
    }
    if (req.method !== "POST") return send(res, 405, { error: "method not allowed" });
    const body = await readBody(req);
    const r = String(body.room || "general").toLowerCase();
    if (!rooms.has(r)) return send(res, 400, { error: "Unknown room." });
    if (body.report != null) return report(res, r, body.report, ipOf(req));
    const call = String(body.call || "").trim().toUpperCase();
    if (!CALL_RE.test(call)) return send(res, 400, { error: "Enter your callsign at the top of the page first (like M3VRV)." });
    const text = cleanText(body.text);
    if (!text) return send(res, 400, { error: "Type a message first." });
    const list = rooms.get(r); prune(list);
    const prev = [...list].reverse().find((m) => m.call === call);
    if (prev && prev.text === text && now() - prev.t < 60e3) return send(res, 409, { error: "You just sent that." });
    const limit = rateLimited(ipOf(req));
    if (limit) return send(res, 429, { error: limit });
    const message = { id: nextId++, call, text, t: now() };
    list.push(message); prune(list); save();
    return send(res, 200, { ok: true, message: pub(message) });
  } catch (err) {
    return send(res, err && err.code >= 400 && err.code < 500 ? err.code : 500, { error: err && err.code ? err.message : "Chat is unavailable right now." });
  }
}

/** Someone reports a message. Enough different people and it comes down for everyone. */
function report(res, room, idIn, ip) {
  const id = Number(idIn);
  if (!Number.isInteger(id) || id < 1) return send(res, 400, { error: "Which message?" });
  const list = rooms.get(room);
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return send(res, 404, { error: "That message has gone already." });
  const t = now();
  const mine = (reportsBy.get(ip) || []).filter((x) => t - x < 60e3);
  if (mine.length >= REPORTS_PER_MIN) return send(res, 429, { error: "That's a lot of reports. Wait a minute." });
  mine.push(t); reportsBy.set(ip, mine);
  if (reportsBy.size > 5000) reportsBy.delete(reportsBy.keys().next().value);
  const m = list[i], h = who(ip);
  m.r = Array.isArray(m.r) ? m.r : [];
  if (!m.r.includes(h)) m.r.push(h);
  const gone = m.r.length >= REPORTS_TO_REMOVE;
  if (gone) {
    list.splice(i, 1);
    const rm = removed.get(room); rm.push({ id, t }); while (rm.length > 100) rm.shift();
  }
  save();
  return send(res, 200, { ok: true, removed: gone });
}

function _reset(clockFn) {
  for (const r of ROOMS) { rooms.set(r, []); removed.set(r, []); }
  posts.clear(); reportsBy.clear(); nextId = 1; if (clockFn) now = clockFn;
}

module.exports = { handle, cleanText, ROOMS, CALL_RE, _reset };
