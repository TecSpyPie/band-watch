"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const E = require("../public/js/eibi-data.js");

const dir = path.join(__dirname, "fixtures", "eibi");
const csv = fs.readFileSync(path.join(dir, "sked-b26.csv"), "latin1");
const readme = fs.readFileSync(path.join(dir, "README.TXT"), "latin1");
const at = (iso) => new Date(iso);

test("reads the CSV: header, inactive entries and Latin-1 names", () => {
  const rows = E.parseSked(csv);
  assert.ok(rows.length >= 20);
  assert.ok(!rows.some((r) => r.station === "Voice of Indonesia"), "persistence code 8 (inactive) is left out");
  const bbc = rows.find((r) => r.kHz === 5975 && r.time === "1400-1500");
  assert.deepStrictEqual([bbc.station, bbc.itu, bbc.langs, bbc.target, bbc.start, bbc.end], ["BBC", "G", ["DR"], "AFG", 840, 900]);
  assert.ok(rows.some((r) => r.station === "Nemzetiségi Rádió"), "accents come through");
  assert.deepStrictEqual(rows.find((r) => r.kHz === 531).langs, ["A", "F"]);
});

test("reads language and country names from README.TXT", () => {
  const c = E.parseCodes(readme);
  assert.strictEqual(c.lang.E, "English");
  assert.strictEqual(c.lang.M, "Mandarin");
  assert.strictEqual(c.lang.S, "Spanish/Castellano");
  assert.strictEqual(c.lang["-TS"], "Time Signal Station");
  assert.strictEqual(c.country.G, "United Kingdom of Great Britain and Northern Ireland");
  assert.strictEqual(c.country.HNG, "Hungary");
  assert.strictEqual(c.lang.G, undefined, "the overview at the top isn't read as a table");
});

test("days of the week", () => {
  const wed = at("2026-11-18T12:00:00Z"), sat = at("2026-11-21T12:00:00Z"), tue = at("2026-11-17T12:00:00Z");
  assert.strictEqual(E.parseDays(""), null);
  assert.ok(E.parseDays("Mo-Fr")(wed) && !E.parseDays("Mo-Fr")(sat));
  assert.ok(E.parseDays("We-Mo")(wed) && E.parseDays("We-Mo")(sat) && !E.parseDays("We-Mo")(tue), "ranges wrap round the week");
  assert.ok(E.parseDays("SaSu")(sat) && !E.parseDays("SaSu")(wed));
  assert.ok(E.parseDays("Tu,Fr")(tue) && !E.parseDays("Tu,Fr")(wed));
  assert.ok(E.parseDays("157")(wed) === false && E.parseDays("135")(wed));
  assert.ok(E.parseDays("1.Sa")(at("2026-11-07T12:00:00Z")) && !E.parseDays("1.Sa")(sat), "first Saturday of the month");
  assert.ok(E.parseDays("23Dec")(at("2026-12-23T10:00:00Z")) && !E.parseDays("23Dec")(wed));
  assert.strictEqual(E.parseDays("irr"), "irregular");
  assert.strictEqual(E.parseDays("Haj"), "irregular");
});

test("on the air: times, days, past midnight and part-season dates", () => {
  const rows = E.parseSked(csv);
  const find = (k, t) => rows.find((r) => r.kHz === k && r.time === t);
  const wed1445 = at("2026-11-18T14:45:00Z");
  assert.strictEqual(E.onAir(find(5845, "1430-1500"), wed1445), true);
  assert.strictEqual(E.onAir(find(5845, "1530-1600"), wed1445), false);
  assert.strictEqual(E.onAir(find(639, "1400-1430"), wed1445), false, "ended at 14:30");
  assert.strictEqual(E.onAir(find(5845, "1430-1500"), at("2026-11-21T14:45:00Z")), false, "Mo-Fr: not on Saturday");
  // 2330-0450 runs past midnight, every day
  assert.strictEqual(E.onAir(find(531, "2330-0450"), at("2026-11-18T02:00:00Z")), true);
  assert.strictEqual(E.onAir(find(531, "2330-0450"), at("2026-11-18T05:00:00Z")), false);
  // 1386 kHz: only 23 December (persistence 6, 28 Oct - 23 Dec)
  assert.strictEqual(E.onAir(find(1386, "1430-1500"), at("2026-12-23T14:40:00Z")), true);
  assert.strictEqual(E.onAir(find(1386, "1430-1500"), at("2026-11-18T14:40:00Z")), false);
  assert.strictEqual(E.onAir(find(873, "2100-2300"), at("2026-11-18T22:00:00Z")), "irregular");
});

test("starting soon", () => {
  const rows = E.parseSked(csv);
  const b = rows.find((r) => r.kHz === 5845 && r.time === "1530-1600");
  assert.strictEqual(E.startsIn(b, at("2026-11-18T15:10:00Z"), 60), 20);
  assert.strictEqual(E.startsIn(b, at("2026-11-18T13:00:00Z"), 60), null);
  assert.strictEqual(E.startsIn(b, at("2026-11-21T15:10:00Z"), 60), null, "not on Saturdays");
});

test("seasons", () => {
  assert.strictEqual(E.season(at("2026-11-18T12:00:00Z")), "B26");
  assert.strictEqual(E.season(at("2027-02-01T12:00:00Z")), "B26");
  assert.strictEqual(E.season(at("2027-03-28T01:00:00Z")), "A27"); // last Sunday of March 2027
  assert.strictEqual(E.season(at("2027-03-27T23:00:00Z")), "B26");
  assert.strictEqual(E.season(at("2026-10-25T00:30:00Z")), "B26"); // last Sunday of October 2026
  assert.strictEqual(E.previousSeason("B26"), "A26");
  assert.strictEqual(E.previousSeason("A27"), "B26");
  assert.strictEqual(E.previousSeason("A00"), "B99");
});

test("broadcast bands", () => {
  assert.strictEqual(E.bandOf(5975), "49");
  assert.strictEqual(E.bandOf(639), "mw");
  assert.strictEqual(E.bandOf(198), "lw");
  assert.strictEqual(E.bandOf(14074), "");
});
