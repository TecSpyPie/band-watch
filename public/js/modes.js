/* Mode filter: a box of modes to show (CW, voice, FT8 and the other data modes). Applies to the whole page. */
"use strict";

const MODE_GROUPS = [
  { name: "Voice", note: "Rarely spotted: speech isn't decoded automatically", modes: [["SSB", "SSB (USB and LSB)"], ["AM", "AM"], ["FM", "FM"], ["DV", "Digital voice (FreeDV, DMR, D-STAR)"]] },
  { name: "Morse", modes: [["CW", "CW"]] },
  { name: "WSJT-X weak signal", modes: [["FT8", "FT8"], ["FT4", "FT4"], ["WSPR", "WSPR"], ["FST4", "FST4"], ["FST4W", "FST4W"], ["JT65", "JT65"], ["JT9", "JT9"], ["Q65", "Q65"], ["MSK144", "MSK144"]] },
  { name: "Keyboard and data", modes: [["JS8", "JS8Call"], ["PSK", "PSK31, PSK63 and other PSK"], ["RTTY", "RTTY"], ["OLIVIA", "Olivia"], ["CONTESTIA", "Contestia"], ["MFSK", "MFSK"], ["THOR", "Thor"], ["DOMINO", "DominoEX"], ["HELL", "Hellschreiber"], ["ROS", "ROS"], ["VARA", "VARA"], ["ARDOP", "ARDOP"], ["PACKET", "Packet and APRS"], ["PACTOR", "PACTOR"], ["SSTV", "SSTV and image modes"]] },
];
const KNOWN_MODES = new Set(MODE_GROUPS.flatMap((g) => g.modes.map(([k]) => k)));
const DATA_MODES = MODE_GROUPS.slice(2).flatMap((g) => g.modes.map(([k]) => k));
const VOICE_MODES = MODE_GROUPS[0].modes.map(([k]) => k);

/** PSK Reporter's mode name -> one of the keys above (or the name itself for anything else). */
function modeKey(raw) {
  const m = String(raw || "").toUpperCase().replace(/[\s_-]/g, "");
  if (!m) return "OTHER";
  if (/^(SSB|USB|LSB)$/.test(m)) return "SSB";
  if (/^(AM|SAM)$/.test(m)) return "AM";
  if (/^(FM|NBFM|NFM|WFM)$/.test(m)) return "FM";
  if (/^(FREEDV|DV|DIGITALVOICE|DMR|DSTAR|C4FM|M17|FUSION|YSF)/.test(m)) return "DV";
  if (/^(CW|QRSS|DFCW)$/.test(m)) return "CW";
  if (/^FST4W/.test(m)) return "FST4W";
  if (/^FST4/.test(m)) return "FST4";
  if (/^(Q65|JT65|JT9|JT4|FT8|FT4|WSPR|MSK144|JS8)/.test(m)) return m.match(/^(Q65|JT65|JT9|JT4|FT8|FT4|WSPR|MSK144|JS8)/)[1];
  if (/^(PSK|BPSK|QPSK|8PSK)/.test(m)) return "PSK";
  if (/^(RTTY|BAUDOT|FSK)/.test(m)) return "RTTY";
  if (/^OLIVIA/.test(m)) return "OLIVIA";
  if (/^CONTESTIA/.test(m)) return "CONTESTIA";
  if (/^(MFSK|IFKP)/.test(m)) return "MFSK";
  if (/^THOR/.test(m)) return "THOR";
  if (/^DOMINO/.test(m)) return "DOMINO";
  if (/^(HELL|FELD)/.test(m)) return "HELL";
  if (/^ROS/.test(m)) return "ROS";
  if (/^VARA/.test(m)) return "VARA";
  if (/^ARDOP/.test(m)) return "ARDOP";
  if (/^(PACKET|APRS|AX25)/.test(m)) return "PACKET";
  if (/^PACTOR/.test(m)) return "PACTOR";
  if (/^(SSTV|FAX|HDSSTV|EASYPAL|DRM)/.test(m)) return "SSTV";
  return m;
}

const modeOn = (key) => !(settings.modesOff || []).includes(key);

function setModesOff(list) {
  settings.modesOff = [...new Set(list)];
  saveSettings();
  renderModes();
}

function renderModesButton() {
  const keys = new Set([...KNOWN_MODES, ...app.allPairs.map((p) => p.mk)]);
  const off = (settings.modesOff || []).filter((k) => keys.has(k)).length;
  const btn = $("modesBtn");
  btn.textContent = off ? `Modes: ${keys.size - off} of ${keys.size}` : "Modes: all";
  btn.classList.toggle("on", Boolean(off));
  if ($("modesBox").open) renderModes();
}

function renderModes() {
  const counts = {};
  for (const p of app.allPairs) counts[p.mk] = (counts[p.mk] || 0) + 1;
  const others = Object.keys(counts).filter((k) => !KNOWN_MODES.has(k)).sort().map((k) => [k, k]);
  const groups = [...MODE_GROUPS, ...(others.length ? [{ name: "Other modes seen now", modes: others }] : [])];
  const box = (k, label) => `<label class="mode"><input type="checkbox" data-mode="${esc(k)}"${modeOn(k) ? " checked" : ""}> ${esc(label)}` +
    `<span class="cnt">${counts[k] ? counts[k].toLocaleString() : ""}</span></label>`;
  $("modesList").innerHTML = groups.map((g, i) => {
    const keys = g.modes.map(([k]) => k);
    const on = keys.filter(modeOn).length;
    return `<fieldset><legend><label><input type="checkbox" data-group="${i}"${on === keys.length ? " checked" : ""}> ${esc(g.name)}</label>` +
      `${g.note ? ` <span class="small muted">${esc(g.note)}</span>` : ""}</legend>${g.modes.map(([k, l]) => box(k, l)).join("")}</fieldset>`;
  }).join("");
  $("modesList").querySelectorAll("input[data-group]").forEach((el) => {
    const keys = groups[Number(el.dataset.group)].modes.map(([k]) => k);
    const on = keys.filter(modeOn).length;
    el.indeterminate = on > 0 && on < keys.length;
    el.onchange = () => {
      const off = new Set(settings.modesOff || []);
      for (const k of keys) el.checked ? off.delete(k) : off.add(k);
      setModesOff([...off]);
    };
  });
  $("modesList").querySelectorAll("input[data-mode]").forEach((el) => {
    el.onchange = () => {
      const off = new Set(settings.modesOff || []);
      el.checked ? off.delete(el.dataset.mode) : off.add(el.dataset.mode);
      setModesOff([...off]);
    };
  });
  const shown = app.pairs.length, all = app.allPairs.length;
  $("modesSum").textContent = app.spots ? `Showing ${shown.toLocaleString()} of ${all.toLocaleString()} spots.` : "";
}

function setupModes() {
  const allKeys = () => [...new Set([...KNOWN_MODES, ...app.allPairs.map((p) => p.mk)])];
  $("modesBtn").addEventListener("click", () => {
    renderModes();
    $("modesBox").open ? $("modesBox").close() : $("modesBox").show();
  });
  $("modesClose").addEventListener("click", () => $("modesBox").close());
  $("modesBox").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); $("modesBox").close(); $("modesBtn").focus(); } });
  document.addEventListener("pointerdown", (e) => {
    if ($("modesBox").open && !$("modesBox").contains(e.target) && e.target !== $("modesBtn")) $("modesBox").close();
  });
  const preset = (id, keep) => $(id).addEventListener("click", () => setModesOff(allKeys().filter((k) => !keep(k))));
  preset("modesAll", () => true);
  preset("modesNone", () => false);
  preset("modesData", (k) => k !== "CW" && !VOICE_MODES.includes(k));
  preset("modesFt8", (k) => k === "FT8" || k === "FT4");
  preset("modesCw", (k) => k === "CW");
  preset("modesVoice", (k) => VOICE_MODES.includes(k));
}
