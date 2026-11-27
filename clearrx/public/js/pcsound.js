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
   * Would this input and output go round in a circle? "loop": ClearRX would hear itself straight away (stop and
   * don't start). "echo": it would probably hear itself through the speakers' own mix (warn). null: fine.
   * `outName` is the "Play to" name, or "" for the default speakers.
   */
  function loopRisk(inName, outName) {
    const i = String(inName || ""), o = String(outName || "");
    if (CABLE_IN.test(o) && (findCable([i]) === 0 || CABLE_IN.test(i) || /cable|voicemeeter/i.test(i))) return "loop";
    if (CABLE_IN.test(o)) return "echo";
    if (WHOLE_PC.test(i)) return "echo";
    return null;
  }

  /** What to tell someone about a loop, in plain words. */
  function loopWords(risk) {
    if (risk === "loop") return "ClearRX would play into the same cable it's listening to and howl. In \"Play to\", pick your speakers or headphones, not the cable.";
    if (risk === "echo") return "This input hears everything the PC plays, including ClearRX itself, so it may echo or howl. For PC sound, use a virtual cable instead (see My radio > PC sound).";
    return "";
  }

  const TIP = "PC sound: clean up an internet radio, WebSDR or KiwiSDR playing on this PC. You need a free virtual cable once: "
    + "VB-CABLE from vb-audio.com (install it, then restart the PC). Then in Windows: Settings > System > Sound > Volume mixer, "
    + "set your browser's Output device to \"CABLE Input\". In ClearRX: Sound from \"CABLE Output\" (ClearRX picks it for you) "
    + "and Play to your speakers or headphones. Leave Windows' main speakers as they are.";
  const NOT_FOUND = "ClearRX couldn't find a virtual cable. Install the free VB-CABLE from vb-audio.com, restart the PC, then press PC sound again. "
    + "(Stereo Mix won't do: it hears ClearRX too and howls.)";

  return { findCable, loopRisk, loopWords, TIP, NOT_FOUND, CABLE_OUT, CABLE_IN, WHOLE_PC };
});
