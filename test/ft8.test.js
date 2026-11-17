"use strict";
// FT8 / FT4 decoder: checked against real WSJT-X output, then end to end with simulated signals.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../public/js/ft8.js");

const toBits = (s) => Uint8Array.from(s, (c) => +c);

test("matches WSJT-X ft8code exactly: CRC, LDPC parity, tones (WSJT-X 2.7.0 output)", () => {
  // ft8code "CQ vk0muchTooLongCallsign", as posted to wsjt-devel
  const bits = toBits("01000101011010110101100001100111111001001010010011011101011110011000000001100");
  const cw = F.encode174(bits);
  assert.equal(Array.from(cw.slice(77, 91)).join(""), "10111011010101");
  assert.equal(Array.from(cw.slice(91)).join(""), "10110010011101111100011011010111110000101010111110001100100000111100110011111011011");
  const tones = new F.Decoder(F.FT8).tonesFor(cw).join("");
  assert.equal(tones, "3140652" + "31346620217433554737540021266" + "3140652" + "34432675223740637415507542722" + "3140652");
  assert.equal(F.unpack77(bits), "CQ VK0MUCHTOOL");
  assert.equal(F.ldpcErrors(cw), 0);
});

test("matches WSJT-X ft8code packing of a non-standard call (CQ YW18FIFA)", () => {
  const want = "00101111000100000000000000001110111011100011100111111010101100001001110001100";
  assert.equal(Array.from(F.pack77("CQ YW18FIFA")).join(""), want);
  assert.equal(F.unpack77(toBits(want)), "CQ YW18FIFA");
});

test("standard callsigns pack as WSJT-X does", () => {
  // n28 = 36*10*27^3*i1 + ... + NTOKENS + MAX22, with a leading space when the digit is 2nd
  assert.equal(F.pack28("K1ABC"), 6257896 + ((((0 * 36 + 20) * 10 + 1) * 27 + 1) * 27 + 2) * 27 + 3);
  assert.equal(F.pack28("2E0ABC"), 6257896 + ((((3 * 36 + 14) * 10 + 0) * 27 + 1) * 27 + 2) * 27 + 3);
  assert.equal(F.pack28("CQ"), 2);
  assert.equal(F.pack28("QRZ"), 1);
  assert.equal(F.pack28("DE"), 0);
  assert.equal(F.pack28("CQ 290"), 293);
  assert.equal(F.pack28("CQ DX"), 1003 + 4 * 27 + 24); // right-justified "  DX"
  assert.equal(F.pack28("PJ4/K1ABC"), -1); // not a standard call
});

test("every common message survives a pack/unpack round trip", () => {
  const msgs = ["CQ M3VRV IO93", "G4ABC M3VRV -12", "M3VRV G4ABC R-08", "G4ABC M3VRV RR73", "G4ABC M3VRV RRR",
    "G4ABC M3VRV 73", "CQ DX K1ABC FN42", "CQ 290 K1ABC FN42", "K1ABC 2E0ABC R+05", "M3VRV/P G4ABC IO93",
    "K1ABC/R W9XYZ EN37", "CQ PJ4/K1ABC", "TNX 73 GL", "K1ABC W9XYZ", "G4ABC M3VRV +32", "G4ABC M3VRV -30"];
  for (const m of msgs) {
    const h = new F.CallHashes();
    const b = F.pack77(m, h);
    assert.ok(b, `packs: ${m}`);
    assert.equal(F.unpack77(b, h), m);
  }
  // A hashed call shows as <...> until the full call has been seen
  const b = F.pack77("<PJ4/K1ABC> W9XYZ RRR");
  assert.equal(F.unpack77(b, new F.CallHashes()), "<...> W9XYZ RRR");
  const h = new F.CallHashes();
  h.add("PJ4/K1ABC");
  assert.equal(F.unpack77(b, h), "<PJ4/K1ABC> W9XYZ RRR");
});

/** A 15 s (or 7.5 s) receive buffer: signals plus white noise. snr is in 2500 Hz, as WSJT-X shows it. */
function band(proto, signals, noiseRms = 0.05, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const buf = new Float32Array(Math.round(proto.period * proto.fs));
  for (let i = 0; i < buf.length; i++) buf[i] = noiseRms * gauss();
  const noise2500 = noiseRms * noiseRms * (2500 / (proto.fs / 2));
  for (const sig of signals) {
    const amp = Math.sqrt(2 * noise2500 * 10 ** (sig.snr / 10));
    F.synthesize(F.encodeTones(sig.text, proto), { proto, baseHz: sig.freq, startSec: proto.start + (sig.dt || 0), amp, out: buf });
  }
  return buf;
}

test("FT8: decodes several signals at once, with the right frequency, time and SNR", () => {
  const sigs = [
    { text: "CQ M3VRV IO93", freq: 1000, snr: -5, dt: 0 },
    { text: "G4ABC M3VRV -12", freq: 1520, snr: -12, dt: 0.4 },
    { text: "CQ DX K1ABC FN42", freq: 640, snr: 0, dt: -0.3 },
    { text: "M3VRV G4ABC R-08", freq: 2210, snr: -15, dt: 1.0 },
    { text: "TNX 73 GL", freq: 2700, snr: -8, dt: 0.2 },
  ];
  const t0 = Date.now();
  const got = new F.Decoder(F.FT8).decode(band(F.FT8, sigs));
  const ms = Date.now() - t0;
  for (const s of sigs) {
    const d = got.find((g) => g.text === s.text);
    assert.ok(d, `decoded "${s.text}" (got: ${got.map((g) => g.text).join(" | ")})`);
    assert.ok(Math.abs(d.freq - s.freq) <= 4, `${s.text}: ${d.freq} Hz`);
    assert.ok(Math.abs(d.dt - s.dt) <= 0.1, `${s.text}: dt ${d.dt}`);
    assert.ok(Math.abs(d.snr - s.snr) <= 4, `${s.text}: snr ${d.snr} vs ${s.snr}`);
  }
  assert.equal(got.length, sigs.length, "no false decodes");
  assert.ok(ms < 5000, `decoded in ${ms} ms`);
});

test("FT8: weak signals down to about -18 dB; noise alone gives nothing", () => {
  let ok = 0;
  for (let seed = 1; seed <= 5; seed++) {
    const got = new F.Decoder(F.FT8).decode(band(F.FT8, [{ text: "CQ M3VRV IO93", freq: 1234, snr: -18 }], 0.05, seed));
    if (got.some((g) => g.text === "CQ M3VRV IO93")) ok++;
  }
  assert.ok(ok >= 3, `${ok}/5 decoded at -18 dB`);
  for (let seed = 10; seed < 13; seed++) {
    assert.deepEqual(new F.Decoder(F.FT8).decode(band(F.FT8, [], 0.05, seed)), []);
  }
});

test("FT4: decodes several signals, including the scrambled message bits", () => {
  const sigs = [
    { text: "CQ M3VRV IO93", freq: 900, snr: -5, dt: 0 },
    { text: "G4ABC M3VRV RR73", freq: 1700, snr: -10, dt: 0.3 },
    { text: "CQ TEST K1ABC FN42", freq: 2400, snr: 0, dt: -0.2 },
  ];
  const got = new F.Decoder(F.FT4).decode(band(F.FT4, sigs));
  for (const s of sigs) {
    const d = got.find((g) => g.text === s.text);
    assert.ok(d, `decoded "${s.text}" (got: ${got.map((g) => g.text).join(" | ")})`);
    assert.ok(Math.abs(d.freq - s.freq) <= 12, `${s.text}: ${d.freq} Hz`);
  }
  assert.equal(got.length, sigs.length);
});

test("resampler: 48 kHz in, the decoder's rate out, a tone stays a tone", () => {
  const r = new F.Resampler(48000, F.FT8.fs);
  const n = 48000;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * 1500 * i) / 48000);
  const parts = [r.process(x.subarray(0, 10007)), r.process(x.subarray(10007, 30000)), r.process(x.subarray(30000))];
  const y = Float32Array.from(parts.flatMap((p) => Array.from(p)));
  assert.ok(Math.abs(y.length - F.FT8.fs) < 40, `length ${y.length}`);
  // check the frequency by counting zero crossings in the middle
  let zc = 0;
  for (let i = 2000; i < 10000; i++) if (y[i - 1] < 0 && y[i] >= 0) zc++;
  const hz = zc / (8000 / F.FT8.fs);
  assert.ok(Math.abs(hz - 1500) < 3, `${hz} Hz`);
});
