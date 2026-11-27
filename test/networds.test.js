"use strict";
const test = require("node:test");
const assert = require("node:assert");
const N = require("../public/js/networds.js");

test("no answer at all: the browser's wording becomes plain English", () => {
  for (const m of ["Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed", "fetch failed", "The network connection was lost."]) {
    const e = new TypeError(m);
    assert.ok(N.isNoAnswer(e), m);
    const s = N.friendly(e, "POTA");
    assert.match(s, /^Couldn't reach POTA\. Check your internet connection/);
    assert.doesNotMatch(s, /fetch|TypeError|NetworkError/i);
  }
  const abort = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
  assert.ok(N.isNoAnswer(abort));
});

test("our own plain messages pass through unchanged", () => {
  const e = new Error("Slow down a little: one message every 3 seconds.");
  assert.equal(N.isNoAnswer(e), false);
  assert.equal(N.friendly(e, "the chat"), e.message);
});

test("JSON and programming errors never reach the screen", () => {
  for (const m of ["Unexpected token < in JSON at position 0", "SyntaxError: bad", "TypeError: x is undefined", ""]) {
    assert.match(N.friendly(new Error(m), "QRZ"), /^Couldn't reach QRZ just now/);
  }
  assert.match(N.friendly(null), /HamShack's server/);
});

test("status numbers become words, and no number is shown", () => {
  assert.match(N.fromStatus(502, "POTA"), /^Couldn't reach POTA just now\. HamShack will try again/);
  assert.match(N.fromStatus(503, "POTA"), /Couldn't reach POTA/);
  assert.match(N.fromStatus(429, "QRZ"), /busy\. Wait a minute/);
  assert.match(N.fromStatus(404), /isn't available on this copy/);
  assert.match(N.fromStatus(400, "QRZ"), /didn't accept that/);
  for (const s of [0, 400, 404, 429, 500, 502, 503, 504]) assert.doesNotMatch(N.fromStatus(s, "POTA"), /\d{3}/);
});
