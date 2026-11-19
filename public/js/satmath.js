/* Band Watch by M3vrv: satellite maths for the Satellites panel. Where a satellite is, where it is in your sky,
 * its next passes over your locator and the Doppler shift on its frequencies. The orbit itself is worked out by
 * satellite.js (SGP4, MIT licence, public/js/vendor/satellite.esm.js), handed in as `lib`.
 * Also the rule for how often CelesTrak may be asked for new orbits (once every 2 hours, their usage policy).
 * Plain JavaScript; works in the browser (window.SatMath) and in Node (require) for the tests. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SatMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEG = 180 / Math.PI;
  const C_KM_S = 299792.458;
  // CelesTrak updates GP data every 2 hours and answers a second download in the same 2 hours with 403.
  const MAX_AGE = 2 * 3600e3;
  // After any answer that isn't 200, stop asking for at least 2 hours (their rule: stop at once; 15 min minimum).
  const BACKOFF = 2 * 3600e3;

  /** Should this browser ask CelesTrak again? cache: { at, data } or null; fail: time of the last failed try. */
  function shouldFetch(cache, fail, now) {
    if (fail && now - fail < BACKOFF) return false;
    if (!cache || !Array.isArray(cache.data) || !cache.data.length) return true;
    return now - cache.at >= MAX_AGE;
  }

  /** satrec for an OMM record from CelesTrak (JSON format), or null if it can't be used. */
  function satrecFor(lib, omm) {
    try {
      const rec = lib.json2satrec(omm);
      return rec && !rec.error ? rec : null;
    } catch { return null; }
  }

  function observer(lat, lon, heightKm = 0.05) {
    return { latitude: lat / DEG, longitude: lon / DEG, height: heightKm };
  }

  /** Where the satellite is at `date`: sub-satellite point and, for an observer, azimuth/elevation/range. */
  function look(lib, rec, date, obs) {
    const pv = lib.propagate(rec, date);
    if (!pv || !pv.position || typeof pv.position !== "object") return null;
    const gmst = lib.gstime(date);
    const ecf = lib.eciToEcf(pv.position, gmst);
    const geo = lib.eciToGeodetic(pv.position, gmst);
    const out = { lat: geo.latitude * DEG, lon: ((geo.longitude * DEG + 540) % 360) - 180, height: geo.height };
    if (obs) {
      const la = lib.ecfToLookAngles(obs, ecf);
      out.az = (la.azimuth * DEG + 360) % 360;
      out.el = la.elevation * DEG;
      out.range = la.rangeSat;
    }
    return out;
  }

  /** Elevation in degrees at time t (ms), or null. */
  function elevation(lib, rec, t, obs) {
    const l = look(lib, rec, new Date(t), obs);
    return l ? l.el : null;
  }

  /** How fast the satellite is coming towards (negative) or going away from (positive) you, km/s. */
  function rangeRate(lib, rec, t, obs) {
    const a = look(lib, rec, new Date(t - 500), obs);
    const b = look(lib, rec, new Date(t + 500), obs);
    if (!a || !b) return null;
    return b.range - a.range;
  }

  /** The frequency you hear (downlink) for a satellite sending on `mhz`: higher while it comes towards you. */
  function dopplerDown(mhz, rateKmS) {
    return mhz * (1 - rateKmS / C_KM_S);
  }
  /** The frequency to send on (uplink) so the satellite hears `mhz`: lower while it comes towards you. */
  function dopplerUp(mhz, rateKmS) {
    return mhz / (1 - rateKmS / C_KM_S);
  }

  /** The time (ms) between lo and hi where elevation crosses minEl, to within a second. */
  function crossing(lib, rec, lo, hi, obs, minEl, rising) {
    for (let i = 0; i < 20 && hi - lo > 1000; i++) {
      const mid = (lo + hi) / 2;
      const up = elevation(lib, rec, mid, obs) > minEl;
      if (up === rising) hi = mid; else lo = mid;
    }
    return Math.round((lo + hi) / 2);
  }

  /** Passes over the observer between from and from + hours: [{ aos, los, tca, maxEl, aosAz, losAz }].
   * A pass already under way at `from` starts at `from` (aos === from, upAtStart true). */
  function passes(lib, rec, obs, from, hours = 24, minEl = 0) {
    const STEP = 30e3;
    const end = from + hours * 3600e3;
    const out = [];
    let prev = elevation(lib, rec, from, obs);
    if (prev == null) return out;
    let cur = prev > 0 ? { aos: from, upAtStart: true, maxEl: prev, tca: from } : null;
    for (let t = from + STEP; t <= end + 20 * 60e3; t += STEP) {
      const el = elevation(lib, rec, t, obs);
      if (el == null) break;
      if (!cur && prev <= 0 && el > 0) {
        if (t - STEP > end) break;
        cur = { aos: crossing(lib, rec, t - STEP, t, obs, 0, true), maxEl: el, tca: t };
      }
      if (cur) {
        if (el > cur.maxEl) { cur.maxEl = el; cur.tca = t; }
        if (el <= 0) {
          cur.los = crossing(lib, rec, t - STEP, t, obs, 0, false);
          out.push(cur);
          cur = null;
        }
      }
      prev = el;
    }
    for (const p of out) {
      // Find the top of the pass to the nearest second (golden-section search around the 30-second peak).
      let a = Math.max(p.aos, p.tca - STEP), b = Math.min(p.los, p.tca + STEP);
      for (let i = 0; i < 25 && b - a > 1000; i++) {
        const m1 = a + (b - a) * 0.382, m2 = a + (b - a) * 0.618;
        if (elevation(lib, rec, m1, obs) < elevation(lib, rec, m2, obs)) a = m1; else b = m2;
      }
      p.tca = Math.round((a + b) / 2);
      p.maxEl = Math.max(p.maxEl, elevation(lib, rec, p.tca, obs));
      p.aosAz = look(lib, rec, new Date(p.aos), obs).az;
      p.losAz = look(lib, rec, new Date(p.los), obs).az;
    }
    return out.filter((p) => p.maxEl >= minEl);
  }

  const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  /** 0..360 degrees -> "NE" etc. */
  function compass(az) {
    return POINTS[Math.round(((az % 360) + 360) % 360 / 22.5) % 16];
  }

  return { MAX_AGE, BACKOFF, shouldFetch, satrecFor, observer, look, elevation, rangeRate, dopplerDown, dopplerUp, passes, compass };
});
