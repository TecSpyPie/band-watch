"use strict";
// APRS: packets made into AFSK audio (with noise, and with the 2200 Hz tone turned down as FM radios do) are decoded
// back, and the reports inside (positions plain, compressed and Mic-E, weather, status, messages) read correctly.
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../public/js/aprs.js");

function hear(frames, { noise = 0.05, tilt = 1 } = {}) {
  const parts = frames.map((f) => A.encode(f));
  let n = A.FS; for (const p of parts) n += p.length + A.FS / 4;
  const all = new Float32Array(n);
  let at = A.FS / 2;
  for (const p of parts) { all.set(p, at); at += p.length + A.FS / 4; }
  // tilt: make 2200 Hz quieter (a crude de-emphasis) by mixing in a smoothed copy
  if (tilt < 1) { let y = 0; for (let i = 0; i < all.length; i++) { y += (all[i] - y) * 0.45; all[i] = all[i] * tilt + y * (1 - tilt); } }
  let seed = 4;
  for (let i = 0; i < all.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; all[i] += noise * (seed / 0x7fffffff - 0.5); }
  const got = [];
  const d = new A.Demod((b) => got.push(A.parse(b)));
  for (let i = 0; i < all.length; i += 600) d.push(all.subarray(i, i + 600));
  return got;
}

test("frame check (CRC-16 X.25): the standard check value", () => {
  assert.equal(A.crc([..."123456789"].map((c) => c.charCodeAt(0))), 0x906e);
});

test("a position report is heard and read: call, path, place, symbol, comment", () => {
  const f = A.frame("M3VRV-9", "APRS", ["WIDE1-1", "WIDE2-1"], "!5330.00N/00130.00W>Band Watch test");
  const [p] = hear([f]);
  assert.ok(p, "decoded");
  assert.equal(p.from, "M3VRV-9");
  assert.equal(p.to, "APRS");
  assert.deepEqual(p.path, ["WIDE1-1", "WIDE2-1"]);
  assert.equal(p.type, "position");
  assert.ok(Math.abs(p.lat - 53.5) < 1e-6 && Math.abs(p.lon + 1.5) < 1e-6, `${p.lat},${p.lon}`);
  assert.equal(p.symbol, "/>");
  assert.equal(p.comment, "Band Watch test");
});

test("several packets in a row, through an FM radio's tilt and some noise", () => {
  const frames = [
    A.frame("G4ABC", "APRS", ["WIDE2-2"], "=5300.00N/00100.00W-Home QTH"),
    A.frame("G7XYZ-7", "APRS", [], ">On the air from Band Watch"),
    A.frame("MB7UFO", "APRS", ["WIDE2-1"], "!5200.00N/00200.00W#Digipeater"),
  ];
  const got = hear(frames, { noise: 0.08, tilt: 0.6 });
  assert.deepEqual(got.map((g) => g.from), ["G4ABC", "G7XYZ-7", "MB7UFO"]);
  assert.equal(got[1].type, "status");
  assert.equal(got[1].status, "On the air from Band Watch");
});

test("course, speed and altitude", () => {
  const r = A.report("!5330.00N/00130.00W>090/030/A=001000 mobile", "APRS");
  assert.equal(r.course, 90);
  assert.equal(r.speedKmh, 56);
  assert.equal(r.altM, 305);
  assert.equal(r.comment, "mobile");
});

test("compressed position (the APRS spec's example)", () => {
  const r = A.report("!/5L!!<*e7>7P[", "APRS");
  assert.ok(Math.abs(r.lat - 49.5) < 0.01 && Math.abs(r.lon + 72.75) < 0.01, `${r.lat},${r.lon}`);
  assert.equal(r.symbol, "/>");
  assert.equal(r.course, 88);
});

test("Mic-E (most car and hand-held radios), built by the spec's rules", () => {
  // 53°30.00' N 1°30.00' W. Destination: digits 5 3 3 0 0 0; 4th char P..Y = north, 5th P..Y = longitude +100
  // (needed for 0-9°), 6th P..Y = west. Info: degrees 1 -> 1+118, minutes 30 -> 30+28, hundredths 0 -> 0+28,
  // speed/course 0, then symbol code ">" and table "/".
  const c = (n) => String.fromCharCode(n);
  const info = "`" + c(119) + c(58) + c(28) + c(28) + c(28) + c(28) + ">/ mobile";
  const r = A.report(info, "533PPP");
  assert.equal(r.type, "position");
  assert.ok(Math.abs(r.lat - 53.5) < 1e-6, `lat ${r.lat}`);
  assert.ok(Math.abs(r.lon + 1.5) < 1e-6, `lon ${r.lon}`);
  assert.equal(r.symbol, "/>");
  assert.equal(r.comment, "mobile");
  // and 112°07.74' W: degrees 112 -> 112-72 = 40 with the +100 flag
  const r2 = A.report("`" + c(40) + c(7 + 28) + c(74 + 28) + c(28) + c(28) + c(28) + ">/", "533PPP");
  assert.ok(Math.abs(r2.lon + (112 + 7.74 / 60)) < 1e-6, `lon ${r2.lon}`);
});

test("weather station", () => {
  const r = A.report("!5330.00N/00130.00W_220/004g005t077r000p000P000h50b09900", "APRS");
  assert.equal(r.type, "weather");
  assert.equal(r.wx.windDir, 220);
  assert.equal(r.wx.tempC, 25);
  assert.equal(r.wx.humidity, 50);
  assert.equal(r.wx.pressureHpa, 990);
});

test("a message, and noise alone hears nothing", () => {
  const m = A.report(":M3VRV    :Hello from the ISS{12", "APRS");
  assert.deepEqual([m.type, m.to, m.msg, m.id], ["message", "M3VRV", "Hello from the ISS", "12"]);
  assert.deepEqual(hear([], { noise: 0.3 }), []);
});
