"use strict";
// HTTP API tests. Run against server.js by default, or the Go build with BW_SERVER=go,
// so the web version and BandWatch.exe are held to the same behaviour.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const { startUpstream, startServer } = require("./helpers.js");

const nowSec = () => Math.floor(Date.now() / 1000);
const report = (o) => `<receptionReport ${Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(" ")} />`;

/* ---------- Fake upstream ---------- */

let up = {};
let qrzKeyValid = true;
const qrzXml = (inner) => `<?xml version="1.0"?><QRZDatabase version="1.34">${inner}</QRZDatabase>`;
function qrzMock(q) {
  if (up.qrzDown) return new Error("down");
  if (q.get("agent") !== "BandWatch-M3VRV-1.2") return { status: 400 };
  if (q.has("username")) {
    return q.get("username") === "m3vrv" && q.get("password") === "secret"
      ? qrzXml("<Session><Key>KEY1</Key><Count>5</Count><SubExp>non-subscriber</SubExp></Session>")
      : qrzXml("<Session><Error>Username/password incorrect </Error></Session>");
  }
  if (q.get("s") !== "KEY1" || !qrzKeyValid) return qrzXml("<Session><Error>Session Timeout</Error></Session>");
  const call = q.get("callsign");
  if (call === "G4ABC") {
    return qrzXml(`<Callsign><call>G4ABC</call><fname>Ann &amp; Bob</fname><name>Smith</name><addr2>York</addr2><country>England</country>
      <grid>IO93fx</grid><lat>53.96</lat><lon>-1.08</lon><class>Full</class><lotw>1</lotw><eqsl>0</eqsl><mqsl>1</mqsl>
      <cqzone>14</cqzone><image>https://cdn-xml.qrz.com/x/g4abc.jpg</image><GMTOffset>0</GMTOffset><DST>Y</DST><TimeZone>Europe/London</TimeZone></Callsign><Session><Key>KEY1</Key></Session>`);
  }
  return qrzXml(`<Session><Key>KEY1</Key><Error>Not found: ${call}</Error></Session>`);
}

const SUN = {
  regions: [
    { observed_date: "2026-11-15", region: 4500, latitude: 1, longitude: 1, area: 999 },
    { observed_date: "2026-11-16", region: 4577, latitude: -6, longitude: -27, location: "S06W27", area: 20, number_spots: 2, spot_class: "Cso", mag_class: "B", c_xray_events: 0, c_flare_probability: 15, m_flare_probability: 1, x_flare_probability: 1 },
    { observed_date: "2026-11-16", region: 4579, latitude: 15, longitude: 45, location: "N15E45", area: 170, number_spots: 1, spot_class: "Hsx", mag_class: "A", c_xray_events: 2, m_xray_events: 0, x_xray_events: 0, c_flare_probability: 10, m_flare_probability: 1, x_flare_probability: 1, first_date: "2026-11-14T08:22:02" },
  ],
  ssn: [{ Obsdate: "2026-11-14T00:00:00", swpc_ssn: 70 }, { Obsdate: "2026-11-15T00:00:00", swpc_ssn: 88 }],
  flares: [{ current_class: "B6.3", max_class: "C2.3", max_time: "2026-11-16T11:36:00Z" }],
  scales: { 0: { R: { Scale: "0" }, S: { Scale: "0" }, G: { Scale: "1" } } },
  wind: [{ proton_speed: 294, time_tag: "2026-11-16T13:36:00Z" }],
};

const XOTA = require("./fixtures/xota.js");
const { eibiFile } = require("./fixtures/eibi.js");
const Eibi = require("../public/js/eibi-data.js");

/* A pretend QRZ Logbook API: form posts, name=value answers. */
const QRZLOG_KEY = "ABCD-1234-EF56-7890";
const qrzLogPosts = [];
function qrzLogMock(body, req) {
  if (up.qrzLogDown) return { status: 503 };
  const f = new URLSearchParams(body);
  qrzLogPosts.push({ form: Object.fromEntries(f), type: req.headers["content-type"], agent: req.headers["user-agent"], method: req.method });
  if (f.get("KEY") !== QRZLOG_KEY) return "RESULT=FAIL&REASON=invalid api key " + f.get("KEY");
  if (f.get("ACTION") === "STATUS") return "RESULT=OK&DATA=&BOOKID=123&BOOK_NAME=M3VRV&OWNER=M3VRV&COUNT=42";
  if (f.get("ACTION") === "INSERT") {
    if (/<call:6>G0DUPE/i.test(f.get("ADIF"))) return "RESULT=FAIL&REASON=Unable to add QSO to database: duplicate&EXTENDED=";
    return "RESULT=OK&LOGID=130877825&COUNT=1";
  }
  return "RESULT=FAIL&REASON=bad action";
}

function handle(kind, url, body, req) {
  if (kind === "qrzlog") return qrzLogMock(body, req);
  if (kind === "qrz") return qrzMock(url.searchParams);
  if (kind === "eibi") return up.eibiDown ? { status: 503 } : eibiFile(url, up.eibiMissing || []);
  if (kind === "pota") return up.potaDown ? { status: 503 } : XOTA.potaRows();
  if (kind === "sota") return up.sotaDown ? new Error("down") : XOTA.sotaRows();
  if (kind === "update") return up.updateDown ? { status: 503 } : { tag_name: up.latestTag || "v99.1.0", html_url: "https://github.com/TecSpyPie/band-watch/releases/tag/v99.1.0", assets: [] };
  if (kind === "psk") return up.psk;
  const p = url.pathname;
  if (p.endsWith("f107_cm_flux.json")) return up.flux;
  if (p.endsWith("planetary_k_index_1m.json")) return up.kp;
  if (p.endsWith("solar_regions.json")) return up.sun.regions;
  if (p.endsWith("swpc_observed_ssn.json")) return up.sun.ssn;
  if (p.endsWith("xray-flares-latest.json")) return up.sun.flares;
  if (p.endsWith("noaa-scales.json")) return up.sun.scales;
  if (p.endsWith("solar-wind-speed.json")) return up.sun.wind;
  return undefined;
}

let upstream, srv;
// A download folder for the install page's Windows download (served by server.js only).
const DL_DIR = require("fs").mkdtempSync(require("path").join(require("os").tmpdir(), "bw-dl-"));
require("fs").writeFileSync(require("path").join(DL_DIR, "BandWatch-Windows.zip"), "PK-test-zip");
require("fs").writeFileSync(require("path").join(DL_DIR, "secret.txt"), "no");
process.env.BW_DOWNLOAD_DIR = DL_DIR;
test.before(async () => {
  upstream = await startUpstream(handle);
  srv = await startServer(upstream.base);
});
test.after(async () => { await srv.stop(); await upstream.close(); });
test.beforeEach(async () => {
  upstream.calls.length = 0;
  qrzKeyValid = true;
  up = {
    flux: [{ time_tag: "2026-11-16T20:00:00", flux: 120 }, { time_tag: "2026-11-16T17:00:00", flux: 999 }],
    kp: [{ time_tag: "2026-11-16T08:00:00", kp_index: 2.33 }, { time_tag: "2026-11-16T08:01:00", kp_index: 3.67 }],
    psk: `<receptionReports>
      ${report({ receiverCallsign: "K1ABC", receiverLocator: "FN42aa", senderCallsign: "G4XYZ", senderLocator: "IO93fa", frequency: 14074500, flowStartSeconds: nowSec() - 60, mode: "FT8", sNR: -12 })}
      ${report({ receiverCallsign: "G0AAA", receiverLocator: "IO93ab", senderCallsign: "JA1ZZZ", senderLocator: "PM95", frequency: 21075000, flowStartSeconds: nowSec() - 300, mode: "FT8", sNR: "" })}
    </receptionReports>`,
    sun: JSON.parse(JSON.stringify(SUN)),
  };
  await srv.reset();
});

const get = async (path, opts = {}) => {
  const res = await new Promise((resolve, reject) => {
    const req = http.request(srv.base + path, { method: opts.method || "GET", headers: opts.headers || {} }, resolve);
    req.on("error", reject);
    req.end(opts.body);
  });
  let body = "";
  for await (const c of res) body += c;
  return { status: res.statusCode, type: res.headers["content-type"], headers: res.headers, body };
};
const pskCalls = () => upstream.calls.filter((u) => u.includes("/psk"));

test("GET /healthz", async () => {
  const r = await get("/healthz");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.ok, true);
  assert.equal(j.version, require("../package.json").version);
});

test("GET /api/solar returns the latest NOAA values, rounded", async () => {
  const r = await get("/api/solar");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.sfi, 120);
  assert.equal(j.kp, 4);
  assert.equal(typeof j.at, "number");
  assert.equal(r.headers["cache-control"], "no-store");
});

test("GET /api/spots validates the grid square", async () => {
  for (const g of ["", "XX", "ZZ99", "1234", "IO9"]) {
    assert.equal((await get(`/api/spots?grid=${g}`)).status, 400, `grid ${JSON.stringify(g)}`);
  }
  assert.equal(pskCalls().length, 0, "invalid grids never reach PSK Reporter");
});

test("GET /api/spots returns parsed spots and trims 6-char grids", async () => {
  const r = await get("/api/spots?grid=io93fa");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.grid, "IO93");
  assert.equal(j.spots.length, 2);
  const k1 = j.spots.find((s) => s.c === "K1ABC");
  assert.deepEqual({ ...k1, ts: 0 }, { c: "K1ABC", l: "G4XYZ", g: "FN42aa", lat: 42.021, lon: -71.958, fq: 14.0745, m: "FT8", snr: -12, ts: 0, dir: "hears your grid" });
  const ja = j.spots.find((s) => s.c === "JA1ZZZ");
  assert.equal(ja.snr, null);
  assert.equal(ja.dir, "heard in your grid");
  assert.deepEqual([ja.lat, ja.lon], [35.5, 139]);
  assert.ok(pskCalls()[0].includes("callsign=IO93") && pskCalls()[0].includes("modify=grid"));
});

test("spots: newest report per path per MHz, entities decoded, unusable rows skipped", async () => {
  const t = nowSec();
  up.psk = `<receptionReports>${[
    report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G2", receiverLocator: "IO93", frequency: 7074300, flowStartSeconds: t - 30, mode: "FT8", sNR: -3 }),
    report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G2", receiverLocator: "IO93", frequency: 7075000, flowStartSeconds: t - 300, mode: "FT8", sNR: -1 }),
    report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G1", receiverLocator: "IO93", frequency: 7074000, flowStartSeconds: t - 600, mode: "FT8", sNR: -20 }),
    report({ senderCallsign: "AB&amp;C", senderLocator: "FN42", receiverLocator: "IO93", frequency: 14074000, flowStartSeconds: t, mode: "FT8" }),
    report({ senderCallsign: "NOLOC", senderLocator: "", receiverLocator: "IO93", frequency: 14074000, flowStartSeconds: t }),
    report({ senderCallsign: "NOFREQ", senderLocator: "FN42", receiverLocator: "IO93", frequency: "", flowStartSeconds: t }),
    report({ senderCallsign: "NOTIME", senderLocator: "FN42", receiverLocator: "IO93", frequency: 14074000 }),
  ].join("")}</receptionReports>`;
  const spots = JSON.parse((await get("/api/spots?grid=IO93")).body).spots;
  assert.deepEqual(spots.map((s) => s.c), ["DL1A", "DL1A", "AB&C"]);
  assert.equal(spots.find((s) => s.l === "G2").snr, -3, "older report on the same path is dropped");
});

test("responses are cached and concurrent requests share one upstream call", async () => {
  await Promise.all([get("/api/spots?grid=IO93"), get("/api/spots?grid=IO93"), get("/api/spots?grid=IO93")]);
  await get("/api/spots?grid=IO93");
  assert.equal(pskCalls().length, 1);
  await get("/api/spots?grid=JO62");
  assert.equal(pskCalls().length, 2, "a different grid is fetched separately");
});

test("serves stale data, marked stale, when a refresh fails", async () => {
  await get("/api/spots?grid=IO93");
  await srv.advance(6 * 60e3); // past the 5 minute cache
  up.psk = new Error("network down");
  const r = await get("/api/spots?grid=IO93");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.stale, true);
  assert.equal(j.spots.length, 2);
});

test("answers 502 without leaking details when a feed is down and nothing is cached", async () => {
  up.psk = { status: 503 };
  const r = await get("/api/spots?grid=IO93");
  assert.equal(r.status, 502);
  assert.deepEqual(JSON.parse(r.body), { error: "upstream feed unavailable" });
  up.flux = new Error("timeout");
  assert.equal((await get("/api/solar")).status, 502);
});

/* ---------- /api/myreports: FT8 and FT4 reports of your own callsign (Antenna A/B) ---------- */

const myRx = (o) => report({ senderCallsign: "G4XYZ", senderLocator: "IO93fa", receiverCallsign: "K1ABC", receiverLocator: "FN42aa", frequency: 14074500, mode: "FT8", sNR: -12, ...o });
const myUpstream = () => {
  const t = nowSec();
  up.psk = `<receptionReports>${[
    myRx({ flowStartSeconds: t - 60 }),
    myRx({ flowStartSeconds: t - 3000, receiverCallsign: "JA1ZZZ", receiverLocator: "PM95", mode: "FT4", frequency: 7047500, sNR: 3 }),
    myRx({ flowStartSeconds: t - 7200, receiverCallsign: "DL1OLD", receiverLocator: "JO62", sNR: -20 }),
    myRx({ flowStartSeconds: t - 100, mode: "WSPR", frequency: 14097100 }),
    myRx({ flowStartSeconds: t - 100, senderCallsign: "N0OTH" }),
    myRx({ flowStartSeconds: t - 100, receiverLocator: "" }),
    myRx({ flowStartSeconds: t - 100, sNR: "" }),
    myRx({ flowStartSeconds: t - 100, receiverCallsign: "" }),
    myRx({ receiverCallsign: "NOTIME" }),
    myRx({ flowStartSeconds: t - 100, receiverCallsign: "AB&amp;C" }),
  ].join("")}</receptionReports>`;
};

test("GET /api/myreports validates the callsign and minutes before asking PSK Reporter", async () => {
  myUpstream();
  for (const c of ["", "x", "XX", "G4ABC;DROP", "a%20b", "G4ABC%26mins%3D1", "%27%20OR%201=1", "TOOLONGCALL1", "G4ABC/", "G4ABC/TOOLONGSUFFIX"]) {
    assert.equal((await get(`/api/myreports?call=${c}`)).status, 400, `call ${JSON.stringify(c)}`);
  }
  for (const m of ["0", "-5", "abc", "1.5", "1e3", "%20"]) {
    assert.equal((await get(`/api/myreports?call=G4XYZ&mins=${m}`)).status, 400, `mins ${JSON.stringify(m)}`);
  }
  assert.equal((await get("/api/myreports")).status, 400);
  assert.equal(pskCalls().length, 0, "invalid requests never reach PSK Reporter");
});

test("GET /api/myreports returns the FT8 and FT4 reports of that sender, compact, and asks PSK Reporter politely", async () => {
  myUpstream();
  const r = await get("/api/myreports?call=g4xyz");
  assert.equal(r.status, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  const j = JSON.parse(r.body);
  assert.equal(j.call, "G4XYZ");
  assert.equal(j.mins, 1440);
  assert.equal(typeof j.at, "number");
  assert.deepEqual(j.reports.map((x) => x.c), ["DL1OLD", "JA1ZZZ", "AB&C", "K1ABC"], "oldest first; WSPR, other senders and unusable rows left out");
  const ja = j.reports[1];
  assert.deepEqual({ ...ja, ts: 0 }, { c: "JA1ZZZ", g: "PM95", lat: 35.5, lon: 139, fq: 7.0475, m: "FT4", snr: 3, ts: 0 });
  assert.deepEqual(Object.keys(ja).sort(), ["c", "fq", "g", "lat", "lon", "m", "snr", "ts"]);
  assert.equal(pskCalls().length, 1);
  const q = new URL(pskCalls()[0]).searchParams;
  assert.equal(q.get("senderCallsign"), "G4XYZ");
  assert.equal(q.get("flowStartSeconds"), "-86400", "never more than PSK Reporter's 24 hours");
  assert.equal(q.get("rronly"), "1");
  assert.equal(q.get("noactive"), "1");
  assert.ok(Number(q.get("rptlimit")) > 0 && Number(q.get("rptlimit")) <= 5000);
  assert.match(q.get("appcontact"), /^https:\/\/github\.com\//, "a project address, never an email");
  assert.ok(!pskCalls()[0].includes("%40"), "no email address anywhere in the request");
});

test("/api/myreports: mins trims the answer (and is capped at 24 hours) without another PSK Reporter call", async () => {
  myUpstream();
  const n = async (m) => JSON.parse((await get(`/api/myreports?call=G4XYZ${m}`)).body);
  assert.equal((await n("&mins=10")).reports.length, 2, "last 10 minutes");
  const hour = await n("&mins=60");
  assert.equal(hour.mins, 60);
  assert.deepEqual(hour.reports.map((x) => x.c), ["JA1ZZZ", "AB&C", "K1ABC"]);
  assert.equal((await n("&mins=999999")).mins, 1440);
  assert.equal((await n("&mins=999999")).reports.length, 4);
  assert.equal(pskCalls().length, 1, "different windows share one upstream call");
});

test("/api/myreports: cached per callsign for 5 minutes, concurrent requests share one upstream call", async () => {
  myUpstream();
  await Promise.all([1, 2, 3, 4].map(() => get("/api/myreports?call=G4XYZ")));
  await get("/api/myreports?call=G4XYZ&mins=30");
  await get("/api/myreports?call=g4xyz");
  assert.equal(pskCalls().length, 1);
  await srv.advance(4 * 60e3);
  await get("/api/myreports?call=G4XYZ");
  assert.equal(pskCalls().length, 1, "still cached after 4 minutes");
  await get("/api/myreports?call=M0ABC");
  assert.equal(pskCalls().length, 2, "another callsign is fetched separately");
  await srv.advance(2 * 60e3);
  await get("/api/myreports?call=G4XYZ");
  assert.equal(pskCalls().length, 3, "asked again only after the 5 minutes");
});

test("/api/myreports: serves stale data, marked stale, when a refresh fails", async () => {
  myUpstream();
  await get("/api/myreports?call=G4XYZ");
  await srv.advance(6 * 60e3);
  up.psk = new Error("network down");
  const r = await get("/api/myreports?call=G4XYZ&mins=1440");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.stale, true);
  assert.ok(j.reports.length >= 1);
});

test("/api/myreports: 502 without leaking details when PSK Reporter is down and nothing is cached", async () => {
  up.psk = { status: 503 };
  const r = await get("/api/myreports?call=G4XYZ");
  assert.equal(r.status, 502);
  assert.deepEqual(JSON.parse(r.body), { error: "upstream feed unavailable" });
  up.psk = new Error("timeout");
  const r2 = await get("/api/myreports?call=G4ABC");
  assert.equal(r2.status, 502);
  assert.ok(!/pskreporter|127\.0\.0\.1|timeout/i.test(r2.body));
});

test("/api/myreports: a callsign with a slash works and an empty answer is an empty list", async () => {
  up.psk = "<receptionReports></receptionReports>";
  const r = await get("/api/myreports?call=ea8%2Fg4abc");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.call, "EA8/G4ABC");
  assert.deepEqual(j.reports, []);
  assert.equal(new URL(pskCalls()[0]).searchParams.get("senderCallsign"), "EA8/G4ABC");
});

test("NOAA data with no usable values is treated as a failure", async () => {
  up.flux = [{ time_tag: "x", flux: null }];
  assert.equal((await get("/api/solar")).status, 502);
});

test("GET /api/sun summarises sunspot regions and space weather", async () => {
  const r = await get("/api/sun");
  assert.equal(r.status, 200);
  const j = JSON.parse(r.body);
  assert.equal(j.date, "2026-11-16");
  assert.deepEqual(j.regions.map((x) => x.region), [4579, 4577], "latest day only, biggest first");
  assert.deepEqual(j.regions[0], {
    region: 4579, lat: 15, lon: 45, location: "N15E45", area: 170, spots: 1, spotClass: "Hsx", magClass: "A",
    flares: { c: 2, m: 0, x: 0 }, prob: { c: 10, m: 1, x: 1 }, first: "2026-11-14T08:22:02",
  });
  assert.equal(j.regions[1].first, null);
  assert.equal(j.ssn, 88);
  assert.equal(j.ssnDate, "2026-11-15");
  assert.deepEqual(j.xray, { now: "B6.3", flare: "C2.3", flareAt: "2026-11-16T11:36:00Z" });
  assert.deepEqual(j.scales, { R: "0", S: "0", G: "1" });
  assert.equal(j.wind, 294);
});

test("GET /api/sun still works when the optional feeds fail, but not without regions", async () => {
  up.sun.ssn = { status: 500 };
  up.sun.flares = new Error("down");
  up.sun.scales = { status: 404 };
  up.sun.wind = "not json";
  const j = JSON.parse((await get("/api/sun")).body);
  assert.equal(j.regions.length, 2);
  assert.equal(j.ssn, null);
  assert.equal(j.xray, null);
  assert.equal(j.scales, null);
  assert.equal(j.wind, null);
  await srv.reset();
  up.sun.regions = { status: 503 };
  assert.equal((await get("/api/sun")).status, 502);
});

/* ---------- Static files ---------- */

test("serves the page and its assets with the right types", async () => {
  const cases = [["/", "text/html"], ["/index.html", "text/html"], ["/js/app.js", "text/javascript"], ["/style.css", "text/css"], ["/favicon.svg", "image/svg+xml"]];
  for (const [path, type] of cases) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.ok(r.type.startsWith(type), `${path}: ${r.type}`);
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  }
  assert.equal((await get("/")).headers["cache-control"], "no-cache");
});

test("the Help guide and its pictures", async () => {
  for (const [path, type] of [["/help", "text/html"], ["/help.html", "text/html"], ["/help/radio-panel.webp", "image/webp"], ["/help/overview.webp", "image/webp"]]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.ok(r.type.startsWith(type), `${path}: ${r.type}`);
  }
  assert.equal((await get("/help")).headers["cache-control"], "no-cache", "the guide is checked for updates like the page");
  const help = (await get("/help")).body;
  // Every picture it shows is there
  for (const [, src] of help.matchAll(/<img src="([^"]+)"/g)) assert.equal((await get(src)).status, 200, src);
  // Every link to a section has its section
  for (const [, id] of help.matchAll(/href="#([a-z]+)"/g)) assert.match(help, new RegExp(`id="${id}"`), id);
  assert.match(help, /CI-V USB Baud Rate:<\/b> Auto/);
  assert.match(help, /Zadig/);
});

test("install page, app manifest, icons and service worker", async () => {
  const cases = [["/install", "text/html"], ["/install.css", "text/css"], ["/manifest.webmanifest", "application/manifest+json"],
    ["/sw.js", "text/javascript"], ["/js/install.js", "text/javascript"], ["/js/installpage.js", "text/javascript"],
    ["/icons/icon-192.png", "image/png"], ["/icons/icon-512.png", "image/png"], ["/icons/maskable-512.png", "image/png"],
    ["/icons/apple-touch-icon.png", "image/png"], ["/icons/qr-install.svg", "image/svg+xml"]];
  for (const [path, type] of cases) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.ok(r.type.startsWith(type), `${path}: ${r.type}`);
  }
  for (const p of ["/install", "/sw.js", "/manifest.webmanifest"]) assert.equal((await get(p)).headers["cache-control"], "no-cache", p);
  const install = await get("/install");
  assert.match(install.body, /iPhone or iPad/);
  assert.match(install.body, /Android/);
  assert.match(install.body, /Windows PC/);
  const m = JSON.parse((await get("/manifest.webmanifest")).body);
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/?app=1");
  assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
  assert.ok(m.icons.some((i) => i.sizes === "192x192"));
  const page = (await get("/")).body;
  assert.match(page, /rel="manifest" href="\/manifest.webmanifest"/);
  assert.match(page, /rel="apple-touch-icon"/);
  assert.match(page, /js\/install.js/);
});

test("Windows download: offered by the web server when present, never other files", async () => {
  const r = await get("/download/BandWatch-Windows.zip");
  if (srv.kind === "go") {
    assert.equal(r.status, 404); // BandWatch.exe doesn't serve its own installer
  } else {
    assert.equal(r.status, 200);
    assert.equal(r.type, "application/zip");
    assert.match(r.headers["content-disposition"], /attachment; filename="BandWatch-Windows.zip"/);
    assert.equal(r.body, "PK-test-zip");
    const h = await get("/download/BandWatch-Windows.zip", { method: "HEAD" });
    assert.equal(h.status, 200);
    assert.equal(h.body, "");
  }
  for (const p of ["/download/secret.txt", "/download/../server.js", "/download/%2e%2e%2fserver.js", "/download/"]) {
    assert.equal((await get(p)).status, 404, p);
  }
});

test("blocks path traversal, unknown paths and other methods", async () => {
  for (const p of ["/../server.js", "/%2e%2e/server.js", "/public/../server.js", "/nope.html", "/api/nope", "/server.js", "/package.json"]) {
    assert.equal((await get(p)).status, 404, p);
  }
  assert.equal((await get("/api/solar", { method: "POST" })).status, 405);
});

/* ---------- QRZ ---------- */

const login = (username, password, extra = {}) => get("/api/qrz/login", {
  method: "POST",
  headers: { "Content-Type": "application/json", ...extra },
  body: JSON.stringify({ username, password }),
});
const cookieOf = (r) => (r.headers["set-cookie"] || [""])[0].split(";")[0];

test("QRZ status is logged out without a session", async () => {
  assert.deepEqual(JSON.parse((await get("/api/qrz/status")).body), { loggedIn: false });
});

test("QRZ login sets an HttpOnly cookie and never returns the key", async () => {
  const r = await login("m3vrv", "secret");
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { loggedIn: true, user: "M3VRV", subscriber: false, subscription: "non-subscriber" });
  assert.ok(!r.body.includes("KEY1"), "QRZ key must stay on the server");
  assert.match(r.headers["set-cookie"][0], /^bw_qrz=[0-9a-f]{48}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=86400$/);
  const status = await get("/api/qrz/status", { headers: { Cookie: cookieOf(r) } });
  assert.equal(JSON.parse(status.body).user, "M3VRV");
});

test("QRZ cookie is marked Secure when served on a real host name", async () => {
  const r = await login("m3vrv", "secret", { Host: "band-watch.ample.run" });
  assert.match(r.headers["set-cookie"][0], /; Secure$/);
});

test("QRZ login rejects wrong passwords, bad input and non-JSON posts", async () => {
  const bad = await login("m3vrv", "nope");
  assert.equal(bad.status, 401);
  assert.equal(JSON.parse(bad.body).error, "QRZ did not accept that username and password.");
  assert.equal(bad.headers["set-cookie"], undefined);
  assert.equal((await login("", "x")).status, 400);
  assert.equal((await login("m3vrv", "x".repeat(200))).status, 400);
  const form = await get("/api/qrz/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "username=m3vrv&password=secret" });
  assert.equal(form.status, 415, "form posts from other sites are refused");
  const big = await get("/api/qrz/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "a", password: "b", pad: "x".repeat(5000) }) });
  assert.equal(big.status, 413);
  assert.equal((await get("/api/qrz/login")).status, 405);
});

test("QRZ login is rate limited per address", async () => {
  const hdr = { "X-Forwarded-For": "203.0.113.9" };
  for (let i = 0; i < 10; i++) assert.equal((await login("m3vrv", "nope", hdr)).status, 401);
  assert.equal((await login("m3vrv", "secret", hdr)).status, 429);
  assert.equal((await login("m3vrv", "secret", { "X-Forwarded-For": "203.0.113.10" })).status, 200, "other addresses unaffected");
});

test("QRZ lookup needs a session, returns tidy details and caches them", async () => {
  assert.equal((await get("/api/qrz/lookup?call=G4ABC")).status, 401);
  const cookie = cookieOf(await login("m3vrv", "secret"));
  const r = await get("/api/qrz/lookup?call=g4abc", { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  const d = JSON.parse(r.body);
  assert.deepEqual(d, {
    call: "G4ABC", name: "Ann & Bob Smith", nickname: null, city: "York", state: null, country: "England", grid: "IO93fx",
    lat: 53.96, lon: -1.08, licenceClass: "Full", cqZone: "14", ituZone: null, qslManager: null, lotw: true, eqsl: false,
    paperQsl: true, image: "https://cdn-xml.qrz.com/x/g4abc.jpg", timeZone: "Europe/London", gmtOffset: 0, dst: true,
    limited: true, message: null,
  });
  const before = upstream.calls.length;
  await get("/api/qrz/lookup?call=G4ABC", { headers: { Cookie: cookie } });
  assert.equal(upstream.calls.length, before, "second lookup comes from cache");
});

test("QRZ lookup handles unknown calls, bad input and expired sessions", async () => {
  const cookie = cookieOf(await login("m3vrv", "secret"));
  const nf = await get("/api/qrz/lookup?call=ZZ9ZZZ", { headers: { Cookie: cookie } });
  assert.equal(nf.status, 404);
  assert.equal(JSON.parse(nf.body).error, "ZZ9ZZZ was not found on QRZ.");
  for (const c of ["", "HELLO", "<script>", "G4ABC%20OR%201"]) {
    assert.equal((await get(`/api/qrz/lookup?call=${c}`, { headers: { Cookie: cookie } })).status, 400, c);
  }
  qrzKeyValid = false;
  const exp = await get("/api/qrz/lookup?call=M0XYZ", { headers: { Cookie: cookie } });
  assert.equal(exp.status, 401);
  assert.match(JSON.parse(exp.body).error, /session has ended/);
  assert.deepEqual(JSON.parse((await get("/api/qrz/status", { headers: { Cookie: cookie } })).body), { loggedIn: false });
});

test("QRZ logout ends the session and clears the cookie", async () => {
  const cookie = cookieOf(await login("m3vrv", "secret"));
  const out = await get("/api/qrz/logout", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(out.status, 200);
  assert.match(out.headers["set-cookie"][0], /^bw_qrz=; .*Max-Age=0/);
  assert.equal((await get("/api/qrz/lookup?call=G4ABC", { headers: { Cookie: cookie } })).status, 401);
  assert.equal((await get("/api/qrz/status", { headers: { Cookie: "bw_qrz=forged" } })).body, '{"loggedIn":false}');
});

const logbook = (body) => get("/api/qrz/logbook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ADIF1 = "<CALL:5>G4ABC<QSO_DATE:8>20261117<TIME_ON:4>1015<BAND:3>20m<MODE:3>SSB<EOR>";

test("QRZ Logbook: checks a key and sends a contact, passing the key straight to QRZ", async () => {
  qrzLogPosts.length = 0;
  const st = await logbook({ key: QRZLOG_KEY.toLowerCase(), action: "status" });
  assert.equal(st.status, 200);
  const s = JSON.parse(st.body);
  assert.equal(s.ok, true);
  assert.equal(s.info.BOOK_NAME, "M3VRV");
  assert.equal(s.info.COUNT, "42");
  const r = JSON.parse((await logbook({ key: QRZLOG_KEY, action: "insert", adif: ADIF1 })).body);
  assert.deepEqual(r, { ok: true, result: "OK", reason: "", duplicate: false, auth: false, logid: "130877825", count: 1, info: { LOGID: "130877825", COUNT: "1" } });
  assert.equal(qrzLogPosts.length, 2);
  assert.deepEqual(qrzLogPosts[1].form, { KEY: QRZLOG_KEY, ACTION: "INSERT", ADIF: ADIF1 });
  assert.equal(qrzLogPosts[1].method, "POST");
  assert.match(qrzLogPosts[1].type, /^application\/x-www-form-urlencoded/);
  assert.equal(qrzLogPosts[1].agent, "BandWatch-M3VRV-1.2");
});

test("QRZ Logbook: duplicates, wrong keys, bad input and QRZ being down", async () => {
  const dup = JSON.parse((await logbook({ key: QRZLOG_KEY, action: "insert", adif: "<CALL:6>G0DUPE<EOR>" })).body);
  assert.equal(dup.ok, false);
  assert.equal(dup.duplicate, true);
  const bad = JSON.parse((await logbook({ key: "WXYZ-0000-0000-0000", action: "status" })).body);
  assert.equal(bad.ok, false);
  assert.equal(bad.auth, true);
  assert.equal((await logbook({ key: "short", action: "status" })).status, 400);
  assert.equal((await logbook({ key: "ABCD-1234<x>", action: "status" })).status, 400);
  assert.equal((await logbook({ key: QRZLOG_KEY, action: "delete" })).status, 400, "only status and insert");
  assert.equal((await logbook({ key: QRZLOG_KEY, action: "insert", adif: "no record" })).status, 400);
  assert.equal((await logbook({ key: QRZLOG_KEY, action: "insert", adif: "<CALL:5>G4ABC" + "x".repeat(5000) + "<EOR>" })).status, 400, "too long for one contact");
  assert.equal((await logbook({ key: QRZLOG_KEY, action: "insert", adif: "<CALL:5>G4ABC" + "x".repeat(9000) + "<EOR>" })).status, 413);
  const form = await get("/api/qrz/logbook", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "key=x" });
  assert.equal(form.status, 415);
  assert.equal((await get("/api/qrz/logbook")).status, 405);
  up.qrzLogDown = true;
  const down = await logbook({ key: QRZLOG_KEY, action: "status" });
  assert.equal(down.status, 502);
  assert.match(JSON.parse(down.body).error, /QRZ Logbook could not be reached/);
});

test("QRZ Logbook is rate limited per address", async () => {
  let last;
  for (let i = 0; i < 121; i++) last = await logbook({ key: QRZLOG_KEY, action: "status" });
  assert.equal(last.status, 429);
});

test("QRZ being unreachable gives a friendly 502", async () => {
  up.qrzDown = true;
  const r = await login("m3vrv", "secret");
  assert.equal(r.status, 502);
  assert.equal(JSON.parse(r.body).error, "QRZ.com could not be reached.");
});

/* ---------- RTL-SDR bridge (rtl_tcp) ---------- */

/** A stand-in for rtl_tcp: sends the 12-byte header and a test pattern, records the commands it gets. */
function startFakeRtlTcp() {
  const net = require("net");
  const state = { received: Buffer.alloc(0), connections: 0, closed: 0 };
  const pattern = Buffer.alloc(200000);
  for (let i = 0; i < pattern.length; i++) pattern[i] = (i * 7) & 0xff;
  const header = Buffer.from([0x52, 0x54, 0x4c, 0x30, 0, 0, 0, 6, 0, 0, 0, 29]); // "RTL0", R828D, 29 gains
  const server = net.createServer((sock) => {
    state.connections++;
    sock.write(Buffer.concat([header, pattern]));
    sock.on("data", (d) => { state.received = Buffer.concat([state.received, d]); });
    sock.on("close", () => { state.closed++; });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, header, pattern, port: server.address().port })));
}

const SDR = { "X-Band-Watch": "sdr" };
const waitFor = async (fn, ms = 3000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** Opens the stream; resolves once `want` bytes have arrived (or it ends). */
function openStream(path, want, headers = SDR) {
  return new Promise((resolve, reject) => {
    const req = http.request(srv.base + path, { headers }, (res) => {
      const chunks = [];
      let got = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), req, res });
      };
      res.on("data", (c) => { chunks.push(c); got += c.length; if (got >= want) finish(); });
      res.on("end", finish);
    });
    req.on("error", reject);
    req.end();
  });
}

test("RTL-SDR bridge: available, and refuses requests without its header", async () => {
  const r = await get("/api/sdr");
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { available: true });
  const noHeader = await get("/api/sdr/stream?addr=127.0.0.1:1234");
  assert.equal(noHeader.status, 403);
  const noHeaderCmd = await get("/api/sdr/cmd", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noHeaderCmd.status, 403);
});

test("RTL-SDR bridge: only this PC or a home-network address", async () => {
  for (const addr of ["8.8.8.8:1234", "example.com:1234", "127.0.0.1:99999", "127.0.0.1", "", "1.2.3.4.5:1", "172.32.0.1:1234", "[::1]:1234", "127.0.0.1:1234/x"]) {
    const r = await get(`/api/sdr/stream?addr=${encodeURIComponent(addr)}`, { headers: SDR });
    assert.equal(r.status, 400, addr);
  }
});

test("RTL-SDR bridge: says clearly when rtl_tcp isn't running", async () => {
  const net = require("net");
  const free = await new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const r = await get(`/api/sdr/stream?addr=127.0.0.1:${free}`, { headers: SDR });
  assert.equal(r.status, 502);
  assert.match(JSON.parse(r.body).error, /Is rtl_tcp running\?/);
});

test("RTL-SDR bridge: passes the samples through and sends commands to rtl_tcp", async () => {
  const fake = await startFakeRtlTcp();
  try {
    const want = fake.header.length + fake.pattern.length;
    const s = await openStream(`/api/sdr/stream?addr=localhost:${fake.port}`, want);
    assert.equal(s.status, 200);
    assert.equal(s.headers["content-type"], "application/octet-stream");
    const id = s.headers["x-sdr-session"];
    assert.match(id, /^[0-9a-f]{32}$/);
    assert.ok(s.body.length >= want);
    assert.ok(s.body.subarray(0, want).equals(Buffer.concat([fake.header, fake.pattern])), "bytes arrive unchanged");

    const cmd = (body, headers = SDR) => get("/api/sdr/cmd", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await cmd({ session: id, cmd: 1, value: 14440000 })).status, 200); // frequency
    assert.equal((await cmd({ session: id, cmd: 5, value: -2 })).status, 200); // ppm, negative
    assert.equal((await cmd({ session: id, cmd: 0x0e, value: 1 })).status, 200); // bias tee on
    await waitFor(() => fake.state.received.length >= 15);
    assert.equal(fake.state.received.toString("hex"), "0100dc5640" + "05fffffffe" + "0e00000001");

    assert.equal((await cmd({ session: id, cmd: 7, value: 1 })).status, 400); // not an allowed command
    assert.equal((await cmd({ session: id, cmd: 9, value: 5 })).status, 400); // direct sampling is 0, 1 or 2
    assert.equal((await cmd({ session: id, cmd: 1, value: 1.5 })).status, 400);
    assert.equal((await cmd({ session: id, cmd: 1, value: 2 ** 33 })).status, 400);
    assert.equal((await cmd({ session: "nope", cmd: 1, value: 1 })).status, 404);
    assert.equal((await cmd({ session: id, cmd: 1, value: 1 }, {})).status, 403);

    // Closing the page closes the connection to rtl_tcp.
    s.req.destroy();
    await waitFor(() => fake.state.closed === 1);
    assert.equal((await cmd({ session: id, cmd: 1, value: 1 })).status, 404);
  } finally {
    fake.server.close();
  }
});

test("RTL-SDR bridge: at most two receivers at once", async () => {
  const fake = await startFakeRtlTcp();
  try {
    const a = await openStream(`/api/sdr/stream?addr=127.0.0.1:${fake.port}`, 12);
    const b = await openStream(`/api/sdr/stream?addr=127.0.0.1:${fake.port}`, 12);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const c = await get(`/api/sdr/stream?addr=127.0.0.1:${fake.port}`, { headers: SDR });
    assert.equal(c.status, 429);
    a.req.destroy();
    b.req.destroy();
    await waitFor(() => fake.state.closed === 2);
  } finally {
    fake.server.close();
  }
});

test("RTL-SDR: starts rtl_tcp for the user, only the real program name, and stops it", { skip: process.platform === "win32" && "fixture rtl_tcp is a shell script, which Windows can't run" }, async () => {
  const path = require("path");
  const net = require("net");
  const exe = path.join(__dirname, "fixtures", "rtl_tcp");
  const post = (p, body) => get(p, { method: "POST", headers: { ...SDR, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });

  assert.equal((await get("/api/sdr/launch")).status, 403, "needs the Band Watch header");
  assert.equal((await post("/api/sdr/launch", { path: "/bin/sh", port, device: 0 })).status, 404, "only rtl_tcp");
  assert.match(JSON.parse((await post("/api/sdr/launch", { path: "/bin/sh", port, device: 0 })).body).error, /isn't rtl_tcp/);
  assert.equal((await post("/api/sdr/launch", { path: "/nowhere/rtl_tcp.exe", port, device: 0 })).status, 404);
  assert.equal((await post("/api/sdr/launch", { path: exe, port: 70000, device: 0 })).status, 400);
  assert.equal((await post("/api/sdr/launch", { path: exe, port, device: 12 })).status, 400);

  const r = await post("/api/sdr/launch", { path: exe, port, device: 1 });
  assert.equal(r.status, 200, r.body);
  const st = JSON.parse(r.body);
  assert.equal(st.running, true);
  assert.deepEqual(st.args, ["-a", "127.0.0.1", "-p", String(port), "-d", "1"]);
  // it listens, and the bridge can use it
  let s;
  for (let i = 0; i < 40; i++) {
    s = await openStream(`/api/sdr/stream?addr=127.0.0.1:${port}`, 12).catch(() => null);
    if (s && s.status === 200) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  assert.equal(s.status, 200);
  assert.equal(s.body.subarray(0, 4).toString(), "RTL0");
  s.req.destroy();
  // asking again with the same settings doesn't start a second one
  const again = JSON.parse((await post("/api/sdr/launch", { path: exe, port, device: 1 })).body);
  assert.equal(again.running, true);
  const status = JSON.parse((await get("/api/sdr/launch", { headers: SDR })).body);
  assert.ok(status.output.some((l) => /Blog V4/.test(l)), JSON.stringify(status.output));
  // stop
  assert.equal((await post("/api/sdr/launch/stop", {})).status, 200);
  for (let i = 0; i < 40 && JSON.parse((await get("/api/sdr/launch", { headers: SDR })).body).running; i++) await new Promise((res) => setTimeout(res, 50));
  assert.equal(JSON.parse((await get("/api/sdr/launch", { headers: SDR })).body).running, false);
});

test("RTL-SDR: a stuck rtl_tcp (header, then silence) reaches the page as just the header", async () => {
  const net = require("net");
  const header = Buffer.from([0x52, 0x54, 0x4c, 0x30, 0, 0, 0, 6, 0, 0, 0, 29]);
  const server = net.createServer((sock) => { sock.write(header); sock.on("error", () => {}); sock.on("data", () => {}); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const s = await openStream(`/api/sdr/stream?addr=127.0.0.1:${server.address().port}`, 12);
    assert.equal(s.status, 200);
    assert.deepEqual(s.body, header);
    // ...and the connection stays open with no samples: the page's stall watch is what notices
    let extra = 0;
    s.res.on("data", (c) => { extra += c.length; });
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(extra, 0);
    s.req.destroy();
  } finally {
    server.close();
  }
});

// What the page does to restart the rtl_tcp it started: stop it, wait until it has gone, start it again.
// (The fixture is a shell script, so this can't run on Windows.)
test("RTL-SDR: stop, wait, launch again gives a fresh rtl_tcp that Band Watch started (stall restart)", { skip: process.platform === "win32" }, async () => {
  const path = require("path");
  const net = require("net");
  const exe = path.join(__dirname, "fixtures", "rtl_tcp");
  const post = (p, body) => get(p, { method: "POST", headers: { ...SDR, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const status = async () => JSON.parse((await get("/api/sdr/launch", { headers: SDR })).body);
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const first = JSON.parse((await post("/api/sdr/launch", { path: exe, port, device: 0 })).body);
  assert.equal(first.running, true);
  // the page tells ours from someone else's by the port in the args
  assert.equal(first.args[first.args.indexOf("-p") + 1], String(port));
  assert.equal((await post("/api/sdr/launch/stop", {})).status, 200);
  for (let i = 0; i < 60 && (await status()).running; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await status()).running, false);
  const again = JSON.parse((await post("/api/sdr/launch", { path: first.path, port, device: 0 })).body);
  assert.equal(again.running, true);
  assert.deepEqual(again.args, first.args);
  let s;
  for (let i = 0; i < 40; i++) {
    s = await openStream(`/api/sdr/stream?addr=127.0.0.1:${port}`, 12).catch(() => null);
    if (s && s.status === 200) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(s.body.subarray(0, 4).toString(), "RTL0");
  s.req.destroy();
  await post("/api/sdr/launch/stop", {});
  for (let i = 0; i < 60 && (await status()).running; i++) await new Promise((r) => setTimeout(r, 50));
});

test("healthz says when this copy was built and what it runs on", async (t) => {
  const r = await get("/healthz");
  const h = JSON.parse(r.body);
  assert.equal(h.version, require("../package.json").version);
  assert.equal(typeof h.build, "object");
  assert.equal(typeof h.build.date, "string");
  if (h.build.date) assert.ok(!Number.isNaN(Date.parse(h.build.date)), h.build.date);
  assert.match(h.build.server, /^(Node\.js|BandWatch\.exe)$/);
  assert.ok(h.build.runtime);
  assert.ok(!Number.isNaN(Date.parse(h.build.started)));
});

test("GET /api/xota: POTA activators, newest first, cached; SOTA's API isn't used", async () => {
  const r = await get("/api/xota");
  assert.equal(r.status, 200);
  const d = JSON.parse(r.body);
  assert.deepEqual(d.failed, []);
  assert.deepEqual(d.spots.map((x) => `${x.src} ${x.call} ${x.kHz} ${x.mode} ${x.ref}`), [
    "pota G0ABC 14244 SSB GB-0123",
    "pota N0POTA 7074 FT8 US-0001",
  ]);
  const p = d.spots[0];
  assert.equal(p.name, "Peak District National Park");
  assert.equal(p.grid, "IO93ah");
  assert.equal(p.lat, 53.3);
  assert.equal(p.by, "M0XYZ");
  assert.match(p.time, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z$/);
  assert.ok(Math.abs(Date.parse(p.time) - (Date.now() - 3 * 60000)) < 120000, "spot time read as UTC");
  assert.equal(upstream.calls.filter((u) => u.includes("/sota")).length, 0, "never asks SOTA");
  const n = upstream.calls.length;
  await get("/api/xota");
  assert.equal(upstream.calls.length, n, "second request from the cache");
});

test("GET /api/xota: POTA down is a 502", async () => {
  up.potaDown = true;
  const r = await get("/api/xota");
  assert.equal(r.status, 502);
});

test("GET /api/eibi: this season's EiBi schedule and README, from Latin-1, cached", async () => {
  const r = await get("/api/eibi");
  assert.equal(r.status, 200);
  const d = JSON.parse(r.body);
  assert.equal(d.season, Eibi.season(new Date()));
  assert.match(d.csv, /^kHz:75;/);
  assert.match(d.csv, /Nemzetiségi Rádió/, "Latin-1 accents become proper letters");
  assert.match(d.readme, /third-party software/);
  assert.ok(upstream.calls.some((u) => u.endsWith(`/eibi/dx/sked-${d.season.toLowerCase()}.csv`)));
  const rows = Eibi.parseSked(d.csv);
  assert.ok(rows.some((b) => b.station === "BBC" && b.kHz === 5975));
  const n = upstream.calls.length;
  await get("/api/eibi");
  assert.equal(upstream.calls.length, n, "second request from the cache");
  const z = await fetch(srv.base + "/api/eibi", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(z.headers.get("content-encoding"), "gzip", "sent gzipped: it's a big file");
  assert.equal((await z.json()).season, d.season);
});

test("GET /api/eibi: early in a season, the season before", async () => {
  const now = Eibi.season(new Date());
  up.eibiMissing = [now];
  const d = JSON.parse((await get("/api/eibi")).body);
  assert.equal(d.season, Eibi.previousSeason(now));
});

test("GET /api/eibi: EiBi down is a 502", async () => {
  up.eibiDown = true;
  const r = await get("/api/eibi");
  assert.equal(r.status, 502);
});

test("GET /api/update: the newest release on GitHub, and whether this copy can install it", async () => {
  const r = await get("/api/update");
  assert.equal(r.status, 200);
  const d = JSON.parse(r.body);
  assert.equal(d.current, require("../package.json").version);
  assert.equal(d.latest, "99.1.0");
  assert.equal(d.newer, true);
  assert.equal(d.canInstall, false, "only the Windows app installs updates");
  assert.match(d.page, /releases\/tag\/v99\.1\.0$/);
  await srv.reset();
  up.latestTag = `v${require("../package.json").version}`;
  assert.equal(JSON.parse((await get("/api/update")).body).newer, false);
  await srv.reset();
  up.updateDown = true;
  assert.equal((await get("/api/update")).status, 502);
});

test("POST /api/update/install: not available outside the Windows app", async () => {
  const r = await get("/api/update/install", { method: "POST", headers: { "X-Band-Watch": "update" } });
  assert.ok([404, 405].includes(r.status), `status ${r.status}`);
});
