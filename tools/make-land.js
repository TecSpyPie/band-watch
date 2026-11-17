// Reads Natural Earth land (TopoJSON data file) and writes an SVG path in 360x180 lon/lat space.
// Usage: npm i world-atlas@2.0.2 in a scratch folder, then node tools/make-land.js <that folder>/node_modules/world-atlas/land-110m.json public/js/land.js
// (decodes the TopoJSON arcs itself, so no library code runs).
"use strict";
const fs = require("fs");
const topo = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
const arcs = topo.arcs.map((arc) => { let x = 0, y = 0; return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; }); });
const arcPts = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
const ring = (ids) => { const pts = []; ids.forEach((i, k) => { const a = arcPts(i); pts.push(...(k ? a.slice(1) : a)); }); return pts; };
const geoms = topo.objects.land.type === "GeometryCollection" ? topo.objects.land.geometries : [topo.objects.land];
let d = "";
for (const g of geoms) {
  const polys = g.type === "MultiPolygon" ? g.arcs : [g.arcs];
  for (const poly of polys) for (const r of poly) {
    let prev = null; const out = []; let shift = 0, lastLon = null;
    for (const [lon0, lat] of ring(r)) {
      // Keep rings that cross the 180th meridian continuous; the map draws the outline again 360 degrees either side.
      if (lastLon !== null && lon0 + shift - lastLon > 180) shift -= 360;
      else if (lastLon !== null && lon0 + shift - lastLon < -180) shift += 360;
      const lon = lon0 + shift; lastLon = lon;
      const k = `${Math.round((lon + 180) * 2) / 2},${Math.round((90 - lat) * 2) / 2}`;
      if (k !== prev) out.push(k); prev = k;
    }
    if (out.length >= 3) d += `M${out.join("L")}Z`;
  }
}
fs.writeFileSync(process.argv[3], `/* World land outline for Band Watch's maps: Natural Earth 1:110m land (public domain), via the world-atlas
   package's land-110m.json, as an SVG path in the maps' 360 x 180 longitude/latitude space (half-degree steps). Rings that cross the 180th meridian run past the edge; map.js (landSvg) draws the path
   again 360 degrees to each side so both halves show. */
"use strict";
const LAND_PATH = "${d}";
`);
console.log("bytes", fs.statSync(process.argv[3]).size);
