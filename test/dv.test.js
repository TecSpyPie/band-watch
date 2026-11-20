"use strict";
// Digital voice add-on: the C4FM command for a Yaesu radio, and the hotspot address.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../public/js/dv.js");

test("C4FM: frequency then mode MD0E, nothing else; only on 2 m and 70 cm", () => {
  assert.equal(D.c4fmCommand(145.375), "FA145375000;MD0E;");
  assert.equal(D.c4fmCommand(438.6125), "FA438612500;MD0E;");
  assert.equal(D.c4fmCommand("144.0"), "FA144000000;MD0E;");
  for (const bad of [7.074, 50.5, 143.999, 146.001, 429.99, 440.01, 1296, NaN, "", "abc", -145]) assert.equal(D.c4fmCommand(bad), "", String(bad));
  for (const c of D.CHANNELS) {
    const cmd = D.c4fmCommand(c.mhz);
    assert.match(cmd, /^FA\d{9};MD0E;$/, c.name);
    assert.doesNotMatch(cmd, /TX|PC|MX/, "never transmit, power or MOX");
  }
});

test("hotspot dashboard address: plain http(s) only, tidied", () => {
  assert.equal(D.hotspotUrl("http://pi-star.local/"), "http://pi-star.local/");
  assert.equal(D.hotspotUrl("pi-star.local"), "http://pi-star.local/");
  assert.equal(D.hotspotUrl(" 192.168.1.50 "), "http://192.168.1.50/");
  assert.equal(D.hotspotUrl("https://wpsd.local/admin/"), "https://wpsd.local/admin/");
  assert.equal(D.hotspotUrl(""), "");
  for (const bad of ["javascript:alert(1)", "ftp://x", "http://user:pass@pi-star.local/", "http://"]) assert.equal(D.hotspotUrl(bad), "", bad);
});
