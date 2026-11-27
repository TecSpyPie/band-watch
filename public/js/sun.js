/* Sunspots: today's active regions on a drawing of the Sun, with NOAA's numbers and what they mean for HF. */
"use strict";

const SUN_REFRESH_MS = 30 * 60e3;
const SDO_IMAGE = "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg";
const sun = { data: null, error: false, sel: null, photo: false };

async function refreshSun() {
  try {
    sun.data = await getJson("/api/sun");
    sun.error = false;
  } catch {
    sun.error = true;
  }
  renderSun();
}

const SCALE_WORDS = {
  R: ["none", "minor", "moderate", "strong", "severe", "extreme"],
  S: ["none", "minor", "moderate", "strong", "severe", "extreme"],
  G: ["none", "minor", "moderate", "strong", "severe", "extreme"],
};

/** Position on the disc, as seen from Earth: solar north up, east on the left. Ignores the Sun's tilt. */
function discXY(lat, lon, r) {
  const la = lat * RAD, lo = lon * RAD;
  return { x: -r * Math.cos(la) * Math.sin(lo), y: -r * Math.sin(la), front: Math.abs(lon) <= 90 };
}

function regionRadius(area) { return 3 + Math.sqrt(Math.max(0, area || 0)) * 0.55; }

function complexMag(m) { return /D|G/.test(m || ""); } // delta or gamma: most likely to flare

function sunDisc(d) {
  const R = 120, C = 130;
  let g = `<svg viewBox="0 0 260 260" role="img" aria-label="Drawing of the Sun with ${d.regions.length} active regions">` +
    `<defs><radialGradient id="limb" cx="50%" cy="50%" r="50%"><stop offset="70%" stop-color="var(--sun1)"/><stop offset="100%" stop-color="var(--sun2)"/></radialGradient></defs>` +
    `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#limb)"/>`;
  // Grid: latitude lines and meridians every 30 degrees.
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = C - R * Math.sin(lat * RAD), w = R * Math.cos(lat * RAD);
    g += `<line x1="${(C - w).toFixed(1)}" y1="${y.toFixed(1)}" x2="${(C + w).toFixed(1)}" y2="${y.toFixed(1)}" class="sgrid"/>`;
  }
  for (let lon = -60; lon <= 60; lon += 30) {
    g += `<ellipse cx="${C}" cy="${C}" rx="${Math.abs(R * Math.sin(lon * RAD)).toFixed(1)}" ry="${R}" class="sgrid"/>`;
  }
  g += `<text x="${C}" y="10" text-anchor="middle" class="slab">N</text><text x="${C}" y="258" text-anchor="middle" class="slab">S</text>` +
    `<text x="2" y="${C + 4}" class="slab">E</text><text x="250" y="${C + 4}" class="slab">W</text>`;
  d.regions.forEach((r, i) => {
    const p = discXY(r.lat, r.lon, R);
    const spotted = (r.area || 0) > 0 || (r.spots || 0) > 0;
    const rad = spotted ? regionRadius(r.area) : 3;
    const cls = !p.front ? "behind" : !spotted ? "plage" : complexMag(r.magClass) ? "complex" : "spot";
    const x = C + (p.front ? p.x : Math.sign(p.x || 1) * R * Math.cos(r.lat * RAD) * 0.99);
    const y = C + p.y;
    const sel = sun.sel === r.region ? " sel" : "";
    g += `<g class="sreg ${cls}${sel}" data-i="${i}" tabindex="0" role="button" aria-label="Region ${r.region}, ${esc(r.location)}">` +
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}"/>` +
      `<text x="${(x + rad + 2).toFixed(1)}" y="${(y + 4).toFixed(1)}">${String(r.region).slice(-4)}</text></g>`;
  });
  return g + `</svg>`;
}

function flareOutlook(d) {
  const max = (k) => Math.max(0, ...d.regions.map((r) => (r.prob && r.prob[k]) || 0));
  return { c: max("c"), m: max("m"), x: max("x") };
}

/** A short plain-English reading of the numbers for HF operators. */
function sunAdvice(d) {
  const lines = [];
  const sfi = app.solar && app.solar.sfi;
  const kp = app.solar && app.solar.kp;
  if (sfi != null) {
    lines.push(sfi >= 150 ? "Solar flux is high: 15, 12 and 10 m should open in daylight, often worldwide."
      : sfi >= 110 ? "Solar flux is good: 20 to 15 m are the daytime bands, with 10 m openings likely."
        : sfi >= 80 ? "Solar flux is moderate: 20 m is the main daytime band; 15 and 10 m open less often."
          : "Solar flux is low: favour 40 and 20 m; the higher bands will mostly be closed.");
  }
  if (kp != null && kp >= 5) lines.push("A geomagnetic storm is under way: expect weak, fluttery signals, especially on paths near the poles.");
  else if (kp != null && kp >= 4) lines.push("The geomagnetic field is unsettled: high-latitude paths may be poor.");
  const r = d.scales && Number(d.scales.R);
  if (r >= 1) lines.push("A radio blackout is happening on the sunlit side of the Earth: the lower HF bands fade first.");
  const o = flareOutlook(d);
  if (o.x >= 10 || o.m >= 40) lines.push(`Flares are likely (up to ${o.m}% chance of an M-class flare today), which can black out HF on the daylight side for minutes to hours.`);
  return lines;
}

function renderSun() {
  const d = sun.data;
  if (!d) {
    $("sunDisc").innerHTML = `<p class="muted small">${sun.error ? "Sunspot data couldn’t be loaded from NOAA. HamShack will try again." : "Loading sunspot data…"}</p>`;
    $("sunFacts").innerHTML = "";
    $("sunRows").innerHTML = "";
    return;
  }
  $("sunDisc").innerHTML = sun.photo
    ? `<img src="${SDO_IMAGE}" alt="Latest picture of the Sun from NASA's Solar Dynamics Observatory" width="260" height="260" referrerpolicy="no-referrer">`
    : sunDisc(d);
  $("sunPhoto").textContent = sun.photo ? "Show the map" : "Show NASA's latest picture";

  const xr = d.xray;
  const scales = d.scales ? ["R", "S", "G"].map((k) => `${k}${d.scales[k]} <span class="muted">${SCALE_WORDS[k][Number(d.scales[k])] || ""}</span>`).join(" · ") : "–";
  const o = flareOutlook(d);
  const spotted = d.regions.filter((r) => (r.spots || 0) > 0);
  const facts = [
    ["Sunspot number", d.ssn != null ? `<b>${d.ssn}</b> <span class="muted small">(${esc(d.ssnDate || "")})</span>` : "–"],
    ["Solar flux", app.solar ? `<b>${Math.round(app.solar.sfi)}</b>` : "–"],
    ["Kp index", app.solar ? `<b>${app.solar.kp}</b>` : "–"],
    ["Sunspot groups", `<b>${spotted.length}</b> <span class="muted small">of ${d.regions.length} numbered regions</span>`],
    ["X-rays now", xr && xr.now ? `<b>${esc(xr.now)}</b>` : "–"],
    ["Latest flare", xr && xr.flare ? `<b>${esc(xr.flare)}</b> <span class="muted small">peak ${xr.flareAt ? esc(new Date(xr.flareAt).toISOString().slice(11, 16)) + " UTC" : ""}</span>` : "–"],
    ["Solar wind", d.wind != null ? `<b>${Math.round(d.wind)}</b> km/s` : "–"],
    ["NOAA scales now", scales],
    ["Flare chance today", `C ${o.c}% · M ${o.m}% · X ${o.x}%`],
  ];
  $("sunFacts").innerHTML = `<dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` +
    `<ul class="advice">${sunAdvice(d).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;

  $("sunRows").innerHTML = d.regions.length
    ? d.regions.map((r, i) => `<tr data-i="${i}" class="${sun.sel === r.region ? "hl" : ""}" tabindex="0">` +
      `<td>${r.region}</td><td>${esc(r.location)}</td><td class="num">${r.area ?? "–"}</td><td class="num">${r.spots ?? "–"}</td>` +
      `<td>${esc(r.spotClass || "–")}</td><td>${esc(r.magClass || "–")}${complexMag(r.magClass) ? ' <span class="warn">complex</span>' : ""}</td>` +
      `<td class="num">${r.prob ? `${r.prob.c ?? "–"} / ${r.prob.m ?? "–"} / ${r.prob.x ?? "–"}` : "–"}</td>` +
      `<td class="num">${r.flares.c + r.flares.m + r.flares.x ? `${r.flares.c}C ${r.flares.m}M ${r.flares.x}X` : ""}</td></tr>`).join("")
    : `<tr><td colspan="8" class="muted">No numbered active regions today.</td></tr>`;
  $("sunNote").textContent = `NOAA SWPC, ${d.date}. Region positions are approximate: the drawing ignores the Sun's tilt.`;

  const pick = (i) => { sun.sel = d.regions[i].region === sun.sel ? null : d.regions[i].region; renderSun(); };
  document.querySelectorAll("#sunDisc .sreg, #sunRows tr[data-i]").forEach((el) => {
    el.onclick = () => pick(Number(el.dataset.i));
    el.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(Number(el.dataset.i)); } };
  });
}

function setupSun() {
  $("sunPhoto").addEventListener("click", () => { sun.photo = !sun.photo; renderSun(); });
  renderSun();
  refreshSun();
  setInterval(refreshSun, SUN_REFRESH_MS);
}
