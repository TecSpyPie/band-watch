/* HamShack by M0GLP & M3VRV: plain words for "it didn't work" when HamShack talks to its server or a service.
 * Browsers say things like "Failed to fetch" or "NetworkError when attempting to fetch resource", and servers
 * answer with numbers like 502. Radio amateurs should see what happened and what to do next instead. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.NetWords = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // What browsers put in the error when the request never got an answer (Chrome, Firefox, Safari, Node).
  const NO_ANSWER = /failed to fetch|networkerror|network request failed|load failed|fetch failed|network connection was lost|err_internet_disconnected|econnrefused|enotfound|etimedout/i;

  /** True when the error means "no answer at all": offline, server down, or blocked on the way. */
  function isNoAnswer(err) {
    if (!err) return false;
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    return NO_ANSWER.test(String(err.message || err));
  }

  /** Words for an answer with an HTTP status that isn't OK. `what` is the service, like "POTA" or "chat". */
  function fromStatus(status, what) {
    const s = Number(status) || 0;
    const name = what || "HamShack's server";
    if (s === 429) return `${name} is busy. Wait a minute, then try again.`;
    if (s === 404) return `${name} isn't available on this copy of HamShack.`;
    if (s >= 500) return `Couldn't reach ${name} just now. HamShack will try again; you don't need to do anything.`;
    if (s >= 400) return `${name} didn't accept that. Check what you entered and try again.`;
    return `Couldn't reach ${name} just now. Try again in a minute.`;
  }

  /** Words for an error thrown by fetch or by our own code. Our own messages are already plain, so they pass. */
  function friendly(err, what) {
    const name = what || "HamShack's server";
    if (isNoAnswer(err)) return `Couldn't reach ${name}. Check your internet connection; HamShack will try again.`;
    const msg = String(err && typeof err === "object" ? err.message || "" : err || "").trim();
    if (!msg || /^(Error|TypeError|SyntaxError|ReferenceError)\b|unexpected token|is not defined|is undefined|json/i.test(msg)) return `Couldn't reach ${name} just now. Try again in a minute.`;
    return msg;
  }

  return { friendly, fromStatus, isNoAnswer };
});
