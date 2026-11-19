"use strict";
// SSTV: every mode's picture is made into audio (VIS header and all), played a little off speed (a sound card's
// clock is never exact, which makes pictures slant), with noise, and decoded back: right mode, straight, right colours.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../public/js/sstv.js");

/** A test card: colour bars on top, a grey ramp, then a colour gradient. */
function card(w, h) {
  const px = new Uint8ClampedArray(w * h * 4);
  const bars = [[255, 255, 255], [255, 255, 0], [0, 255, 255], [0, 255, 0], [255, 0, 255], [255, 0, 0], [0, 0, 255], [0, 0, 0]];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let c;
      if (y < h * 0.45) c = bars[Math.floor((x / w) * bars.length)];
      else if (y < h * 0.7) { const g = Math.round((x / (w - 1)) * 255); c = [g, g, g]; }
      else c = [Math.round((x / (w - 1)) * 255), Math.round(((y - h * 0.7) / (h * 0.3)) * 255), 128];
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
    }
  }
  return px;
}

/** Resample by a factor (linear), as a sound card running fast or slow would. */
function stretch(x, factor) {
  const n = Math.floor(x.length * factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / factor, k = Math.floor(t), f = t - k;
    out[i] = (x[k] || 0) * (1 - f) + (x[k + 1] || 0) * f;
  }
  return out;
}

function run(modeName, { ppm = 300, noise = 0.05, lead = 0.7 } = {}) {
  const m = S.MODES[modeName];
  const src = card(m.width, m.height);
  let audio = S.encode(m, src, { rate: S.FS, amp: 0.7 });
  audio = stretch(audio, 1 + ppm / 1e6);
  // some quiet noise before it starts and after it ends
  const pad = Math.round(lead * S.FS);
  const all = new Float32Array(pad + audio.length + pad);
  all.set(audio, pad);
  let seed = 11;
  for (let i = 0; i < all.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; all[i] += noise * (seed / 0x7fffffff - 0.5); }
  const got = { starts: [], done: [], lines: 0 };
  const d = new S.Decoder({ onStart: (s) => got.starts.push(s), onLines: (l) => { got.lines = Math.max(got.lines, l.to); }, onDone: (r) => got.done.push(r) });
  for (let i = 0; i < all.length; i += 1200) d.push(all.subarray(i, i + 1200));
  return { m, src, got };
}

/** How far the decoded picture is from the original: mean difference (0-255), over the middle of the picture. */
function diff(m, a, b) {
  let s = 0, n = 0;
  const x0 = Math.round(m.width * 0.03), x1 = Math.round(m.width * 0.97);
  for (let y = 2; y < m.height - 2; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * m.width + x) * 4;
      // skip the edges of the colour bars, where every SSTV picture blurs a little
      const bar = y < m.height * 0.45 && Math.abs(((x / m.width) * 8) % 1 - 0.5) > 0.4;
      if (bar) continue;
      for (let c = 0; c < 3; c++) { s += Math.abs(a[i + c] - b[i + c]); n++; }
    }
  }
  return s / n;
}

for (const name of Object.keys(S.MODES)) {
  test(`${name}: decoded from its VIS code, straightened, right colours`, () => {
    const { m, src, got } = run(name);
    assert.equal(got.starts.length, 1, "one picture started");
    assert.equal(got.starts[0].mode, name, `VIS ${m.vis} recognised`);
    assert.equal(got.done.length, 1, "one picture finished");
    const r = got.done[0];
    assert.equal(r.complete, true, `whole picture received (${r.lines} of ${m.height} lines)`);
    const e = diff(m, src, r.rgba);
    const yuv = m.parts.some((p) => "YUVC".includes(p[0][0]));
    // Robot 36 sends half the colour detail (each colour difference on every other line): a little softer.
    const limit = name === "Robot 36" ? 17 : yuv ? 14 : 10;
    assert.ok(e < limit, `${name}: mean difference ${e.toFixed(1)} of 255`);
    if (m.syncAt >= 0) assert.ok(Math.abs(r.slant - 300) < 60, `${name}: slant found ${r.slant} ppm (was 300)`);
  });
}

test("a picture with the sound card 1000 ppm slow still comes out straight", () => {
  const { m, src, got } = run("Martin M1", { ppm: -1000 });
  assert.equal(got.done[0].complete, true);
  assert.ok(Math.abs(got.done[0].slant + 1000) < 80, `slant ${got.done[0].slant}`);
  assert.ok(diff(m, src, got.done[0].rgba) < 10);
});

test("noise alone starts no pictures", () => {
  const d = new S.Decoder({ onStart: () => assert.fail("started on noise") });
  let seed = 5;
  const x = new Float32Array(S.FS);
  for (let s = 0; s < 20; s++) {
    for (let i = 0; i < x.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; x[i] = seed / 0x7fffffff - 0.5; }
    d.push(x);
  }
});

test("VIS codes are right and all different; picture lengths as published", () => {
  const vis = Object.values(S.MODES).map((m) => m.vis);
  assert.equal(new Set(vis).size, vis.length);
  const len = (n) => S.seconds(S.MODES[n]);
  assert.ok(Math.abs(len("Martin M1") - 114.3) < 0.3, `M1 ${len("Martin M1")}`);
  assert.ok(Math.abs(len("Scottie S1") - 109.6) < 0.3, `S1 ${len("Scottie S1")}`);
  assert.ok(Math.abs(len("Robot 36") - 36) < 0.1);
  assert.ok(Math.abs(len("Robot 72") - 72) < 0.1);
  assert.ok(Math.abs(len("PD120") - 126.1) < 0.3, `PD120 ${len("PD120")}`);
  assert.ok(Math.abs(len("PD90") - 90) < 0.3, `PD90 ${len("PD90")}`);
  assert.ok(Math.abs(len("PD290") - 288.7) < 0.5, `PD290 ${len("PD290")}`);
  const tones = S.visTones(44);
  assert.equal(tones.length, 13); // leader, break, leader, start, 7 bits, parity, stop
  assert.deepEqual(tones.slice(4, 11).map((t) => t[0]), [1300, 1300, 1100, 1100, 1300, 1100, 1300]); // 44 = 0101100, lowest bit first
});

test("colour conversion round trip", () => {
  for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128], [250, 200, 30]]) {
    const back = S.yuvToRgb(...S.rgbToYuv(...rgb));
    rgb.forEach((v, i) => assert.ok(Math.abs(back[i] - v) <= 2, `${rgb} -> ${back}`));
  }
});

test("a missed VIS header: start by hand, and the syncs line the picture up", () => {
  const m = S.MODES["Scottie S1"];
  const src = card(m.width, m.height);
  const audio = S.encode(m, src, { vis: false });
  const got = [];
  const d = new S.Decoder({ onDone: (r) => got.push(r) });
  d.push(new Float32Array(Math.round(0.137 * S.FS))); // started 137 ms early, by hand
  d.start("Scottie S1", 0);
  for (let i = 0; i < audio.length; i += 1200) d.push(audio.subarray(i, i + 1200));
  d.push(new Float32Array(S.FS));
  assert.equal(got.length, 1);
  assert.ok(diff(m, src, got[0].rgba) < 16, `difference ${diff(m, src, got[0].rgba).toFixed(1)}`);
});
