/* HamShack by M0GLP & M3VRV: plays the RTL-SDR audio. The page posts 48 kHz blocks; this keeps a short
 * buffer so the sound stays smooth, and trims it if it grows (the dongle's clock and the sound
 * card's never quite agree). */
"use strict";

class BandWatchSdrPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(48000 * 2);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.port.onmessage = (e) => this.push(e.data);
  }

  push(block) {
    const cap = this.buf.length;
    for (let i = 0; i < block.length; i++) {
      this.buf[this.write] = block[i];
      this.write = (this.write + 1) % cap;
    }
    this.count = Math.min(cap, this.count + block.length);
    // Keep the delay under half a second: drop the oldest audio if it has piled up.
    const max = sampleRate / 2;
    if (this.count > max) {
      const drop = this.count - Math.round(sampleRate * 0.15);
      this.read = (this.read + drop) % cap;
      this.count -= drop;
    }
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    const cap = this.buf.length;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (this.count > 0) {
        v = this.buf[this.read];
        this.read = (this.read + 1) % cap;
        this.count--;
      }
      for (let c = 0; c < out.length; c++) out[c][i] = v;
    }
    return true;
  }
}

registerProcessor("bw-sdr-player", BandWatchSdrPlayer);
