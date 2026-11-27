/* HamShack by M0GLP & M3VRV: FT8 and FT4 decoder (and encoder, for testing), in plain JavaScript.
 * Implements the published WSJT-X protocols: 77-bit messages, CRC-14, LDPC(174,91) error
 * correction, 8-FSK (FT8) / 4-FSK (FT4) with Costas sync. The approach follows ft8_lib
 * (Karlis Goba, MIT licence): a spectrogram, a Costas-array sync search, soft bits, then
 * belief-propagation decoding. Works in the browser, in a Web Worker and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Ftx = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // LDPC(174,91) generator: 83 rows of 91 bits (23 hex digits, last bit unused). From WSJT-X,
  // checked against the parity-check table below: every codeword passes all 83 checks.
  const LDPC_G = [
    "8329ce11bf31eaf509f27fc", "761c264e25c259335493132", "dc265902fb277c6410a1bdc", "1b3f417858cd2dd33ec7f62",
    "09fda4fee04195fd034783a", "077cccc11b8873ed5c3d48a", "29b62afe3ca036f4fe1a9da", "6054faf5f35d96d3b0c8c3e",
    "e20798e4310eed27884ae90", "775c9c08e80e26ddae56318", "b0b811028c2bf997213487c", "18a0c9231fc60adf5c5ea32",
    "76471e8302a0721e01b12b8", "ffbccb80ca8341fafb47b2e", "66a72a158f9325a2bf67170", "c4243689fe85b1c51363a18",
    "0dff739414d1a1b34b1c270", "15b48830636c8b99894972e", "29a89c0d3de81d665489b0e", "4f126f37fa51cbe61bd6b94",
    "99c47239d0d97d3c84e0940", "1919b75119765621bb4f1e8", "09db12d731faee0b86df6b8", "488fc33df43fbdeea4eafb4",
    "827423ee40b675f756eb5fe", "abe197c484cb74757144a9a", "2b500e4bc0ec5a6d2bdbdd0", "c474aa53d70218761669360",
    "8eba1a13db3390bd6718cec", "753844673a27782cc42012e", "06ff83a145c37035a5c1268", "3b37417858cc2dd33ec3f62",
    "9a4a5a28ee17ca9c324842c", "bc29f465309c977e89610a4", "2663ae6ddf8b5ce2bb29488", "46f231efe457034c1814418",
    "3fb2ce85abe9b0c72e06fbe", "de87481f282c153971a0a2e", "fcd7ccf23c69fa99bba1412", "f0261447e9490ca8e474cec",
    "4410115818196f95cdd7012", "088fc31df4bfbde2a4eafb4", "b8fef1b6307729fb0a078c0", "5afea7acccb77bbc9d99a90",
    "49a7016ac653f65ecdc9076", "1944d085be4e7da8d6cc7d0", "251f62adc4032f0ee714002", "56471f8702a0721e00b12b8",
    "2b8e4923f2dd51e2d537fa0", "6b550a40a66f4755de95c26", "a18ad28d4e27fe92a4f6c84", "10c2e586388cb82a3d80758",
    "ef34a41817ee02133db2eb0", "7e9c0c54325a9c15836e000", "3693e572d1fde4cdf079e86", "bfb2cec5abe1b0c72e07fbe",
    "7ee18230c583cccc57d4b08", "a066cb2fedafc9f52664126", "bb23725abc47cc5f4cc4cd2", "ded9dba3bee40c59b5609b4",
    "d9a7016ac653e6decdc9036", "9ad46aed5f707f280ab5fc4", "e5921c77822587316d7d3c2", "4f14da8242a8b86dca73352",
    "8b8b507ad467d4441df770e", "22831c9cf1169467ad04b68", "213b838fe2ae54c38ee7180", "5d926b6dd71f085181a4e12",
    "66ab79d4b29ee6e69509e56", "958148682d748a38dd68baa", "b8ce020cf069c32a723ab14", "f4331d6d461607e95752746",
    "6da23ba424b9596133cf9c8", "a636bcbc7b30c5fbeae67fe", "5cb0d86a07df654a9089a20", "f11f106848780fc9ecdd80a",
    "1fbb5364fb8d2c9d730d5ba", "fcb86bc70a50c9d02a5d034", "a534433029eac15f322e34c", "c989d9c7c3d3b8c55d75130",
    "7bb38b2f0186d46643ae962", "2644ebadeb44b9467d1f42c", "608cc857594bfbb55d69600",
  ];
  // LDPC parity checks: the (1-based) codeword bits in each of the 83 checks (0 = unused).
  const LDPC_NM = [
    [4, 31, 59, 91, 92, 96, 153], [5, 32, 60, 93, 115, 146, 0], [6, 24, 61, 94, 122, 151, 0],
    [7, 33, 62, 95, 96, 143, 0], [8, 25, 63, 83, 93, 96, 148], [6, 32, 64, 97, 126, 138, 0],
    [5, 34, 65, 78, 98, 107, 154], [9, 35, 66, 99, 139, 146, 0], [10, 36, 67, 100, 107, 126, 0],
    [11, 37, 67, 87, 101, 139, 158], [12, 38, 68, 102, 105, 155, 0], [13, 39, 69, 103, 149, 162, 0],
    [8, 40, 70, 82, 104, 114, 145], [14, 41, 71, 88, 102, 123, 156], [15, 42, 59, 106, 123, 159, 0],
    [1, 33, 72, 106, 107, 157, 0], [16, 43, 73, 108, 141, 160, 0], [17, 37, 74, 81, 109, 131, 154],
    [11, 44, 75, 110, 121, 166, 0], [45, 55, 64, 111, 130, 161, 173], [8, 46, 71, 112, 119, 166, 0],
    [18, 36, 76, 89, 113, 114, 143], [19, 38, 77, 104, 116, 163, 0], [20, 47, 70, 92, 138, 165, 0],
    [2, 48, 74, 113, 128, 160, 0], [21, 45, 78, 83, 117, 121, 151], [22, 47, 58, 118, 127, 164, 0],
    [16, 39, 62, 112, 134, 158, 0], [23, 43, 79, 120, 131, 145, 0], [19, 35, 59, 73, 110, 125, 161],
    [20, 36, 63, 94, 136, 161, 0], [14, 31, 79, 98, 132, 164, 0], [3, 44, 80, 124, 127, 169, 0],
    [19, 46, 81, 117, 135, 167, 0], [7, 49, 58, 90, 100, 105, 168], [12, 50, 61, 118, 119, 144, 0],
    [13, 51, 64, 114, 118, 157, 0], [24, 52, 76, 129, 148, 149, 0], [25, 53, 69, 90, 101, 130, 156],
    [20, 46, 65, 80, 120, 140, 170], [21, 54, 77, 100, 140, 171, 0], [35, 82, 133, 142, 171, 174, 0],
    [14, 30, 83, 113, 125, 170, 0], [4, 29, 68, 120, 134, 173, 0], [1, 4, 52, 57, 86, 136, 152],
    [26, 51, 56, 91, 122, 137, 168], [52, 84, 110, 115, 145, 168, 0], [7, 50, 81, 99, 132, 173, 0],
    [23, 55, 67, 95, 172, 174, 0], [26, 41, 77, 109, 141, 148, 0], [2, 27, 41, 61, 62, 115, 133],
    [27, 40, 56, 124, 125, 126, 0], [18, 49, 55, 124, 141, 167, 0], [6, 33, 85, 108, 116, 156, 0],
    [28, 48, 70, 85, 105, 129, 158], [9, 54, 63, 131, 147, 155, 0], [22, 53, 68, 109, 121, 174, 0],
    [3, 13, 48, 78, 95, 123, 0], [31, 69, 133, 150, 155, 169, 0], [12, 43, 66, 89, 97, 135, 159],
    [5, 39, 75, 102, 136, 167, 0], [2, 54, 86, 101, 135, 164, 0], [15, 56, 87, 108, 119, 171, 0],
    [10, 44, 82, 91, 111, 144, 149], [23, 34, 71, 94, 127, 153, 0], [11, 49, 88, 92, 142, 157, 0],
    [29, 34, 87, 97, 147, 162, 0], [30, 50, 60, 86, 137, 142, 162], [10, 53, 66, 84, 112, 128, 165],
    [22, 57, 85, 93, 140, 159, 0], [28, 32, 72, 103, 132, 166, 0], [28, 29, 84, 88, 117, 143, 150],
    [1, 26, 45, 80, 128, 147, 0], [17, 27, 89, 103, 116, 153, 0], [51, 57, 98, 163, 165, 172, 0],
    [21, 37, 73, 138, 152, 169, 0], [16, 47, 76, 130, 137, 154, 0], [3, 24, 30, 72, 104, 139, 0],
    [9, 40, 90, 106, 134, 151, 0], [15, 58, 60, 74, 111, 150, 163], [18, 42, 79, 144, 146, 152, 0],
    [25, 38, 65, 99, 122, 160, 0], [17, 42, 75, 129, 170, 172, 0],
  ];

  // Each codeword bit takes part in 3 checks: build that list from LDPC_NM.
  const LDPC_MN = Array.from({ length: 174 }, () => []);
  LDPC_NM.forEach((row, m) => row.forEach((n) => { if (n) LDPC_MN[n - 1].push(m); }));
  const NM0 = LDPC_NM.map((row) => row.filter((n) => n).map((n) => n - 1));
  const GBITS = LDPC_G.map((hex) => {
    const bits = new Uint8Array(91);
    for (let j = 0; j < 91; j++) bits[j] = (parseInt(hex[j >> 2], 16) >> (3 - (j & 3))) & 1;
    return bits;
  });

  /* ---------- Protocols ---------- */
  // Sample rates chosen so a symbol is a power of two long and the tone spacing is one FFT bin.
  const FT8 = {
    name: "FT8", fs: 12800, nsps: 2048, period: 15, tones: 8, bitsPerSym: 3, nsym: 79,
    gray: [0, 1, 3, 2, 5, 6, 4, 7],
    sync: [[3, 1, 4, 0, 6, 5, 2], [3, 1, 4, 0, 6, 5, 2], [3, 1, 4, 0, 6, 5, 2]], syncAt: [0, 36, 72],
    dataAt: [[7, 29], [43, 29]], start: 0.5, scramble: false,
  };
  const FT4 = {
    name: "FT4", fs: 32000 / 3, nsps: 512, period: 7.5, tones: 4, bitsPerSym: 2, nsym: 103,
    gray: [0, 1, 3, 2],
    sync: [[0, 1, 3, 2], [1, 0, 2, 3], [2, 3, 1, 0], [3, 2, 0, 1]], syncAt: [0, 33, 66, 99],
    dataAt: [[4, 29], [37, 29], [70, 29]], start: 0.5, scramble: true,
  };
  // FT4 scrambles the 77 message bits with this before the CRC (WSJT-X).
  const FT4_RVEC = [0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 1];
  const PROTOCOLS = { FT8, FT4 };

  /* ---------- CRC-14 and LDPC ---------- */
  /** CRC-14 (polynomial 0x2757) of the 77 message bits followed by 5 zero bits. */
  function crc14(bits77) {
    let r = 0;
    for (let i = 0; i < 82; i++) {
      const b = i < 77 ? bits77[i] : 0;
      r ^= b << 13;
      r = r & 0x2000 ? ((r << 1) ^ 0x2757) & 0x3fff : (r << 1) & 0x3fff;
    }
    return r;
  }

  /** 77 message bits -> 174 codeword bits (message, CRC, parity). */
  function encode174(bits77) {
    const a = new Uint8Array(174);
    a.set(bits77.subarray ? bits77.subarray(0, 77) : bits77.slice(0, 77));
    const crc = crc14(a);
    for (let i = 0; i < 14; i++) a[77 + i] = (crc >> (13 - i)) & 1;
    for (let i = 0; i < 83; i++) {
      let p = 0;
      const g = GBITS[i];
      for (let j = 0; j < 91; j++) p ^= g[j] & a[j];
      a[91 + i] = p;
    }
    return a;
  }

  const ldpcErrors = (bits) => NM0.reduce((e, row) => e + (row.reduce((x, n) => x ^ bits[n], 0) ? 1 : 0), 0);

  /** Belief propagation (sum-product). llr > 0 means a 1. Returns the bits and the checks still failing. */
  function bpDecode(llr, maxIter = 30) {
    const tov = Array.from({ length: 174 }, () => new Float64Array(3));
    const toc = NM0.map((row) => new Float64Array(row.length));
    const bits = new Uint8Array(174);
    let best = 83;
    for (let iter = 0; iter <= maxIter; iter++) {
      let sum = 0;
      for (let n = 0; n < 174; n++) {
        bits[n] = llr[n] + tov[n][0] + tov[n][1] + tov[n][2] > 0 ? 1 : 0;
        sum += bits[n];
      }
      if (sum === 0) break; // all zeros is not a valid message
      const errors = ldpcErrors(bits);
      if (errors < best) best = errors;
      if (errors === 0 || iter === maxIter) break;
      for (let m = 0; m < 83; m++) {
        const row = NM0[m];
        for (let k = 0; k < row.length; k++) {
          const n = row[k];
          let t = llr[n];
          const mn = LDPC_MN[n];
          for (let i = 0; i < 3; i++) if (mn[i] !== m) t += tov[n][i];
          toc[m][k] = Math.tanh(Math.max(-15, Math.min(15, -t / 2)));
        }
      }
      for (let n = 0; n < 174; n++) {
        const mn = LDPC_MN[n];
        for (let i = 0; i < 3; i++) {
          const m = mn[i];
          const row = NM0[m];
          let p = 1;
          for (let k = 0; k < row.length; k++) if (row[k] !== n) p *= toc[m][k];
          p = Math.max(-0.999999, Math.min(0.999999, p));
          tov[n][i] = -2 * Math.atanh(p);
        }
      }
    }
    return { bits, errors: ldpcErrors(bits) };
  }

  /* ---------- 77-bit messages ---------- */
  const NTOKENS = 2063592;
  const MAX22 = 4194304;
  const MAXGRID4 = 32400;
  const C_NUM_SP = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 37
  const C_NUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 36
  const C_DIG = "0123456789";
  const C_LET_SP = " ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 27
  const C38 = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/";
  const C42 = " 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ+-./?";

  const bitsToBig = (b, from, n) => { let v = 0n; for (let i = 0; i < n; i++) v = (v << 1n) | BigInt(b[from + i]); return v; };
  const bitsToNum = (b, from, n) => Number(bitsToBig(b, from, n));
  const putBits = (b, from, n, v) => { let x = BigInt(v); for (let i = n - 1; i >= 0; i--) { b[from + i] = Number(x & 1n); x >>= 1n; } };

  /** The hash WSJT-X uses for callsigns it can't send in full (10, 12 or 22 bits). */
  function hashCall(call, bits) {
    const c = (call.trim().toUpperCase() + "           ").slice(0, 11);
    let n = 0n;
    for (const ch of c) {
      const i = C38.indexOf(ch);
      n = n * 38n + BigInt(i < 0 ? 0 : i);
    }
    return Number((((47055833459n * n) & 0xffffffffffffffffn) >> BigInt(64 - bits)));
  }

  /** Remembers callsigns seen in full, so later messages that only carry their hash can show them. */
  class CallHashes {
    constructor() { this.h22 = new Map(); this.h12 = new Map(); this.h10 = new Map(); }
    add(call) {
      if (!call || call.startsWith("<") || /^(CQ|QRZ|DE)\b/.test(call)) return;
      this.h22.set(hashCall(call, 22), call);
      this.h12.set(hashCall(call, 12), call);
      this.h10.set(hashCall(call, 10), call);
    }
    look(map, h) { const c = map.get(h); return c ? `<${c}>` : "<...>"; }
  }

  /** A standard callsign (1-2 character prefix, a digit, up to 3 letters) in its 6-character form, or null. */
  function stdCall6(call) {
    const c = call.toUpperCase();
    let s = null;
    if (/^[A-Z0-9][A-Z0-9][0-9][A-Z]{0,3}$/.test(c)) s = c;
    else if (/^[A-Z0-9][0-9][A-Z]{0,3}$/.test(c)) s = " " + c;
    if (!s || !/[A-Z]/.test(s.slice(0, 2)) && !/[A-Z]/.test(s.slice(3))) return null;
    return s.padEnd(6, " ");
  }

  function pack28(token, hashes) {
    const t = token.toUpperCase();
    if (t === "DE") return 0;
    if (t === "QRZ") return 1;
    if (t === "CQ") return 2;
    let m = /^CQ (\d{3})$/.exec(t);
    if (m) return 3 + Number(m[1]);
    m = /^CQ ([A-Z]{1,4})$/.exec(t);
    if (m) {
      const s = m[1].padStart(4, " ");
      let n = 0;
      for (const ch of s) n = n * 27 + C_LET_SP.indexOf(ch);
      return 1003 + n;
    }
    if (/^<.+>$/.test(t)) return NTOKENS + hashCall(t.slice(1, -1), 22);
    const c6 = stdCall6(t);
    if (!c6) return -1;
    const i1 = C_NUM_SP.indexOf(c6[0]), i2 = C_NUM.indexOf(c6[1]), i3 = C_DIG.indexOf(c6[2]);
    const i4 = C_LET_SP.indexOf(c6[3]), i5 = C_LET_SP.indexOf(c6[4]), i6 = C_LET_SP.indexOf(c6[5]);
    if ([i1, i2, i3, i4, i5, i6].some((i) => i < 0)) return -1;
    return NTOKENS + MAX22 + ((((i1 * 36 + i2) * 10 + i3) * 27 + i4) * 27 + i5) * 27 + i6;
  }

  function unpack28(n, hashes) {
    if (n < NTOKENS) {
      if (n === 0) return "DE";
      if (n === 1) return "QRZ";
      if (n === 2) return "CQ";
      if (n <= 1002) return `CQ ${String(n - 3).padStart(3, "0")}`;
      if (n <= 532443) {
        let v = n - 1003;
        let s = "";
        for (let i = 0; i < 4; i++) { s = C_LET_SP[v % 27] + s; v = Math.floor(v / 27); }
        return `CQ ${s.trim()}`;
      }
      return null;
    }
    n -= NTOKENS;
    if (n < MAX22) return hashes ? hashes.look(hashes.h22, n) : "<...>";
    n -= MAX22;
    const i6 = n % 27; n = Math.floor(n / 27);
    const i5 = n % 27; n = Math.floor(n / 27);
    const i4 = n % 27; n = Math.floor(n / 27);
    const i3 = n % 10; n = Math.floor(n / 10);
    const i2 = n % 36; n = Math.floor(n / 36);
    const i1 = n;
    if (i1 >= 37) return null;
    return (C_NUM_SP[i1] + C_NUM[i2] + C_DIG[i3] + C_LET_SP[i4] + C_LET_SP[i5] + C_LET_SP[i6]).trim();
  }

  const fmtReport = (dd) => (dd >= 0 ? "+" : "-") + String(Math.abs(dd)).padStart(2, "0");

  /** Pack a message's text into 77 bits. Supports the usual QSO messages, CQ, non-standard calls and free text. */
  function pack77(text, hashes) {
    const msg = text.toUpperCase().trim().replace(/\s+/g, " ");
    const b = new Uint8Array(77);
    const w = msg.split(" ");
    // CQ with a modifier is two words: "CQ DX", "CQ 290"
    if (w[0] === "CQ" && w.length >= 3 && /^([A-Z]{1,4}|\d{3})$/.test(w[1]) && !stdCall6(w[1])) w.splice(0, 2, `CQ ${w[1]}`);
    const isCall = (s) => /^<.+>$/.test(s) || pack28(s) >= 0;
    const strip = (s) => s.replace(/\/[RP]$/, "");
    // Standard message: CALL1 CALL2 [R] [GRID | REPORT | RRR | RR73 | 73]
    if (w.length >= 2 && w.length <= 4) {
      const c1 = w[0];
      const c2 = w[1];
      const rest = w.slice(2);
      const suf = (s) => (/\/R$/.test(s) ? 1 : /\/P$/.test(s) ? 2 : 0);
      const s1 = suf(c1), s2 = suf(c2);
      const n1 = pack28(strip(c1), hashes), n2 = pack28(strip(c2), hashes);
      if (n1 >= 0 && n2 >= 0 && !/^CQ /.test(c2) && (s1 === 0 || s2 === 0 || s1 === s2)) {
        let ir = 0;
        let g = -1;
        let r = rest.join(" ");
        if (/^R /.test(r) || /^R[+-]\d\d$/.test(r)) { ir = 1; r = r.replace(/^R ?/, ""); }
        if (r === "") g = MAXGRID4 + 1;
        else if (/^[A-R]{2}\d{2}$/.test(r)) g = ((r.charCodeAt(0) - 65) * 18 + (r.charCodeAt(1) - 65)) * 100 + Number(r[2]) * 10 + Number(r[3]);
        else if (r === "RRR" && !ir) g = MAXGRID4 + 2;
        else if (r === "RR73" && !ir) g = MAXGRID4 + 3;
        else if (r === "73" && !ir) g = MAXGRID4 + 4;
        else if (/^[+-]\d\d$/.test(r) && Number(r) >= -30 && Number(r) <= 32) g = MAXGRID4 + 35 + Number(r);
        if (g >= 0) {
          const i3 = s1 === 2 || s2 === 2 ? 2 : 1;
          putBits(b, 0, 28, n1); b[28] = s1 ? 1 : 0;
          putBits(b, 29, 28, n2); b[57] = s2 ? 1 : 0;
          b[58] = ir; putBits(b, 59, 15, g); putBits(b, 74, 3, i3);
          if (hashes) { hashes.add(strip(c1)); hashes.add(strip(c2)); }
          return b;
        }
      }
    }
    // Non-standard callsign (type 4): "CQ PJ4/K1ABC", "<K1ABC> PJ4/W9XYZ RR73", "PJ4/K1ABC <W9XYZ>"
    const m4 = /^(CQ )?(<?[A-Z0-9/]+>?)(?: (<?[A-Z0-9/]+>?))?(?: (RRR|RR73|73))?$/.exec(msg);
    if (m4) {
      const cq = Boolean(m4[1]);
      const a = m4[2], bb = m4[3];
      const plain = (s) => s && !s.startsWith("<");
      let full, hashed, h1 = 0;
      if (cq && !bb && plain(a) && a.length <= 11) { full = a; hashed = ""; }
      else if (bb && a.startsWith("<") && plain(bb)) { hashed = a.slice(1, -1); full = bb; h1 = 0; }
      else if (bb && plain(a) && bb.startsWith("<")) { full = a; hashed = bb.slice(1, -1); h1 = 1; }
      if (full && full.length <= 11 && /^[A-Z0-9/]+$/.test(full) && (cq || hashed)) {
        let n58 = 0n;
        for (const ch of full.padStart(11, " ")) n58 = n58 * 38n + BigInt(C38.indexOf(ch));
        putBits(b, 0, 12, hashCall(hashed || full, 12)); // for CQ, WSJT-X sends the call's own hash
        putBits(b, 12, 58, n58);
        b[70] = h1;
        putBits(b, 71, 2, { "": 0, RRR: 1, RR73: 2, 73: 3 }[m4[4] || ""]);
        b[73] = cq ? 1 : 0;
        putBits(b, 74, 3, 4);
        if (hashes) { hashes.add(full); if (hashed) hashes.add(hashed); }
        return b;
      }
    }
    // Free text, up to 13 characters
    if (msg.length <= 13 && [...msg].every((ch) => C42.includes(ch))) {
      let n = 0n;
      for (const ch of msg.padStart(13, " ")) n = n * 42n + BigInt(C42.indexOf(ch));
      putBits(b, 0, 71, n);
      putBits(b, 71, 3, 0);
      putBits(b, 74, 3, 0);
      return b;
    }
    return null;
  }

  /** 77 bits -> message text, or null if it isn't a valid message. */
  function unpack77(b, hashes) {
    const i3 = bitsToNum(b, 74, 3);
    if (i3 === 1 || i3 === 2) {
      const n1 = bitsToNum(b, 0, 28), r1 = b[28], n2 = bitsToNum(b, 29, 28), r2 = b[57], ir = b[58];
      const g = bitsToNum(b, 59, 15);
      let c1 = unpack28(n1, hashes);
      let c2 = unpack28(n2, hashes);
      if (c1 === null || c2 === null) return null;
      const suf = i3 === 1 ? "/R" : "/P";
      if (r1 && !c1.startsWith("<") && !/^(CQ|QRZ|DE)/.test(c1)) c1 += suf;
      if (r2 && !c2.startsWith("<")) c2 += suf;
      if (hashes) { hashes.add(c1.replace(/\/[RP]$/, "")); hashes.add(c2.replace(/\/[RP]$/, "")); }
      let tail = "";
      if (g < MAXGRID4) {
        let n = g;
        const d4 = n % 10; n = Math.floor(n / 10);
        const d3 = n % 10; n = Math.floor(n / 10);
        const l2 = n % 18; n = Math.floor(n / 18);
        if (n >= 18) return null;
        tail = (ir ? "R " : "") + String.fromCharCode(65 + n, 65 + l2) + d3 + d4;
      } else {
        const irpt = g - MAXGRID4;
        if (irpt === 1) tail = "";
        else if (irpt === 2) tail = "RRR";
        else if (irpt === 3) tail = "RR73";
        else if (irpt === 4) tail = "73";
        else if (irpt >= 5 && irpt <= 67) tail = (ir ? "R" : "") + fmtReport(irpt - 35);
        else return null;
      }
      return [c1, c2, tail].filter(Boolean).join(" ");
    }
    if (i3 === 4) {
      const h12 = bitsToNum(b, 0, 12);
      let n58 = bitsToBig(b, 12, 58);
      let call = "";
      for (let i = 0; i < 11; i++) { call = C38[Number(n58 % 38n)] + call; n58 /= 38n; }
      call = call.trim();
      if (!call) return null;
      if (hashes) hashes.add(call);
      const h1 = b[70];
      const r = ["", "RRR", "RR73", "73"][bitsToNum(b, 71, 2)];
      if (b[73]) return `CQ ${call}`;
      const other = hashes ? hashes.look(hashes.h12, h12) : "<...>";
      return [h1 ? call : other, h1 ? other : call, r].filter(Boolean).join(" ");
    }
    if (i3 === 0) {
      const n3 = bitsToNum(b, 71, 3);
      if (n3 === 0) {
        let n = bitsToBig(b, 0, 71);
        let s = "";
        for (let i = 0; i < 13; i++) { s = C42[Number(n % 42n)] + s; n /= 42n; }
        return s.trim() || null;
      }
      if (n3 === 5) {
        // telemetry: 71 bits as hex
        const v = bitsToBig(b, 0, 71);
        return v.toString(16).toUpperCase();
      }
      if (n3 === 1) {
        // DXpedition: K1ABC RR73; W9XYZ <KH1/KH7Z> -08
        const a = unpack28(bitsToNum(b, 0, 28), hashes);
        const c = unpack28(bitsToNum(b, 28, 28), hashes);
        const h10 = bitsToNum(b, 56, 10);
        const r5 = bitsToNum(b, 66, 5);
        if (!a || !c) return null;
        const dx = hashes ? hashes.look(hashes.h10, h10) : "<...>";
        return `${a} RR73; ${c} ${dx} ${fmtReport(r5 * 2 - 30)}`;
      }
    }
    return null; // other message types (contest exchanges) aren't shown
  }

  /* ---------- Tones (for tests and self-checks) ---------- */

  /** Message text -> channel tones, or null if it can't be packed. */
  function encodeTones(text, proto = FT8, hashes) {
    let bits = pack77(text, hashes);
    if (!bits) return null;
    if (proto.scramble) bits = bits.map((v, i) => v ^ FT4_RVEC[i]);
    const cw = encode174(bits);
    const tones = new Array(proto.nsym).fill(0);
    proto.syncAt.forEach((at, i) => proto.sync[i].forEach((t, k) => { tones[at + k] = t; }));
    let bit = 0;
    for (const [at, n] of proto.dataAt) {
      for (let s = 0; s < n; s++) {
        let v = 0;
        for (let k = 0; k < proto.bitsPerSym; k++) v = (v << 1) | cw[bit++];
        tones[at + s] = proto.gray[v];
      }
    }
    return tones;
  }

  /** Audio (at proto.fs) of a signal: continuous-phase FSK, starting `startSec` into the buffer. */
  function synthesize(tones, { proto = FT8, baseHz = 1000, startSec = proto.start, amp = 1, seconds = proto.period, out } = {}) {
    const fs = proto.fs;
    const buf = out || new Float32Array(Math.round(seconds * fs));
    const spacing = fs / proto.nsps;
    let ph = 0;
    const start = Math.round(startSec * fs);
    for (let s = 0; s < tones.length; s++) {
      const step = (2 * Math.PI * (baseHz + tones[s] * spacing)) / fs;
      for (let k = 0; k < proto.nsps; k++) {
        const i = start + s * proto.nsps + k;
        if (i >= 0 && i < buf.length) buf[i] += amp * Math.sin(ph);
        ph += step;
      }
    }
    return buf;
  }

  /* ---------- FFT ---------- */
  function fftInPlace(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const a = i + j, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }

  /* ---------- Decoder ---------- */

  /** Spectrogram: a frame every half symbol, each an FFT over two symbols (so bins are half a tone apart). Power in dB. */
  function spectrogram(audio, proto, maxHz) {
    const n2 = proto.nsps * 2;
    const step = proto.nsps / 2;
    const bins = Math.min(n2 / 2, Math.ceil((maxHz * n2) / proto.fs));
    const frames = Math.max(0, Math.floor((audio.length - n2) / step) + 1);
    const win = new Float32Array(n2);
    for (let i = 0; i < n2; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n2);
    const re = new Float64Array(n2);
    const im = new Float64Array(n2);
    const db = new Float32Array(frames * bins);
    for (let f = 0; f < frames; f++) {
      const o = f * step;
      for (let i = 0; i < n2; i++) { re[i] = audio[o + i] * win[i]; im[i] = 0; }
      fftInPlace(re, im);
      for (let k = 0; k < bins; k++) db[f * bins + k] = 10 * Math.log10(re[k] * re[k] + im[k] * im[k] + 1e-12);
    }
    return { db, frames, bins, step, n2 };
  }

  class Decoder {
    constructor(proto = FT8, { minHz = 150, maxHz = 3200, maxCandidates = 140, minScore = 1.6 } = {}) {
      this.proto = proto;
      this.minHz = minHz;
      this.maxHz = maxHz;
      this.maxCandidates = maxCandidates;
      this.minScore = minScore;
      this.hashes = new CallHashes();
    }

    /** Decode one cycle: `audio` at proto.fs starting at the cycle's start. Returns [{ text, snr, dt, freq }]. */
    decode(audio) {
      const p = this.proto;
      const sp = spectrogram(audio, p, this.maxHz + p.tones * (p.fs / p.nsps) + 50);
      const { db, frames, bins } = sp;
      const at = (t, f) => (t >= 0 && t < frames && f >= 0 && f < bins ? db[t * bins + f] : -200);
      // 1. Sync search over start time (half-symbol steps) and frequency (half-tone bins)
      const binHz = p.fs / sp.n2;
      const fLo = Math.max(1, Math.floor(this.minHz / binHz));
      const fHi = Math.min(bins - 2 * p.tones - 1, Math.floor(this.maxHz / binHz));
      const symSteps = 2;
      const tMin = -Math.round(p.start / (p.nsps / p.fs) * symSteps) - 4;
      const tMax = frames - p.nsym * symSteps + 6;
      const syncScore = (t0, f0) => {
        let score = 0;
        let num = 0;
        for (let b = 0; b < p.syncAt.length; b++) {
          const costas = p.sync[b];
          for (let k = 0; k < costas.length; k++) {
            const t = t0 + (p.syncAt[b] + k) * symSteps;
            if (t < 0 || t >= frames) continue;
            const sm = costas[k];
            const s = at(t, f0 + 2 * sm);
            if (sm > 0) { score += s - at(t, f0 + 2 * (sm - 1)); num++; }
            if (sm < p.tones - 1) { score += s - at(t, f0 + 2 * (sm + 1)); num++; }
            if (t - symSteps >= 0) { score += s - at(t - symSteps, f0 + 2 * sm); num++; }
            if (t + symSteps < frames) { score += s - at(t + symSteps, f0 + 2 * sm); num++; }
          }
        }
        return num < 8 ? -1e9 : score / num;
      };
      const cands = [];
      for (let t0 = tMin; t0 <= tMax; t0++) {
        for (let f0 = fLo; f0 <= fHi; f0++) {
          const score = syncScore(t0, f0);
          if (score >= this.minScore) cands.push({ t0, f0, score });
        }
      }
      // Peak position between steps (parabola through three points), for finer time and frequency
      const vertex = (a, b, c) => { const d = a - 2 * b + c; return d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0; };
      cands.sort((a, b) => b.score - a.score);
      // keep the best, and skip near-duplicates (same signal one bin or step away)
      const kept = [];
      for (const c of cands) {
        if (kept.length >= this.maxCandidates) break;
        if (kept.some((k) => Math.abs(k.t0 - c.t0) <= 1 && Math.abs(k.f0 - c.f0) <= 1)) continue;
        kept.push(c);
      }
      // Noise level per bin (median of the whole spectrogram), for the SNR estimate
      const sample = [];
      for (let i = 0; i < db.length; i += 7) sample.push(db[i]);
      sample.sort((a, b) => a - b);
      const noiseDb = sample[Math.floor(sample.length / 2)] || -100;

      // 2. Soft bits, LDPC, CRC, unpack
      const out = [];
      const seen = new Set();
      for (const c of kept) {
        const llr = this.softBits(at, c.t0, c.f0);
        const { bits, errors } = bpDecode(llr, 30);
        if (errors) continue;
        let msg = bits.slice(0, 77);
        let crc = 0;
        for (let i = 0; i < 14; i++) crc = (crc << 1) | bits[77 + i];
        if (crc !== crc14(msg)) continue;
        if (p.scramble) msg = msg.map((v, i) => v ^ FT4_RVEC[i]);
        if (msg.every((v) => v === 0)) continue;
        const text = unpack77(msg, this.hashes);
        if (!text || seen.has(text)) continue;
        seen.add(text);
        // SNR: power on the decoded tones against the noise, in 2500 Hz (as WSJT-X shows it)
        const tones = this.tonesFor(bits);
        let sig = 0;
        let ns = 0;
        tones.forEach((tone, s) => {
          const v = at(c.t0 + s * symSteps, c.f0 + 2 * tone);
          if (v > -150) { sig += 10 ** (v / 10); ns++; }
        });
        const enbw = 1.5 * binHz;
        const snr = Math.round(10 * Math.log10(Math.max(1e-12, (sig / Math.max(1, ns)) / 10 ** (noiseDb / 10) - 1)) - 10 * Math.log10(2500 / enbw));
        const symSec = p.nsps / p.fs;
        out.push({
          text,
          snr: Math.max(-30, Math.min(40, snr)),
          // a frame spans two symbols: the best one starts half a symbol (one step) before the signal
          dt: Math.round((((c.t0 + 1 + vertex(syncScore(c.t0 - 1, c.f0), c.score, syncScore(c.t0 + 1, c.f0))) * symSec) / symSteps - p.start) * 10) / 10,
          freq: Math.round((c.f0 + vertex(syncScore(c.t0, c.f0 - 1), c.score, syncScore(c.t0, c.f0 + 1))) * binHz),
          score: c.score,
        });
      }
      return out;
    }

    /** The tone sent in each symbol, from the decoded codeword. */
    tonesFor(cw) {
      const p = this.proto;
      const tones = new Array(p.nsym).fill(0);
      p.syncAt.forEach((at, i) => p.sync[i].forEach((t, k) => { tones[at + k] = t; }));
      let bit = 0;
      for (const [at, n] of p.dataAt) {
        for (let s = 0; s < n; s++) {
          let v = 0;
          for (let k = 0; k < p.bitsPerSym; k++) v = (v << 1) | cw[bit++];
          tones[at + s] = p.gray[v];
        }
      }
      return tones;
    }

    /** Log-likelihoods for the 174 codeword bits at a candidate. Positive means 1. */
    softBits(at, t0, f0) {
      const p = this.proto;
      const llr = new Float64Array(174);
      const nb = p.bitsPerSym;
      const nv = 1 << nb;
      let bit = 0;
      const s2 = new Float64Array(nv);
      for (const [start, n] of p.dataAt) {
        for (let s = 0; s < n; s++) {
          const t = t0 + (start + s) * 2;
          for (let v = 0; v < nv; v++) s2[v] = at(t, f0 + 2 * p.gray[v]);
          for (let k = 0; k < nb; k++) {
            const mask = 1 << (nb - 1 - k);
            let one = -1e9;
            let zero = -1e9;
            for (let v = 0; v < nv; v++) {
              if (v & mask) one = Math.max(one, s2[v]);
              else zero = Math.max(zero, s2[v]);
            }
            llr[bit++] = one - zero;
          }
        }
      }
      // Scale so the soft bits have the spread the decoder expects
      let sum = 0;
      let sum2 = 0;
      for (let i = 0; i < 174; i++) { sum += llr[i]; sum2 += llr[i] * llr[i]; }
      const variance = sum2 / 174 - (sum / 174) ** 2;
      const k = Math.sqrt(24 / Math.max(variance, 1e-6));
      for (let i = 0; i < 174; i++) llr[i] *= k;
      return llr;
    }
  }

  /* ---------- Resampler: any rate in, the protocol's rate out ---------- */
  class Resampler {
    constructor(inRate, outRate) {
      this.ratio = inRate / outRate;
      this.half = Math.ceil(8 * Math.max(1, this.ratio));
      this.cut = Math.min(1, 1 / this.ratio) * 0.92;
      this.phases = 128;
      this.kernels = [];
      for (let ph = 0; ph <= this.phases; ph++) {
        const frac = ph / this.phases;
        const k = new Float32Array(2 * this.half);
        let sum = 0;
        for (let i = 0; i < 2 * this.half; i++) {
          const x = i - this.half + 1 - frac; // distance from the output point, in input samples
          const sinc = x === 0 ? 1 : Math.sin(Math.PI * this.cut * x) / (Math.PI * this.cut * x);
          const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / this.half);
          k[i] = Math.abs(x) >= this.half ? 0 : sinc * w;
          sum += k[i];
        }
        for (let i = 0; i < k.length; i++) k[i] /= sum;
        this.kernels.push(k);
      }
      this.buf = new Float32Array(0);
      this.pos = this.half; // position of the next output in buf
    }
    process(input) {
      const buf = new Float32Array(this.buf.length + input.length);
      buf.set(this.buf);
      buf.set(input, this.buf.length);
      const out = [];
      while (this.pos + this.half < buf.length) {
        const i0 = Math.floor(this.pos);
        const frac = this.pos - i0;
        const k = this.kernels[Math.round(frac * this.phases)];
        let s = 0;
        const base = i0 - this.half + 1;
        for (let i = 0; i < k.length; i++) s += k[i] * buf[base + i];
        out.push(s);
        this.pos += this.ratio;
      }
      const keepFrom = Math.max(0, Math.floor(this.pos) - this.half);
      this.buf = buf.slice(keepFrom);
      this.pos -= keepFrom;
      return Float32Array.from(out);
    }
  }

  return { FT8, FT4, PROTOCOLS, crc14, encode174, bpDecode, ldpcErrors, pack77, unpack77, pack28, unpack28, hashCall, CallHashes, encodeTones, synthesize, spectrogram, Decoder, Resampler, FT4_RVEC };
});
