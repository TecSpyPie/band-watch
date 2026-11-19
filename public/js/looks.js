/* The Space station look's sky: three layers of stars on a canvas behind the page, drifting at different depths as
   the mouse moves (parallax), and --px / --py (-1..1) for the panels and Earth's glow to follow. Drawn only while
   that look is on; still (no drifting) for people who ask their computer for reduced motion. */
"use strict";
(function () {
  const root = document.documentElement;
  const DEPTH = [6, 14, 26]; // how far each layer drifts (px) at the edge of the screen
  const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let cv = null, g = null, stars = null, raf = 0, px = 0, py = 0, tx = 0, ty = 0;

  function makeStars(w, h) {
    let seed = 1977; // the same sky every time
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const area = (w * h) / 1e6;
    return DEPTH.map((d, i) => Array.from({ length: Math.round([180, 90, 35][i] * area) }, () => ({
      x: rnd() * w, y: rnd() * h, r: [0.6, 1.0, 1.6][i] * (0.6 + rnd() * 0.7), a: 0.35 + rnd() * 0.65,
      c: rnd() < 0.12 ? "#ffe2b0" : rnd() < 0.2 ? "#b8d8ff" : "#ffffff",
    })));
  }

  function draw() {
    if (!g) return;
    const w = cv.width, h = cv.height, k = window.devicePixelRatio || 1;
    g.clearRect(0, 0, w, h);
    // a faint band of the Milky Way across the sky
    const mw = g.createLinearGradient(0, h * 0.15, w, h * 0.7);
    mw.addColorStop(0, "rgba(60,80,140,0)"); mw.addColorStop(0.5, "rgba(80,100,170,.10)"); mw.addColorStop(1, "rgba(60,80,140,0)");
    g.fillStyle = mw; g.fillRect(0, 0, w, h);
    stars.forEach((layer, i) => {
      const ox = -px * DEPTH[i] * k, oy = -py * DEPTH[i] * k;
      for (const s of layer) {
        const x = (((s.x + ox) % w) + w) % w, y = (((s.y + oy) % h) + h) % h;
        g.globalAlpha = s.a;
        g.fillStyle = s.c;
        g.beginPath(); g.arc(x, y, s.r * k, 0, Math.PI * 2); g.fill();
      }
    });
    g.globalAlpha = 1;
  }

  function resize() {
    if (!cv) return;
    const k = window.devicePixelRatio || 1;
    cv.width = Math.round(innerWidth * k); cv.height = Math.round(innerHeight * k);
    stars = makeStars(cv.width, cv.height);
    draw();
  }

  function frame() {
    px += (tx - px) * 0.12; py += (ty - py) * 0.12;
    root.style.setProperty("--px", px.toFixed(3));
    root.style.setProperty("--py", py.toFixed(3));
    draw();
    raf = Math.abs(tx - px) + Math.abs(ty - py) > 0.002 ? requestAnimationFrame(frame) : 0;
  }
  function onMove(e) {
    tx = (e.clientX / innerWidth - 0.5) * 2; ty = (e.clientY / innerHeight - 0.5) * 2;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (cv) return;
    cv = document.createElement("canvas");
    cv.id = "lookSky";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
    g = cv.getContext("2d");
    resize();
    addEventListener("resize", resize);
    if (!still) addEventListener("pointermove", onMove, { passive: true });
  }
  function stop() {
    if (!cv) return;
    cancelAnimationFrame(raf); raf = 0;
    removeEventListener("resize", resize);
    removeEventListener("pointermove", onMove);
    cv.remove(); cv = null; g = null;
    root.style.removeProperty("--px"); root.style.removeProperty("--py");
  }
  const check = () => (root.dataset.look === "space" ? start() : stop());
  new MutationObserver(check).observe(root, { attributes: true, attributeFilter: ["data-look"] });
  if (document.body) check(); else addEventListener("DOMContentLoaded", check);
})();
