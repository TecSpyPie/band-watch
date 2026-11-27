/* ClearRX by M3VRV & King Coder: the big graph at the top. It shows the sound's spectrum (before and after ClearRX)
 * and the graphic EQ as a curve with a point for each band that can be dragged up and down.
 * This file is only the maths (no page), so Node can test it: where a frequency or a level goes on the graph, and
 * which EQ point is nearest the pointer. app.js does the drawing and the dragging. Receive only: nothing transmits. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EqGraph = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LO = 50, HI = 6000; // Hz: radio sound lives below 6 kHz
  const RANGE = 12; // dB up and down for the EQ points
  const PAD_BOTTOM = 16; // room for the frequency labels

  /** Where a frequency sits across the graph, 0 to 1. Log spreads the low notes out (like an EQ); linear doesn't. */
  function xFrac(hz, scale) {
    const f = Math.max(LO, Math.min(HI, hz));
    if (scale === "linear") return f / HI;
    return Math.log(f / LO) / Math.log(HI / LO);
  }

  /** The frequency at a point across the graph (the opposite of xFrac). */
  function hzAt(frac, scale) {
    const t = Math.max(0, Math.min(1, frac));
    if (scale === "linear") return Math.max(LO, t * HI);
    return LO * Math.pow(HI / LO, t);
  }

  /** The graph's area for drawing: the plot height leaves room for the labels underneath. */
  const plotH = (H) => Math.max(10, H - PAD_BOTTOM);

  /** Where an EQ gain (dB) sits down the graph: +12 at the top, 0 in the middle, -12 at the bottom. */
  function yOfDb(db, H) {
    const h = plotH(H), d = Math.max(-RANGE, Math.min(RANGE, db));
    return 4 + (1 - (d + RANGE) / (2 * RANGE)) * (h - 8);
  }

  /** The EQ gain at a height on the graph, rounded to whole dB like the sliders. */
  function dbAtY(y, H) {
    const h = plotH(H), t = (y - 4) / (h - 8);
    const db = Math.round(RANGE - t * 2 * RANGE);
    return Math.max(-RANGE, Math.min(RANGE, db)) || 0; // no "-0"
  }

  /** A band's new gain after dragging from startY to y: it moves by the pointer's distance, whole dB, within range. */
  function dragDb(startDb, startY, y, H) {
    const h = plotH(H), perDb = (h - 8) / (2 * RANGE);
    const db = Math.round(startDb + (startY - y) / perDb);
    return Math.max(-RANGE, Math.min(RANGE, db)) || 0;
  }

  /** Labels along the bottom for each scale, in Hz. */
  function ticks(scale) {
    return scale === "linear" ? [1000, 2000, 3000, 4000, 5000, 6000] : [50, 100, 200, 500, 1000, 2000, 5000];
  }
  const tickName = (hz) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

  /** The EQ point nearest to (x, y) on a W x H graph, or -1 if none is within `reach` pixels across. */
  function nearestPoint(freqs, x, W, scale, reach = 28) {
    let best = -1, bestD = Infinity;
    freqs.forEach((f, i) => {
      const d = Math.abs(xFrac(f, scale) * W - x);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= reach ? best : -1;
  }

  return { LO, HI, RANGE, xFrac, hzAt, yOfDb, dbAtY, dragDb, ticks, tickName, nearestPoint, plotH };
});
