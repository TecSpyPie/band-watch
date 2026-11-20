"use strict";
// Antenna A/B: the period log, matching by receiver and band, averages, sectors, distance bands, the wspr.live query.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../public/js/antenna.js");

const MIN = 60000;
const T0 = Date.UTC(2026, 10, 19, 10, 0);
const periods = [
  { id: "1", ant: "A", start: T0, end: T0 + 20 * MIN },
  { id: "2", ant: "B", start: T0 + 20 * MIN, end: T0 + 40 * MIN },
  { id: "3", ant: "A", start: T0 + 40 * MIN, end: null },
];
const now = T0 + 70 * MIN;
const rep = (min, rx, snr, band = 14, extra = {}) => ({ t: T0 + min * MIN, band, rx, snr, lat: 40, lon: -74, dist: 5500, az: 290, ...extra });

test("assignPeriod: start included, end excluded, whole 2-minute slot must fit", () => {
  assert.equal(A.assignPeriod(T0, periods, now), "A");
  assert.equal(A.assignPeriod(T0 + 18 * MIN, periods, now), "A");        // slot ends exactly at the swap: fits
  assert.equal(A.assignPeriod(T0 + 19 * MIN, periods, now), null);       // slot straddles the swap: dropped
  assert.equal(A.assignPeriod(T0 + 20 * MIN, periods, now), "B");
  assert.equal(A.assignPeriod(T0 - 2 * MIN, periods, now), null);        // before everything
  assert.equal(A.assignPeriod(T0 + 60 * MIN, periods, now), "A");        // open period runs to now
  assert.equal(A.assignPeriod(T0 + 69 * MIN, periods, now), null);       // slot not finished yet at "now"
  assert.equal(A.assignPeriod(T0, [], now), null);
});

test("assignPeriod: overlapping periods for different antennas are 'both' (not used)", () => {
  const overlap = [{ ant: "A", start: T0, end: T0 + 30 * MIN }, { ant: "B", start: T0 + 10 * MIN, end: T0 + 40 * MIN }];
  assert.equal(A.assignPeriod(T0 + 12 * MIN, overlap, now), "both");
  assert.equal(A.assignPeriod(T0 + 2 * MIN, overlap, now), "A");
  const same = [{ ant: "A", start: T0, end: T0 + 30 * MIN }, { ant: "A", start: T0 + 10 * MIN, end: T0 + 40 * MIN }];
  assert.equal(A.assignPeriod(T0 + 12 * MIN, same, now), "A");
});

test("switchTo: closes the open period, ignores a repeat press, stopLog closes", () => {
  let p = A.switchTo([], "A", T0, "x");
  assert.deepEqual(p, [{ id: "x", ant: "A", start: T0, end: null }]);
  assert.deepEqual(A.switchTo(p, "A", T0 + MIN), p);
  p = A.switchTo(p, "B", T0 + 10 * MIN, "y");
  assert.equal(p.length, 2);
  assert.equal(p[0].end, T0 + 10 * MIN);
  assert.equal(p[1].end, null);
  p = A.stopLog(p, T0 + 20 * MIN);
  assert.ok(p.every((x) => x.end != null));
});

test("checkPeriod and parseUtc: typed periods", () => {
  const s = A.parseUtc("2026-11-19T10:00"), e = A.parseUtc("2026-11-19T10:30");
  assert.equal(s, T0);
  assert.equal(A.checkPeriod("A", s, e, now), "");
  assert.match(A.checkPeriod("A", e, s, now), /after the start/);
  assert.match(A.checkPeriod("C", s, e, now), /A or B/);
  assert.match(A.checkPeriod("A", s, NaN, now), /time/);
  assert.match(A.checkPeriod("A", s, s + MIN, now), /2 minutes/);
  assert.match(A.checkPeriod("A", s, now + 3 * 3600e3, now), /future/);
  assert.ok(Number.isNaN(A.parseUtc("tomorrow")));
  assert.equal(A.fmtUtc(T0), "2026-11-19 10:00");
});

test("cleanPeriods drops malformed saved data", () => {
  const c = A.cleanPeriods([{ ant: "A", start: 1, end: 5 }, { ant: "Z", start: 1 }, { ant: "B", start: 9, end: 3 }, null, { ant: "B", start: 2, end: null }]);
  assert.equal(c.length, 2);
  assert.deepEqual(A.cleanPeriods("junk"), []);
});

test("analyse: only receivers that heard both antennas on the same band are matched; averages per receiver", () => {
  const reports = [
    rep(0, "DL1AAA", -20), rep(4, "DL1AAA", -22),       // A: mean -21
    rep(20, "DL1AAA", -15), rep(24, "DL1AAA", -17),     // B: mean -16  -> +5
    rep(2, "F5BBB", -10), rep(22, "F5BBB", -12),        // A -10, B -12 -> -2
    rep(2, "ONLYA", -5),                                // only A
    rep(22, "ONLYB", -5),                               // only B
    rep(6, "F5BBB", -8, 7), rep(26, "F5BBB", -2, 7),    // same receiver, band 7 (40 m): +6, separate band
    rep(19, "XX9", -1),                                 // straddles a swap: unassigned
    rep(60, "DL1AAA", -30),                             // A again (open period)
  ];
  const r = A.analyse(reports, periods, { now });
  const b20 = r.bands.find((b) => b.band === 14);
  assert.equal(b20.label, "20 m");
  assert.equal(b20.receivers, 2);
  // DL1AAA: A = mean(-20,-22,-30) = -24, B = -16 -> +8 ; F5BBB: -10 vs -12 -> -2 ; band mean diff = 3
  assert.equal(b20.diff, 3);
  assert.equal(b20.avgA, (-24 + -10) / 2);
  assert.equal(b20.avgB, (-16 + -12) / 2);
  const b40 = r.bands.find((b) => b.band === 7);
  assert.equal(b40.receivers, 1);
  assert.equal(b40.diff, 6);
  assert.equal(r.totals.matched, 3);
  assert.equal(r.totals.onlyA, 1);
  assert.equal(r.totals.onlyB, 1);
  assert.equal(r.totals.unassigned, 1);
  assert.equal(r.totals.reports, reports.length);
  assert.ok(r.bands.indexOf(b40) > r.bands.indexOf(b20) === false, "bands sorted from low to high frequency (40 m before 20 m)");
});

test("analyse: a busy receiver does not outweigh a quiet one (per-receiver averaging)", () => {
  const reports = [];
  for (let i = 0; i < 8; i += 2) reports.push(rep(i, "BUSY", -10));        // 4 on A
  reports.push(rep(22, "BUSY", -10));                                      // 1 on B -> diff 0
  reports.push(rep(2, "QUIET", -20), rep(22, "QUIET", -10));               // diff +10
  const r = A.analyse(reports, periods, { now });
  assert.equal(r.bands[0].receivers, 2);
  assert.equal(r.bands[0].diff, 5);
});

test("analyse: too-few-samples flag at fewer than 10 matched receivers", () => {
  const few = [rep(0, "R1", -10), rep(20, "R1", -9)];
  assert.equal(A.analyse(few, periods, { now }).tooFew, true);
  assert.equal(A.analyse(few, periods, { now }).bands[0].few, true);
  const many = [];
  for (let i = 0; i < 10; i++) many.push(rep(0, `R${i}`, -10), rep(20, `R${i}`, -9));
  const r = A.analyse(many, periods, { now });
  assert.equal(r.totals.matched, 10);
  assert.equal(r.tooFew, false);
  assert.equal(r.bands[0].few, false);
  assert.equal(r.overall, 1);
  const none = A.analyse([], periods, { now });
  assert.equal(none.tooFew, true);
  assert.equal(none.overall, null);
  assert.deepEqual(none.bands, []);
});

test("analyse: overlapping periods are counted as ambiguous, not used", () => {
  const overlap = [{ ant: "A", start: T0, end: T0 + 30 * MIN }, { ant: "B", start: T0 + 10 * MIN, end: T0 + 40 * MIN }];
  const r = A.analyse([rep(12, "R1", -5), rep(2, "R1", -5), rep(32, "R1", -4)], overlap, { now });
  assert.equal(r.totals.ambiguous, 1);
  assert.equal(r.totals.matched, 1);
});

test("sectorOf: eight 45-degree sectors centred on the compass points", () => {
  assert.equal(A.sectorOf(0), 0);
  assert.equal(A.sectorOf(22.4), 0);
  assert.equal(A.sectorOf(22.5), 1);
  assert.equal(A.sectorOf(90), 2);
  assert.equal(A.sectorOf(180), 4);
  assert.equal(A.sectorOf(270), 6);
  assert.equal(A.sectorOf(337.4), 7);
  assert.equal(A.sectorOf(337.5), 0);
  assert.equal(A.sectorOf(359.9), 0);
  assert.equal(A.sectorOf(-90), 6);
  assert.equal(A.sectorOf(450), 2);
});

test("distanceBin: under 1000, 1000 to 3000, 3000 to 8000, over 8000 km", () => {
  assert.deepEqual([0, 999, 1000, 2999, 3000, 8000, 8001, 20000].map(A.distanceBin), [0, 0, 1, 1, 2, 2, 3, 3]);
});

test("analyse: direction and distance come from your locator when known (Sheffield to New York is west, ~5400 km)", () => {
  const me = A.locToLatLon("IO93fa");
  assert.ok(me && Math.abs(me.lat - 53.4) < 0.5);
  const reports = [rep(0, "NY1", -20, 14, { az: 0, dist: 1 }), rep(20, "NY1", -10, 14, { az: 0, dist: 1 })];
  const r = A.analyse(reports, periods, { now, me });
  const w = r.sectors.find((s) => s.name === "W");
  assert.equal(w.n, 1);
  assert.equal(w.diff, 10);
  assert.equal(r.sectors.reduce((n, s) => n + s.n, 0), 1);
  assert.equal(r.distances[2].n, 1);   // 3000 to 8000 km
  // without a locator the report's own figures are used
  const r2 = A.analyse(reports, periods, { now, me: null });
  assert.equal(r2.sectors[0].n, 1);
  assert.equal(r2.distances[0].n, 1);
});

test("locToLatLon and distKm", () => {
  assert.equal(A.locToLatLon("nonsense"), null);
  assert.ok(A.locToLatLon("JN58"));
  assert.ok(Math.abs(A.distKm(0, 0, 0, 90) - 10007) < 15);
});

test("diffText: wording names the better antenna, and says 'about the same' when tiny", () => {
  assert.equal(A.diffText(2.34, "Dipole", "Vertical"), "Vertical better by 2.3 dB");
  assert.equal(A.diffText(-4, "Dipole", "Vertical"), "Dipole better by 4.0 dB");
  assert.match(A.diffText(0.3, "Dipole", "Vertical"), /about the same/);
  assert.equal(A.diffText(null, "A", "B"), "no data");
  assert.equal(A.diffText(1, "", ""), "B better by 1.0 dB");
});

test("windowOf: earliest start to latest end, at most 7 days", () => {
  assert.equal(A.windowOf([], now), null);
  const w = A.windowOf(periods, now);
  assert.deepEqual([w.from, w.to, w.clamped], [T0, now, false]);
  const long = A.windowOf([{ ant: "A", start: now - 30 * 864e5, end: now }], now);
  assert.equal(long.clamped, true);
  assert.equal(long.to - long.from, 7 * 864e5);
});

test("buildQuery: only a plain callsign gets into the question; bounded time and rows", () => {
  const url = A.buildQuery("m3vrv", T0, T0 + 3600e3);
  assert.ok(url.startsWith("https://db1.wspr.live/?query="));
  const sql = decodeURIComponent(url.split("?query=")[1]);
  assert.match(sql, /tx_sign='M3VRV'/);
  assert.match(sql, /time>='2026-11-19 10:00:00' AND time<='2026-11-19 11:00:00'/);
  assert.match(sql, /LIMIT 50000 FORMAT JSONCompact$/);
  assert.ok(A.buildQuery("EA8/G4ABC", T0, T0 + 1));
  for (const bad of ["", "x' OR 1=1 --", "G4ABC;DROP", "a b", "'"]) assert.throws(() => A.buildQuery(bad, T0, T0 + 1), /callsign/);
});

test("parseRows: reads wspr.live's JSONCompact and skips broken rows", () => {
  const json = { data: [
    ["2026-11-19 10:02:00", 14, "DL1AAA", 52.1, 13.4, -21, 900, 80],
    ["2026-11-19 10:04:00", 7, "F5BBB", 48.0, 2.0, -9, 600, 120],
    ["not a time", 14, "X", 0, 0, 1, 1, 1],
    ["2026-11-19 10:06:00", 14, "", 0, 0, 1, 1, 1],
    "junk",
  ] };
  const r = A.parseRows(json);
  assert.equal(r.length, 2);
  assert.equal(r[0].t, Date.UTC(2026, 10, 19, 10, 2));
  assert.equal(r[0].snr, -21);
  assert.equal(r[1].band, 7);
  assert.deepEqual(A.parseRows(null), []);
  assert.deepEqual(A.parseRows({}), []);
});

/* ---------- FT8 and FT4 from PSK Reporter ---------- */

const sec = (s) => T0 + s * 1000;
const psk = (s, rx, snr, mode = "FT8", fq = 14.074) => ({ ts: sec(s), c: rx, snr, m: mode, fq, lat: 40, lon: -74, g: "FN30" });

test("parseMyReports: FT8 and FT4 become reports with their own slot length; broken rows are skipped", () => {
  const r = A.parseMyReports({ reports: [
    psk(0, "K1ABC", -12, "FT8", 14.0745),
    psk(30, "K1ABC", -9, "FT4", 7.0475),
    psk(5, "JUNK", -5, "WSPR"),
    { ...psk(5, "NOSNR", 0), snr: null },
    { ...psk(5, "", -3) },
    { ...psk(5, "BADT", -3), ts: "x" },
    "junk",
  ] });
  assert.equal(r.length, 2);
  assert.deepEqual([r[0].band, r[0].slotMs, r[0].src, r[0].mode], [14, 15000, "psk", "FT8"]);
  assert.deepEqual([r[1].band, r[1].slotMs], [7, 7500]);
  assert.equal(r[0].t, sec(0));
  assert.ok(Number.isNaN(r[0].dist));
  assert.deepEqual(A.parseMyReports(null), []);
  assert.deepEqual(A.parseMyReports({}), []);
});

test("myReportsUrl: callsign checked, minutes bounded to 1..1440", () => {
  assert.equal(A.myReportsUrl("m3vrv", 120), "/api/myreports?call=M3VRV&mins=120");
  assert.equal(A.myReportsUrl("EA8/G4ABC", 99999), "/api/myreports?call=EA8%2FG4ABC&mins=1440");
  assert.equal(A.myReportsUrl("G4ABC", 0.2), "/api/myreports?call=G4ABC&mins=1");
  for (const bad of ["", "x' OR 1=1", "G4ABC&mins=1", "a b"]) assert.throws(() => A.myReportsUrl(bad), /callsign/);
});

test("assignPeriod: FT8 needs a 15 s slot inside one period, FT4 7.5 s", () => {
  const end = T0 + 20 * MIN;
  assert.equal(A.assignPeriod(end - 15000, periods, now, 15000), "A");     // ends exactly at the swap
  assert.equal(A.assignPeriod(end - 14000, periods, now, 15000), null);    // straddles it
  assert.equal(A.assignPeriod(end - 7500, periods, now, 7500), "A");
  assert.equal(A.assignPeriod(end - 7000, periods, now, 7500), null);
  assert.equal(A.assignPeriod(end - 14000, periods, now, 7500), "A", "the same time fits a shorter FT4 slot");
  assert.equal(A.assignPeriod(end - 14000, periods, now), null, "a WSPR (2 minute) slot does not");
});

test("analyse: FT8 slots are used per report, FT4 shorter than FT8, and sources are not mixed", () => {
  const end = (T0 + 20 * MIN - T0) / 1000;      // seconds from T0 to the A to B swap
  const reports = A.parseMyReports({ reports: [
    psk(100, "K1ABC", -20), psk(end - 15, "K1ABC", -22),        // A (the second ends exactly at the swap)
    psk(end, "K1ABC", -10), psk(end + 60, "K1ABC", -12),        // B
    psk(end - 10, "STRAD", -5),                                   // FT8 straddles the swap: dropped
    psk(end - 5, "STRAD", -5, "FT4"),                             // FT4 (7.5 s) straddles too: dropped
    psk(end - 7.5, "SHORT", -5, "FT4", 7.0475), psk(end + 5, "SHORT", -1, "FT4", 7.0475),   // FT4 fits A, then B
  ] });
  const wspr = [rep(0, "K1ABC", -30), rep(20, "K1ABC", -20)];             // WSPR: same receiver and band
  const r = A.analyse([...reports, ...wspr], periods, { now });
  assert.equal(r.totals.unassigned, 2);
  assert.deepEqual(r.totals.bySource, { psk: 8, wspr: 2 });
  const f20 = r.bands.find((b) => b.band === 14 && b.src === "psk");
  assert.equal(f20.srcLabel, "FT8/FT4");
  assert.equal(f20.receivers, 1);
  assert.equal(f20.avgA, -21);
  assert.equal(f20.avgB, -11);
  assert.equal(f20.diff, 10);
  const w20 = r.bands.find((b) => b.band === 14 && b.src === "wspr");
  assert.equal(w20.srcLabel, "WSPR");
  assert.equal(w20.diff, 10, "WSPR numbers stay separate from the FT8 ones for the same receiver");
  const f40 = r.bands.find((b) => b.band === 7 && b.src === "psk");
  assert.equal(f40.receivers, 1);
  assert.equal(f40.diff, 4);
  assert.equal(r.totals.matched, 3);
  assert.deepEqual(r.bands.map((b) => `${b.band}${b.src}`), ["7psk", "14psk", "14wspr"]);
});

test("analyse: reports without a source are WSPR; sourcesOf maps the switch", () => {
  const r = A.analyse([rep(0, "R1", -10), rep(20, "R1", -9)], periods, { now });
  assert.equal(r.bands[0].src, "wspr");
  assert.deepEqual(r.totals.bySource, { wspr: 2 });
  assert.deepEqual(A.sourcesOf("wspr"), ["wspr"]);
  assert.deepEqual(A.sourcesOf("psk"), ["psk"]);
  assert.deepEqual(A.sourcesOf("both"), ["wspr", "psk"]);
  assert.deepEqual(A.sourcesOf("nonsense"), ["wspr"]);
});

/* ---------- the FT8/FT4 history (PSK Reporter keeps only the latest report per receiver) ---------- */

test("mergeHistory: de-duplicated by receiver, band and time; pruned to 7 days; capped, oldest dropped", () => {
  const N = T0 + 10 * 864e5;
  const mk = (rx, t, band = 14) => ({ rx, t, band, snr: -10, slotMs: 15000, src: "psk" });
  const h1 = A.mergeHistory([], [mk("A1", N - 60000), mk("B2", N - 120000)], N);
  const h2 = A.mergeHistory(h1, [mk("A1", N - 60000), mk("A1", N - 30000), mk("A1", N - 60000, 7), mk("OLD", N - 8 * 864e5)], N);
  assert.deepEqual(h2.map((r) => `${r.rx}${r.band}@${N - r.t}`), ["B214@120000", "A114@60000", "A17@60000", "A114@30000"]);
  assert.equal(h2.some((r) => r.rx === "OLD"), false, "older than 7 days is dropped");
  assert.equal(A.receiversIn(h2), 3, "receiver and band pairs");
  const many = [];
  for (let i = 0; i < 10; i++) many.push(mk("R" + i, N - (10 - i) * 1000));
  const capped = A.mergeHistory([], many, N, { max: 4 });
  assert.deepEqual(capped.map((r) => r.rx), ["R6", "R7", "R8", "R9"], "the newest are kept");
  assert.equal(A.mergeHistory(null, null, N).length, 0);
  assert.equal(A.HISTORY_MAX, 20000);
});

test("cleanHistory: survives JSON (NaN becomes null) and drops broken rows", () => {
  const rows = A.parseMyReports({ reports: [psk(0, "K1ABC", -12), psk(5, "K1ABC", -9, "FT4", 7.04)] });
  const back = A.cleanHistory(JSON.parse(JSON.stringify(rows)));
  assert.equal(back.length, 2);
  assert.ok(Number.isNaN(back[0].dist));
  assert.equal(back[1].slotMs, 7500);
  assert.deepEqual(A.cleanHistory([null, "x", { rx: "A", t: 1, snr: null, band: 14, slotMs: 15000 }, { rx: "", t: 1, snr: 1, band: 14, slotMs: 1 }]), []);
  assert.deepEqual(A.cleanHistory("junk"), []);
});

test("collected history gives matches: the same receiver heard in a poll during A and a poll during B", () => {
  const N = T0 + 70 * MIN;
  const pollA = A.parseMyReports({ reports: [psk(300, "K1ABC", -20), psk(310, "DL1X", -15)] });         // seen during A
  const pollB = A.parseMyReports({ reports: [psk(25 * 60, "K1ABC", -10), psk(25 * 60 + 5, "F5Z", -9)] }); // seen during B
  const h = A.mergeHistory(A.mergeHistory([], pollA, N), pollB, N);
  const r = A.analyse(h, periods, { now: N });
  assert.equal(r.totals.matched, 1);
  assert.equal(r.bands[0].diff, 10);
  assert.equal(r.totals.onlyA, 1);
  assert.equal(r.totals.onlyB, 1);
});
