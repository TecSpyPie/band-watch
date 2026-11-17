/* Active band monitor: watches bands and alerts when one opens. */
"use strict";

/* ===================== Active band monitor ===================== */

const monitor = { watched: ["20", "15", "10"], history: {}, last: {}, log: [], sound: false, notify: false };
let audio = null;
let toastTimer = null;

function loadMonitor() {
  try {
    const saved = JSON.parse(load("bw-mon"));
    if (!saved) return;
    if (Array.isArray(saved.w)) monitor.watched = saved.w.filter((b) => BANDS.includes(b));
    monitor.sound = Boolean(saved.snd);
    monitor.notify = Boolean(saved.nt);
    // History older than 30 minutes is no longer meaningful.
    const newest = Math.max(0, ...Object.values(saved.h || {}).flat().map((s) => s.t));
    if (Date.now() - newest < 30 * 60e3) {
      monitor.history = saved.h || {};
      monitor.last = saved.p || {};
      monitor.log = Array.isArray(saved.log) ? saved.log : [];
    }
  } catch { /* corrupt or missing */ }
}

function saveMonitor() {
  store("bw-mon", { w: monitor.watched, h: monitor.history, p: monitor.last, log: monitor.log, snd: monitor.sound, nt: monitor.notify });
}

function resetMonitorHistory() {
  monitor.history = {};
  monitor.last = {};
  monitor.log = [];
}

/** Record one sample per band and raise an alert when a watched band opens. */
function monitorTick() {
  const now = Date.now();
  for (const band of app.bands) {
    const s = status(band);
    if (s === "none") continue;
    const h = (monitor.history[band.b] ||= []);
    const prevSample = h[h.length - 1];
    if (!prevSample || now - prevSample.t >= 55e3) {
      h.push({ t: now, n: band.sp.length, s });
      if (h.length > 60) h.shift();
    }
    const prev = monitor.last[band.b];
    if (prev && prev !== s && monitor.watched.includes(band.b)) {
      monitor.log.unshift({ t: now, b: band.b, from: prev, to: s });
      monitor.log.length = Math.min(monitor.log.length, 12);
      if (s === "open" && STATUS_RANK[s] > STATUS_RANK[prev]) announceOpen(band);
    }
    monitor.last[band.b] = s;
  }
  saveMonitor();
  drawMonitor();
}

function heldFor(b, s) {
  const h = monitor.history[b] || [];
  if (!h.length) return "";
  let i = h.length - 1;
  while (i > 0 && h[i - 1].s === s) i--;
  const m = Math.round((Date.now() - h[i].t) / 6e4);
  if (i === 0 && h.length > 1) return `at least ${m} min`;
  return m < 1 ? "under a minute" : `${m} min`;
}

function sparkline(b) {
  const h = (monitor.history[b] || []).slice(-36);
  if (h.length < 2) return `<svg viewBox="0 0 120 26" aria-hidden="true"><text x="0" y="17" font-size="10" fill="var(--muted)">collecting…</text></svg>`;
  const max = Math.max(OPEN_AT, ...h.map((s) => s.n));
  const pts = h.map((s, i) => `${((i / (h.length - 1)) * 118 + 1).toFixed(1)},${(24 - (s.n / max) * 22).toFixed(1)}`).join(" ");
  const openY = (24 - (OPEN_AT / max) * 22).toFixed(1);
  return `<svg viewBox="0 0 120 26" aria-hidden="true"><line x1="0" y1="${openY}" x2="120" y2="${openY}" stroke="var(--grid)" stroke-dasharray="2 2" stroke-width=".8"/>` +
    `<polyline points="${pts}" fill="none" stroke="var(--cool)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function drawMonitor() {
  $("chips").innerHTML = BANDS.map((b) => `<button type="button" data-b="${b}" aria-pressed="${monitor.watched.includes(b)}">${b} m</button>`).join("");
  $("chips").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => {
      const b = btn.dataset.b;
      monitor.watched = monitor.watched.includes(b) ? monitor.watched.filter((x) => x !== b) : [...monitor.watched, b];
      saveMonitor();
      drawMonitor();
    };
  });

  const watched = app.bands.filter((x) => monitor.watched.includes(x.b));
  $("mon").innerHTML = watched.length
    ? watched.map((x) => {
      const s = status(x);
      const held = s === "none" ? "" : heldFor(x.b, s);
      const detail = s === "none" ? "Waiting for live spots" : `${x.sp.length} spots${x.far ? `, farthest ${kmText(x.far)}` : ""}`;
      return `<li tabindex="0" data-b="${x.b}"><span class="bn">${x.b} m</span>` +
        `<span><span class="st ${s}">${STATUS_LABEL[s]}</span>${held ? ` for ${held}` : ""}<small>${detail}</small></span>${sparkline(x.b)}</li>`;
    }).join("")
    : `<li style="cursor:default;display:block"><small>No bands picked. Tap a band above to start watching it.</small></li>`;
  bindActivate("#mon li[data-b]", (el) => { selectBand(el.dataset.b); drawMonitor(); });

  $("mlog").innerHTML = monitor.log
    .filter((l) => monitor.watched.includes(l.b))
    .slice(0, 6)
    .map((l) => `<li>${new Date(l.t).toISOString().slice(11, 16)} UTC · ${l.b} m went from ${STATUS_LABEL[l.from]} to ${STATUS_LABEL[l.to]}</li>`)
    .join("");

  $("mSnd").checked = monitor.sound;
  $("mNote").checked = monitor.notify && "Notification" in window && Notification.permission === "granted";
}

function showToast(title, msg) {
  const toast = $("toast");
  toast.innerHTML = `<b>${esc(title)}</b>${esc(msg)}`;
  toast.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("on"), 12e3);
}

function announceOpen(band) {
  const msg = `${band.sp.length} stations spotted, the farthest ${kmText(band.far)} away.`;
  showToast(`${band.b} m just opened`, msg);

  if (monitor.sound && audio) {
    try {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.5);
    } catch { /* audio blocked */ }
  }
  if (monitor.notify && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(`Band Watch: ${band.b} m is open`, { body: msg, tag: `bw-${band.b}` }); } catch { /* not allowed */ }
  }
}

function setupMonitorControls() {
  $("toast").addEventListener("click", () => $("toast").classList.remove("on"));
  $("mSnd").addEventListener("change", (e) => {
    monitor.sound = e.target.checked;
    saveMonitor();
    if (monitor.sound) {
      try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { /* no audio */ }
    }
  });
  $("mNote").addEventListener("change", async (e) => {
    if (!e.target.checked) { monitor.notify = false; saveMonitor(); return; }
    try { monitor.notify = "Notification" in window && (await Notification.requestPermission()) === "granted"; } catch { monitor.notify = false; }
    e.target.checked = monitor.notify;
    saveMonitor();
  });
}
