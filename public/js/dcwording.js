/* Band Watch by M3vrv: the words the Decoders panel shows while it waits. Only FT8, FT4 and WSPR work in cycles;
 * CW and RTTY are continuous, SSTV waits for a picture and APRS for a packet. Receive only; no radio control. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DcWording = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** What the status line says right after decoding starts from the sound input. */
  function micStart(mode) {
    const base = "Listening to the sound input.";
    switch (mode) {
      case "CW": case "RTTY": return "Listening to the sound input…";
      case "SSTV": return `${base} Waiting for a picture to start…`;
      case "APRS": return `${base} Waiting for a packet…`;
      default: return `${base} Waiting for the next cycle…`; // FT8, FT4, WSPR
    }
  }

  /** Modes that show a running text box (and no table) in the results window. */
  const isText = (mode) => mode === "CW" || mode === "RTTY";

  return { micStart, isText };
});
