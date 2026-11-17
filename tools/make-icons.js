"use strict";
// Draws Band Watch's app icons (the favicon's teal tile and white wave) as PNG files, with no
// dependencies: node tools/make-icons.js public/icons
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// The favicon wave, "M6 22c3-9 5-9 7 0s4 9 7 0 4-9 6-3", in a 32 x 32 box, as cubic Bezier segments.
const SEGS = [[[6, 22], [9, 13], [11, 13], [13, 22]], [[13, 22], [15, 31], [17, 31], [20, 22]], [[20, 22], [23, 13], [24, 13], [26, 19]]];
const PTS = [];
for (const [a, b, c, d] of SEGS) {
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, u = 1 - t;
    PTS.push([u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
      u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]]);
  }
}
function distToWave(x, y) {
  if (x < 4 || x > 28 || y < 11 || y > 32) return Infinity; // nowhere near the wave
  let best = Infinity;
  for (let i = 1; i < PTS.length; i++) {
    const [ax, ay] = PTS[i - 1], [bx, by] = PTS[i];
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

/** size in pixels; radius of the tile's corners (32-unit box); scale of the wave (1 = as in the favicon). */
function draw(size, radius, scale) {
  const TEAL = [0x0b, 0x72, 0x85], WHITE = [255, 255, 255], SS = 4;
  const rows = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let tile = 0, wave = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const x = ((px + (sx + 0.5) / SS) / size) * 32, y = ((py + (sy + 0.5) / SS) / size) * 32;
        const cx = Math.min(Math.max(x, radius), 32 - radius), cy = Math.min(Math.max(y, radius), 32 - radius);
        if (Math.hypot(x - cx, y - cy) > radius) continue;
        tile++;
        if (distToWave(16 + (x - 16) / scale, 16 + (y - 16) / scale) <= 1.25) wave++;
      }
      const n = SS * SS, o = 1 + px * 4;
      for (let k = 0; k < 3; k++) row[o + k] = tile ? Math.round((TEAL[k] * (tile - wave) + WHITE[k] * wave) / tile) : 0;
      row[o + 3] = Math.round((255 * tile) / n);
    }
    rows.push(row);
  }
  return png(size, Buffer.concat(rows));
}

function png(size, raw) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const out = process.argv[2] || "public/icons";
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "icon-192.png"), draw(192, 6, 1));
fs.writeFileSync(path.join(out, "icon-512.png"), draw(512, 6, 1));
fs.writeFileSync(path.join(out, "maskable-512.png"), draw(512, 0, 0.72)); // full bleed, wave inside the safe zone
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), draw(180, 0, 0.85)); // iOS rounds the corners itself
