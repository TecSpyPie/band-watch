"use strict";
// My repeaters: validation, locator distance, CSV import. All rows here are made up (no third-party data).
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../public/js/repeaters.js");

test("bands: only UK 2 m and 70 cm", () => {
  assert.equal(R.bandOf(145.6), "2 m");
  assert.equal(R.bandOf(144), "2 m");
  assert.equal(R.bandOf(433.5), "70 cm");
  for (const bad of [143.99, 146.01, 429.9, 440.1, 28.4, 1296, NaN, "x"]) assert.equal(R.bandOf(bad), "", String(bad));
});

test("validate: good repeater is tidied; bad ones say why", () => {
  const v = R.validate({ call: " gb3xx ", out: "145.6", offset: "-0.6", ctcss: "82.5", mode: "fm", loc: "io93fa", town: "Testville" });
  assert.equal(v.ok, true);
  assert.deepEqual([v.clean.call, v.clean.out, v.clean.offset, v.clean.ctcss, v.clean.mode, v.clean.loc], ["GB3XX", 145.6, -0.6, 82.5, "FM", "IO93fa"]);
  assert.equal(R.inputOf(v.clean), 145);
  assert.equal(R.validate({ call: "GB3XX", out: 28.4 }).ok, false);
  assert.match(R.validate({ call: "GB3XX", out: 146.5 }).errors[0], /2 m.*70 cm/);
  assert.equal(R.validate({ call: "", out: 145.6 }).ok, false);
  assert.equal(R.validate({ call: "GB3XX", out: "" }).ok, false);
  assert.equal(R.validate({ call: "GB3XX", out: 145.6, ctcss: "83" }).ok, false, "not a standard tone");
  assert.equal(R.validate({ call: "GB3XX", out: 145.6, mode: "SSB" }).ok, false);
  assert.equal(R.validate({ call: "GB3XX", out: 145.6, loc: "ZZ99" }).ok, false);
  assert.equal(R.validate({ call: "GB3XX", out: 145.9, offset: 0.6 }).ok, false, "input must stay in the band");
  assert.equal(R.validate({ call: "GB3XX", out: 433.0, offset: 1.6 }).ok, true);
  assert.equal(R.validate({ call: "GB3XX", out: 145.6, offset: 50 }).ok, false);
});

test("distance, bearing and nearest-first sort", () => {
  const home = R.locatorPos("IO93fa");
  assert.ok(home && Math.abs(home.lat - 53.02) < 0.05);
  const d = R.distBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
  assert.equal(d.bearing, 90);
  assert.ok(Math.abs(d.km - 111) <= 1);
  assert.equal(R.compass(0), "N");
  assert.equal(R.compass(350), "N");
  assert.equal(R.compass(135), "SE");
  const list = [
    { call: "FAR", out: 145.6, loc: "JO01" },
    { call: "NONE", out: 145.6, loc: "" },
    { call: "NEAR", out: 145.6, loc: "IO93" },
    { call: "ALSO", out: 145.7, loc: "" },
  ];
  const s = R.sortNearest(list, home);
  assert.deepEqual(s.map((r) => r.call), ["NEAR", "FAR", "ALSO", "NONE"]);
  assert.ok(s[0].km < s[1].km && s[2].km === null);
  assert.equal(list[0].call, "FAR", "input not changed");
  assert.deepEqual(R.sortNearest(list, null).map((r) => r.km), [null, null, null, null]);
});

test("CSV: quotes, delimiters, BOM", () => {
  assert.deepEqual(R.parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n').rows, [["a", "b"], ["x, y", 'say "hi"']]);
  const semi = R.parseCsv("a;b\n1,5;2\n");
  assert.equal(semi.delimiter, ";");
  assert.deepEqual(semi.rows[1], ["1,5", "2"]);
  assert.equal(R.parseCsv("a\tb\n1\t2").delimiter, "\t");
});

test("columns are matched flexibly; each used once", () => {
  const m = R.matchColumns(["Callsign", "Output (MHz)", "Input", "CTCSS Tone", "Mode", "Locator", "Town", "Notes"]);
  assert.deepEqual(m, { call: 0, out: 1, inp: 2, ctcss: 3, mode: 4, loc: 5, town: 6, notes: 7 });
  const m2 = R.matchColumns(["Repeater", "TX Freq", "RX Freq", "Shift", "Grid", "City"]);
  assert.equal(m2.call, 0); assert.equal(m2.out, 1); assert.equal(m2.inp, 2); assert.equal(m2.offset, 3); assert.equal(m2.loc, 4); assert.equal(m2.town, 5);
});

test("frequency and shift cells", () => {
  assert.equal(R.parseMhz("145.600"), 145.6);
  assert.equal(R.parseMhz("145,6", true), 145.6);
  assert.equal(R.parseMhz("433.5 MHz"), 433.5);
  assert.equal(R.parseMhz("145600"), 145.6, "kHz");
  assert.equal(R.parseMhz("145600000"), 145.6, "Hz");
  assert.ok(Number.isNaN(R.parseMhz("abc")));
  assert.equal(R.parseShift("-0.6"), -0.6);
  assert.equal(R.parseShift("1.6"), 1.6);
  assert.equal(R.parseShift("600", "-"), -0.6);
  assert.equal(R.parseShift("-600 kHz"), -0.6);
  assert.equal(R.parseShift("0.6", "-"), -0.6);
  assert.equal(R.parseShift("", ""), 0);
});

test("import: made-up rows, with output/input, skipped rows and duplicates", () => {
  const csv = [
    "Callsign,Output,Input,CTCSS,Mode,Locator,Town",
    "GB3AA,145.6,145.0,82.5,FM,IO93fa,Anytown",
    "GB3BB,433.0,434.6,,DMR,IO91,Otherplace",
    "GB3CC,28.4,28.5,,FM,,Out of band",
    ",145.7,145.1,,FM,,No call",
    "GB3DD,145.7,145.1,83,Fusion,,Odd tone",
    "GB3EE,abc,,,FM,,No freq",
  ].join("\n");
  const r = R.importCsv(csv);
  assert.equal(r.error, "");
  assert.deepEqual(r.repeaters.map((x) => x.call), ["GB3AA", "GB3BB", "GB3DD"]);
  assert.equal(r.repeaters[0].offset, -0.6);
  assert.equal(r.repeaters[1].offset, 1.6);
  assert.equal(r.repeaters[1].mode, "DMR");
  assert.equal(r.repeaters[2].mode, "C4FM");
  assert.equal(r.repeaters[2].ctcss, "", "odd tone dropped, repeater kept");
  assert.ok(r.repeaters.every((x) => x.imported));
  assert.equal(r.skipped.length, 3);
  assert.match(r.skipped[0].reason, /2 m.*70 cm/);
  const again = R.mergeNew([{ call: "gb3aa", out: 145.6 }], r.repeaters);
  assert.equal(again.dupes.length, 1);
  assert.equal(again.add.length, 2);
});

test("import: shift column with duplex sign, semicolons, bad files", () => {
  const r = R.importCsv("Name;Call;Frequency;Duplex;Offset;rToneFreq\nx;GB3ZZ;145,725;-;0,6;118,8\n");
  assert.equal(r.error, "");
  assert.deepEqual([r.repeaters[0].out, r.repeaters[0].offset, r.repeaters[0].ctcss], [145.725, -0.6, 118.8]);
  assert.match(R.importCsv("").error, /rows/);
  assert.match(R.importCsv("Callsign,Town\nGB3AA,x\n").error, /frequency column/);
  assert.match(R.importCsv("x".repeat(R.MAX_FILE_BYTES + 1)).error, /too big/);
});

test("Tune: receive only, output frequency in FM, nothing else", () => {
  assert.deepEqual(R.tuneTarget({ out: 145.6, offset: -0.6 }), { kHz: 145600, mode: "fm" });
  assert.deepEqual(R.tuneTarget({ out: 433.0, offset: 1.6 }), { kHz: 433000, mode: "fm" });
  assert.equal(R.tuneTarget({ out: 7.1 }), null);
  const src = require("fs").readFileSync(require("path").join(__dirname, "../public/js/repeaters.js"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /rigWrite|dvTune|PTT|sdrTx|rigCommands/, "no transmit or direct radio commands");
});
