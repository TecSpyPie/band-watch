/* Band Watch by M3VRV & King Coder: the optional "Support" pieces. Plain JavaScript, used by the page and the Help page
 * (window.Support) and the tests (require).
 *
 * Band Watch and ClearRX are free and open source and always will be. Nothing is locked, there are no popups, no
 * timers and no reminders. This file is the ONE place the owner sets a support link:
 *   SUPPORT_URL  leave it "" and every support button and section stays hidden.
 *                Only an https link on ko-fi.com, github.com/sponsors, buymeacoffee.com or liberapay.com is accepted;
 *                anything else is ignored and also leaves everything hidden.
 *   SUPPORTERS   plain callsigns shown under "Supporters" in Help. Only add a callsign with that person's
 *                permission. Empty by default.
 * If ClearRX gets its own support page, copy the same SUPPORT_URL value there. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Support = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SUPPORT_URL = ""; // e.g. "https://ko-fi.com/yourname" (set by the owner)
  const SUPPORTERS = []; // e.g. ["M3VRV"], only with permission

  /** The link if it is a safe https support link, otherwise "" (so everything stays hidden). */
  function validateSupportUrl(value) {
    if (typeof value !== "string") return "";
    const s = value.trim();
    if (!s || s.length > 300) return "";
    let u;
    try { u = new URL(s); } catch { return ""; }
    if (u.protocol !== "https:" || u.username || u.password || u.port) return "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "ko-fi.com" || host === "buymeacoffee.com" || host === "liberapay.com") return u.href;
    if (host === "github.com" && /^\/sponsors\/[^/]+/.test(u.pathname)) return u.href;
    return "";
  }

  /** What to show: { show, url, supporters }. show is false (and url "") unless the link is valid. */
  function supportState(url, supporters) {
    const clean = validateSupportUrl(url);
    const names = Array.isArray(supporters)
      ? supporters.map((x) => String(x == null ? "" : x).trim()).filter((x) => /^[A-Za-z0-9/]{3,14}$/.test(x))
      : [];
    return { show: !!clean, url: clean, supporters: clean ? names : [] };
  }

  const api = { SUPPORT_URL, SUPPORTERS, validateSupportUrl, supportState };

  function init() {
    const st = supportState(SUPPORT_URL, SUPPORTERS);
    if (!st.show) return; // nothing is shown, nothing is changed
    for (const a of document.querySelectorAll("a[data-support]")) {
      a.href = st.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.hidden = false;
    }
    for (const el of document.querySelectorAll("[data-support-section]")) el.hidden = false;
    const list = document.getElementById("supportersList");
    const box = document.getElementById("supporters");
    if (list && box && st.supporters.length) {
      for (const n of st.supporters) {
        const li = document.createElement("li");
        li.textContent = n;
        list.append(li);
      }
      box.hidden = false;
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
  return api;
});
