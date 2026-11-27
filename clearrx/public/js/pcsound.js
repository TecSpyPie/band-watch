/* ClearRX by M3VRV & King Coder: "PC sound", for cleaning up sound that's already on the PC (an internet radio stream,
 * a WebSDR or KiwiSDR in the browser, a recording). Windows doesn't let a program simply listen to what the PC is
 * playing, so the usual way is a free virtual cable (VB-CABLE from vb-audio.com, or Voicemeeter): the browser plays into
 * the cable's input, ClearRX listens to the cable's output and plays the cleaned-up sound to the speakers.
 * This file is only names and checks (no page), so Node can test it. Receive only: nothing here transmits. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PcSound = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The end of a virtual cable that ClearRX listens to (an input in "Sound from"), best first.
  const CABLE_OUT = [/cable output/i, /voicemeeter out/i, /voicemeeter.*output/i, /vb-audio virtual cable/i, /virtual audio cable/i, /\bvac\b.*line/i];
  // The end the browser plays into (an output in "Play to"). ClearRX must never play into it.
  const CABLE_IN = /cable input|voicemeeter in(put)?\b|vb-audio.*input|virtual audio cable.*input/i;
  // Windows' "what the PC is playing" inputs. They include ClearRX's own sound, so they feed back.
  const WHOLE_PC = /stereo mix|what u hear|wave out mix|loopback|rec(ording)? playback|mixed output/i;

  /** The best virtual cable output among the input names, or -1. */
  function findCable(names) {
    for (const re of CABLE_OUT) {
      const i = names.findIndex((n) => re.test(n || ""));
      if (i >= 0) return i;
    }
    return -1;
  }

  /**
   * Would this input and output go wrong? "loop": ClearRX would hear itself straight away (stop and don't start).
   * "nohear": it plays into a cable, so nobody hears it (warn). "echo": it would probably hear itself through the
   * PC's own mix (warn). null: fine. `outName` is the "Play to" name; for "Default speakers" pass Windows' default
   * output's name (the browser calls it "Default - <name>"), or "" when it isn't known.
   */
  function loopRisk(inName, outName) {
    const i = String(inName || ""), o = String(outName || "").replace(/^default\s*-\s*/i, "");
    if (CABLE_IN.test(o)) return /cable|voicemeeter|virtual audio/i.test(i) ? "loop" : "nohear";
    if (WHOLE_PC.test(i)) return "echo";
    return null;
  }

  /** Windows' default output's own name, from the browser's "Default - <name>" (or "" when there's none). */
  function defaultName(label) {
    const m = /^default\s*-\s*(.+)$/i.exec(String(label || "").trim());
    return m ? m[1] : "";
  }

  /** What to tell someone about a loop, in plain words. */
  function loopWords(risk, viaDefault) {
    const fix = viaDefault
      ? "Windows' default speakers are the cable (installing VB-CABLE often does that). In \"Play to\", pick your speakers or headphones by name, and set them back as the default in Windows: Settings > System > Sound > Output."
      : "In \"Play to\", pick your speakers or headphones, not the cable.";
    if (risk === "loop") return `ClearRX would play into the same cable it's listening to and howl. ${fix}`;
    if (risk === "nohear") return `ClearRX is playing into the cable, so you won't hear it. ${fix}`;
    if (risk === "echo") return "This input hears everything the PC plays, including ClearRX itself, so it may echo or howl. For PC sound, use a virtual cable instead (see My radio > PC sound).";
    return "";
  }

  const TIP = "PC sound: clean up an internet radio, WebSDR or KiwiSDR playing on this PC. You need a free virtual cable once: "
    + "VB-CABLE from vb-audio.com (install it, then restart the PC). Then in Windows: Settings > System > Sound > Volume mixer, "
    + "set your browser's Output device to \"CABLE Input\". In ClearRX: Sound from \"CABLE Output\" (ClearRX picks it for you) "
    + "and Play to your speakers or headphones. Leave Windows' main speakers as they are.";
  const NOT_FOUND = "ClearRX couldn't find a virtual cable. Install the free VB-CABLE from vb-audio.com, restart the PC, then press PC sound again. "
    + "(Stereo Mix won't do: it hears ClearRX too and howls.)";

  return { findCable, loopRisk, loopWords, defaultName, TIP, NOT_FOUND, CABLE_OUT, CABLE_IN, WHOLE_PC };
});
