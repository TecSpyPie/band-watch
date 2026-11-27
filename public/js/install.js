// HamShack by M0GLP & M3VRV: makes HamShack installable as an app (Windows, Android, iPhone)
// and offers the browser's own "Install" prompt where there is one.
"use strict";
(function () {
  const bw = (window.bwInstall = { prompt: null, installed: false, listeners: [] });
  const notify = () => bw.listeners.forEach((f) => { try { f(bw); } catch { /* keep going */ } });

  bw.standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  bw.platform = () => {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iphone";
    if (/Android/.test(ua)) return "android";
    if (/Windows/.test(ua)) return "windows";
    return "";
  };
  bw.onChange = (f) => { bw.listeners.push(f); f(bw); };
  bw.install = async () => {
    if (!bw.prompt) return false;
    const p = bw.prompt;
    bw.prompt = null;
    p.prompt();
    let accepted = false;
    try { accepted = (await p.userChoice).outcome === "accepted"; } catch { /* dismissed */ }
    if (accepted) bw.installed = true;
    notify();
    return accepted;
  };

  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); bw.prompt = e; notify(); });
  window.addEventListener("appinstalled", () => { bw.installed = true; bw.prompt = null; notify(); });

  // The "Install HamShack" part of Settings in the main page.
  document.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("optInstall");
    const msg = document.getElementById("optInstMsg");
    if (!btn || !msg) return;
    btn.addEventListener("click", () => bw.install());
    bw.onChange(() => {
      btn.hidden = !bw.prompt;
      if (bw.standalone() || bw.installed) msg.textContent = "HamShack is installed as an app on this device. You can put it on your other devices too.";
    });
  });

  // Service workers need https, or http on this computer (the Windows app).
  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
  }
})();
