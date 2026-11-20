"use strict";
const test = require("node:test");
const assert = require("node:assert");
const W = require("../public/js/dcwording.js");

test("text box modes are CW and RTTY only", () => {
  assert.ok(W.isText("CW") && W.isText("RTTY"));
  for (const m of ["FT8", "FT4", "WSPR", "SSTV", "APRS", undefined]) assert.ok(!W.isText(m));
});

test("mic start wording: cycle wording only for FT8, FT4 and WSPR", () => {
  for (const m of ["FT8", "FT4", "WSPR"]) assert.match(W.micStart(m), /next cycle/);
  for (const m of ["CW", "RTTY", "SSTV", "APRS"]) assert.doesNotMatch(W.micStart(m), /cycle/);
  assert.match(W.micStart("CW"), /^Listening/);
  assert.match(W.micStart("RTTY"), /^Listening/);
  assert.match(W.micStart("SSTV"), /picture/);
  assert.match(W.micStart("APRS"), /packet/);
});
