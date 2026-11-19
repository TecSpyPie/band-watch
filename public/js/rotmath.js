/* Band Watch by M3vrv: antenna rotator maths and the controllers' command languages. Plain JavaScript, used by the
 * page (window.RotMath) and the tests (require).
 *   bearing()  great-circle beam heading from you to a place (short path, or long path: the other way round)
 *   PROTOCOLS  Yaesu GS-232A, GS-232B (azimuth and elevation), EasyComm II (K3NG and many home-built controllers),
 *              Hy-Gain DCU-1: the command to turn to a heading, to stop, to ask where it points, and how to read
 *              the answer. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.RotMath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const RAD = Math.PI / 180;

  /** Beam heading (degrees from true north, 0-360) from (lat1, lon1) to (lat2, lon2); long path adds 180. */
  function bearing(lat1, lon1, lat2, lon2, longPath = false) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    let b = (Math.atan2(y, x) / RAD + 360) % 360;
    if (longPath) b = (b + 180) % 360;
    return b;
  }

  const n3 = (v) => String(Math.round(v)).padStart(3, "0");
  const clampAz = (az) => ((Math.round(az) % 360) + 360) % 360;
  const clampEl = (el) => Math.max(0, Math.min(90, Math.round(el)));

  const PROTOCOLS = {
    gs232a: {
      name: "Yaesu GS-232A", baud: 9600, el: false,
      goto: (az) => `M${n3(clampAz(az))}\r`,
      stop: () => "S\r",
      ask: () => "C\r",
      // "+0123" (A), or "AZ=123" on some versions
      read: (s) => { const m = /(?:\+0?|AZ=)(\d{3})/.exec(s); return m ? { az: Number(m[1]) } : null; },
    },
    gs232b: {
      name: "Yaesu GS-232B (azimuth and elevation)", baud: 9600, el: true,
      goto: (az, el) => (el == null ? `M${n3(clampAz(az))}\r` : `W${n3(clampAz(az))} ${n3(clampEl(el))}\r`),
      stop: () => "S\r",
      ask: () => "C2\r",
      // "AZ=123  EL=045", or "+0123+0045"
      read: (s) => {
        let m = /AZ=\s*(\d{1,3}).*?EL=\s*(\d{1,3})/.exec(s);
        if (m) return { az: Number(m[1]), el: Number(m[2]) };
        m = /\+0?(\d{3})\+0?(\d{3})/.exec(s);
        if (m) return { az: Number(m[1]), el: Number(m[2]) };
        m = /(?:\+0?|AZ=)(\d{3})/.exec(s);
        return m ? { az: Number(m[1]) } : null;
      },
    },
    easycomm: {
      name: "EasyComm II (K3NG and others)", baud: 9600, el: true,
      goto: (az, el) => `AZ${clampAz(az).toFixed(1)}${el == null ? "" : ` EL${clampEl(el).toFixed(1)}`}\n`,
      stop: () => "SA SE\n",
      ask: () => "AZ EL\n",
      read: (s) => {
        const a = /AZ\s*(-?\d+(?:\.\d+)?)/.exec(s), e = /EL\s*(-?\d+(?:\.\d+)?)/.exec(s);
        return a ? { az: Number(a[1]), ...(e ? { el: Number(e[1]) } : {}) } : null;
      },
    },
    dcu1: {
      name: "Hy-Gain DCU-1", baud: 4800, el: false,
      goto: (az) => `AP1${n3(clampAz(az))};AM1;`,
      stop: () => ";",
      ask: () => "AI1;",
      read: (s) => { const m = /;?(\d{3});?\s*$/.exec(s.trim()) || /(\d{3})/.exec(s); return m ? { az: Number(m[1]) } : null; },
    },
  };

  /** The shortest way round from one heading to another, in degrees (-180..180). */
  function turn(from, to) {
    return ((to - from + 540) % 360) - 180;
  }

  const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (az) => POINTS[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];

  return { bearing, PROTOCOLS, turn, compass, clampAz, clampEl };
});
