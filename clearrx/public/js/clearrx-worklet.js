/* ClearRX by M3VRV: the sound processor. It runs in the sound system's own thread (an AudioWorklet), so the sound
 * never stutters. rxfx.js (the effects) is loaded into the same place first and gives globalThis.RxFx. */
"use strict";

class ClearRxProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chain = new globalThis.RxFx.Chain({ preset: "off" });
    this.bypass = false;
    this.gain = 1;
    this.inPeak = 0;
    this.outPeak = 0;
    this.sent = 0;
    this.buf = new Float32Array(128);
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.settings) this.chain.configure(m.settings);
      if (typeof m.bypass === "boolean") this.bypass = m.bypass;
      if (Number.isFinite(m.gain)) this.gain = Math.max(0, Math.min(4, m.gain));
    };
  }

  process(inputs, outputs) {
    const input = inputs[0], out = outputs[0];
    const n = out[0].length;
    if (this.buf.length !== n) this.buf = new Float32Array(n);
    const x = this.buf;
    // Mix the input down to one channel (radios send mono, or the same on both)
    x.fill(0);
    if (input && input.length) {
      for (let c = 0; c < input.length; c++) { const ch = input[c]; for (let i = 0; i < n; i++) x[i] += ch[i] / input.length; }
    }
    for (let i = 0; i < n; i++) { x[i] *= this.gain; const a = Math.abs(x[i]); if (a > this.inPeak) this.inPeak = a; }
    if (!this.bypass) this.chain.process(x);
    else for (let i = 0; i < n; i++) x[i] = Math.max(-1, Math.min(1, x[i]));
    for (let i = 0; i < n; i++) { const a = Math.abs(x[i]); if (a > this.outPeak) this.outPeak = a; }
    for (let c = 0; c < out.length; c++) out[c].set(x);
    // The meters, ten times a second
    this.sent += n;
    if (this.sent >= sampleRate / 10) {
      this.sent = 0;
      const db = (v) => (v > 1e-6 ? 20 * Math.log10(v) : -120);
      // "clip": the sound coming in is too loud (it would be clipped before ClearRX can help)
      this.port.postMessage({ meter: { inPeak: db(this.inPeak), outPeak: db(this.outPeak), clip: this.inPeak >= 0.999 || (this.bypass && this.outPeak >= 0.999) } });
      this.inPeak = 0;
      this.outPeak = 0;
    }
    return true;
  }
}

registerProcessor("clearrx", ClearRxProcessor);
