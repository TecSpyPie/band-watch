/* Band Watch by M3vrv: passes sound-card input to the page in blocks, for the FT8/FT4 decoder. */
"use strict";

class BandWatchCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(4096);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.block[this.n++] = ch[i];
        if (this.n === this.block.length) {
          this.port.postMessage(this.block, [this.block.buffer]);
          this.block = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("bw-capture", BandWatchCapture);
