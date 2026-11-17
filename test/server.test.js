"use strict";
// Unit tests for server.js's parsing helpers. The HTTP API is tested in api.test.js, against both servers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parsePskXml, locatorToLatLon, latestByTime, summariseSun } = require("../server.js");

const nowSec = () => Math.floor(Date.now() / 1000);
const report = (o) =>
  `<receptionReport ${Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(" ")} />`;

const FLUX = [{ time_tag: "2026-11-16T20:00:00", flux: 120 }, { time_tag: "2026-11-16T17:00:00", flux: 999 }];
const PSK = `<receptionReports>
  ${report({ receiverCallsign: "K1ABC", receiverLocator: "FN42aa", senderCallsign: "G4XYZ", senderLocator: "IO93fa", frequency: 14074500, flowStartSeconds: nowSec() - 60, mode: "FT8", sNR: -12 })}
  ${report({ receiverCallsign: "G0AAA", receiverLocator: "IO93ab", senderCallsign: "JA1ZZZ", senderLocator: "PM95", frequency: 21075000, flowStartSeconds: nowSec() - 300, mode: "FT8", sNR: "" })}
</receptionReports>`;

/* ---------- Pure functions ---------- */

test("locatorToLatLon handles 4, 6 and 8 character locators", () => {
  assert.deepEqual(locatorToLatLon("IO93"), { lat: 53.5, lon: -1 });
  const six = locatorToLatLon("io93fa");
  assert.ok(Math.abs(six.lat - 53.021) < 0.01 && Math.abs(six.lon - -1.542) < 0.01, JSON.stringify(six));
  assert.deepEqual(locatorToLatLon("IO93fa12"), six);
  assert.deepEqual(locatorToLatLon("IO93f"), { lat: 53.5, lon: -1 });
  assert.equal(locatorToLatLon(""), null);
  assert.equal(locatorToLatLon("ZZ99"), null);
  assert.equal(locatorToLatLon(undefined), null);
});

test("latestByTime picks the newest valid record regardless of order", () => {
  assert.equal(latestByTime(FLUX, "flux").flux, 120);
  assert.equal(latestByTime([{ time_tag: "b", flux: null }, { time_tag: "a", flux: 5 }], "flux").flux, 5);
  assert.equal(latestByTime([], "flux"), null);
  assert.equal(latestByTime(null, "flux"), null);
});

test("parsePskXml finds the far end of each path and its direction", () => {
  const spots = parsePskXml(PSK, "IO93");
  assert.equal(spots.length, 2);
  const k1 = spots.find((s) => s.c === "K1ABC");
  assert.equal(k1.dir, "hears your grid");
  assert.equal(k1.l, "G4XYZ", "local station is the sender in our grid");
  assert.equal(k1.g, "FN42aa", "remote locator is kept, up to 6 characters");
  assert.equal(spots.find((s) => s.c === "JA1ZZZ").l, "G0AAA", "local station is the receiver in our grid");
  assert.equal(k1.fq, 14.0745);
  assert.equal(k1.snr, -12);
  const ja = spots.find((s) => s.c === "JA1ZZZ");
  assert.equal(ja.dir, "heard in your grid");
  assert.equal(ja.snr, null, "an empty sNR becomes null, not 0");
  assert.deepEqual([ja.lat, ja.lon], [35.5, 139]);
});

test("parsePskXml keeps only the newest report per path per MHz", () => {
  const t = nowSec();
  const xml = [
    report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G1", receiverLocator: "IO93", frequency: 7074000, flowStartSeconds: t - 600, mode: "FT8", sNR: -20 }),
    report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G2", receiverLocator: "IO93", frequency: 7074300, flowStartSeconds: t - 30, mode: "FT8", sNR: -3 }),
    report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G2", receiverLocator: "IO93", frequency: 14074000, flowStartSeconds: t - 30, mode: "FT8", sNR: -9 }),
  ].join("");
  const spots = parsePskXml(xml, "IO93");
  assert.equal(spots.length, 3, "G1 and G2 hearing DL1A on 40 m are separate paths");
  assert.deepEqual(spots.filter((s) => s.fq < 8).map((s) => s.l).sort(), ["G1", "G2"]);
  assert.equal(spots.find((s) => s.l === "G2" && s.fq < 8).snr, -3);

  const again = xml + report({ senderCallsign: "DL1A", senderLocator: "JO62", receiverCallsign: "G2", receiverLocator: "IO93", frequency: 7075000, flowStartSeconds: t - 300, mode: "FT8", sNR: -1 });
  assert.equal(parsePskXml(again, "IO93").find((s) => s.l === "G2" && s.fq < 8).snr, -3, "older report on the same path is dropped");
});

test("parsePskXml decodes XML entities and skips unusable rows", () => {
  const t = nowSec();
  const xml = [
    report({ senderCallsign: "AB&amp;C", senderLocator: "FN42", receiverLocator: "IO93", frequency: 14074000, flowStartSeconds: t, mode: "FT8" }),
    report({ senderCallsign: "NOLOC", senderLocator: "", receiverLocator: "IO93", frequency: 14074000, flowStartSeconds: t }),
    report({ senderCallsign: "NOFREQ", senderLocator: "FN42", receiverLocator: "IO93", frequency: "", flowStartSeconds: t }),
    report({ senderCallsign: "NOTIME", senderLocator: "FN42", receiverLocator: "IO93", frequency: 14074000 }),
  ].join("");
  const spots = parsePskXml(xml, "IO93");
  assert.deepEqual(spots.map((s) => s.c), ["AB&C"]);
});

test("summariseSun keeps the latest day's regions, biggest first, and tolerates missing extras", () => {
  const regions = [
    { observed_date: "2026-11-15", region: 1, latitude: 5, longitude: 5, area: 900 },
    { observed_date: "2026-11-16", region: 4577, latitude: -6, longitude: -27, location: "S06W27", area: 20, number_spots: 2, spot_class: "Cso", mag_class: "B", c_xray_events: 1, c_flare_probability: 15, m_flare_probability: 1, x_flare_probability: 1 },
    { observed_date: "2026-11-16", region: 4579, latitude: 15, longitude: 45, location: "N15E45", area: 170, number_spots: 1 },
    { observed_date: "2026-11-16", region: 4570, latitude: null, longitude: -90 },
  ];
  const sun = summariseSun({ regions, ssn: [{ Obsdate: "2026-11-15T00:00:00", swpc_ssn: 88 }, { Obsdate: "2026-11-14T00:00:00", swpc_ssn: 70 }] });
  assert.equal(sun.date, "2026-11-16");
  assert.deepEqual(sun.regions.map((r) => r.region), [4579, 4577]);
  assert.deepEqual(sun.regions[1].flares, { c: 1, m: 0, x: 0 });
  assert.equal(sun.regions[1].prob.c, 15);
  assert.equal(sun.ssn, 88);
  assert.equal(sun.ssnDate, "2026-11-15");
  assert.equal(sun.xray, null);
  assert.equal(sun.wind, null);
  assert.throws(() => summariseSun({ regions: [] }));
});
