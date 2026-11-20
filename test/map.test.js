"use strict";
// The spots map: projection and zoom, great-circle paths, signal strength and age, the night side, and the land outline.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const M = require("../public/js/mapmath.js");

const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test("project and unproject are inverses, at any zoom", () => {
  const w = 720, h = 360;
  for (const view of [M.newView(), { zoom: 3, lon: -40, lat: 30 }, { zoom: 12, lon: 100, lat: -60 }]) {
    for (const [lat, lon] of [[53.4, -1.5], [-33.9, 151.2], [0, 0], [80, 170]]) {
      const p = M.project(view, lat, lon, w, h);
      const q = M.unproject(view, p.x, p.y, w, h);
      assert.ok(close(q.lat, lat, 1e-9) && close(q.lon, lon, 1e-9), `${lat},${lon} came back as ${q.lat},${q.lon}`);
    }
  }
});

test("the whole world fits at zoom 1 whatever the shape of the picture, and north is up, east is right", () => {
  for (const [w, h] of [[720, 360], [360, 360], [1000, 200]]) {
    const nw = M.project(M.newView(), 90, -180, w, h), se = M.project(M.newView(), -90, 180, w, h);
    assert.ok(nw.x >= -1e-9 && nw.y >= -1e-9 && se.x <= w + 1e-9 && se.y <= h + 1e-9, `${w}x${h}`);
    assert.ok(se.x > nw.x && se.y > nw.y);
    // 2:1 pictures are filled exactly
  }
  const a = M.project(M.newView(), 90, -180, 720, 360), b = M.project(M.newView(), -90, 180, 720, 360);
  assert.deepEqual([a.x, a.y, b.x, b.y], [0, 0, 720, 360]);
});

test("zooming keeps the place under the pointer where it is, and the view never leaves the world", () => {
  const w = 720, h = 360;
  let v = M.newView();
  const px = 200, py = 90;
  const before = M.unproject(v, px, py, w, h);
  v = M.zoomAt(v, 4, px, py, w, h);
  const after = M.unproject(v, px, py, w, h);
  assert.ok(close(before.lat, after.lat, 1e-9) && close(before.lon, after.lon, 1e-9));
  assert.equal(v.zoom, 4);
  // zoom limits
  assert.equal(M.zoomAt(M.newView(), 0.1, 10, 10, w, h).zoom, 1);
  assert.equal(M.zoomAt(M.newView(), 1000, 10, 10, w, h).zoom, M.MAX_ZOOM);
  // the whole world shown: nothing to pan
  assert.deepEqual(M.panBy(M.newView(), 300, 300, w, h), { zoom: 1, lon: 0, lat: 0 });
  // zoomed in: pan a long way and the edge of the map stops at the edge of the picture
  const far = M.panBy(M.zoomAt(M.newView(), 4, 360, 180, w, h), -99999, -99999, w, h);
  const tl = M.project(far, 90, -180, w, h), br = M.project(far, -90, 180, w, h);
  assert.ok(br.x >= w - 1e-6 && br.y >= h - 1e-6, "bottom right of the world reaches the corner");
  assert.ok(tl.x <= 0 && tl.y <= 0);
  const back = M.panBy(far, 99999, 99999, w, h);
  assert.ok(M.project(back, 90, -180, w, h).x >= -1e-6 && M.project(back, 90, -180, w, h).y >= -1e-6 - 0);
});

test("great circle: starts and ends where it should, and bends towards the pole", () => {
  const sheffield = { lat: 53.4, lon: -1.5 }, newYork = { lat: 40.7, lon: -74.0 };
  const segs = M.greatCircle(sheffield, newYork);
  assert.equal(segs.length, 1);
  const pts = segs[0];
  assert.deepEqual(pts[0], [-1.5, 53.4]);
  assert.deepEqual(pts[pts.length - 1], [-74, 40.7]);
  // halfway along, the path is well north of the straight line on the map (about 52 N rather than 47 N)
  const mid = pts[Math.floor(pts.length / 2)];
  assert.ok(mid[1] > 52 && mid[1] < 55, `mid latitude ${mid[1]}`);
  // every point is on the great circle: distances add up
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += M.distanceKm(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]);
  assert.ok(Math.abs(km - M.distanceKm(53.4, -1.5, 40.7, -74.0)) < 5, `path length ${km}`);
});

test("great circle across the date line comes back in pieces that meet at the edge", () => {
  const segs = M.greatCircle({ lat: 35.7, lon: 139.7 }, { lat: 37.8, lon: -122.4 }); // Tokyo to San Francisco
  assert.equal(segs.length, 2);
  const [a, b] = segs;
  assert.equal(a[a.length - 1][0], 180);
  assert.equal(b[0][0], -180);
  assert.ok(close(a[a.length - 1][1], b[0][1]), "same latitude where it leaves and re-enters");
  for (const seg of segs) for (let i = 1; i < seg.length; i++) assert.ok(Math.abs(seg[i][0] - seg[i - 1][0]) < 90, "no jump across the map");
  assert.ok(a[a.length - 1][1] > 40, "the path arcs north over the Pacific");
  // westward the other way round
  const rev = M.greatCircle({ lat: 37.8, lon: -122.4 }, { lat: 35.7, lon: 139.7 });
  assert.equal(rev.length, 2);
  assert.equal(rev[0][rev[0].length - 1][0], -180);
  assert.equal(rev[1][0][0], 180);
});

test("great circle: no distance, and straight through the poles, don't break", () => {
  const same = M.greatCircle({ lat: 10, lon: 20 }, { lat: 10, lon: 20 });
  assert.ok(same.every((s) => s.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))));
  const anti = M.greatCircle({ lat: 0, lon: 0 }, { lat: 0, lon: 180 });
  assert.ok(anti.flat().every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});

test("distance and bearing match known paths (Sheffield to New York, Tokyo, Sydney)", () => {
  const me = [53.4, -1.5];
  const near = (a, b, tol) => Math.abs(((a - b + 540) % 360) - 180) <= tol;
  assert.ok(Math.abs(M.distanceKm(...me, 40.7, -74.0) - 5360) < 80);
  assert.ok(near(M.bearing(...me, 40.7, -74.0), 286, 1.5));
  assert.ok(near(M.bearing(...me, 35.7, 139.7), 31, 1.5));
  assert.ok(near(M.bearing(...me, -33.9, 151.2), 56, 1.5));
  assert.equal(M.compass(0), "N");
  assert.equal(M.compass(286), "WNW");
  assert.equal(M.compass(359), "N");
  assert.equal(M.compass(-90), "W");
});

test("signal strength buckets: none, weak, fair, good, strong", () => {
  assert.equal(M.snrBucket(null), 0);
  assert.equal(M.snrBucket(undefined), 0);
  assert.equal(M.snrBucket(NaN), 0);
  assert.equal(M.snrBucket(-28), 1);
  assert.equal(M.snrBucket(-21), 1);
  assert.equal(M.snrBucket(-20), 2);
  assert.equal(M.snrBucket(-13), 2);
  assert.equal(M.snrBucket(-12), 3);
  assert.equal(M.snrBucket(-5), 3);
  assert.equal(M.snrBucket(-4), 4);
  assert.equal(M.snrBucket(0), 4);
  assert.equal(M.snrBucket(25), 4);
  assert.equal(M.snrBucket("-15"), 2);
  assert.equal(M.SNR_LABELS.length, 5);
  assert.equal(M.SNR_RANGES.length, 5);
});

test("age fade: fresh spots are drawn fully, 30 minute old ones are faint but still visible", () => {
  assert.equal(M.ageFade(0), 1);
  assert.equal(M.ageFade(30), 0.25);
  assert.equal(M.ageFade(99), 0.25);
  assert.equal(M.ageFade(-5), 1);
  assert.equal(M.ageFade(undefined), 1);
  let last = 2;
  for (let m = 0; m <= 30; m += 3) { const f = M.ageFade(m); assert.ok(f < last); last = f; }
  assert.ok(close(M.ageFade(15), 0.625));
  assert.ok(close(M.ageFade(10, 20), 0.625), "window is a parameter");
});

test("night side: the Sun's own point is in daylight, the opposite point in darkness, and the outline is closed round the dark pole", () => {
  const inside = (poly, lon, lat) => { // even-odd test on the lon/lat plane
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (const sun of [{ dec: 20, lon: 10 }, { dec: -15, lon: -120 }, { dec: 0, lon: 90 }, { dec: 23.4, lon: 179 }]) {
    const poly = M.nightPolygon(sun);
    assert.ok(poly.length > 100);
    assert.ok(!inside(poly, sun.lon, sun.dec), `daylight under the Sun ${JSON.stringify(sun)}`);
    const anti = M.wrapLon(sun.lon + 180);
    assert.ok(inside(poly, anti, -sun.dec), `night at the opposite point ${JSON.stringify(sun)}`);
    // summer: the dark pole is the far one
    assert.ok(inside(poly, 0, sun.dec >= 0 ? -89 : 89));
    assert.ok(!inside(poly, 0, sun.dec >= 0 ? 89 : -89) || Math.abs(sun.dec) < 1);
  }
});

test("pointing: the nearest dot within reach, and nothing when nothing is near", () => {
  const items = [{ x: 10, y: 10, id: "a" }, { x: 30, y: 10, id: "b" }, { x: 200, y: 200, id: "c" }];
  assert.equal(M.nearest(items, 28, 12, 10).id, "b");
  assert.equal(M.nearest(items, 19, 10, 10).id, "a", "closer of two");
  assert.equal(M.nearest(items, 100, 100, 10), null);
  assert.equal(M.nearest([], 1, 1), null);
});

test("colour mixing reads the colours a browser reports and gives up on anything else", () => {
  assert.equal(M.mixRgb("rgb(0, 0, 0)", "rgb(100, 200, 50)", 0.5), "rgba(50, 100, 25, 1)");
  assert.equal(M.mixRgb("rgba(0, 0, 0, 0.5)", "rgb(255, 255, 255)", 1), "rgba(255, 255, 255, 1)");
  assert.equal(M.mixRgb("rgb(10, 20, 30)", "rgb(10, 20, 30)", 0.3), "rgba(10, 20, 30, 1)");
  assert.equal(M.mixRgb("banana", "rgb(1, 2, 3)", 0.5), undefined);
});

test("land outline (Natural Earth 110m) is there, small, and credited", () => {
  const file = path.join(__dirname, "..", "public", "js", "vendor", "land110.js");
  const src = fs.readFileSync(file, "utf8");
  assert.ok(src.length < 150 * 1024, `${src.length} bytes`);
  assert.match(src, /Natural Earth/);
  assert.match(src, /PUBLIC DOMAIN/i);
  // (vendor/ is marked as an ES module folder, so run the plain script the way a browser does)
  const ctx = { self: {} };
  vm.runInNewContext(src, ctx);
  const land = ctx.self.BWLand;
  const rings = land.rings();
  assert.ok(rings.length > 100 && rings.length === land.count);
  assert.ok(rings.every((r) => r.length >= 3 && r.every(([lon, lat]) => lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)));
  assert.equal(land.rings(), rings, "decoded once");
  // known places are on land: a ring contains Sheffield, Sydney and Denver; mid-Atlantic and mid-Pacific are in none
  const onLand = (lon, lat) => {
    let n = 0;
    for (const poly of rings) {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, yi] = poly[i], [xj, yj] = poly[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
      }
      if (c) n++;
    }
    return n % 2 === 1; // even-odd, as the map fills it
  };
  assert.ok(onLand(-1.5, 53.4), "Sheffield");
  assert.ok(onLand(151.2, -33.9) || onLand(150, -30), "Australia");
  assert.ok(onLand(-105, 39.7), "Denver");
  assert.ok(onLand(25, 5), "Africa");
  assert.ok(onLand(0, -80), "Antarctica");
  assert.ok(!onLand(-30, 30), "mid-Atlantic");
  assert.ok(!onLand(-150, 0), "mid-Pacific");
  assert.ok(!onLand(50, 42), "Caspian Sea");
});
