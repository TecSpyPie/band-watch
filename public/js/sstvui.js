/* SSTV pictures in the Decoder panel: the picture building line by line as it arrives, its mode and how much it
   was straightened, "Start now as…" for a picture whose VIS header was missed, and a gallery of the last pictures
   (kept in this browser) with Save. The decoding itself is in sstv.js, in the decoder's worker. */
"use strict";

const SSTV_KEEP = 16; // pictures kept in the gallery
// Where SSTV is on each band (kHz) and the sideband used there.
const SSTV_FREQ = { 80: [3735, "lsb"], 40: [7171, "lsb"], 20: [14230, "usb"], 17: [18160, "usb"], 15: [21340, "usb"], 12: [24975, "usb"], 10: [28680, "usb"] };
const sstvui = { cur: null, gallery: [], ctx: null };

function sstvLoadGallery() {
  try {
    const g = JSON.parse(load("bw-sstv") || "[]");
    if (Array.isArray(g)) sstvui.gallery = g.filter((x) => x && typeof x.src === "string" && x.src.startsWith("data:image/")).slice(0, SSTV_KEEP);
  } catch { /* none */ }
}
function sstvSaveGallery() {
  // Pictures are big: if the browser's storage is full, keep fewer.
  for (let n = sstvui.gallery.length; n >= 0; n--) {
    try { localStorage.setItem("bw-sstv", JSON.stringify(sstvui.gallery.slice(0, n))); return; } catch { /* too big: try fewer */ }
  }
}

function sstvCanvas() { return $("sstvPic"); }

/** Messages from the worker. */
function sstvOnMessage(m) {
  const cv = sstvCanvas();
  if (!cv) return;
  if (m.type === "sstv-start") {
    sstvui.cur = { mode: m.mode, width: m.width, height: m.height, at: m.at || Date.now(), lines: 0, manual: m.manual };
    cv.width = m.width;
    cv.height = m.height;
    sstvui.ctx = cv.getContext("2d");
    sstvui.ctx.fillStyle = "#000";
    sstvui.ctx.fillRect(0, 0, m.width, m.height);
    sstvRenderInfo();
    if (!m.manual && typeof showToast === "function") showToast("SSTV picture", `A ${m.mode} picture is coming in`);
    return;
  }
  if (m.type === "sstv-lines" && sstvui.cur && sstvui.ctx) {
    const w = sstvui.cur.width;
    const rows = m.to - m.from;
    if (rows > 0) sstvui.ctx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba.buffer, m.rgba.byteOffset, w * rows * 4), w, rows), 0, m.from);
    sstvui.cur.lines = Math.max(sstvui.cur.lines, m.to);
    sstvRenderInfo();
    return;
  }
  if (m.type === "sstv-done") {
    if (!sstvui.ctx) { cv.width = m.width; cv.height = m.height; sstvui.ctx = cv.getContext("2d"); }
    sstvui.ctx.putImageData(new ImageData(new Uint8ClampedArray(m.rgba.buffer), m.width, m.height), 0, 0);
    const cur = sstvui.cur || { at: Date.now() };
    const pic = { mode: m.mode, w: m.width, h: m.height, at: cur.at, slant: m.slant, complete: m.complete, lines: m.lines,
      kHz: typeof listen !== "undefined" ? listen.kHz : 0, src: cv.toDataURL("image/jpeg", 0.85) };
    // a picture that hardly started (a false start) isn't worth keeping
    if (m.lines >= Math.min(24, m.height / 8)) {
      sstvui.gallery.unshift(pic);
      sstvui.gallery = sstvui.gallery.slice(0, SSTV_KEEP);
      sstvSaveGallery();
    }
    sstvui.cur = null;
    sstvRenderInfo(pic);
    sstvRenderGallery();
  }
}

function sstvTime(t) { return new Date(t).toISOString().slice(11, 16); }

function sstvRenderInfo(done) {
  const el = $("sstvInfo");
  if (!el) return;
  const c = sstvui.cur;
  if (c) {
    const md = Sstv.MODES[c.mode];
    const left = md ? Math.max(0, Math.round(Sstv.seconds(md) - (Date.now() - c.at) / 1000)) : 0;
    el.textContent = `Receiving ${c.mode} (${c.width}×${c.height}): line ${c.lines} of ${c.height}${left ? `, about ${left} s to go` : ""}${c.manual ? " · started by hand" : ""}`;
  } else if (done) {
    el.textContent = `${done.mode} picture ${done.complete ? "received" : `stopped at line ${done.lines}`} at ${sstvTime(done.at)} UTC` +
      `${done.slant ? ` · straightened (sound card ${done.slant > 0 ? "+" : ""}${done.slant} ppm)` : ""}.`;
  } else el.textContent = dc.running ? "Waiting for a picture… (it starts by itself when the VIS code is heard)" : "Press Start decoding.";
  $("sstvStop").disabled = !c;
}

function sstvRenderGallery() {
  const g = $("sstvGallery");
  if (!g) return;
  g.innerHTML = sstvui.gallery.map((p, i) => `<figure class="sstvthumb">
      <img src="${p.src}" alt="${esc(p.mode)} picture received at ${sstvTime(p.at)} UTC" data-i="${i}">
      <figcaption>${esc(p.mode)} · ${sstvTime(p.at)}${p.complete ? "" : " (part)"}
        <span><button type="button" class="linkbtn sstvsave" data-i="${i}">Save</button> <button type="button" class="linkbtn sstvdel" data-i="${i}" aria-label="Delete this picture">✕</button></span></figcaption>
    </figure>`).join("") || `<p class="small muted">Pictures you receive appear here (the last ${SSTV_KEEP} are kept).</p>`;
}

function sstvSave(i) {
  const p = sstvui.gallery[i];
  if (!p) return;
  // Save as PNG at full size
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = p.w; c.height = p.h;
    c.getContext("2d").drawImage(img, 0, 0);
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `sstv-${p.mode.replace(/\s+/g, "-")}-${new Date(p.at).toISOString().slice(0, 16).replace(/[:T]/g, "")}.png`;
    a.click();
  };
  img.src = p.src;
}

function sstvTuneKHz() {
  const f = SSTV_FREQ[listen.band];
  return f || null;
}

/* ---------- Sending a picture ---------- */

const sstvtx = { img: null, mode: "Martin M1", fit: "cover", top: "", bottom: "" };

function sstvTxLoad() {
  try {
    const s = JSON.parse(load("bw-sstvtx") || "{}");
    if (Sstv.MODES[s.mode]) sstvtx.mode = s.mode;
    if (s.fit === "cover" || s.fit === "contain") sstvtx.fit = s.fit;
    if (typeof s.top === "string") sstvtx.top = s.top.slice(0, 40);
    if (typeof s.bottom === "string") sstvtx.bottom = s.bottom.slice(0, 40);
  } catch { /* defaults */ }
}
const sstvTxSave = () => store("bw-sstvtx", { mode: sstvtx.mode, fit: sstvtx.fit, top: sstvtx.top, bottom: sstvtx.bottom });

/** Your callsign, so the default text names you. */
const sstvDefaultTop = () => `CQ ${app.myCall || "MY CALL"}`;
const sstvDefaultBottom = () => `${(typeof grid4 === "function" && grid4()) || ""} · HamShack`.replace(/^ · /, "");

/** Draw what will be sent: the picture fitted to the mode's size, and the text on it. */
function sstvRenderOut() {
  const cv = $("sstvOut");
  if (!cv) return;
  const md = Sstv.MODES[sstvtx.mode];
  cv.width = md.width; cv.height = md.height;
  const g = cv.getContext("2d");
  g.fillStyle = "#000"; g.fillRect(0, 0, md.width, md.height);
  const img = sstvtx.img;
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = sstvtx.fit === "cover" ? Math.max(md.width / iw, md.height / ih) : Math.min(md.width / iw, md.height / ih);
    const w = iw * s, h = ih * s;
    g.drawImage(img, (md.width - w) / 2, (md.height - h) / 2, w, h);
  } else {
    // No picture chosen yet: a simple card
    const grad = g.createLinearGradient(0, 0, md.width, md.height);
    grad.addColorStop(0, "#0b4f6c"); grad.addColorStop(1, "#01baef");
    g.fillStyle = grad; g.fillRect(0, 0, md.width, md.height);
  }
  const size = Math.max(12, Math.round(md.height / 9));
  g.font = `700 ${size}px Barlow, Arial, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineJoin = "round";
  const text = (t, y) => {
    if (!t) return;
    g.lineWidth = Math.max(3, size / 6);
    g.strokeStyle = "rgba(0,0,0,.85)";
    g.strokeText(t, md.width / 2, y, md.width * 0.94);
    g.fillStyle = "#fff";
    g.fillText(t, md.width / 2, y, md.width * 0.94);
  };
  text(sstvtx.top, size * 0.85);
  text(sstvtx.bottom, md.height - size * 0.85);
  const secs = Math.round(Sstv.seconds(md) + 0.91); // with the VIS header
  $("sstvSendInfo").textContent = `${md.name}: ${md.width}×${md.height}, takes ${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, "0")} s.`;
}

async function sstvSendNow() {
  const md = Sstv.MODES[sstvtx.mode];
  sstvRenderOut();
  const data = $("sstvOut").getContext("2d").getImageData(0, 0, md.width, md.height).data;
  if (!sstvtx.top.includes(app.myCall || "\u0000") && !sstvtx.bottom.includes(app.myCall || "\u0000")) {
    $("sstvSendInfo").textContent = "Put your callsign on the picture (in the top or bottom text) before sending it.";
    return;
  }
  await txSendSstv(md, new Uint8ClampedArray(data), sstvtx.top);
}

function setupSstvSend() {
  sstvTxLoad();
  if (!sstvtx.top) sstvtx.top = sstvDefaultTop();
  if (!sstvtx.bottom) sstvtx.bottom = sstvDefaultBottom();
  $("sstvTxMode").innerHTML = Object.keys(Sstv.MODES).map((n) => `<option>${esc(n)}</option>`).join("");
  $("sstvTxMode").value = sstvtx.mode;
  $("sstvFit").value = sstvtx.fit;
  $("sstvTop").value = sstvtx.top;
  $("sstvBottom").value = sstvtx.bottom;
  $("sstvTxMode").addEventListener("change", () => { sstvtx.mode = $("sstvTxMode").value; sstvTxSave(); sstvRenderOut(); });
  $("sstvFit").addEventListener("change", () => { sstvtx.fit = $("sstvFit").value; sstvTxSave(); sstvRenderOut(); });
  $("sstvTop").addEventListener("input", () => { sstvtx.top = $("sstvTop").value; sstvTxSave(); sstvRenderOut(); });
  $("sstvBottom").addEventListener("input", () => { sstvtx.bottom = $("sstvBottom").value; sstvTxSave(); sstvRenderOut(); });
  $("sstvFile").addEventListener("change", () => {
    const f = $("sstvFile").files && $("sstvFile").files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { sstvtx.img = img; sstvRenderOut(); };
    img.onerror = () => { $("sstvSendInfo").textContent = "That file isn't a picture HamShack can open."; };
    img.src = url;
  });
  $("sstvUseRx").addEventListener("click", () => {
    const img = new Image();
    img.onload = () => { sstvtx.img = img; sstvRenderOut(); };
    img.src = sstvCanvas().toDataURL("image/png");
  });
  $("sstvSendBtn").addEventListener("click", sstvSendNow);
  $("sstvSend").addEventListener("toggle", sstvRenderOut);
  sstvRenderOut();
}

function setupSstv() {
  if (!$("dcSstv")) return;
  setupSstvSend();
  sstvLoadGallery();
  $("sstvNowMode").innerHTML = Object.keys(Sstv.MODES).map((n) => `<option>${esc(n)}</option>`).join("");
  $("sstvNowMode").value = load("bw-sstvmode") || "Scottie S1";
  $("sstvNowMode").addEventListener("change", () => store("bw-sstvmode", $("sstvNowMode").value));
  $("sstvNow").addEventListener("click", () => {
    if (!dc.running || !dc.worker) { $("sstvInfo").textContent = "Press Start decoding first."; return; }
    dc.worker.postMessage({ type: "sstv-now", mode: $("sstvNowMode").value });
  });
  $("sstvStop").addEventListener("click", () => { if (dc.worker) dc.worker.postMessage({ type: "sstv-stop" }); });
  $("sstvGallery").addEventListener("click", (e) => {
    const s = e.target.closest(".sstvsave");
    if (s) { sstvSave(Number(s.dataset.i)); return; }
    const d = e.target.closest(".sstvdel");
    if (d) { sstvui.gallery.splice(Number(d.dataset.i), 1); sstvSaveGallery(); sstvRenderGallery(); return; }
    const im = e.target.closest("img");
    if (im) {
      // show it big in the main picture
      const p = sstvui.gallery[Number(im.dataset.i)];
      const img = new Image();
      img.onload = () => { const cv = sstvCanvas(); cv.width = p.w; cv.height = p.h; cv.getContext("2d").drawImage(img, 0, 0); sstvRenderInfo(p); };
      img.src = p.src;
    }
  });
  sstvRenderGallery();
  sstvRenderInfo();
  setInterval(() => { if (sstvui.cur) sstvRenderInfo(); }, 1000);
}
