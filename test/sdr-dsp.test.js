"use strict";
// The RTL-SDR demodulator: synthetic I/Q in, check the audio that comes out.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../public/js/sdr-dsp.js");

const FS = D.IN_RATE;

/** I/Q bytes as the dongle would send them when tuned to centreFor(dial), for a signal
 *  given as a function of time returning [i, q] relative to the dial frequency. */
function synth(seconds, signal) {
  const n = Math.round(seconds * FS);
  const out = new Uint8Array(n * 2);
  const shift = -D.OFFSET; // the dial frequency sits a quarter of the sample rate below centre
  for (let k = 0; k < n; k++) {
    const t = k / FS;
    const [si, sq] = signal(t);
    const c = Math.cos(2 * Math.PI * shift * t);
    const s = Math.sin(2 * Math.PI * shift * t);
    const i = si * c - sq * s;
    const q = si * s + sq * c;
    // a little noise, as real samples always have
    const ni = (Math.random() - 0.5) * 0.01;
    const nq = (Math.random() - 0.5) * 0.01;
    out[2 * k] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * (i + ni))));
    out[2 * k + 1] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * (q + nq))));
  }
  return out;
}

const tone = (f, a = 0.5) => (t) => [a * Math.cos(2 * Math.PI * f * t), a * Math.sin(2 * Math.PI * f * t)];

/** Feed the samples in uneven chunks (as a network stream would), return the audio. */
function run(mode, bytes) {
  const d = new D.Demodulator();
  d.setMode(mode);
  const parts = [];
  let pos = 0;
  const sizes = [16383, 4097, 65536, 777];
  for (let i = 0; pos < bytes.length; i++) {
    const n = sizes[i % sizes.length];
    parts.push(d.process(bytes.subarray(pos, pos + n)));
    pos += n;
  }
  const len = parts.reduce((a, p) => a + p.length, 0);
  const audio = new Float32Array(len);
  let o = 0;
  for (const p of parts) { audio.set(p, o); o += p.length; }
  return { audio, d };
}

/** Strongest audio frequency (Hz) in the second half of the audio, and its share of the power. */
function peak(audio) {
  const x = audio.subarray(audio.length >> 1);
  let best = 0;
  let bestF = 0;
  let total = 0;
  for (let f = 100; f <= 5000; f += 10) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < x.length; n++) {
      const a = (2 * Math.PI * f * n) / D.AUDIO_RATE;
      re += x[n] * Math.cos(a);
      im -= x[n] * Math.sin(a);
    }
    const p = re * re + im * im;
    total += p;
    if (p > best) { best = p; bestF = f; }
  }
  return { f: bestF, share: best / total };
}

const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

test("constants: tuned a quarter of the sample rate above the dial frequency", () => {
  assert.equal(D.IN_RATE, 960000);
  assert.equal(D.OFFSET, 240000);
  assert.equal(D.centreFor(14200000), 14440000);
  assert.equal(D.IN_RATE / D.AUDIO_RATE, 20);
});

test("audio comes out at 48 kHz, whatever the chunk sizes", () => {
  const { audio } = run("usb", synth(0.5, tone(1000)));
  assert.ok(Math.abs(audio.length - 24000) <= 2, `got ${audio.length} samples`);
});

test("USB: a signal 1 kHz above the dial frequency is a 1 kHz note", () => {
  const { audio } = run("usb", synth(0.4, tone(1000)));
  const p = peak(audio);
  assert.ok(Math.abs(p.f - 1000) <= 10, `peak at ${p.f} Hz`);
  assert.ok(rms(audio.subarray(audio.length >> 1)) > 0.05, "audible");
});

test("USB rejects the other sideband; LSB hears it", () => {
  const below = synth(0.4, tone(-1000));
  const usb = run("usb", below).audio;
  const lsb = run("lsb", below).audio;
  const p = peak(lsb);
  assert.ok(Math.abs(p.f - 1000) <= 10, `LSB peak at ${p.f} Hz`);
  // The AGC lifts whatever is left, so compare the tone's purity rather than loudness.
  assert.ok(p.share > 0.5, `LSB tone is clean (${p.share})`);
  assert.ok(peak(usb).share < 0.2, `USB doesn't hear the lower sideband (${peak(usb).share})`);
});

test("CW: a carrier on the dial frequency is a 700 Hz note; 1 kHz away is filtered out", () => {
  const on = run("cw", synth(0.4, tone(0)));
  assert.ok(Math.abs(peak(on.audio).f - 700) <= 10, `peak at ${peak(on.audio).f}`);
  const off = run("cw", synth(0.4, tone(1000, 0.5)));
  assert.ok(off.d.level < on.d.level - 30, `channel level ${off.d.level} vs ${on.d.level}`);
});

test("AM: an 800 Hz modulated carrier gives an 800 Hz note", () => {
  const am = (t) => {
    const a = 0.3 * (1 + 0.6 * Math.cos(2 * Math.PI * 800 * t));
    return [a, 0];
  };
  const { audio } = run("am", synth(0.5, am));
  assert.ok(Math.abs(peak(audio).f - 800) <= 10, `peak at ${peak(audio).f}`);
});

test("FM: 1 kHz tone, 2.5 kHz deviation", () => {
  const fm = (t) => {
    const ph = (2500 / 1000) * Math.sin(2 * Math.PI * 1000 * t);
    return [0.5 * Math.cos(ph), 0.5 * Math.sin(ph)];
  };
  const { audio } = run("fm", synth(0.4, fm));
  assert.ok(Math.abs(peak(audio).f - 1000) <= 10, `peak at ${peak(audio).f}`);
});

test("broadcast FM: 1 kHz tone, 75 kHz deviation", () => {
  const fm = (t) => {
    const ph = (75000 / 1000) * Math.sin(2 * Math.PI * 1000 * t);
    return [0.5 * Math.cos(ph), 0.5 * Math.sin(ph)];
  };
  const { audio } = run("wfm", synth(0.3, fm));
  assert.ok(Math.abs(peak(audio).f - 1000) <= 10, `peak at ${peak(audio).f}`);
  assert.ok(Math.abs(audio.length - 14400) <= 2);
});

test("signal level: louder signal reads higher", () => {
  const quiet = run("am", synth(0.2, tone(0, 0.02))).d.level;
  const loud = run("am", synth(0.2, tone(0, 0.5))).d.level;
  assert.ok(loud - quiet > 20, `${quiet} -> ${loud}`);
});

test("spectrum: a tone shows up in the right bin", () => {
  const f = 100000; // 100 kHz above the dongle's centre
  const n = 1024;
  const bytes = new Uint8Array(n * 2);
  for (let k = 0; k < n; k++) {
    bytes[2 * k] = Math.round(127.5 + 100 * Math.cos((2 * Math.PI * f * k) / FS));
    bytes[2 * k + 1] = Math.round(127.5 + 100 * Math.sin((2 * Math.PI * f * k) / FS));
  }
  const s = D.spectrum(bytes, n);
  let bi = 0;
  for (let k = 1; k < n; k++) if (s[k] > s[bi]) bi = k;
  const binHz = FS / n;
  const got = (bi - n / 2) * binHz;
  assert.ok(Math.abs(got - f) <= binHz, `peak at ${got} Hz`);
});

test("unknown modes fall back to USB", () => {
  const d = new D.Demodulator();
  d.setMode("dsb");
  assert.equal(d.mode, "usb");
});

/* ---------- Receiver settings ---------- */

function synthAt(rate, seconds, f, amp = 0.5) {
  const n = Math.round(seconds * rate);
  const out = new Uint8Array(n * 2);
  const shift = -rate / 4;
  for (let k = 0; k < n; k++) {
    const ph = (2 * Math.PI * (f + shift) * k) / rate;
    out[2 * k] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * (amp * Math.cos(ph) + (Math.random() - 0.5) * 0.01))));
    out[2 * k + 1] = Math.max(0, Math.min(255, Math.round(127.5 + 127.5 * (amp * Math.sin(ph) + (Math.random() - 0.5) * 0.01))));
  }
  return out;
}

test("sample rates 1.92 and 2.4 MS/s: same audio, still 48 kHz", () => {
  assert.deepEqual(D.RATES, [960000, 1920000, 2400000]);
  for (const rate of [1920000, 2400000]) {
    const d = new D.Demodulator(rate);
    assert.equal(d.inRate, rate);
    const audio = d.process(synthAt(rate, 0.4, 1000));
    assert.ok(Math.abs(audio.length - 0.4 * 48000) <= 2, `${rate}: ${audio.length} samples`);
    const p = peak(audio);
    assert.ok(Math.abs(p.f - 1000) <= 10, `${rate}: peak at ${p.f}`);
  }
  assert.equal(D.centreFor(14200000, 2400000), 14800000);
  assert.equal(new D.Demodulator(123).inRate, 960000, "unknown rates fall back");
});

test("filter width: a narrow SSB filter cuts a 2.5 kHz tone that a wide one passes", () => {
  const sig = synthAt(960000, 0.4, 2500);
  const wide = new D.Demodulator();
  wide.configure({ widths: { usb: 3000 } });
  wide.process(sig);
  const narrow = new D.Demodulator();
  narrow.configure({ widths: { usb: 1800 } });
  narrow.process(sig);
  assert.ok(narrow.level < wide.level - 20, `narrow ${narrow.level.toFixed(1)} vs wide ${wide.level.toFixed(1)} dBFS`);
  // widths that aren't offered are ignored
  const d = new D.Demodulator();
  d.configure({ widths: { usb: 12345, cw: 250 } });
  assert.equal(d.widths.usb, 2700);
  assert.equal(d.widths.cw, 250);
});

test("squelch: silent below the level set, open above it", () => {
  const d = new D.Demodulator();
  d.setMode("am");
  d.configure({ squelch: -20 });
  const weak = d.process(synthAt(960000, 0.3, 0, 0.01));
  assert.ok(weak.every((v) => v === 0), "weak signal muted");
  const big = synthAt(960000, 0.3, 0, 0.6);
  let heard = false;
  for (let i = 0; i < big.length; i += 19200) heard = d.process(big.subarray(i, i + 19200)).some((v) => v !== 0) || heard;
  assert.ok(heard, "strong signal heard");
  d.configure({ squelch: null });
  assert.equal(d.squelch, null);
});

test("AGC speed and broadcast FM de-emphasis settings", () => {
  const d = new D.Demodulator();
  d.configure({ agc: "fast" });
  assert.equal(d.agcDecay, D.AGC_DECAY.fast);
  d.configure({ agc: "nonsense" });
  assert.equal(d.agcDecay, D.AGC_DECAY.fast, "ignored");
  d.setMode("wfm");
  const a50 = d.deemphA;
  d.configure({ deemph: 75 });
  assert.ok(d.deemphA > a50, "75 µs is a slower de-emphasis");
  assert.equal(d.mode, "wfm", "mode kept");
});
