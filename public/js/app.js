/* Start-up. Loaded last. */
"use strict";

/* ===================== Start ===================== */

function tickClock() {
  $("clock").textContent = `${new Date().toUTCString().slice(17, 25)} UTC`;
  tickWorldClock();
}

function start() {
  setupOptions();
  setupListen();
  setupRig();
  setupWindows();
  setupLog();
  setupWanted();
  setupXota();
  setupSats();
  setupSked();
  setupPanel();
  setupDecoders();
  setupTx();
  setupSstv();
  setupCwKey();
  setupRotator();
  setupDv();
  setupRepeaters();
  setupAprs();
  const savedGrid = load("bw-grid");
  if (savedGrid && gridToLatLon(savedGrid)) $("grid").value = savedGrid;
  app.home = gridToLatLon($("grid").value) || app.home;
  app.square = grid4();

  loadMonitor();
  setupScopeInput();
  setupScope3d();
  setupMonitorControls();
  $("grid").addEventListener("change", setGrid);
  $("lk").addEventListener("submit", lookupCall);
  setupWorldClock();
  setupActivity();
  setupMyCall();
  setupLocator();
  setupQrz();
  setupHover();
  setupSpotMap();
  setupModes();
  setupSun();
  // The Windows app says so in /healthz; it shows a Quit button in Settings.
  getJson("/healthz").then((h) => { app.desktop = Boolean(h.desktop); updateNudge(); }).catch(() => {});

  tickClock();
  setInterval(tickClock, 1000);
  render();
  drawMonitor();
  refresh();
  setInterval(refresh, REFRESH_MS);
}

start();

// Extras, loaded in order: extras.js (shack screen, forecast, Morse trainer), chat-ui.js (chat),
// round2.js (quick log, worked map, contests, who's hearing me).
(function () {
  const files = ["/js/extras.js?v=r2", "/js/chat-ui.js?v=r3", "/js/round2.js?v=r2"];
  const next = () => {
    const src = files.shift(); if (!src) return;
    const s = document.createElement("script");
    s.src = src; s.onload = s.onerror = next;
    document.body.append(s);
  };
  next();
})();
