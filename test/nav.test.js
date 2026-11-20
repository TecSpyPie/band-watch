"use strict";
// Section menu: the button list, the highlighted panel, and the saved fold list.
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../public/js/nav.js");

test("menuLabel: plain heading text, shortened at a colon", () => {
  assert.equal(N.menuLabel("Listen"), "Listen");
  assert.equal(N.menuLabel("  Decoders: FT8, FT4, WSPR, CW "), "Decoders");
  assert.equal(N.menuLabel("Shortwave stations on air"), "Shortwave stations on air");
  assert.equal(N.menuLabel(": odd"), ": odd");
  assert.equal(N.menuLabel(null), "");
});

test("buildItems: only panels that are showing, in page order, folded flagged", () => {
  const items = N.buildItems([
    { id: "secClock", title: "World clock", visible: true, folded: false },
    { id: "secAts", title: "ATS Mini", visible: false },
    { id: "secDecode", title: "Decoders: FT8, FT4, WSPR, CW", visible: true, folded: true },
    { id: "secRot", title: "Rotator", visible: false, folded: true },
    { id: "secBlank", title: "  ", visible: true },
    { title: "No id", visible: true },
  ]);
  assert.deepEqual(items, [
    { id: "secClock", label: "World clock", title: "World clock", folded: false },
    { id: "secDecode", label: "Decoders", title: "Decoders: FT8, FT4, WSPR, CW", folded: true },
  ]);
  // an add-on switched on later appears where it belongs
  const later = N.buildItems([
    { id: "secClock", title: "World clock", visible: true },
    { id: "secRot", title: "Rotator", visible: true },
  ]);
  assert.deepEqual(later.map((i) => i.id), ["secClock", "secRot"]);
  assert.deepEqual(N.buildItems(null), []);
});

test("pickActive: last panel on the reading line, else the previous one, the last at the bottom", () => {
  const ids = ["a", "b", "c"];
  assert.equal(N.pickActive(ids, new Set(["b"]), "a", false), "b");
  assert.equal(N.pickActive(ids, new Set(["a", "b"]), "a", false), "b");
  assert.equal(N.pickActive(ids, new Set(), "c", false), "c");
  assert.equal(N.pickActive(ids, new Set(), "gone", false), "a");
  assert.equal(N.pickActive(ids, new Set(["a"]), "a", true), "c");
  assert.equal(N.pickActive([], new Set(), "", false), "");
});

test("parseFolded / foldedList: survive bad saved data", () => {
  assert.deepEqual(N.parseFolded('["secLog","secSats","secLog",3]'), ["secLog", "secSats"]);
  assert.deepEqual(N.parseFolded("nope"), []);
  assert.deepEqual(N.parseFolded(null), []);
  assert.deepEqual(N.parseFolded('{"a":1}'), []);
  assert.deepEqual(N.foldedList(new Set(["secSats", "secLog"])), ["secLog", "secSats"]);
});
