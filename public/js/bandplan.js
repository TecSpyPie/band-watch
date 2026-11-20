/* UK band plan (RSGB, following the IARU Region 1 HF plan) and the band plan chart. Frequencies in kHz. */
"use strict";

// Segment types, used for colours on the chart and the scope's band plan strip.
const PLAN_TYPES = {
  cw: { label: "CW", short: "CW" },
  narrow: { label: "Narrow band modes and data (up to 500 Hz)", short: "Data" },
  unatt: { label: "Data, including unattended stations", short: "Data" },
  all: { label: "All modes (phone, CW, data)", short: "All modes" },
  digi: { label: "All modes, data and unattended stations", short: "Data" },
  beacon: { label: "Beacons only", short: "Beacons" },
  fm: { label: "FM, repeaters and simplex", short: "FM" },
  sat: { label: "Satellite links", short: "Satellite" },
  rptin: { label: "Repeater inputs (what repeaters listen on; you normally listen on the output)", short: "Repeater in" },
  rptout: { label: "Repeater outputs (what repeaters send: listen here)", short: "Repeater out" },
  dv: { label: "Digital voice, hotspots and gateways", short: "Digital voice" },
  none: { label: "No UK amateur allocation", short: "Not UK" },
};

/*
 * seg: [from kHz, to kHz, type, max bandwidth in Hz (0 = not stated, -1 = no limit), usage]
 * centres: [kHz, label]
 */
const BANDPLAN = {
  160: {
    lo: 1810, hi: 2000,
    note: "UK allocation 1810–2000 kHz.",
    segs: [
      [1810, 1838, "cw", 200, "CW"],
      [1838, 1840, "narrow", 500, "Narrow band modes"],
      [1840, 1843, "digi", 2700, "All modes, data preferred"],
      [1843, 2000, "all", 2700, "All modes; the lowest LSB dial setting is 1843 kHz"],
    ],
    centres: [[1836, "CW QRP"], [1840, "FT8"], [1836.6, "WSPR"]],
  },
  80: {
    lo: 3500, hi: 3800,
    note: "UK allocation 3500–3800 kHz.",
    segs: [
      [3500, 3510, "cw", 200, "CW, priority for intercontinental contacts"],
      [3510, 3560, "cw", 200, "CW, contest preferred; QRS (slow CW) at 3555"],
      [3560, 3570, "cw", 200, "CW; QRP centre 3560"],
      [3570, 3580, "narrow", 200, "Narrow band modes, data"],
      [3580, 3590, "narrow", 500, "Narrow band modes, data"],
      [3590, 3600, "unatt", 500, "Narrow band modes, data, unattended stations"],
      [3600, 3620, "digi", 2700, "All modes, data, unattended stations"],
      [3620, 3650, "all", 2700, "All modes, SSB contest preferred; digital voice 3630"],
      [3650, 3700, "all", 2700, "All modes; SSB QRP 3690"],
      [3700, 3775, "all", 2700, "All modes, SSB contest preferred; image modes 3735, emergency 3760"],
      [3775, 3800, "all", 2700, "All modes, priority for intercontinental contacts"],
    ],
    centres: [[3555, "QRS"], [3560, "CW QRP"], [3573, "FT8"], [3630, "Digital voice"], [3690, "SSB QRP"], [3735, "Image"], [3760, "Emergency"]],
  },
  60: {
    lo: 5258.5, hi: 5406.5,
    note: "UK 5 MHz: Full licence only, in these blocks. Don't transmit in the gaps (including 5358–5362 kHz), even if you hear others there. Check rsgb.org/5MHz for current guidance.",
    segs: [
      [5258.5, 5264, "all", 0, "UK block"],
      [5264, 5276, "none", 0, "No UK allocation"],
      [5276, 5284, "all", 0, "UK block"],
      [5284, 5288.5, "none", 0, "No UK allocation"],
      [5288.5, 5292, "all", 0, "UK block"],
      [5292, 5298, "none", 0, "No UK allocation"],
      [5298, 5307, "all", 0, "UK block"],
      [5307, 5313, "none", 0, "No UK allocation"],
      [5313, 5323, "all", 0, "UK block"],
      [5323, 5333, "none", 0, "No UK allocation"],
      [5333, 5338, "all", 0, "UK block"],
      [5338, 5354, "none", 0, "No UK allocation"],
      [5354, 5358, "all", 2700, "UK block, inside the international 5351.5–5366.5 kHz band; FT8 5357"],
      [5358, 5362, "none", 0, "No UK allocation"],
      [5362, 5374.5, "all", 0, "UK block"],
      [5374.5, 5378, "none", 0, "No UK allocation"],
      [5378, 5382, "all", 0, "UK block"],
      [5382, 5395, "none", 0, "No UK allocation"],
      [5395, 5401.5, "all", 0, "UK block"],
      [5401.5, 5403.5, "none", 0, "No UK allocation"],
      [5403.5, 5406.5, "all", 0, "UK block"],
    ],
    centres: [[5357, "FT8"]],
  },
  40: {
    lo: 7000, hi: 7200,
    note: "UK allocation 7000–7200 kHz.",
    segs: [
      [7000, 7040, "cw", 200, "CW; QRP centre 7030"],
      [7040, 7047, "narrow", 500, "Narrow band modes, data"],
      [7047, 7050, "unatt", 500, "Narrow band modes, data, unattended stations"],
      [7050, 7053, "digi", 2700, "All modes, data, unattended; the lowest LSB dial setting is 7053"],
      [7053, 7060, "digi", 2700, "All modes, data"],
      [7060, 7100, "all", 2700, "All modes, SSB contest preferred; digital voice 7070, SSB QRP 7090"],
      [7100, 7130, "all", 2700, "All modes; Region 1 emergency 7110"],
      [7130, 7175, "all", 2700, "All modes, SSB contest preferred; image modes 7165"],
      [7175, 7200, "all", 2700, "All modes, SSB contest preferred, intercontinental priority"],
    ],
    centres: [[7030, "CW QRP"], [7047.5, "FT4"], [7070, "Digital voice"], [7074, "FT8"], [7090, "SSB QRP"], [7110, "Emergency"], [7165, "Image"]],
  },
  30: {
    lo: 10100, hi: 10150,
    note: "CW and data only: no phone, and no contests.",
    segs: [
      [10100, 10130, "cw", 200, "CW; QRP centre 10116"],
      [10130, 10150, "narrow", 500, "Narrow band modes, data"],
    ],
    centres: [[10116, "CW QRP"], [10136, "FT8"], [10140, "FT4"], [10138.7, "WSPR"]],
  },
  20: {
    lo: 14000, hi: 14350,
    note: "UK allocation 14000–14350 kHz.",
    segs: [
      [14000, 14060, "cw", 200, "CW, contest preferred; QRS (slow CW) 14055"],
      [14060, 14070, "cw", 200, "CW; QRP centre 14060"],
      [14070, 14089, "narrow", 500, "Narrow band modes, data"],
      [14089, 14099, "unatt", 500, "Narrow band modes, data, unattended stations"],
      [14099, 14101, "beacon", 0, "International Beacon Project, beacons only"],
      [14101, 14112, "digi", 2700, "All modes, data, unattended stations"],
      [14112, 14125, "all", 2700, "All modes"],
      [14125, 14300, "all", 2700, "All modes, SSB contest preferred; DX-peditions 14195 ±5 kHz"],
      [14300, 14350, "all", 2700, "All modes; global emergency 14300"],
    ],
    centres: [[14055, "QRS"], [14060, "CW QRP"], [14074, "FT8"], [14080, "FT4"], [14095.6, "WSPR"], [14100, "Beacons"], [14130, "Digital voice"], [14195, "DX-peditions"], [14230, "Image / SSTV"], [14285, "SSB QRP"], [14300, "Emergency"]],
  },
  17: {
    lo: 18068, hi: 18168,
    note: "No contests on this band.",
    segs: [
      [18068, 18095, "cw", 200, "CW; QRP centre 18086"],
      [18095, 18105, "narrow", 500, "Narrow band modes, data"],
      [18105, 18109, "unatt", 500, "Narrow band modes, data, unattended stations"],
      [18109, 18111, "beacon", 0, "Beacons only"],
      [18111, 18120, "digi", 2700, "All modes, data, unattended stations"],
      [18120, 18168, "all", 2700, "All modes; SSB QRP 18130, digital voice 18150, emergency 18160"],
    ],
    centres: [[18086, "CW QRP"], [18100, "FT8"], [18104, "FT4"], [18110, "Beacons"], [18130, "SSB QRP"], [18150, "Digital voice"], [18160, "Emergency"]],
  },
  15: {
    lo: 21000, hi: 21450,
    note: "UK allocation 21000–21450 kHz. 21125–21450 is also used by satellites, mostly above 21400.",
    segs: [
      [21000, 21070, "cw", 200, "CW; QRS 21055, QRP centre 21060"],
      [21070, 21090, "narrow", 500, "Narrow band modes, data"],
      [21090, 21110, "unatt", 500, "Narrow band modes, data, unattended stations"],
      [21110, 21120, "digi", 2700, "Data and unattended stations, not SSB"],
      [21120, 21149, "narrow", 500, "Narrow band modes"],
      [21149, 21151, "beacon", 0, "International Beacon Project, beacons only"],
      [21151, 21450, "all", 2700, "All modes; digital voice 21180, SSB QRP 21285, image 21340, emergency 21360"],
    ],
    centres: [[21055, "QRS"], [21060, "CW QRP"], [21074, "FT8"], [21140, "FT4"], [21150, "Beacons"], [21180, "Digital voice"], [21285, "SSB QRP"], [21340, "Image / SSTV"], [21360, "Emergency"]],
  },
  12: {
    lo: 24890, hi: 24990,
    note: "No contests on this band.",
    segs: [
      [24890, 24915, "cw", 200, "CW; QRP centre 24906"],
      [24915, 24925, "narrow", 500, "Narrow band modes, data"],
      [24925, 24929, "unatt", 500, "Narrow band modes, unattended stations"],
      [24929, 24931, "beacon", 0, "Beacons only"],
      [24931, 24940, "digi", 2700, "All modes, data, unattended stations"],
      [24940, 24990, "all", 2700, "All modes; SSB QRP 24950, digital voice 24960"],
    ],
    centres: [[24906, "CW QRP"], [24915, "FT8"], [24919, "FT4"], [24930, "Beacons"], [24950, "SSB QRP"], [24960, "Digital voice"]],
  },
  10: {
    lo: 28000, hi: 29700,
    note: "UK allocation 28000–29700 kHz.",
    segs: [
      [28000, 28070, "cw", 200, "CW; QRS 28055, QRP centre 28060"],
      [28070, 28120, "narrow", 500, "Narrow band modes, data"],
      [28120, 28150, "unatt", 500, "Narrow band modes, data, unattended stations"],
      [28150, 28190, "narrow", 500, "Narrow band modes"],
      [28190, 28225, "beacon", 0, "Beacons only (time-shared and continuous)"],
      [28225, 28300, "all", 2700, "All modes; beacons"],
      [28300, 28320, "digi", 2700, "All modes, data, unattended stations"],
      [28320, 29000, "all", 2700, "All modes; digital voice 28330, SSB QRP 28360, image 28680"],
      [29000, 29100, "all", -1, "All modes"],
      [29100, 29200, "fm", -1, "All modes; FM simplex in 10 kHz channels"],
      [29200, 29300, "unatt", -1, "Data, unattended stations"],
      [29300, 29510, "sat", -1, "Satellite links"],
      [29510, 29520, "none", 0, "Guard channel"],
      [29520, 29590, "fm", 6000, "FM repeater inputs (RH1–RH8)"],
      [29590, 29620, "fm", 6000, "FM calling 29600, simplex repeater 29610"],
      [29620, 29700, "fm", 6000, "FM repeater outputs (RH1–RH8)"],
    ],
    centres: [[28055, "QRS"], [28060, "CW QRP"], [28074, "FT8"], [28180, "FT4"], [28200, "Beacons"], [28330, "Digital voice"], [28360, "SSB QRP"], [28680, "Image / SSTV"], [29600, "FM calling"]],
  },
  6: {
    lo: 50000, hi: 52000,
    note: "UK allocation 50–52 MHz. Simplified: see the RSGB VHF band plan for repeater channels and details.",
    segs: [
      [50000, 50100, "cw", 500, "CW; intercontinental CW calling 50090"],
      [50100, 50200, "all", 2700, "SSB and CW; DX calling 50110, SSB centre 50150"],
      [50200, 50300, "all", 2700, "SSB, CW and data"],
      [50300, 50400, "narrow", 500, "Narrow band modes and data"],
      [50400, 50500, "beacon", 0, "Beacons"],
      [50500, 51410, "all", 12000, "All modes, including digital communications"],
      [51410, 52000, "fm", 12000, "FM: simplex (calling 51510) and repeaters"],
    ],
    centres: [[50090, "CW calling"], [50110, "DX calling"], [50150, "SSB centre"], [50313, "FT8"], [50318, "FT4"], [51510, "FM calling"]],
  },
  2: {
    lo: 144000, hi: 146000,
    note: "UK 2 m, 144–146 MHz. UK FM repeaters (RV48–RV63) send on 145.600–145.7875 MHz and listen 600 kHz lower (145.000–145.1875). Receive on the output. Simplified from the RSGB VHF band plan: check it, and your licence, before transmitting. Special conditions apply near Scarborough.",
    // Source: RSGB band plan 2026 (144 MHz sheet), summarised in plain words. Uncertain: FT8 144.174 and FT4 144.170 are
    // the usual calling channels (IARU Region 1 practice), not separate rows in the RSGB table; they sit in its
    // "CW, digital and SSB" block.
    segs: [
      [144000, 144025, "all", 2700, "All modes, including satellite downlinks"],
      [144025, 144100, "cw", 500, "CW, including moonbounce (EME); CW centre 144,050"],
      [144100, 144150, "narrow", 500, "CW and digital modes (moonbounce, meteor scatter calling 144,100)"],
      [144150, 144400, "all", 2700, "CW, digital and SSB; FT8 144,174, GB2RS news 144,250, SSB centre 144,300, meteor scatter 144,370"],
      [144400, 144490, "beacon", 0, "Propagation beacons only"],
      [144490, 144500, "beacon", 0, "Beacon guard band"],
      [144500, 144794, "all", 12000, "All modes; image 144,500, data centre 144,600, UK digital voice calling 144,6125, ATV talk-back 144,750"],
      [144794, 144990, "digi", 12000, "Data and digital voice, including unattended; APRS 144,800; internet voice gateways 144,8125–144,9625; ad hoc repeater inputs 144,975 and 144,9875"],
      [144990, 145193.5, "rptin", 12000, "FM and digital voice repeater inputs RV48–RV63 (145,000–145,1875)"],
      [145193.5, 145206, "sat", 12000, "Space communications, Earth to space (145,200, e.g. the ISS)"],
      [145206, 145593.5, "fm", 12000, "FM and digital voice simplex V16–V45; FM calling 145,500; GB2RS news 145,525; rally talk-in 145,550; ad hoc repeater outputs 145,575 and 145,5875"],
      [145593.5, 145793.5, "rptout", 12000, "FM and digital voice repeater outputs RV48–RV63 (145,600–145,7875)"],
      [145793.5, 146000, "sat", 12000, "Space to Earth (145,800, e.g. the ISS) and satellites only above 145,806"],
    ],
    centres: [[144050, "CW centre"], [144174, "FT8"], [144300, "SSB centre"], [144800, "APRS"], [145500, "FM calling"], [145600, "Repeaters (out)"], [145800, "ISS downlink"]],
  },
  70: {
    lo: 430000, hi: 440000,
    note: "UK 70 cm, 430–440 MHz. Amateur use is secondary. UK repeaters use several shifts: 1.6 MHz (outputs 433.000–433.375, inputs 434.600–434.975), 5 MHz (inputs 438.000–438.375), 7.6 MHz (outputs 430.8125–430.975, inputs 438.4125–438.575) and 9 MHz for digital voice. 430–432 MHz is limited to 40 W erp, and 431–432 isn't available within 100 km of Charing Cross, London. Simplified from the RSGB band plan: check it before transmitting.",
    // Source: RSGB band plan 2026 (430 MHz sheet). Uncertain: the published table's columns don't line up cleanly in
    // places (e.g. 9 MHz digital-voice split blocks and the 439.6–440 digital block overlap), so those blocks are merged
    // here and described loosely. FT8 on 432.174 MHz is the usual practice, not a separate RSGB row.
    segs: [
      [430000, 430800, "dv", 12000, "Digital voice and data: FM internet voice gateways 430,0125–430,100, UK digital voice 9 MHz split repeaters, digital links"],
      [430800, 431000, "rptout", 12000, "7.6 MHz split repeater outputs RU65–RU78 (430,8125–430,975); talkthrough 430,800"],
      [431000, 432000, "digi", 12000, "Digital communications; digital voice gateways 431,025–431,250. 40 W erp max, and not near London"],
      [432000, 432400, "all", 2700, "CW and SSB; FT8 432,174; centre of activity 432,200"],
      [432400, 432500, "beacon", 500, "Propagation beacons only"],
      [432500, 433000, "all", 12000, "All modes; SSTV 432,500; digital communications 432,625–432,675"],
      [433000, 433394, "rptout", 12000, "FM repeater outputs RB0–RB15 (433,000–433,375), 1.6 MHz shift; 5 MHz split outputs RBW (UK only)"],
      [433394, 433600, "fm", 12000, "FM and digital voice simplex U272–U286; FM calling 433,500; rally talk-in 433,550"],
      [433600, 433800, "digi", 12000, "Digital communications 433,625–433,675; emergency and community use 433,700–433,775"],
      [433800, 434000, "digi", 0, "APRS 433,800 (where 144.800 can't be used); digital communications and experiments (including LoRa)"],
      [434000, 434594, "dv", 12000, "Low-power hotspot 434,000; digital voice gateways; mobile talkthrough 434,375; DV gateways 434,475–434,525"],
      [434594, 434981, "rptin", 12000, "FM and digital voice repeater inputs RB0–RB15 (434,600–434,975), 1.6 MHz above the output"],
      [434981, 435000, "all", 0, "Not detailed in the band plan summary"],
      [435000, 436000, "sat", 0, "Satellites only"],
      [436000, 438000, "sat", 0, "Satellites and experimental data/DATV; centre 437,000"],
      [438000, 438400, "rptin", 12000, "5 MHz split repeater inputs RBW00–RBW30 (438,000–438,375); 5 MHz below the output"],
      [438400, 438600, "rptin", 12000, "7.6 MHz split repeater inputs RU65–RU78 (438,4125–438,575); talkthrough 438,400"],
      [438600, 439100, "dv", 12000, "UK digital voice calling 438,6125; low-power hotspot 438,800 (alternatives 438,775–438,7875)"],
      [439100, 439775, "rptout", 12000, "Digital voice 9 MHz split repeater outputs (439,125–439,1375 and 439,400–439,775); ad hoc repeater output 439,1125"],
      [439775, 440000, "digi", 0, "Digital communications; LoRa gateways 439,900–439,9875; pagers 439,9875"],
    ],
    centres: [[432174, "FT8"], [432200, "SSB centre"], [433500, "FM calling"], [433800, "APRS"], [437000, "Satellites"], [438612.5, "DV calling"]],
  },
};

const PLAN_BANDS = ["160", "80", "60", "40", "30", "20", "17", "15", "12", "10", "6", "2", "70"];

/** A band's name for people: "20 m", "70 cm". */
const bandName = (b) => (String(b) === "70" ? "70 cm" : `${b} m`);

/** The band plan segment containing a frequency (kHz), or null. */
function planSegment(kHz) {
  for (const b of PLAN_BANDS) {
    const p = BANDPLAN[b];
    if (kHz < p.lo || kHz > p.hi) continue;
    const s = p.segs.find(([a, z]) => kHz >= a && kHz < z) || p.segs[p.segs.length - 1];
    return { band: b, from: s[0], to: s[1], type: s[2], bw: s[3], use: s[4] };
  }
  return null;
}

/** The usual listening mode at a frequency: CW in CW segments, USB for data, LSB for phone below 10 MHz. */
function modeForFreq(kHz) {
  const seg = planSegment(kHz);
  if (seg && seg.type === "cw") return "cw";
  if (seg && ["fm", "rptin", "rptout", "dv"].includes(seg.type)) return "fm";
  if (kHz === 144800 || kHz === 433800) return "fm"; // APRS
  if (seg && ["narrow", "unatt", "digi", "beacon"].includes(seg.type)) return "usb";
  if (seg && seg.band === "60") return "usb";
  return kHz < 10000 ? "lsb" : "usb";
}

function bwText(bw) {
  if (bw > 0) return bw >= 1000 ? `${(bw / 1000).toLocaleString()} kHz` : `${bw} Hz`;
  return bw < 0 ? "No limit" : "–";
}

/* ---------- Chart ---------- */

const plan = { band: "20", hover: null };

function renderPlan() {
  $("planBands").innerHTML = PLAN_BANDS.map((b) => `<button type="button" data-b="${b}" aria-pressed="${b === plan.band}">${bandName(b)}</button>`).join("");
  $("planBands").querySelectorAll("button").forEach((btn) => {
    btn.onclick = () => { plan.band = btn.dataset.b; renderPlan(); };
  });
  const p = BANDPLAN[plan.band];
  const W = 1000, H = 92, BAR_Y = 26, BAR_H = 30;
  const x = (k) => ((k - p.lo) / (p.hi - p.lo)) * W;
  let svg = "";
  // Live spots on this band, as ticks above the bar.
  const spots = (app.pairs || []).filter((s) => s.band === plan.band);
  for (const s of spots.slice(0, 600)) {
    const k = s.fq * 1000;
    if (k < p.lo || k > p.hi) continue;
    svg += `<line x1="${x(k).toFixed(1)}" y1="6" x2="${x(k).toFixed(1)}" y2="${BAR_Y - 2}" stroke="var(--cool)" stroke-width="1.2" opacity=".6"/>`;
  }
  p.segs.forEach(([a, z, type], i) => {
    svg += `<rect class="pseg t-${type}" data-i="${i}" x="${x(a).toFixed(1)}" y="${BAR_Y}" width="${Math.max(1.5, x(z) - x(a)).toFixed(1)}" height="${BAR_H}" tabindex="-1"><title>${esc(`${a}–${z} kHz: ${p.segs[i][4]}`)}</title></rect>`;
  });
  // Centres of activity
  p.centres.forEach(([k, label], i) => {
    const cx = x(k);
    const row = i % 2;
    svg += `<line x1="${cx.toFixed(1)}" y1="${BAR_Y}" x2="${cx.toFixed(1)}" y2="${BAR_Y + BAR_H + 6 + row * 13}" stroke="var(--text)" stroke-width="1" opacity=".55"/>` +
      `<text x="${Math.min(W - 4, Math.max(4, cx)).toFixed(1)}" y="${BAR_Y + BAR_H + 16 + row * 13}" font-size="11" text-anchor="${cx < 60 ? "start" : cx > W - 60 ? "end" : "middle"}" fill="var(--muted)">${esc(label)}</text>`;
  });
  svg += `<text x="0" y="${BAR_Y - 8}" font-size="11" fill="var(--muted)">${p.lo.toLocaleString()} kHz</text>` +
    `<text x="${W}" y="${BAR_Y - 8}" font-size="11" fill="var(--muted)" text-anchor="end">${p.hi.toLocaleString()} kHz</text>`;
  if (listen.kHz >= p.lo && listen.kHz <= p.hi) {
    svg += `<path d="M${x(listen.kHz).toFixed(1)} ${BAR_Y - 1} l-5 -7 h10 z" fill="var(--warm)"><title>Tuned to ${listen.kHz} kHz</title></path>`;
  }
  $("planChart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${bandName(plan.band)} UK band plan, ${p.lo} to ${p.hi} kHz">${svg}</svg>`;
  $("planNote").textContent = p.note;
  $("planRows").innerHTML = p.segs.map(([a, z, type, bw, use], i) =>
    `<tr data-i="${i}" tabindex="0" title="Listen here"><td><span class="sw t-${type}"></span>${a.toLocaleString()}–${z.toLocaleString()}</td>` +
    `<td class="num">${bwText(bw)}</td><td>${esc(PLAN_TYPES[type].short)}</td><td class="wrapcell">${esc(use)}</td>` +
    `<td class="num">${type === "none" ? "" : spots.filter((s) => s.fq * 1000 >= a && s.fq * 1000 < z).length || ""}</td></tr>`).join("");
  $("planLegend").innerHTML = [...new Set(p.segs.map((s) => s[2]))].map((t) => `<span><i class="sw t-${t}"></i>${esc(PLAN_TYPES[t].label)}</span>`).join("");

  const tuneSeg = (i) => {
    const [a, z, type] = p.segs[i];
    if (type === "none") return;
    const centre = p.centres.find(([k]) => k >= a && k < z);
    const k = centre ? centre[0] : Math.round(((a + z) / 2) * 10) / 10;
    tuneTo(k, modeForFreq(k), { scroll: true });
  };
  const highlight = (i) => {
    document.querySelectorAll("#planChart .pseg, #planRows tr").forEach((el) => el.classList.toggle("hl", el.dataset.i === String(i)));
  };
  document.querySelectorAll("#planChart .pseg, #planRows tr").forEach((el) => {
    el.addEventListener("mouseenter", () => highlight(el.dataset.i));
    el.addEventListener("mouseleave", () => highlight(-1));
    el.addEventListener("click", () => tuneSeg(Number(el.dataset.i)));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tuneSeg(Number(el.dataset.i)); } });
  });
}

if (typeof module === "object" && module.exports) module.exports = { BANDPLAN, PLAN_BANDS, PLAN_TYPES, planSegment, modeForFreq, bandName };
