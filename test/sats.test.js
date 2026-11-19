"use strict";
// Satellite maths for the Satellites panel: positions, passes over a locator, Doppler and the CelesTrak fetch rule.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const S = require("../public/js/satmath.js");
const GP = require("./fixtures/sats.js");

let lib;
test.before(async () => {
  lib = await import(pathToFileURL(path.join(__dirname, "../public/js/vendor/satellite.esm.js")).href);
});

const T0 = Date.parse("2026-11-19T12:00:00Z");
const IO93 = S.observer(53.5, -1.0); // Sheffield area, as Band Watch's default locator
const rec = (id) => S.satrecFor(lib, GP.find((g) => g.NORAD_CAT_ID === id));

test("each orbit from CelesTrak's JSON turns into a satrec; a broken one is null", () => {
  for (const g of GP) assert.ok(S.satrecFor(lib, g), g.OBJECT_NAME);
  assert.equal(S.satrecFor(lib, { OBJECT_NAME: "junk" }), null);
});

test("the ISS is where the ISS should be: about 420 km up, never further than 51.6° from the equator", () => {
  const iss = rec(25544);
  for (let t = T0; t < T0 + 3 * 3600e3; t += 5 * 60e3) {
    const l = S.look(lib, iss, new Date(t), IO93);
    assert.ok(l.height > 390 && l.height < 450, `height ${l.height}`);
    assert.ok(Math.abs(l.lat) <= 51.8, `lat ${l.lat}`);
    assert.ok(l.lon >= -180 && l.lon <= 180, `lon ${l.lon}`);
    assert.ok(l.az >= 0 && l.az < 360);
    assert.ok(l.el >= -90 && l.el <= 90);
  }
});

test("passes over IO93: rise, top and set in order, horizon to horizon, sensible lengths", () => {
  for (const [id, maxMin] of [[25544, 12], [27607, 17], [44909, 25]]) {
    const r = rec(id);
    const ps = S.passes(lib, r, IO93, T0, 24, 0);
    assert.ok(ps.length >= 3, `${id}: ${ps.length} passes`);
    let last = 0;
    for (const p of ps) {
      assert.ok(p.aos < p.tca && p.tca < p.los, `${id} order`);
      assert.ok(p.aos >= last, `${id} sorted, not overlapping`);
      last = p.los;
      assert.ok(Math.abs(S.elevation(lib, r, p.aos, IO93)) < 0.2, `${id} rises at the horizon`);
      assert.ok(Math.abs(S.elevation(lib, r, p.los, IO93)) < 0.2, `${id} sets at the horizon`);
      assert.ok(p.maxEl > 0 && p.maxEl <= 90);
      // The top of the pass really is the top.
      assert.ok(S.elevation(lib, r, p.tca - 20e3, IO93) <= p.maxEl + 1e-6);
      assert.ok(S.elevation(lib, r, p.tca + 20e3, IO93) <= p.maxEl + 1e-6);
      assert.ok((p.los - p.aos) / 60e3 < maxMin, `${id} pass of ${(p.los - p.aos) / 60e3} min`);
      assert.ok(p.aosAz >= 0 && p.aosAz < 360 && p.losAz >= 0 && p.losAz < 360);
    }
  }
});

test("passes: the lowest-elevation filter and a pass already under way", () => {
  const iss = rec(25544);
  const all = S.passes(lib, iss, IO93, T0, 24, 0);
  const high = S.passes(lib, iss, IO93, T0, 24, 30);
  assert.ok(high.length < all.length);
  assert.ok(high.every((p) => p.maxEl >= 30));
  const p = all[0];
  const mid = S.passes(lib, iss, IO93, p.tca, 2, 0)[0];
  assert.equal(mid.upAtStart, true);
  assert.equal(mid.aos, p.tca);
  assert.ok(Math.abs(mid.los - p.los) <= 2000);
});

test("Doppler: up to about 3.5 kHz on 2 m from the ISS, higher while it comes towards you, none at the top", () => {
  const iss = rec(25544);
  const p = S.passes(lib, iss, IO93, T0, 24, 40)[0];
  assert.ok(p, "a high ISS pass in the next day");
  const rising = S.rangeRate(lib, iss, p.aos + 30e3, IO93);
  const setting = S.rangeRate(lib, iss, p.los - 30e3, IO93);
  const top = S.rangeRate(lib, iss, p.tca, IO93);
  assert.ok(rising < -4 && rising > -8, `rising ${rising} km/s`);
  assert.ok(setting > 4 && setting < 8, `setting ${setting} km/s`);
  assert.ok(Math.abs(top) < 0.6, `top ${top} km/s`);
  const hearUp = S.dopplerDown(145.8, rising), hearDown = S.dopplerDown(145.8, setting);
  assert.ok(hearUp > 145.8 && hearUp - 145.8 < 0.004, `rising ${hearUp}`);
  assert.ok(hearDown < 145.8 && 145.8 - hearDown < 0.004, `setting ${hearDown}`);
  // Uplink goes the other way: send lower while it comes towards you.
  assert.ok(S.dopplerUp(145.2, rising) < 145.2);
  assert.ok(Math.abs(S.dopplerDown(436.795, 0) - 436.795) < 1e-12);
});

test("CelesTrak rule: ask at most once every 2 hours, and wait 2 hours after a refusal", () => {
  const now = T0;
  assert.equal(S.shouldFetch(null, 0, now), true);
  assert.equal(S.shouldFetch({ at: now - 10 * 60e3, data: [{}] }, 0, now), false);
  assert.equal(S.shouldFetch({ at: now - 2 * 3600e3, data: [{}] }, 0, now), true);
  assert.equal(S.shouldFetch({ at: now - 3 * 3600e3, data: [] }, 0, now), true);
  assert.equal(S.shouldFetch(null, now - 30 * 60e3, now), false);
  assert.equal(S.shouldFetch({ at: now - 5 * 3600e3, data: [{}] }, now - 119 * 60e3, now), false);
  assert.equal(S.shouldFetch(null, now - 121 * 60e3, now), true);
});

test("orbit facts: the ISS laps in about 92 minutes about 420 km up, tilted 51.6°, launched 1998", () => {
  const o = S.orbitInfo(GP[0]);
  assert.ok(o.periodMin > 91 && o.periodMin < 94, `period ${o.periodMin}`);
  assert.ok(o.perigeeKm > 390 && o.apogeeKm < 450 && o.perigeeKm <= o.apogeeKm, `${o.perigeeKm}-${o.apogeeKm}`);
  assert.equal(o.inclination, 51.6318);
  assert.equal(o.launched, 1998);
  assert.equal(o.epoch, Date.parse("2026-11-19T04:55:07.676Z"));
  // RS-44 is much higher (about 1,100 to 1,500 km) and slower
  const r = S.orbitInfo(GP[2]);
  assert.ok(r.periodMin > 110 && r.periodMin < 115, `RS-44 period ${r.periodMin}`);
  assert.ok(r.perigeeKm > 1000 && r.apogeeKm < 1700, `RS-44 ${r.perigeeKm}-${r.apogeeKm}`);
  assert.equal(S.orbitInfo({ MEAN_MOTION: 0 }), null);
});

test("reach: from 420 km up a satellite sees about 2,250 km around the point below it", () => {
  const f = S.footprintKm(420);
  assert.ok(f > 2200 && f < 2300, `footprint ${f}`);
  assert.ok(S.footprintKm(1300) > f);
  assert.equal(S.footprintKm(0), 0);
});

test("sky chart: the track runs horizon to horizon; overhead is the middle, north is up, east is right", () => {
  const iss = rec(25544);
  const p = S.passes(lib, iss, IO93, T0, 24, 30)[0];
  const tr = S.skyTrack(lib, iss, IO93, p.aos, p.los, 15e3);
  assert.equal(tr[0].t, p.aos);
  assert.equal(tr[tr.length - 1].t, p.los);
  assert.ok(Math.abs(tr[0].el) < 0.3 && Math.abs(tr[tr.length - 1].el) < 0.3);
  assert.ok(Math.max(...tr.map((x) => x.el)) <= p.maxEl + 0.01);
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  let q = S.skyXY(0, 90, 100); assert.ok(near(q.x, 0) && near(q.y, 0));
  q = S.skyXY(0, 0, 100); assert.ok(near(q.x, 0) && near(q.y, -100));
  q = S.skyXY(90, 0, 100); assert.ok(near(q.x, 100) && near(q.y, 0));
  q = S.skyXY(180, 45, 100); assert.ok(near(q.x, 0) && near(q.y, 50));
  q = S.skyXY(270, -5, 100); assert.ok(near(q.x, -100));
});

test("look also gives the speed: the ISS does about 7.7 km/s", () => {
  const l = S.look(lib, rec(25544), new Date(T0), IO93);
  assert.ok(l.speed > 7.5 && l.speed < 7.8, `speed ${l.speed}`);
});

test("compass points", () => {
  assert.equal(S.compass(0), "N");
  assert.equal(S.compass(359), "N");
  assert.equal(S.compass(45), "NE");
  assert.equal(S.compass(180), "S");
  assert.equal(S.compass(292), "WNW");
});
