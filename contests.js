// HamShack: upcoming contests from the WA7BNM Contest Calendar RSS feed.
//   GET /api/contests -> { source, link, contests[{ name, link, when, start, end }], at, stale? }
// The feed's terms allow showing it on a non-profit site when it is labelled "WA7BNM Contest Calendar" and links
// back to the site; the page does both. Fetched at most once every 6 hours and shared by everyone.
"use strict";

const FEED = process.env.BW_CONTEST_URL || "https://www.contestcalendar.com/calendar.rss";
const TTL = 6 * 3600e3;
const UA = "BandWatch-M3VRV (amateur radio propagation monitor; contest list labelled and linked to WA7BNM Contest Calendar)";
const HEADERS = { "X-Content-Type-Options": "nosniff", "Content-Type": "application/json", "Cache-Control": "public, max-age=900" };
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

let cache = null; // { at, data }
let inflight = null;

const unxml = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();

/** "0000Z-0200Z, Nov 25" or "1200Z, Nov 28 to 1200Z, Nov 29" -> { start, end } in ms (UTC), near `ref`. */
function parseWhen(desc, ref) {
  const d = String(desc || "");
  const year = (mon) => { // the feed has no year: pick the one that puts the date nearest to now
    const y = new Date(ref).getUTCFullYear();
    const best = [y - 1, y, y + 1].map((yy) => ({ yy, t: Date.UTC(yy, mon, 15) })).sort((a, b) => Math.abs(a.t - ref) - Math.abs(b.t - ref))[0];
    return best.yy;
  };
  const at = (hhmm, mon, day) => Date.UTC(year(mon), mon, day, Number(hhmm.slice(0, 2)), Number(hhmm.slice(2)));
  let m = /^(\d{4})Z-(\d{4})Z,\s*([A-Z][a-z]{2})\s+(\d{1,2})/.exec(d);
  if (m && m[3] in MONTHS) {
    const mon = MONTHS[m[3]], day = Number(m[4]);
    const start = at(m[1], mon, day);
    let end = at(m[2], mon, day);
    if (end <= start) end += 24 * 3600e3;
    return { start, end };
  }
  m = /^(\d{4})Z,\s*([A-Z][a-z]{2})\s+(\d{1,2})\s+to\s+(\d{4})Z,\s*([A-Z][a-z]{2})\s+(\d{1,2})/.exec(d);
  if (m && m[2] in MONTHS && m[5] in MONTHS) {
    const start = at(m[1], MONTHS[m[2]], Number(m[3]));
    let end = at(m[4], MONTHS[m[5]], Number(m[6]));
    if (end < start) end = Date.UTC(new Date(start).getUTCFullYear() + 1, MONTHS[m[5]], Number(m[6]), Number(m[4].slice(0, 2)), Number(m[4].slice(2)));
    return { start, end };
  }
  return { start: null, end: null };
}

function parseFeed(xml, ref = Date.now()) {
  const out = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (t) => { const x = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(m[1]); return x ? unxml(x[1]) : ""; };
    const name = tag("title").slice(0, 120), link = tag("link"), when = tag("description").slice(0, 120);
    if (!name || !/^https:\/\/www\.contestcalendar\.com\//.test(link)) continue;
    const { start, end } = parseWhen(when, ref);
    out.push({ name, link, when, start, end });
  }
  return out.slice(0, 200);
}

async function load() {
  const res = await fetch(FEED, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20e3) });
  if (!res.ok) throw new Error(`contest calendar answered ${res.status}`);
  const contests = parseFeed(await res.text());
  if (!contests.length) throw new Error("no contests in the feed");
  return { source: "WA7BNM Contest Calendar", link: "https://www.contestcalendar.com/", contests, at: Date.now() };
}

async function get() {
  if (cache && Date.now() - cache.at < TTL) return cache.data;
  if (!inflight) {
    inflight = load().then((data) => { cache = { at: Date.now(), data }; return data; })
      .catch((err) => { if (cache) return { ...cache.data, stale: true }; throw err; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

async function handle(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, HEADERS); return res.end(JSON.stringify({ error: "method not allowed" })); }
  try { const data = await get(); res.writeHead(200, HEADERS); res.end(JSON.stringify(data)); }
  catch { res.writeHead(502, { ...HEADERS, "Cache-Control": "no-store" }); res.end(JSON.stringify({ error: "The contest calendar couldn't be reached right now." })); }
}

module.exports = { handle, parseFeed, parseWhen };
