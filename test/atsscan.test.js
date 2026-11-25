"use strict";
const test = require("node:test");
const assert = require("node:assert");
const S = require("../public/js/atsscan-data.js");

test("plans the steps on the radio's own grid, inside one of its bands", () => {
  const p = S.plan({ fromKHz: 9600, toKHz: 9700, stepKHz: 5, mode: "AM" });
  assert.strictEqual(p.error, "");
  assert.strictEqual(p.points.length, 21);
  assert.strictEqual(p.points[0], 9600000);
  assert.strictEqual(p.points[20], 9700000);
  assert.strictEqual(S.BANDS[p.band][0], "31M");
  // AM is whole kHz: odd starts are rounded up onto the grid
  assert.deepStrictEqual(S.plan({ fromKHz: 531.4, toKHz: 549, stepKHz: 9, mode: "AM" }).points, [532000, 541000]);
  // FM: VHF band, 10 kHz grid
  const fm = S.plan({ fromKHz: 87500, toKHz: 108000, stepKHz: 100, mode: "FM" });
  assert.strictEqual(fm.error, "");
  assert.strictEqual(S.BANDS[fm.band][0], "VHF");
  assert.strictEqual(fm.points.length, 206);
  // SSB to 10 Hz, and the amateur band is the narrowest that holds it
  const ssb = S.plan({ fromKHz: 7050, toKHz: 7051, stepKHz: 0.5, mode: "LSB" });
  assert.deepStrictEqual(ssb.points, [7050000, 7050500, 7051000]);
  assert.strictEqual(S.BANDS[ssb.band][0], "40M");
  assert.strictEqual(S.BANDS[S.plan({ fromKHz: 7200, toKHz: 7600, stepKHz: 5, mode: "AM" }).band][0], "41M");
  assert.strictEqual(S.BANDS[S.plan({ fromKHz: 531, toKHz: 1602, stepKHz: 9, mode: "AM" }).band][0], "MW2");
  assert.strictEqual(S.BANDS[S.plan({ fromKHz: 5000, toKHz: 12000, stepKHz: 50, mode: "AM" }).band][0], "ALL");
});

test("says plainly what's wrong with a range", () => {
  assert.match(S.plan({ fromKHz: 9700, toKHz: 9600, stepKHz: 5, mode: "AM" }).error, /above/);
  assert.match(S.plan({ fromKHz: "", toKHz: 9600, stepKHz: 5, mode: "AM" }).error, /Type the frequencies/);
  assert.match(S.plan({ fromKHz: 9600, toKHz: 9700, stepKHz: 0.5, mode: "AM" }).error, /at least 1 kHz/);
  assert.match(S.plan({ fromKHz: 88000, toKHz: 90000, stepKHz: 5, mode: "FM" }).error, /at least 10 kHz/);
  assert.match(S.plan({ fromKHz: 50000, toKHz: 50500, stepKHz: 5, mode: "USB" }).error, /150 to 30,000 kHz/);
  assert.match(S.plan({ fromKHz: 7000, toKHz: 7300, stepKHz: 10, mode: "FM" }).error, /VHF band only/);
  assert.match(S.plan({ fromKHz: 150, toKHz: 30000, stepKHz: 1, mode: "AM" }).error, /29,851 steps.*400 at most/);
  assert.match(S.plan({ fromKHz: 9600, toKHz: 9601, stepKHz: 5, mode: "AM" }).error, /smaller than one step/);
  for (const [label, from, to, step, mode] of S.PRESETS) {
    const p = S.plan({ fromKHz: from, toKHz: to, stepKHz: step, mode });
    assert.strictEqual(p.error, "", label);
    assert.ok(p.points.length <= S.MAX_STEPS, label);
  }
});

test("knows a status line is on the step it asked for", () => {
  assert.ok(S.matches(9650000, 9650000, "AM"));
  assert.ok(!S.matches(9650000, 9655000, "AM"));
  assert.ok(S.matches(98500000, 98500000, "FM"));
  assert.ok(!S.matches(98500000, 98510000, "FM"));
  assert.ok(S.matches(7050500, 7050510, "LSB"));
  assert.ok(!S.matches(7050500, 7050700, "LSB"));
});

/* A pretend band: noise of about 12 dBuV with a few dB of jitter, and carriers that spread over a few steps. */
function fakeBand(points, carriers, seed = 7) {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return points.map((hz) => {
    let level = 12 + rand() * 3;
    for (const c of carriers) {
      const off = Math.abs(hz - c.hz) / 1000;
      level = Math.max(level, c.dbuv - off * c.fall);
    }
    const rssi = Math.round(level);
    return { hz, rssi, snr: Math.max(0, rssi - 12) };
  });
}

test("finds the stations in a noisy scan, strongest first, each only once", () => {
  const p = S.plan({ fromKHz: 9400, toKHz: 9900, stepKHz: 5, mode: "AM" });
  const carriers = [{ hz: 9410000, dbuv: 45, fall: 4 }, { hz: 9650000, dbuv: 60, fall: 5 }, { hz: 9800000, dbuv: 26, fall: 3 }];
  const readings = fakeBand(p.points, carriers);
  const floor = S.noiseFloor(readings);
  assert.ok(floor >= 12 && floor <= 15, `noise about 12 to 15 dBuV, got ${floor}`);
  const found = S.signals(readings);
  assert.deepStrictEqual(found.map((x) => x.hz), [9650000, 9410000, 9800000]);
  assert.strictEqual(found[0].rssi, 60);
  assert.ok(found[0].over >= 44);
  // A gap where the radio didn't answer doesn't break it
  readings[51].rssi = null; // 9655 kHz, inside the strongest station
  assert.deepStrictEqual(S.signals(readings).map((x) => x.hz), [9650000, 9410000, 9800000]);
  // Pure noise: nothing found
  assert.deepStrictEqual(S.signals(fakeBand(p.points, [])), []);
  assert.deepStrictEqual(S.signals([]), []);
  assert.strictEqual(S.signals(readings, { max: 1 }).length, 1);
});

test("writes a CSV a spreadsheet can open, and shows frequencies plainly", () => {
  const text = S.csv([{ hz: 9650000, rssi: 60, snr: 40 }, { hz: 9655000, rssi: null, snr: null }], "AM");
  assert.strictEqual(text, "Frequency (kHz),Mode,Signal (dBuV),SNR (dB)\r\n9650,AM,60,40\r\n9655,AM,,\r\n");
  assert.strictEqual(S.showFreq(9650000, "AM"), "9,650 kHz");
  assert.strictEqual(S.showFreq(7074500, "USB"), "7,074.5 kHz");
  assert.strictEqual(S.showFreq(98500000, "FM"), "98.5 MHz");
  assert.strictEqual(S.estimateSeconds(100, false), 50);
  assert.strictEqual(S.estimateSeconds(100, true), 100);
});
