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
  setupLog();
  setupLogMap();
  setupWanted();
  setupXota();
  setupDx();
  setupPlanner();
  setupDecoders();
  const savedGrid = load("bw-grid");
  if (savedGrid && gridToLatLon(savedGrid)) $("grid").value = savedGrid;
  app.home = gridToLatLon($("grid").value) || app.home;
  app.square = grid4();

  loadMonitor();
  setupScopeInput();
  setupMonitorControls();
  $("grid").addEventListener("change", setGrid);
  $("lk").addEventListener("submit", lookupCall);
  setupWorldClock();
  setupActivity();
  setupMyCall();
  setupLocator();
  setupQrz();
  setupHover();
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
