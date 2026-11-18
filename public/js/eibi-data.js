/* Band Watch by M3vrv: reads the EiBi shortwave schedule (eibispace.de, by Eike Bierwirth).
 * EiBi's conditions of use: "any person is absolutely free to download, use, copy, or distribute these
 * files or to use them within third-party software." Band Watch's server fetches the season's CSV
 * (sked-B26.csv and so on) and README.TXT and passes them on unchanged; this file reads them.
 * Works in the browser and in Node (tests). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Eibi = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]; // EiBi's own day names; 1 = Monday
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Words in the Days column that mean "not on a fixed timetable": shown, but marked as irregular.
  const IRREGULAR = new Set(["irr", "alt", "tent", "test", "spur", "harm", "imod"]);

  /** "1300" -> minutes after midnight UTC (0..1440), or null. */
  function hhmm(s) {
    const m = /^(\d\d)(\d\d)$/.exec(String(s || ""));
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 24 || min > 59 || (h === 24 && min)) return null;
    return h * 60 + min;
  }

  /** "DDMM" ("2810" = 28 October), ignoring a "[0923]" last-heard note -> month * 100 + day, or null. */
  function ddmm(s) {
    const m = /^(\d\d)(\d\d)$/.exec(String(s || "").replace(/\[.*?\]/g, "").trim());
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]);
    return d >= 1 && d <= 31 && mo >= 1 && mo <= 12 ? mo * 100 + d : null;
  }

  /** The Days column -> a test for a date, or "irregular", or null for "every day".
   * EiBi writes: "" (daily), "Mo-Fr", "We-Mo" (wraps round), "Tu,Fr", "SaSu", "1245" (1 = Monday),
   * "1.Sa" (first Saturday of the month), "3Nov" (one date), and words like irr, alt, test, USB. */
  function parseDays(raw) {
    const s = String(raw || "").trim();
    if (!s || s === "USB" || s === "LSB") return null;
    if (IRREGULAR.has(s)) return "irregular";
    if (/^[1-7]+$/.test(s)) {
      const set = new Set([...s].map(Number));
      return (d) => set.has(isoDay(d));
    }
    let m = /^(\d)\.(Mo|Tu|We|Th|Fr|Sa|Su)$/.exec(s);
    if (m) {
      const n = Number(m[1]), wd = DAYS.indexOf(m[2]) + 1;
      return (d) => isoDay(d) === wd && Math.ceil(d.getUTCDate() / 7) === n;
    }
    m = /^(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/.exec(s);
    if (m) {
      const day = Number(m[1]), mon = MONTHS.indexOf(m[2]);
      return (d) => d.getUTCDate() === day && d.getUTCMonth() === mon;
    }
    const set = new Set();
    for (const part of s.split(",")) {
      const r = /^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/.exec(part);
      if (r) {
        let a = DAYS.indexOf(r[1]);
        const b = DAYS.indexOf(r[2]);
        for (let i = 0; i < 7; i++) { set.add(a + 1); if (a === b) break; a = (a + 1) % 7; }
        continue;
      }
      if (!/^((Mo|Tu|We|Th|Fr|Sa|Su))+$/.test(part)) return "irregular"; // something we can't read
      for (let i = 0; i < part.length; i += 2) set.add(DAYS.indexOf(part.slice(i, i + 2)) + 1);
    }
    return (d) => set.has(isoDay(d));
  }

  /** 1 = Monday ... 7 = Sunday, in UTC. */
  function isoDay(d) { return ((d.getUTCDay() + 6) % 7) + 1; }

  /** One CSV line -> a broadcast, or null for the header, inactive entries and broken lines. */
  function parseLine(line) {
    const f = String(line).replace(/\r$/, "").split(";");
    if (f.length < 10) return null;
    const kHz = Number(f[0]);
    if (!(kHz >= 10 && kHz <= 30000)) return null;
    const t = /^(\d{4})-(\d{4})$/.exec(f[1].trim());
    if (!t) return null;
    const start = hhmm(t[1]), end = hhmm(t[2]);
    if (start == null || end == null) return null;
    const p = Number(f[8]);
    if (p === 8 || p === 98) return null; // inactive entries
    return {
      kHz, start, end, time: `${t[1]}-${t[2]}`,
      days: f[2].trim(), itu: f[3].trim(), station: f[4].trim(),
      langs: f[5].trim() ? f[5].trim().split(",").map((x) => x.trim()).filter(Boolean) : [],
      target: f[6].trim(), site: f[7].trim(),
      from: p % 90 === 6 ? ddmm(f[9]) : null, to: p % 90 === 6 ? ddmm(f[10]) : null,
      utility: p >= 90,
    };
  }

  /** The whole CSV -> broadcasts. */
  function parseSked(csv) {
    const out = [];
    for (const line of String(csv || "").split("\n")) {
      const b = parseLine(line);
      if (b) out.push(b);
    }
    return out;
  }

  /** Language and country names from README.TXT: { lang: { E: "English" }, country: { G: "United Kingdom" } }. */
  function parseCodes(readme) {
    const lang = {}, country = {};
    let part = "";
    let seen = 0;
    for (const raw of String(readme || "").split("\n")) {
      const line = raw.replace(/\r$/, "");
      // The overview lists the headings first; the tables start at their second appearance.
      if (/^\s*I\)\s+Language codes\./.test(line)) { seen++; part = seen >= 2 ? "lang" : ""; continue; }
      if (/^\s*II\)\s+Country codes\./.test(line)) { part = seen >= 2 ? "country" : ""; continue; }
      if (/^\s*III\)\s+Target-area codes\./.test(line)) { part = ""; continue; }
      if (part === "lang") {
        const m = /^\s{2,}(-?[A-Z][A-Z0-9]{0,3})\s{2,}(\S.*?)\s*(\[[a-z]{3}\])?\s*$/.exec(line);
        if (m) {
          const name = m[2].split(/[:(]/)[0].trim();
          if (name && !lang[m[1]]) lang[m[1]] = name;
        }
      } else if (part === "country") {
        const m = /^\s{2,}([A-Z][A-Z0-9]{0,3})\s{2,}(\S.*?)\s*$/.exec(line);
        if (m && !country[m[1]]) country[m[1]] = m[2].replace(/\s*\*+$/, "").trim();
      }
    }
    return { lang, country };
  }

  /** Is a broadcast on the air at this moment? true, false, or "irregular" (on the timetable, but not every week). */
  function onAir(b, date) {
    const t = date.getUTCHours() * 60 + date.getUTCMinutes();
    let day = date;
    let on;
    if (b.end > b.start) on = t >= b.start && t < b.end;
    else if (b.end === b.start) on = true; // 0000-0000 or 2400-2400: all day
    else {
      on = t >= b.start || t < b.end; // wraps past midnight
      if (on && t < b.end) day = new Date(date.getTime() - 86400000); // it started yesterday
    }
    if (!on) return false;
    if (!inDates(b, day)) return false;
    const days = daysOf(b);
    if (days === null) return true;
    if (days === "irregular") return "irregular";
    return days(day);
  }

  /** Minutes until a broadcast next starts within `within` minutes, or null. */
  function startsIn(b, date, within) {
    const t = date.getUTCHours() * 60 + date.getUTCMinutes();
    for (let add = 1; add <= within; add++) {
      if ((t + add) % 1440 !== b.start % 1440) continue;
      const day = new Date(date.getTime() + add * 60000);
      if (!inDates(b, day)) return null;
      const days = daysOf(b);
      if (days === null || days === "irregular" || days(day)) return add;
      return null;
    }
    return null;
  }

  /** The Days test for a broadcast, worked out once. */
  function daysOf(b) {
    if (!Object.prototype.hasOwnProperty.call(b, "_days")) Object.defineProperty(b, "_days", { value: parseDays(b.days) });
    return b._days;
  }

  /** For entries that only run part of the season (persistence code 6). */
  function inDates(b, day) {
    if (b.from == null && b.to == null) return true;
    const k = (day.getUTCMonth() + 1) * 100 + day.getUTCDate();
    const from = b.from == null ? 101 : b.from, to = b.to == null ? 1231 : b.to;
    return from <= to ? k >= from && k <= to : k >= from || k <= to; // the winter season runs over New Year
  }

  /** Broadcast bands in kHz, to filter the list. */
  const BANDS = [
    { id: "lw", name: "Long wave", lo: 148, hi: 284 },
    { id: "mw", name: "Medium wave", lo: 520, hi: 1710 },
    { id: "120", name: "120 m", lo: 2300, hi: 2495 },
    { id: "90", name: "90 m", lo: 3200, hi: 3400 },
    { id: "75", name: "75 m", lo: 3900, hi: 4000 },
    { id: "60", name: "60 m", lo: 4750, hi: 5110 },
    { id: "49", name: "49 m", lo: 5800, hi: 6300 },
    { id: "41", name: "41 m", lo: 7200, hi: 7600 },
    { id: "31", name: "31 m", lo: 9300, hi: 9990 },
    { id: "25", name: "25 m", lo: 11500, hi: 12160 },
    { id: "22", name: "22 m", lo: 13570, hi: 13870 },
    { id: "19", name: "19 m", lo: 15030, hi: 15830 },
    { id: "16", name: "16 m", lo: 17480, hi: 17900 },
    { id: "15", name: "15 m", lo: 18900, hi: 19020 },
    { id: "13", name: "13 m", lo: 21450, hi: 21850 },
    { id: "11", name: "11 m", lo: 25600, hi: 26100 },
  ];
  function bandOf(kHz) {
    const b = BANDS.find((x) => kHz >= x.lo && kHz <= x.hi);
    return b ? b.id : "";
  }

  /** The EiBi season for a date: "A" (summer, from the last Sunday of March) or "B" (winter, from the
   * last Sunday of October) plus the year, e.g. B26 for winter 2026/27. */
  function season(date) {
    const y = date.getUTCFullYear();
    const lastSunday = (month) => { const d = new Date(Date.UTC(y, month + 1, 0)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.getTime(); };
    const t = date.getTime();
    const yy = (n) => String(((n % 100) + 100) % 100).padStart(2, "0");
    if (t >= lastSunday(2) && t < lastSunday(9)) return `A${yy(y)}`;
    return t >= lastSunday(9) ? `B${yy(y)}` : `B${yy(y - 1)}`;
  }
  /** The season before: B26 -> A26, A27 -> B26. */
  function previousSeason(s) {
    const n = Number(s.slice(1));
    return s[0] === "B" ? `A${s.slice(1)}` : `B${String((n + 99) % 100).padStart(2, "0")}`;
  }

  return { parseSked, parseLine, parseCodes, parseDays, onAir, startsIn, bandOf, BANDS, season, previousSeason, isoDay };
});
