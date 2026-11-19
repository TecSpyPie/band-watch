"use strict";
const test = require("node:test");
const assert = require("node:assert");
const M = require("../public/js/atsmem-data.js");

test("reads the radio's memory lines, with and without names", () => {
  assert.deepStrictEqual(M.parseLine("#01,VHF,107900000,FM"), { slot: 1, band: "VHF", hz: 107900000, mode: "FM", name: "" });
  assert.deepStrictEqual(M.parseLine("#12,20M,14230500,USB,DX net\r"), { slot: 12, band: "20M", hz: 14230500, mode: "USB", name: "DX net" });
  assert.deepStrictEqual(M.parseLine("#99,31M,9650000,AM,"), { slot: 99, band: "31M", hz: 9650000, mode: "AM", name: "" });
  assert.strictEqual(M.parseLine("245,103900,0,0,VHF,FM,100k,Auto,0,35,28,9,0,4.05,7"), null, "a status line isn't a slot");
  assert.strictEqual(M.parseLine("#00,VHF,1,FM"), null);
  assert.strictEqual(M.parseLine("#05,VHF,107900000,CW"), null);
});

test("picks the narrowest of the radio's bands, FM only on VHF", () => {
  assert.strictEqual(M.bandFor(107900000, "FM"), "VHF");
  assert.strictEqual(M.bandFor(107900000, "AM"), "");
  assert.strictEqual(M.bandFor(7150000, "LSB"), "40M");
  assert.strictEqual(M.bandFor(7400000, "AM"), "41M");
  assert.strictEqual(M.bandFor(9650000, "AM"), "31M");
  assert.strictEqual(M.bandFor(14230000, "USB"), "20M");
  assert.strictEqual(M.bandFor(21300000, "USB"), "15M");
  assert.strictEqual(M.bandFor(18950000, "AM"), "15M");
  assert.strictEqual(M.bandFor(27185000, "AM"), "CB");
  assert.strictEqual(M.bandFor(198000, "AM"), "MW1");
  assert.strictEqual(M.bandFor(909000, "AM"), "MW2");
  assert.strictEqual(M.bandFor(1900000, "LSB"), "160M");
  assert.strictEqual(M.bandFor(16000000, "AM"), "ALL");
  assert.strictEqual(M.bandFor(50000000, "USB"), "");
});

test("writes slots the way the radio takes them, with names only for firmware 2.42 and later", () => {
  const mem = { slot: 3, mode: "USB", hz: 14230000, name: "SSTV" };
  assert.strictEqual(M.command(mem), "#03,20M,14230000,USB\r\n");
  assert.strictEqual(M.command(mem, { names: true }), "#03,20M,14230000,USB,SSTV\r\n");
  assert.strictEqual(M.command({ slot: 1, mode: "FM", hz: 98500000, name: "" }, { names: true }), "#01,VHF,98500000,FM,\r\n");
  assert.strictEqual(M.clearCommand({ slot: 7, band: "31M", mode: "AM", hz: 9650000 }), "#07,31M,0,AM\r\n");
  assert.ok(M.hasNames("2.42") && M.hasNames(245) && M.hasNames("2.46"));
  assert.ok(!M.hasNames("2.36") && !M.hasNames(241) && !M.hasNames(""));
  assert.strictEqual(M.cleanName("  Radio, One Two  "), "Radio One");
  assert.strictEqual(M.cleanName("Ünïcode✓"), "ncode");
});

test("says plainly what's wrong with a slot", () => {
  assert.strictEqual(M.problem({ slot: 1, mode: "AM", hz: 9650000 }), "");
  assert.match(M.problem({ slot: 0, mode: "AM", hz: 9650000 }), /1 to 99/);
  assert.match(M.problem({ slot: 100, mode: "AM", hz: 9650000 }), /1 to 99/);
  assert.match(M.problem({ slot: 2, mode: "AM", hz: NaN }), /Type a frequency/);
  assert.match(M.problem({ slot: 2, mode: "FM", hz: 145500000 }), /64 to 108 MHz/);
  assert.match(M.problem({ slot: 2, mode: "USB", hz: 50313000 }), /can't keep/);
  assert.match(M.problem({ slot: 2, mode: "CW", hz: 7030000 }), /Pick a mode/);
});

test("frequencies typed and shown: kHz, or MHz for FM", () => {
  assert.strictEqual(M.readFreq("9650", "AM"), 9650000);
  assert.strictEqual(M.readFreq("14,230.5", "USB"), 14230500);
  assert.strictEqual(M.readFreq("98.5", "FM"), 98500000);
  assert.strictEqual(M.readFreq("98500", "FM"), 98500000);
  assert.ok(Number.isNaN(M.readFreq("abc", "AM")));
  assert.strictEqual(M.showFreq(107900000, "FM"), "107.9 MHz");
  assert.strictEqual(M.showFreq(98550000, "FM"), "98.55 MHz");
  assert.strictEqual(M.showFreq(9650000, "AM"), "9,650 kHz");
  assert.strictEqual(M.showFreq(14230500, "USB"), "14,230.5 kHz");
});

test("backup files: the radio's own lines, read back the same", () => {
  const list = [
    { slot: 12, band: "20M", hz: 14230000, mode: "USB", name: "SSTV" },
    { slot: 1, band: "VHF", hz: 107900000, mode: "FM", name: "" },
  ];
  const text = M.backupText(list);
  assert.strictEqual(text, "#01,VHF,107900000,FM\r\n#12,20M,14230000,USB,SSTV\r\n");
  assert.deepStrictEqual(M.parseBackup(`Band Watch\n${text}\n#03,31M,0,AM\nnonsense`), [list[1], list[0]]);
  assert.strictEqual(M.backupText([]), "");
  assert.strictEqual(M.firstFree(list), 2);
  assert.strictEqual(M.firstFree(Array.from({ length: 99 }, (_, i) => ({ slot: i + 1 }))), 0);
});
