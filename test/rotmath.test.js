"use strict";
// Rotator: beam headings and the controllers' commands and answers.
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../public/js/rotmath.js");

const near = (a, b, tol = 1.5) => Math.abs(((a - b + 540) % 360) - 180) <= tol;

test("beam headings from Sheffield (IO93): New York, Tokyo, Sydney, Cape Town; long path is the other way", () => {
  const me = [53.4, -1.5];
  assert.ok(near(R.bearing(...me, 40.7, -74.0), 286), `NY ${R.bearing(...me, 40.7, -74.0)}`);
  assert.ok(near(R.bearing(...me, 35.7, 139.7), 31), `Tokyo ${R.bearing(...me, 35.7, 139.7)}`);
  assert.ok(near(R.bearing(...me, -33.9, 151.2), 56), `Sydney ${R.bearing(...me, -33.9, 151.2)}`);
  assert.ok(near(R.bearing(...me, -33.9, 18.4), 164), `Cape Town ${R.bearing(...me, -33.9, 18.4)}`);
  assert.ok(near(R.bearing(...me, 40.7, -74.0, true), 106), "New York long path");
  assert.ok(near(R.bearing(0, 0, 10, 0), 0) && near(R.bearing(0, 0, 0, 10), 90) && near(R.bearing(0, 0, -10, 0), 180) && near(R.bearing(0, 0, 0, -10), 270));
});

test("Yaesu GS-232A: turn, stop, ask, and its answers", () => {
  const p = R.PROTOCOLS.gs232a;
  assert.equal(p.goto(45), "M045\r");
  assert.equal(p.goto(359.6), "M000\r");
  assert.equal(p.goto(-10), "M350\r");
  assert.equal(p.stop(), "S\r");
  assert.equal(p.ask(), "C\r");
  assert.deepEqual(p.read("+0123\r\n"), { az: 123 });
  assert.deepEqual(p.read("AZ=045"), { az: 45 });
  assert.equal(p.read("?>"), null);
});

test("Yaesu GS-232B: azimuth and elevation together", () => {
  const p = R.PROTOCOLS.gs232b;
  assert.equal(p.goto(270, 30), "W270 030\r");
  assert.equal(p.goto(270, 120), "W270 090\r", "elevation kept to 0-90");
  assert.equal(p.goto(270), "M270\r");
  assert.equal(p.ask(), "C2\r");
  assert.deepEqual(p.read("AZ=270  EL=030\r"), { az: 270, el: 30 });
  assert.deepEqual(p.read("+0270+0030"), { az: 270, el: 30 });
});

test("EasyComm II and Hy-Gain DCU-1", () => {
  const e = R.PROTOCOLS.easycomm;
  assert.equal(e.goto(123.4, 45.6), "AZ123.0 EL46.0\n");
  assert.equal(e.goto(10), "AZ10.0\n");
  assert.deepEqual(e.read("AZ123.0 EL45.0"), { az: 123, el: 45 });
  const d = R.PROTOCOLS.dcu1;
  assert.equal(d.goto(90), "AP1090;AM1;");
  assert.equal(d.ask(), "AI1;");
  assert.deepEqual(d.read(";090"), { az: 90 });
});

test("the shortest way round, and compass points", () => {
  assert.equal(R.turn(350, 10), 20);
  assert.equal(R.turn(10, 350), -20);
  assert.equal(R.turn(0, 180), -180);
  assert.equal(R.compass(289), "WNW");
  assert.equal(R.compass(32), "NNE");
});
