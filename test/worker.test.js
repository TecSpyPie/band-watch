"use strict";
// The decoder worker (ft8-worker.js) with pretend audio and a pretend clock: FT8 and FT4 are decoded early
// (13.6 s / 6.0 s into the cycle, so there's time to answer in the next one), and the end-of-cycle pass only adds
// stations that were missed early, never the same message twice.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const F = require("../public/js/ft8.js");
const T = require("../public/js/ftxtx.js");

function loadWorker() {
  const out = [];
  const ctx = { postMessage: (m) => out.push(m), console, Float32Array, Math, Date, Set, Map, BigInt, Uint8Array, Int8Array, Float64Array, Int32Array, Uint16Array, Uint32Array, Array, Object, Number, String, JSON, Error };
  ctx.self = ctx;
  ctx.onmessage = null; // set by the worker
  ctx.importScripts = (...urls) => {
    for (const u of urls) {
      const file = path.join(__dirname, "..", "public", u.split("?")[0]);
      vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
    }
  };
  vm.createContext(ctx);
  const file = path.join(__dirname, "..", "public", "js", "ft8-worker.js");
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  return { send: (m) => ctx.onmessage({ data: m }), out };
}

/** Feed `seconds` of audio (a function of the sample number) in 0.1 s blocks, with matching clock times. */
function feed(w, rate, t0, seconds, sample) {
  const block = Math.round(rate / 10);
  for (let n = 0; n < seconds * rate; n += block) {
    const b = new Float32Array(block);
    for (let i = 0; i < block; i++) b[i] = sample(n + i);
    w.send({ type: "audio", samples: b, at: t0 + ((n + block) / rate) * 1000 });
  }
}

for (const [proto, earlySec] of [[F.FT8, 13.6], [F.FT4, 6.0]]) {
  test(`${proto.name}: decoded early (${earlySec} s into the cycle), once`, () => {
    const rate = 12000;
    const w = loadWorker();
    w.send({ type: "start", mode: proto.name, rate });
    const period = proto.period * 1000;
    const c0 = Date.parse("2026-11-19T15:00:00Z");
    // our signal in the second cycle (c0 + period), starting 0.5 s in, as Band Watch sends it
    const text = "CQ M3VRV IO93";
    const { samples, lead } = T.wave(F.encodeTones(text, proto), { proto, rate, baseHz: 1200, amp: 0.4 });
    const sigAt = Math.round(((period + (proto.start - lead) * 1000) / 1000) * rate);
    let seed = 3;
    const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 0.02; };
    const sample = (n) => noise() + (n >= sigAt && n < sigAt + samples.length ? samples[n - sigAt] : 0);
    // up to just before the early-decode point in the second cycle: nothing yet for it
    feed(w, rate, c0, proto.period + earlySec - 0.3, sample);
    const before = w.out.filter((m) => m.type === "decodes" && m.cycle === c0 + period);
    assert.equal(before.length, 0, "not decoded before the early point");
    // a little past the early point: decoded, early
    feed(w, rate, c0 + (proto.period + earlySec - 0.3) * 1000, 0.6, (n) => sample(n + Math.round((proto.period + earlySec - 0.3) * rate)));
    const early = w.out.filter((m) => m.type === "decodes" && m.cycle === c0 + period);
    assert.equal(early.length, 1, "one early decode");
    assert.equal(early[0].early, true);
    assert.ok(early[0].list.some((d) => d.text === text), `early decode found it (got ${early[0].list.map((d) => d.text).join(" | ")})`);
    // to the end of the cycle and beyond: the full pass adds nothing new, so no second message for this cycle
    const done = proto.period + earlySec + 0.3;
    feed(w, rate, c0 + done * 1000, proto.period + 1, (n) => sample(n + Math.round(done * rate)));
    const all = w.out.filter((m) => m.type === "decodes" && m.cycle === c0 + period);
    assert.equal(all.length, 1, "the same message isn't reported twice");
  });
}
