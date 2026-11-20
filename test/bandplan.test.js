"use strict";
// UK band plan: the 2 m and 70 cm segments.
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../public/js/bandplan.js");

for (const [band, lo, hi] of [["2", 144000, 146000], ["70", 430000, 440000]]) {
  test(`${band}: segments are contiguous, in range, with known types`, () => {
    const p = B.BANDPLAN[band];
    assert.equal(p.lo, lo); assert.equal(p.hi, hi);
    assert.equal(p.segs[0][0], lo); assert.equal(p.segs[p.segs.length - 1][1], hi);
    p.segs.forEach((s, i) => {
      assert.ok(s[1] > s[0], `segment ${i}`);
      if (i) assert.equal(s[0], p.segs[i - 1][1], `gap before segment ${i}`);
      assert.ok(B.PLAN_TYPES[s[2]], s[2]);
      assert.ok(s[4].length > 3);
    });
    p.centres.forEach(([k]) => assert.ok(k >= lo && k <= hi));
    assert.ok(B.PLAN_BANDS.includes(band));
  });
}

test("band-plan lookup for the usual channels", () => {
  const at = (k) => B.planSegment(k);
  assert.equal(at(144174).band, "2");
  assert.equal(at(144174).type, "all");
  assert.equal(at(144050).type, "cw");
  assert.equal(at(144800).type, "digi");
  assert.match(at(144800).use, /APRS/);
  assert.equal(at(145500).type, "fm");
  assert.match(at(145500).use, /calling 145,500/);
  assert.equal(at(145000).type, "rptin");
  assert.equal(at(145600).type, "rptout");
  assert.equal(at(145800).type, "sat");
  assert.equal(at(145900).type, "sat");
  assert.equal(at(433500).band, "70");
  assert.equal(at(433500).type, "fm");
  assert.equal(at(433000).type, "rptout");
  assert.equal(at(434600).type, "rptin");
  assert.equal(at(432174).type, "all");
  assert.equal(at(433800).type, "digi");
  assert.equal(at(437000).type, "sat");
  assert.equal(at(438612.5).type, "dv");
  assert.equal(at(7074).band, "40");
});

test("listening mode: FM for repeaters, simplex and APRS; CW and USB elsewhere", () => {
  assert.equal(B.modeForFreq(145600), "fm");
  assert.equal(B.modeForFreq(145500), "fm");
  assert.equal(B.modeForFreq(144800), "fm");
  assert.equal(B.modeForFreq(433500), "fm");
  assert.equal(B.modeForFreq(144050), "cw");
  assert.equal(B.modeForFreq(144300), "usb");
  assert.equal(B.modeForFreq(432174), "usb");
});

test("band names", () => {
  assert.equal(B.bandName("20"), "20 m");
  assert.equal(B.bandName("2"), "2 m");
  assert.equal(B.bandName("70"), "70 cm");
});
