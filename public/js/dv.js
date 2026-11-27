/* Digital voice add-on: DMR, BrandMeister and Yaesu System Fusion (C4FM).
 * HamShack can't make or send DMR or C4FM voice itself: both use the AMBE voice codec, which is patented and only
 * built into radios and hotspots. What this add-on does:
 *   - puts a Yaesu radio (FT-991A and others) on a C4FM frequency in one click (FA...; then MD0E;). That is all it
 *     sends: never a transmit or power command. You talk on your own microphone, as normal.
 *   - links to BrandMeister's own pages (Hoseline to listen in a browser, talkgroups, last heard) and to the UK
 *     repeater lists at ukrepeater.net (RSGB ETCC). No data is copied from either: neither says it may be reused.
 *   - a link to your own hotspot's dashboard (Pi-Star or WPSD).
 * The pure parts (DvMath) are used by the page and the tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DvMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // Where C4FM is allowed from HamShack's button: the UK 2 m and 70 cm amateur bands (MHz).
  const BANDS = [["2 m", 144, 146], ["70 cm", 430, 440]];
  // UK digital voice calling frequencies (RSGB band plan), simplex.
  const CHANNELS = [
    { mhz: 145.375, name: "2 m DV calling" },
    { mhz: 438.6125, name: "70 cm DV calling" },
  ];
  const bandOf = (mhz) => BANDS.find(([, lo, hi]) => mhz >= lo && mhz <= hi);
  /** The Yaesu CAT commands for C4FM on mhz, or "" if it's outside 2 m / 70 cm. Frequency then mode, nothing else. */
  function c4fmCommand(mhz) {
    mhz = Number(mhz);
    if (!Number.isFinite(mhz) || !bandOf(mhz)) return "";
    const hz = Math.round(mhz * 1e6);
    return `FA${String(hz).padStart(9, "0")};MD0E;`;
  }
  /** A hotspot dashboard address, tidied, or "" if it isn't a plain http(s) address. */
  function hotspotUrl(s) {
    s = String(s || "").trim();
    if (!s) return "";
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !/^https?:\/\//i.test(s)) return ""; // ftp:// and the like
    if (!/^https?:\/\//i.test(s)) s = "http://" + s;
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return "";
      return u.href;
    } catch { return ""; }
  }
  return { BANDS, CHANNELS, bandOf, c4fmCommand, hotspotUrl };
});

/* ---------- The panel (browser only) ---------- */
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const dv = window.dv = { hotspot: "" };

  const dvLoad = () => {
    try { dv.hotspot = DvMath.hotspotUrl(JSON.parse(load("bw-dv") || "{}").hotspot); } catch { dv.hotspot = ""; }
  };
  const dvSave = () => store("bw-dv", { hotspot: dv.hotspot });
  const dvNote = (s) => { $("dvNote").textContent = s; };

  /** Put the radio on C4FM at mhz. Only a connected Yaesu; only 2 m / 70 cm. */
  window.dvTune = async function dvTune(mhz) {
    const cmd = DvMath.c4fmCommand(mhz);
    if (!cmd) { dvNote("C4FM from here is for the 2 m (144–146 MHz) and 70 cm (430–440 MHz) bands. Try a frequency in one of those."); return false; }
    if (!rig.connected) { dvNote("Connect your radio first: Settings > Radio control > Connect radio."); return false; }
    if (rig.kind !== "yaesu") { dvNote("One-click C4FM is for Yaesu radios (FT-991A and others with C4FM). On other radios, set the digital mode on the radio itself."); return false; }
    rig.lastSet = Date.now();
    await rigWrite(cmd);
    const band = DvMath.bandOf(Number(mhz))[0];
    dvNote(`Your radio is on ${Number(mhz).toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} MHz, C4FM (${band}). Listen first, then talk on your microphone as normal.`);
    return true;
  };

  function renderDv() {
    $("dvChans").innerHTML = DvMath.CHANNELS.map((c) =>
      `<button type="button" class="ghost" data-mhz="${c.mhz}">${esc(c.mhz)} MHz <span class="muted">${esc(c.name)}</span></button>`).join("");
    $("dvHotspot").value = dv.hotspot;
    const link = $("dvHotspotOpen");
    link.hidden = !dv.hotspot;
    if (dv.hotspot) link.href = dv.hotspot;
  }

  window.setupDv = function setupDv() {
    dvLoad();
    renderDv();
    $("dvChans").addEventListener("click", (e) => { const b = e.target.closest("button[data-mhz]"); if (b) dvTune(Number(b.dataset.mhz)); });
    $("dvGo").addEventListener("click", () => dvTune(Number($("dvFreq").value)));
    $("dvFreq").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); dvTune(Number($("dvFreq").value)); } });
    $("dvHotspot").addEventListener("change", () => {
      const raw = $("dvHotspot").value.trim();
      const url = DvMath.hotspotUrl(raw);
      if (raw && !url) { $("dvHotNote").textContent = "That doesn't look like a web address. Try http://pi-star.local/ or your hotspot's number, e.g. 192.168.1.50."; return; }
      dv.hotspot = url;
      dvSave();
      $("dvHotNote").textContent = url ? "Saved. Open your dashboard with the button." : "";
      renderDv();
    });
  };
}
