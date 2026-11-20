/* Band Watch by M3vrv: the section menu and fold buttons. Plain JavaScript, used by the page (window.Nav) and the
 * tests (require).
 *   menuLabel()  the short button text for a panel's heading ("Decoders: FT8, FT4, WSPR, CW" -> "Decoders")
 *   buildItems() the menu's buttons from the panels that are showing, in page order
 *   pickActive() which panel the menu highlights, from the ones crossing the reading line
 *   parseFolded(), foldedList()  the folded panels as saved in this browser
 * The page part builds the menu from the page itself, so a panel that is switched off (or an add-on that isn't
 * on) is not listed, and one that is switched on later appears. Folding only hides a panel's body: nothing in it
 * stops. Nothing here touches the radio, the decoders or the server. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Nav = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function menuLabel(text) {
    const t = String(text == null ? "" : text).replace(/\s+/g, " ").trim();
    const short = t.split(":")[0].trim();
    return short || t;
  }

  /** panels: [{ id, title, visible, folded }] in page order -> [{ id, label, title, folded }] for those showing. */
  function buildItems(panels) {
    const out = [];
    for (const p of panels || []) {
      if (!p || !p.id || !p.visible) continue;
      const title = String(p.title == null ? "" : p.title).replace(/\s+/g, " ").trim();
      if (!title) continue;
      out.push({ id: String(p.id), label: menuLabel(title), title, folded: Boolean(p.folded) });
    }
    return out;
  }

  /** ids: the panels in page order; hit: the ids crossing the reading line; prev: the one highlighted now.
   * At the very bottom of the page the last panel wins (a short last panel never reaches the line). */
  function pickActive(ids, hit, prev, atBottom) {
    if (!ids || !ids.length) return "";
    if (atBottom) return ids[ids.length - 1];
    let found = "";
    for (const id of ids) if (hit && hit.has(id)) found = id;
    if (found) return found;
    return ids.includes(prev) ? prev : ids[0];
  }

  function parseFolded(raw) {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === "string"))] : [];
    } catch { return []; }
  }
  function foldedList(set) { return [...set].sort(); }

  const api = { menuLabel, buildItems, pickActive, parseFolded, foldedList };
  if (typeof document === "undefined" || typeof window === "undefined") return api;

  /* ---------------------------- the page ---------------------------- */

  const FOLD_KEY = "bw-folded";
  const folded = new Set();
  let nav = null;
  let list = null;
  let active = "";
  let io = null;
  let lastSig = "";
  let renderQueued = false;
  const hit = new Set();

  const sectionsEl = () => [...document.querySelectorAll(".wrap > section.panel[id]")];
  const headingOf = (el) => el.querySelector(":scope > .phead h2, :scope > h2");
  const isShowing = (el) => el.isConnected && el.ownerDocument === document && !el.hidden && !el.classList.contains("floating") &&
    getComputedStyle(el).display !== "none";
  const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const menuOn = () => document.documentElement.dataset.secnav !== "off";

  function saveFolded() { try { localStorage.setItem(FOLD_KEY, JSON.stringify(foldedList(folded))); } catch { /* storage unavailable */ } }
  function readFolded() { try { return localStorage.getItem(FOLD_KEY); } catch { return null; } }

  function setFolded(el, on) {
    el.classList.toggle("navfolded", on);
    if (on) folded.add(el.id); else folded.delete(el.id);
    const b = el.querySelector(":scope > .phead > .navfold");
    if (b) {
      b.setAttribute("aria-expanded", String(!on));
      b.title = on ? "Unfold this section" : "Fold this section";
    }
  }

  function addFoldButtons() {
    for (const el of sectionsEl()) {
      const head = el.querySelector(":scope > .phead");
      const h2 = headingOf(el);
      if (!head || !h2 || head.querySelector(":scope > .navfold")) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "navfold";
      b.setAttribute("aria-label", `${menuLabel(h2.textContent)}: show or hide this section`);
      b.setAttribute("aria-expanded", "true");
      b.title = "Fold this section";
      const chev = document.createElement("span");
      chev.className = "navchev";
      chev.setAttribute("aria-hidden", "true");
      b.append(chev);
      b.addEventListener("click", () => {
        setFolded(el, !el.classList.contains("navfolded"));
        saveFolded();
        renderMenu();
        window.dispatchEvent(new Event("resize")); // canvases that were hidden measure themselves again
      });
      head.prepend(b);
      if (folded.has(el.id)) setFolded(el, true);
    }
  }

  function navOffset() {
    const h = nav && !nav.hidden ? nav.getBoundingClientRect().height : 0;
    document.documentElement.style.setProperty("--navh", `${Math.ceil(h)}px`);
    return h;
  }

  function goTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains("navfolded")) {
      setFolded(el, false);
      saveFolded();
      renderMenu();
      window.dispatchEvent(new Event("resize"));
    }
    navOffset();
    el.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); // layout is already up to date
    const h2 = headingOf(el);
    if (h2) { h2.tabIndex = -1; try { h2.focus({ preventScroll: true }); } catch { /* old browser */ } }
    active = id;
    markActive();
  }

  function markActive() {
    if (!list) return;
    for (const b of list.querySelectorAll("button[data-target]")) {
      if (b.dataset.target === active) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    }
    const cur = list.querySelector('button[aria-current="true"]');
    if (cur && list.scrollWidth > list.clientWidth) { // keep the highlighted button in view on a narrow screen
      const l = cur.offsetLeft, r = l + cur.offsetWidth;
      if (l < list.scrollLeft || r > list.scrollLeft + list.clientWidth) list.scrollTo({ left: Math.max(0, l - 24), behavior: reduceMotion() ? "auto" : "smooth" });
    }
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; addFoldButtons(); renderMenu(); }, 0);
  }

  function renderMenu() {
    if (!nav) return;
    const on = menuOn();
    nav.hidden = !on;
    const panels = sectionsEl().map((el) => {
      const h2 = headingOf(el);
      return { id: el.id, title: h2 ? h2.textContent : "", visible: isShowing(el), folded: el.classList.contains("navfolded") };
    });
    const items = on ? buildItems(panels) : [];
    const sig = JSON.stringify(items);
    if (sig !== lastSig) {
      lastSig = sig;
      list.textContent = "";
      for (const it of items) {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.target = it.id;
        if (it.folded) b.dataset.folded = "true";
        b.title = it.folded ? `${it.title} (folded: click to open it)` : it.title;
        const t = document.createElement("span");
        t.textContent = it.label;
        b.append(t);
        if (it.folded) {
          const m = document.createElement("span");
          m.className = "navmark";
          m.setAttribute("aria-hidden", "true");
          m.textContent = "▸";
          const s = document.createElement("span");
          s.className = "sr-only";
          s.textContent = " (folded)";
          b.append(m, s);
        }
        li.append(b);
        list.append(li);
      }
      observePanels();
    }
    navOffset();
    if (!items.some((i) => i.id === active)) active = "";
    markActive();
  }

  /* The panel under the reading line (a thin strip just below the menu) is the one highlighted. */
  function observePanels() {
    if (io) io.disconnect();
    hit.clear();
    if (!("IntersectionObserver" in window) || !menuOn()) return;
    const line = Math.round(navOffset() + 24);
    const vh = window.innerHeight;
    if (vh <= line + 2) return;
    io = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) hit.add(e.target.id); else hit.delete(e.target.id); }
      const ids = [...list.querySelectorAll("button[data-target]")].map((b) => b.dataset.target);
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      const next = pickActive(ids, hit, active, atBottom);
      if (next !== active) { active = next; markActive(); }
    }, { rootMargin: `-${line}px 0px -${vh - line - 1}px 0px`, threshold: 0 });
    for (const b of list.querySelectorAll("button[data-target]")) {
      const el = document.getElementById(b.dataset.target);
      if (el) io.observe(el);
    }
  }

  function init() {
    const wrap = document.querySelector(".wrap");
    const header = wrap && wrap.querySelector(":scope > header");
    if (!wrap || !header) return;
    for (const id of parseFolded(readFolded())) folded.add(id);
    nav = document.createElement("nav");
    nav.className = "secnav";
    nav.setAttribute("aria-label", "Sections");
    list = document.createElement("ul");
    list.className = "secnav-list";
    nav.append(list);
    header.after(nav);
    list.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-target]");
      if (b) goTo(b.dataset.target);
    });
    addFoldButtons();
    renderMenu();
    // Panels showing or hiding (Settings > sections, add-ons, the ATS Mini connecting), panels moving to their own
    // window and back, and the menu itself being switched on or off.
    const mo = new MutationObserver(queueRender);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-hide", "data-addons", "data-secnav"] });
    mo.observe(wrap, { childList: true });
    for (const el of sectionsEl()) mo.observe(el, { attributes: true, attributeFilter: ["hidden", "class", "style"] });
    let t = 0;
    window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { lastSig = ""; queueRender(); }, 150); });
    if ("ResizeObserver" in window) new ResizeObserver(() => navOffset()).observe(nav);
  }

  init();
  return api;
});
