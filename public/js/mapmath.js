/* HamShack by M0GLP & M3VRV: the maths behind the spots map (the "Map" view of the <band> spots panel). Plain JavaScript,
 * used by the page (window.MapMath) and the tests (require). No drawing here, only numbers:
 *   project / unproject  equirectangular map (longitude across, latitude down) with zoom and pan
 *   zoomAt / panBy       change the view, keeping what is under the pointer where it is, and never leaving the world
 *   greatCircle          the curved path a radio wave takes between two places, cut where it crosses the date line
 *   snrBucket / ageFade  signal strength -> 5 levels (colour and size); spot age -> how faint it is drawn
 *   nightPolygon         the dark side of the Earth for a given Sun position
 *   bearing / distanceKm / compass, nearest (which dot is under the pointer) */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MapMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const RAD = Math.PI / 180;
  const MIN_ZOOM = 1, MAX_ZOOM = 12;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** A view is { zoom, lon, lat }: the longitude and latitude at the middle of the picture, and how far in (1 = the whole world). */
  const newView = () => ({ zoom: 1, lon: 0, lat: 0 });

  /** Pixels per degree for a picture w by h pixels: at zoom 1 the whole world (360 by 180 degrees) just fits. */
  const pxPerDeg = (view, w, h) => Math.min(w / 360, h / 180) * view.zoom;

  function project(view, lat, lon, w, h) {
    const k = pxPerDeg(view, w, h);
    return { x: w / 2 + (lon - view.lon) * k, y: h / 2 - (lat - view.lat) * k };
  }

  function unproject(view, x, y, w, h) {
    const k = pxPerDeg(view, w, h);
    return { lat: view.lat - (y - h / 2) / k, lon: view.lon + (x - w / 2) / k };
  }

  /** Keep the view inside the world: zoom 1 to 12, and the edge of the picture never past the edge of the map. */
  function clampView(view, w, h) {
    const zoom = clamp(view.zoom, MIN_ZOOM, MAX_ZOOM);
    const k = pxPerDeg({ zoom }, w, h);
    const halfLon = w / 2 / k, halfLat = h / 2 / k;
    const lon = halfLon >= 180 ? 0 : clamp(view.lon, -180 + halfLon, 180 - halfLon);
    const lat = halfLat >= 90 ? 0 : clamp(view.lat, -90 + halfLat, 90 - halfLat);
    return { zoom, lon, lat };
  }

  /** Zoom by a factor, keeping the place under the pointer (px, py) under the pointer. */
  function zoomAt(view, factor, px, py, w, h) {
    const before = unproject(view, px, py, w, h);
    const zoom = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const k = pxPerDeg({ zoom }, w, h);
    const next = { zoom, lon: before.lon - (px - w / 2) / k, lat: before.lat + (py - h / 2) / k };
    return clampView(next, w, h);
  }

  /** Drag the map by dx, dy pixels. */
  function panBy(view, dx, dy, w, h) {
    const k = pxPerDeg(view, w, h);
    return clampView({ zoom: view.zoom, lon: view.lon - dx / k, lat: view.lat + dy / k }, w, h);
  }

  function distanceKm(lat1, lon1, lat2, lon2) {
    const h = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
      Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Beam heading (0-360, from true north) from the first place to the second, the short way. */
  function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

  const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

  /**
   * The great-circle path from a to b ({lat, lon} each) as a list of segments, each a list of [lon, lat] points in
   * -180..180. A path that crosses the date line comes back as two or more segments that meet exactly at the edge
   * (lon = -180 or 180), so drawing each segment on its own never draws a line right across the map.
   * `step` is the aim for the gap between points in degrees of arc.
   */
  function greatCircle(a, b, step = 3) {
    const toV = (p) => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
    const va = toV(a), vb = toV(b);
    const dot = clamp(va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2], -1, 1);
    const w = Math.acos(dot);
    const n = clamp(Math.ceil(w / RAD / step), 2, 120);
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const k1 = w < 1e-9 ? 1 - t : Math.sin((1 - t) * w) / Math.sin(w);
      const k2 = w < 1e-9 ? t : Math.sin(t * w) / Math.sin(w);
      const v = [k1 * va[0] + k2 * vb[0], k1 * va[1] + k2 * vb[1], k1 * va[2] + k2 * vb[2]];
      pts.push([Math.atan2(v[1], v[0]) / RAD, Math.atan2(v[2], Math.hypot(v[0], v[1])) / RAD]);
    }
    pts[0] = [wrapLon(a.lon), a.lat];
    pts[n] = [wrapLon(b.lon), b.lat];
    const segs = [[pts[0]]];
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      if (Math.abs(x1 - x0) > 180) {
        // crossed the date line: finish this segment on one edge and start the next on the other
        const edge0 = x0 > 0 ? 180 : -180;
        const x1u = x1 + (x0 > 0 ? 360 : -360);
        const f = (edge0 - x0) / (x1u - x0);
        const yc = y0 + (y1 - y0) * f;
        segs[segs.length - 1].push([edge0, yc]);
        segs.push([[-edge0, yc]]);
      }
      segs[segs.length - 1].push([x1, y1]);
    }
    return segs;
  }

  /**
   * The night side of the Earth as a closed outline of [lon, lat] points, for the Sun overhead at sun.lon and with
   * declination sun.dec (degrees): the terminator from west to east, then round the pole that is in darkness.
   */
  function nightPolygon(sun, step = 3) {
    const dec = Math.abs(sun.dec) < 0.3 ? 0.3 : sun.dec;
    const pts = [];
    for (let l = -180; l <= 180; l += step) {
      const lat = Math.atan(-Math.cos((l - sun.lon) * RAD) / Math.tan(dec * RAD)) / RAD;
      pts.push([l, lat]);
    }
    const pole = dec > 0 ? -90 : 90; // Sun north of the equator: the south pole is the dark one
    pts.push([180, pole], [-180, pole]);
    return pts;
  }

  /** Signal report (dB) -> 0 (none given) and 1 (weak) up to 4 (strong). */
  function snrBucket(snr) {
    if (snr == null || !Number.isFinite(Number(snr))) return 0;
    const s = Number(snr);
    if (s < -20) return 1;
    if (s < -12) return 2;
    if (s < -4) return 3;
    return 4;
  }
  const SNR_LABELS = ["No report", "Weak", "Fair", "Good", "Strong"];
  const SNR_RANGES = ["no signal report", "below -20 dB", "-20 to -13 dB", "-12 to -5 dB", "-4 dB and up"];

  /** How strongly to draw a spot that is ageMin minutes old, when spots older than windowMin are dropped: 1 down to 0.25. */
  function ageFade(ageMin, windowMin = 30) {
    const t = clamp((Number(ageMin) || 0) / windowMin, 0, 1);
    return 0.25 + 0.75 * (1 - t);
  }

  /** The dot (item with x and y, in pixels) nearest the pointer and within maxPx of it, or null. */
  function nearest(items, px, py, maxPx = 10) {
    let best = null, bestD = maxPx * maxPx;
    for (const it of items) {
      const d = (it.x - px) ** 2 + (it.y - py) ** 2;
      if (d <= bestD) { best = it; bestD = d; }
    }
    return best;
  }

  /** Mix two "rgb(r, g, b)" / "rgba(r, g, b, a)" colours, t = 0 gives a and t = 1 gives b; undefined if either can't be read. */
  function mixRgb(a, b, t) {
    const read = (s) => {
      const m = String(s).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
      if (!m) return null;
      const al = m[4] == null ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      return [Number(m[1]), Number(m[2]), Number(m[3]), al];
    };
    const x = read(a), y = read(b);
    if (!x || !y) return undefined;
    const mix = (i) => x[i] + (y[i] - x[i]) * t;
    return `rgba(${Math.round(mix(0))}, ${Math.round(mix(1))}, ${Math.round(mix(2))}, ${+mix(3).toFixed(3)})`;
  }

  return {
    MIN_ZOOM, MAX_ZOOM, newView, pxPerDeg, project, unproject, clampView, zoomAt, panBy,
    distanceKm, bearing, compass, greatCircle, nightPolygon, snrBucket, SNR_LABELS, SNR_RANGES, ageFade, nearest, mixRgb, wrapLon,
  };
});
