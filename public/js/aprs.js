/* HamShack by M0GLP & M3VRV: APRS on 2 m. Plain JavaScript for the decoder worker and the tests (window.Aprs / require).
 *   Demod      FM audio -> bits: Bell 202 AFSK (mark 1200 Hz, space 2200 Hz, 1200 baud), a clock that locks to the
 *              bit edges, NRZI, HDLC (flags, bit stuffing) and the frame check (CRC-16, X.25).
 *   parse()    an AX.25 frame -> from, to, path and the APRS report: position (plain or compressed, and Mic-E as
 *              used by most car and hand-held radios), symbol, course and speed, weather, status, messages, comment.
 *   encode()   a frame -> audio, for the tests.  */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Aprs = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const FS = 12000, BAUD = 1200, SPB = FS / BAUD, MARK = 1200, SPACE = 2200;

  /* ---------- Frame check ---------- */
  function crc(bytes) {
    let c = 0xffff;
    for (const b of bytes) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0x8408 : c >>> 1;
    }
    return ~c & 0xffff;
  }

  /* ---------- Building a frame (tests) ---------- */
  function addr(call, last) {
    const [base, ssid = "0"] = String(call).toUpperCase().split("-");
    const out = [];
    for (let i = 0; i < 6; i++) out.push(((base.charCodeAt(i) || 32) << 1) & 0xff);
    out.push(0x60 | ((Number(ssid) & 15) << 1) | (last ? 1 : 0));
    return out;
  }
  /** AX.25 UI frame bytes (without flags), FCS included. */
  function frame(from, to, path, info) {
    const calls = [to, from, ...path];
    const b = calls.flatMap((c, i) => addr(c, i === calls.length - 1));
    b.push(0x03, 0xf0);
    for (const ch of info) b.push(ch.charCodeAt(0) & 0xff);
    const f = crc(b);
    b.push(f & 0xff, f >> 8);
    return b;
  }
  /** Audio for a frame: preamble flags, the frame with bit stuffing, NRZI, AFSK; continuous phase. */
  function encode(bytes, { rate = FS, amp = 0.6, flags = 30 } = {}) {
    const bits = [];
    const flag = () => { for (let k = 0; k < 8; k++) bits.push((0x7e >> k) & 1); };
    for (let i = 0; i < flags; i++) flag();
    let ones = 0;
    for (const b of bytes) for (let k = 0; k < 8; k++) {
      const v = (b >> k) & 1;
      bits.push(v);
      if (v) { if (++ones === 5) { bits.push(0); ones = 0; } } else ones = 0;
    }
    for (let i = 0; i < 4; i++) flag();
    // NRZI: a 0 changes the tone, a 1 keeps it
    let tone = 1;
    const tones = bits.map((v) => { if (!v) tone ^= 1; return tone; });
    const spb = rate / BAUD;
    const out = new Float32Array(Math.ceil(tones.length * spb));
    let ph = 0;
    for (let i = 0; i < out.length; i++) {
      const f = tones[Math.min(tones.length - 1, Math.floor(i / spb))] ? MARK : SPACE;
      ph += (2 * Math.PI * f) / rate;
      out[i] = amp * Math.sin(ph);
    }
    return out;
  }

  /* ---------- Demodulator ---------- */
  class Demod {
    /** onFrame(bytes) for each frame whose check passes. */
    constructor(onFrame) {
      this.onFrame = onFrame;
      const n = Math.round(SPB); // correlate over one bit
      this.n = n;
      this.mc = new Float64Array(n); this.ms = new Float64Array(n); this.sc = new Float64Array(n); this.ss = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        this.mc[i] = Math.cos((2 * Math.PI * MARK * i) / FS); this.ms[i] = Math.sin((2 * Math.PI * MARK * i) / FS);
        this.sc[i] = Math.cos((2 * Math.PI * SPACE * i) / FS); this.ss[i] = Math.sin((2 * Math.PI * SPACE * i) / FS);
      }
      this.buf = new Float64Array(n); this.pos = 0;
      this.lastD = 0; this.phase = 0; this.lastTone = 0;
      this.shift = 0; this.bytes = []; this.byte = 0; this.nbit = 0; this.ones = 0; this.inFrame = false;
      this.peakM = 1e-6; this.peakS = 1e-6;
    }
    push(x) {
      const { n, buf } = this;
      for (let k = 0; k < x.length; k++) {
        buf[this.pos] = x[k];
        this.pos = (this.pos + 1) % n;
        let a = 0, b = 0, c = 0, d = 0;
        for (let i = 0, j = this.pos; i < n; i++, j = (j + 1) % n) {
          const v = buf[j];
          a += v * this.mc[i]; b += v * this.ms[i]; c += v * this.sc[i]; d += v * this.ss[i];
        }
        let m = Math.sqrt(a * a + b * b), s = Math.sqrt(c * c + d * d);
        // even out the two tones (FM radios tilt the audio: de-emphasis makes 2200 Hz quieter)
        this.peakM = Math.max(m, this.peakM * 0.9995); this.peakS = Math.max(s, this.peakS * 0.9995);
        m /= this.peakM; s /= this.peakS;
        const tone = m > s ? 1 : 0;
        // the bit clock: a tone change should land half-way between two samples, so each bit is read in its middle
        if (tone !== this.lastTone) { this.phase -= (this.phase - 0.5) * 0.3; this.lastTone = tone; }
        this.phase += 1 / SPB;
        if (this.phase >= 1) { this.phase -= 1; this.bit(tone); }
      }
    }
    bit(tone) {
      const v = tone === this.lastBitTone ? 1 : 0; // NRZI
      this.lastBitTone = tone;
      this.shift = ((this.shift << 1) | v) & 0xff;
      // a flag is 01111110 in time order; bits arrive lowest first, so look at the last 8 as they came
      this.hist = ((this.hist || 0) >>> 1) | (v << 7);
      if ((this.hist & 0xff) === 0x7e) {
        if (this.inFrame && this.bytes.length >= 17) this.done();
        this.inFrame = true; this.bytes = []; this.byte = 0; this.nbit = 0; this.ones = 0;
        return;
      }
      if (!this.inFrame) return;
      if (v) { this.ones++; if (this.ones > 6) { this.inFrame = false; return; } } else {
        if (this.ones === 5) { this.ones = 0; return; } // a stuffed 0
        this.ones = 0;
      }
      this.byte |= v << this.nbit;
      if (++this.nbit === 8) {
        this.bytes.push(this.byte); this.byte = 0; this.nbit = 0;
        if (this.bytes.length > 400) this.inFrame = false;
      }
    }
    done() {
      // the flag's own first bits (0 then six 1s) went into the byte buffer: drop that partial byte
      const b = this.bytes;
      if (b.length < 17) return;
      const body = b.slice(0, -2), f = crc(body);
      if ((f & 0xff) === b[b.length - 2] && f >> 8 === b[b.length - 1]) this.onFrame(body);
    }
  }

  /* ---------- AX.25 and APRS ---------- */
  function callOf(bytes, i) {
    let c = "";
    for (let k = 0; k < 6; k++) { const ch = bytes[i + k] >> 1; if (ch !== 32) c += String.fromCharCode(ch); }
    const ssid = (bytes[i + 6] >> 1) & 15;
    return { call: ssid ? `${c}-${ssid}` : c, last: bytes[i + 6] & 1, used: (bytes[i + 6] & 0x80) !== 0 };
  }

  /** "4903.50N" "07201.75W" -> degrees. */
  function dm(s, deg) {
    const m = new RegExp(`^(\\d{${deg}})([\\d ]{2}\\.[\\d ]{2})([NSEW])$`).exec(s);
    if (!m) return null;
    let v = Number(m[1]) + Number(m[2].replace(/ /g, "0")) / 60;
    if (m[3] === "S" || m[3] === "W") v = -v;
    return v;
  }
  const b91 = (s) => [...s].reduce((a, ch) => a * 91 + (ch.charCodeAt(0) - 33), 0);

  /** The APRS part of a frame: { type, lat, lon, symbol, course, speedKmh, altM, wx, status, msg, comment }. */
  function report(info, to) {
    const r = { type: "other", comment: "" };
    const t = info[0];
    let rest = info.slice(1);
    if (t === "!" || t === "=" || t === "/" || t === "@") {
      if (t === "/" || t === "@") rest = rest.slice(7); // timestamp
      r.type = "position";
      const p = /^(\d{4}\.[\d ]{2}[NS])(.)(\d{5}\.[\d ]{2}[EW])(.)(.*)$/s.exec(rest);
      if (p) {
        r.lat = dm(p[1], 2); r.lon = dm(p[3], 3); r.symbol = p[2] + p[4]; rest = p[5];
      } else if (/^[\/\\A-Za-j]/.test(rest) && rest.length >= 13) {
        // compressed: symbol table, 4 lat, 4 lon, symbol, cs, T
        r.lat = 90 - b91(rest.slice(1, 5)) / 380926;
        r.lon = -180 + b91(rest.slice(5, 9)) / 190463;
        r.symbol = rest[0] + rest[9];
        const c = rest.charCodeAt(10) - 33, s = rest.charCodeAt(11) - 33;
        if (rest[10] !== " " && c >= 0 && c <= 89) { r.course = c * 4; r.speedKmh = Math.round((1.08 ** s - 1) * 1.852); }
        rest = rest.slice(13);
      } else return { type: "other", comment: info };
      // a weather station's "220/004" is wind, not course and speed
      if (r.symbol && r.symbol[1] === "_") { r.type = "weather"; r.wx = weather(rest); rest = ""; }
      const cs = /^(\d{3})\/(\d{3})/.exec(rest);
      if (cs) { r.course = Number(cs[1]); r.speedKmh = Math.round(Number(cs[2]) * 1.852); rest = rest.slice(7); }
      const alt = /\/A=(-?\d{6})/.exec(rest);
      if (alt) { r.altM = Math.round(Number(alt[1]) * 0.3048); rest = rest.replace(alt[0], ""); }
      r.comment = rest.trim();
      return r;
    }
    if (t === "`" || t === "'") return micE(info, to);
    if (t === ">") return { type: "status", status: rest.trim(), comment: "" };
    if (t === ":") {
      const m = /^(.{9}):(.*?)(?:\{(\w+))?$/s.exec(rest);
      if (m) return { type: "message", to: m[1].trim(), msg: m[2], id: m[3] || "", comment: "" };
    }
    if (t === "_") return { type: "weather", wx: weather(rest.slice(8)), comment: "" };
    return { type: "other", comment: info };
  }

  function weather(s) {
    const w = {};
    const get = (k, n) => { const m = new RegExp(`${k}(-?\\d{${n}})`).exec(s); return m ? Number(m[1]) : null; };
    const dir = /^(\d{3})\/(\d{3})/.exec(s);
    if (dir) { w.windDir = Number(dir[1]); w.windKmh = Math.round(Number(dir[2]) * 1.609); }
    const g = get("g", 3); if (g != null) w.gustKmh = Math.round(g * 1.609);
    const t = get("t", 3); if (t != null) w.tempC = Math.round(((t - 32) * 5) / 9 * 10) / 10;
    const h = get("h", 2); if (h != null) w.humidity = h === 0 ? 100 : h;
    const b = get("b", 5); if (b != null) w.pressureHpa = b / 10;
    const r = get("r", 3); if (r != null) w.rainMm1h = Math.round(r * 0.254 * 10) / 10;
    return w;
  }

  /** Mic-E: latitude hidden in the destination call, longitude and speed in the info field. */
  function micE(info, to) {
    const d = String(to || "").split("-")[0].padEnd(6, " ");
    const digit = (ch) => { const c = ch.charCodeAt(0); if (c >= 48 && c <= 57) return c - 48; if (c >= 65 && c <= 74) return c - 65; if (c >= 80 && c <= 89) return c - 80; if (ch === "K" || ch === "L" || ch === "Z") return 0; return null; };
    const dg = [...d].map(digit);
    if (dg.some((x) => x == null) || info.length < 9) return { type: "other", comment: info };
    let lat = dg[0] * 10 + dg[1] + (dg[2] * 10 + dg[3] + (dg[4] * 10 + dg[5]) / 100) / 60;
    const north = d.charCodeAt(3) >= 80, lonOff = d.charCodeAt(4) >= 80, west = d.charCodeAt(5) >= 80;
    if (!north) lat = -lat;
    let lonDeg = info.charCodeAt(1) - 28;
    if (lonOff) lonDeg += 100;
    if (lonDeg >= 180 && lonDeg <= 189) lonDeg -= 80; else if (lonDeg >= 190 && lonDeg <= 199) lonDeg -= 190;
    let lonMin = info.charCodeAt(2) - 28; if (lonMin >= 60) lonMin -= 60;
    const lonHun = info.charCodeAt(3) - 28;
    let lon = lonDeg + (lonMin + lonHun / 100) / 60;
    if (west) lon = -lon;
    const sp = info.charCodeAt(4) - 28, dc = info.charCodeAt(5) - 28, se = info.charCodeAt(6) - 28;
    let speed = sp * 10 + Math.floor(dc / 10); if (speed >= 800) speed -= 800;
    let course = (dc % 10) * 100 + se; if (course >= 400) course -= 400;
    return { type: "position", micE: true, lat, lon, symbol: info[8] + info[7], course, speedKmh: Math.round(speed * 1.852), comment: info.slice(9).trim() };
  }

  /** A frame -> { from, to, path, info, ...report }, or null if it isn't a UI frame. */
  function parse(bytes) {
    const calls = [];
    let i = 0;
    for (; i + 7 <= bytes.length; i += 7) { const a = callOf(bytes, i); calls.push(a); if (a.last) { i += 7; break; } }
    if (calls.length < 2 || bytes[i] !== 0x03 || bytes[i + 1] !== 0xf0) return null;
    const info = String.fromCharCode(...bytes.slice(i + 2));
    const to = calls[0].call, from = calls[1].call;
    const path = calls.slice(2).map((a) => a.call + (a.used ? "*" : ""));
    return { from, to, path, info, ...report(info, to) };
  }

  return { FS, crc, frame, encode, Demod, parse, report };
});
