/* Writes a test RTTY recording (a WAV file) so the RTTY decoder can be tried without a signal on the air:
 *   node tools/rtty-wav.js out.wav "CQ CQ DE M3VRV 599 73" [--noise 0.1] [--low 2125] [--baud 45.45] [--shift 170] [--reverse]
 * Play it into the computer's sound input (a virtual cable, or speakers near the microphone). It only writes a file. */
"use strict";
const fs = require("fs");
const Rtty = require("../public/js/rtty.js");

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(`--${name}`); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i < 0 ? dflt : Number(args.splice(i, 2)[1]); };
const reverse = flag("reverse");
const noise = opt("noise", 0.05), low = opt("low", 2125), baud = opt("baud", 45.45), shift = opt("shift", 170);
const [file, text] = args;
if (!file || !text) {
  console.error('Usage: node tools/rtty-wav.js out.wav "TEXT" [--noise 0.1] [--low 2125] [--baud 45.45] [--shift 170] [--reverse]');
  process.exit(1);
}

const rate = 48000;
const pcm = Rtty.synthesize(`${text}\n`, { fs: rate, noise, low, baud, shift, reverse, lead: 1.5, tail: 1.5 });
const buf = Buffer.alloc(44 + pcm.length * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + pcm.length * 2, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(pcm.length * 2, 40);
pcm.forEach((v, i) => buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
fs.writeFileSync(file, buf);
console.log(`Wrote ${file}: ${(pcm.length / rate).toFixed(1)} s of RTTY (${baud} baud, ${shift} Hz shift, lower tone ${low} Hz${reverse ? ", reversed" : ""}).`);
