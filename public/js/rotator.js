/* Rotator add-on: turn your antenna from HamShack. Connects to the rotator controller over its own USB serial port
   (Web Serial, Chrome or Edge), speaking Yaesu GS-232A/B, EasyComm II or Hy-Gain DCU-1 (rotmath.js). A compass dial
   shows where the beam points and where it's going; click the dial, a compass button or type a heading; point at a
   locator or a callsign HamShack has heard (short or long path); or follow a satellite across the sky.
   The rotator only moves when you ask; Stop (or Esc) stops it. */
"use strict";

const rot = {
  proto: "gs232a", baud: 9600, longPath: false, // saved
  port: null, writer: null, reader: null, connected: false, az: null, el: null, target: null, follow: null,
  buf: "", poll: null, followTimer: null, lastSent: null, note: "",
};

function rotLoad() {
  try {
    const s = JSON.parse(load("bw-rot") || "{}");
    if (RotMath.PROTOCOLS[s.proto]) rot.proto = s.proto;
    if ([1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(s.baud)) rot.baud = s.baud;
    rot.longPath = s.longPath === true;
  } catch { /* defaults */ }
}
const rotSave = () => store("bw-rot", { proto: rot.proto, baud: rot.baud, longPath: rot.longPath });
const rotP = () => RotMath.PROTOCOLS[rot.proto];

async function rotWrite(s) {
  if (!rot.writer) return;
  try { await rot.writer.write(new TextEncoder().encode(s)); } catch (e) { rotLost(`Couldn't talk to the rotator: ${e.message || e}`); }
}

async function rotConnect() {
  if (!("serial" in navigator)) { rot.note = "Rotator control needs Chrome or Edge on the computer the rotator is plugged into."; renderRot(); return; }
  try {
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: rot.baud });
    rot.port = port;
    rot.writer = port.writable.getWriter();
    rot.connected = true;
    rot.note = `Connected (${rotP().name}, ${rot.baud} baud).`;
    rotReadLoop();
    rot.poll = setInterval(() => { if (rot.connected) rotWrite(rotP().ask()); }, 1000);
    rotWrite(rotP().ask());
  } catch (e) {
    if (e && e.name !== "NotFoundError") rot.note = `Couldn't open the rotator's port (${e.message || e}).`;
  }
  renderRot();
}

async function rotReadLoop() {
  const dec = new TextDecoder();
  try {
    while (rot.port && rot.port.readable) {
      rot.reader = rot.port.readable.getReader();
      for (;;) {
        const { value, done } = await rot.reader.read();
        if (done) break;
        rot.buf = (rot.buf + dec.decode(value)).slice(-200);
        // answers end with a new line, a carriage return or (DCU-1) a semicolon
        const parts = rot.buf.split(/[\r\n;]+/);
        rot.buf = parts.pop();
        for (const line of parts) {
          const r = line.trim() && rotP().read(line);
          if (r) { rot.az = r.az; if (r.el != null) rot.el = r.el; renderRotDial(); }
        }
      }
      rot.reader.releaseLock();
    }
  } catch (e) { if (rot.connected) rotLost(`The rotator stopped answering (${e.message || e}).`); }
}

function rotLost(why) {
  rotDisconnect();
  rot.note = why;
  renderRot();
}

async function rotDisconnect() {
  rot.connected = false;
  clearInterval(rot.poll); rot.poll = null;
  rotStopFollow();
  try { if (rot.reader) await rot.reader.cancel(); } catch { /* gone */ }
  try { if (rot.writer) rot.writer.releaseLock(); } catch { /* gone */ }
  try { if (rot.port) await rot.port.close(); } catch { /* gone */ }
  rot.port = rot.writer = rot.reader = null;
  renderRot();
}

/** Turn to a heading (and elevation, on an az/el rotator). */
function rotGoto(az, el, why = "") {
  if (!rot.connected) { rot.note = "Connect the rotator first."; renderRot(); return; }
  const a = RotMath.clampAz(az), e = rotP().el && el != null ? RotMath.clampEl(el) : null;
  rot.target = { az: a, el: e };
  rot.lastSent = { az: a, el: e };
  rotWrite(rotP().goto(a, e));
  rot.note = `Turning to ${a}° ${RotMath.compass(a)}${e != null ? `, ${e}° up` : ""}${why ? ` (${why})` : ""}.`;
  renderRot();
}

function rotStop() {
  rotStopFollow();
  rot.target = null;
  if (rot.connected) rotWrite(rotP().stop());
  rot.note = "Stopped.";
  renderRot();
}

/** Where is this? A locator, or a callsign HamShack has heard (decodes, spots, POTA). */
function rotWhere(text) {
  const t = String(text || "").trim().toUpperCase();
  if (!t) return null;
  const g = gridToLatLon(t.slice(0, 6).replace(/^([A-R]{2}\d{2})([A-X]{2})?$/i, (m, a, b) => a + (b || "")));
  if (/^[A-R]{2}\d{2}([A-X]{2})?$/.test(t) && g) return { ...g, what: t };
  const call = typeof baseCall === "function" ? baseCall(t) : t;
  if (typeof dc !== "undefined") {
    for (const r of dc.rows) {
      const s = typeof dcStation === "function" ? dcStation(r.text) : null;
      if (s && baseCall(s.call) === call && s.grid) { const p = gridToLatLon(s.grid); if (p) return { ...p, what: `${t} (${s.grid})` }; }
    }
  }
  for (const b of app.bands || []) for (const p of b.sp || []) if (baseCall(p.c) === call && p.lat != null) return { lat: p.lat, lon: p.lon, what: `${t} (${p.g || "from spots"})` };
  if (typeof xota !== "undefined") for (const x of xota.spots) if (baseCall(x.call) === call && x.lat != null) return { lat: x.lat, lon: x.lon, what: `${t} (${x.ref})` };
  return null;
}

function rotPointAt() {
  const v = $("rotAt").value;
  const w = rotWhere(v);
  if (!w) { rot.note = `HamShack doesn't know where "${v.trim()}" is yet: type their locator (e.g. FN31) instead.`; renderRot(); return; }
  rotStopFollow();
  const az = RotMath.bearing(app.home.lat, app.home.lon, w.lat, w.lon, rot.longPath);
  const km = Math.round(distanceKm(app.home.lat, app.home.lon, w.lat, w.lon));
  rotGoto(az, rotP().el ? 0 : null, `${w.what}, ${(rot.longPath ? 40075 - km : km).toLocaleString()} km ${rot.longPath ? "long path" : "short path"}`);
}

/* ---------- Following a satellite ---------- */

function rotStopFollow() {
  clearInterval(rot.followTimer); rot.followTimer = null; rot.follow = null;
}

function rotFollow(id) {
  if (!rot.connected) { rot.note = "Connect the rotator first."; renderRot(); return; }
  if (typeof sats === "undefined" || !sats.lib) { rot.note = "Satellite orbits haven't loaded yet."; renderRot(); return; }
  rotStopFollow();
  rot.follow = id;
  rot.lastSent = null;
  const tick = () => {
    const rec = satRec(id);
    if (!rec) { rot.note = "No orbit for that satellite."; rotStopFollow(); renderRot(); return; }
    const now = Date.now(), obs = satObs();
    const l = SatMath.look(sats.lib, rec, new Date(now), obs);
    let az, el, why;
    if (l && l.el > 0) { az = l.az; el = l.el; why = `following ${satName(id)}`; } else {
      // below the horizon: wait pointing where it will rise
      const p = SatMath.passes(sats.lib, rec, obs, now, 24, 0)[0];
      if (!p) { rot.note = `${satName(id)} has no pass in the next day.`; renderRot(); return; }
      az = p.aosAz; el = 0; why = `waiting for ${satName(id)} to rise ${satIn(p.aos - now)}`;
    }
    const last = rot.lastSent;
    // only send when it has moved a couple of degrees: rotators are slow, and this saves wear
    if (!last || Math.abs(RotMath.turn(last.az, az)) >= 2 || (rotP().el && Math.abs((last.el || 0) - el) >= 2)) rotGoto(az, el, why);
    else { rot.note = `${why[0].toUpperCase()}${why.slice(1)}: ${Math.round(az)}° ${RotMath.compass(az)}${rotP().el ? `, ${Math.round(el)}° up` : ""}.`; renderRot(); }
  };
  tick();
  rot.followTimer = setInterval(tick, 2000);
}

/* ---------- On screen ---------- */

function renderRotDial() {
  const svg = $("rotDial");
  if (!svg) return;
  const R = 90;
  const xy = (az, r) => [Math.sin((az * Math.PI) / 180) * r, -Math.cos((az * Math.PI) / 180) * r];
  let s = `<circle r="${R}" class="rotring"/>`;
  for (let a = 0; a < 360; a += 10) {
    const [x1, y1] = xy(a, a % 90 ? R - 5 : R - 10), [x2, y2] = xy(a, R);
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" class="rottick"/>`;
  }
  for (const [a, t] of [[0, "N"], [90, "E"], [180, "S"], [270, "W"]]) { const [x, y] = xy(a, R - 20); s += `<text x="${x}" y="${y}" class="rotlbl">${t}</text>`; }
  if (rot.target) { const [x, y] = xy(rot.target.az, R - 4); s += `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rottarget"/>`; }
  if (rot.az != null) {
    const [x, y] = xy(rot.az, R - 8), [lx, ly] = xy(rot.az - 6, R - 26), [rx, ry] = xy(rot.az + 6, R - 26);
    s += `<line x1="0" y1="0" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="rotbeam"/><polygon points="${x.toFixed(1)},${y.toFixed(1)} ${lx.toFixed(1)},${ly.toFixed(1)} ${rx.toFixed(1)},${ry.toFixed(1)}" class="rotbeamhead"/>`;
  }
  s += `<circle r="4" class="rothub"/>`;
  svg.innerHTML = s;
  $("rotNow").textContent = rot.az == null ? (rot.connected ? "Asking the rotator where it points…" : "Not connected")
    : `Pointing ${Math.round(rot.az)}° ${RotMath.compass(rot.az)}${rot.el != null && rotP().el ? `, ${Math.round(rot.el)}° up` : ""}`;
}

function renderRot() {
  if (!$("secRot")) return;
  $("rotConnect").textContent = rot.connected ? "Disconnect" : "Connect rotator";
  $("rotProto").value = rot.proto;
  $("rotBaud").value = String(rot.baud);
  $("rotProto").disabled = $("rotBaud").disabled = rot.connected;
  $("rotLong").checked = rot.longPath;
  if (typeof sats !== "undefined" && sats.picked) {
    const cur = $("rotSat").value;
    $("rotSat").innerHTML = `<option value="">Choose a satellite…</option>` + sats.picked.map((id) => `<option value="${id}">${esc(satName(id))}</option>`).join("");
    $("rotSat").value = rot.follow ? String(rot.follow) : cur;
  }
  $("rotFollow").textContent = rot.follow ? "Stop following" : "Follow";
  $("rotNote").textContent = rot.note;
  renderRotDial();
}

function setupRotator() {
  if (!$("secRot")) return;
  rotLoad();
  $("rotProto").innerHTML = Object.entries(RotMath.PROTOCOLS).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join("");
  $("rotProto").addEventListener("change", () => { rot.proto = $("rotProto").value; rot.baud = rotP().baud; rotSave(); renderRot(); });
  $("rotBaud").addEventListener("change", () => { rot.baud = Number($("rotBaud").value); rotSave(); });
  $("rotConnect").addEventListener("click", () => (rot.connected ? rotDisconnect() : rotConnect()));
  $("rotStop").addEventListener("click", rotStop);
  $("rotLong").addEventListener("change", () => { rot.longPath = $("rotLong").checked; rotSave(); });
  $("rotGo").addEventListener("click", rotPointAt);
  $("rotAt").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); rotPointAt(); } });
  $("rotTurn").addEventListener("click", () => { const v = Number($("rotDeg").value); if (Number.isFinite(v)) { rotStopFollow(); rotGoto(v, null, "by hand"); } });
  $("secRot").addEventListener("click", (e) => { const b = e.target.closest("button[data-az]"); if (b) { rotStopFollow(); rotGoto(Number(b.dataset.az), null, "by hand"); } });
  // Click the dial: turn to that heading
  $("rotDial").addEventListener("click", (e) => {
    const r = $("rotDial").getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(x, y) < 8) return;
    rotStopFollow();
    rotGoto((Math.atan2(x, -y) * 180) / Math.PI, null, "clicked on the dial");
  });
  $("rotFollow").addEventListener("click", () => {
    if (rot.follow) { rotStop(); return; }
    const id = Number($("rotSat").value);
    if (id) rotFollow(id); else { rot.note = "Choose a satellite to follow."; renderRot(); }
  });
  $("rotSat").addEventListener("focus", renderRot); // the satellite list may have changed
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && rot.connected && (rot.target || rot.follow)) rotStop(); });
  renderRot();
}
