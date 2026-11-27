/* Own windows: move a part of HamShack (the scope, the map, Listen, the ATS Mini…) into a window of its own, to
   put on another screen. The part itself moves, so it keeps working as before: the same radio connection, sound and
   decoders. Closing its window, or "Back", puts it back in its place. */

const POP_PARTS = [
  ["secBands", "Bands"], ["secMap", "Map"], ["secScope", "Band scope"], ["secListen", "Listen"], ["secPanel", "Radio panel"], ["secAts", "ATS Mini"], ["secSked", "Shortwave stations"],
  ["secDecode", "Decoder"], ["secXota", "POTA"], ["secSats", "Satellites"],["secWanted", "Wanted"], ["secLog", "Logbook"], ["secActivity", "Band activity"],
];
const popWins = new Map(); // part id -> { win, holder, doc, extras: [{ id, holder }] }
// Parts that go along in the same window: Listen goes with the Radio panel, so its sound plays where you click.
const POP_WITH = { secPanel: ["secListen"] };

/** The window a part is in now: the main one, or its own. Sound and new windows start from there, because
 * browsers only let a click start sound (or open a window) in the window that was clicked. */
function hostWindowOf(id) {
  const el = typeof $ === "function" ? $(id) : document.getElementById(id);
  return (el && el.ownerDocument && el.ownerDocument.defaultView) || window;
}

function popPlaces() {
  try { return JSON.parse(load("bw-windows") || "{}") || {}; } catch { return {}; }
}

/** The new window looks like the main one: same style sheets, theme, colours and text size. */
function popCopyLook(doc) {
  const root = document.documentElement;
  for (const a of [...doc.documentElement.attributes]) if (a.name !== "lang") doc.documentElement.removeAttribute(a.name);
  for (const a of [...root.attributes]) doc.documentElement.setAttribute(a.name, a.value);
}

/** The main window's styles, copied in (links written into a new window don't reliably load). */
function popStyles() {
  return [...document.styleSheets].map((sh) => {
    try { return `<style>${[...sh.cssRules].map((r) => r.cssText).join("\n").replace(/<\/style/gi, "<\\/style")}</style>`; }
    catch { return sh.href ? `<link rel="stylesheet" href="${esc(sh.href)}">` : ""; } // fonts from another site
  }).join("\n");
}

function popOut(id, label) {
  if (popWins.has(id)) { popWins.get(id).win.focus(); return; }
  const el = document.getElementById(id);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const place = popPlaces()[id] || {};
  const w = place.w || Math.max(420, Math.round(r.width) + 40), h = place.h || Math.max(320, Math.round(r.height) + 60);
  const at = place.x != null ? `,left=${place.x},top=${place.y}` : "";
  const win = window.open("", `bw-${id}`, `popup,width=${w},height=${h}${at}`);
  if (!win) { showToast("Window blocked", "Your browser blocked the new window. Allow pop-ups for HamShack and try again."); return; }
  const doc = win.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(label)} · HamShack</title>
<link rel="icon" href="${location.origin}/favicon.svg" type="image/svg+xml">
${popStyles()}
<style>body{margin:0;padding:10px 12px;min-height:100vh;box-sizing:border-box}
 .popbar{display:flex;justify-content:flex-end;gap:8px;margin-bottom:6px}
 .popbar button{font:inherit}
 body > section, body > div{margin:0;max-width:none;width:100%}</style></head>
<body class="popwin"><div class="popbar"><button type="button" class="lbtn" id="popBack">Back to the main window</button></div></body></html>`);
  doc.close();
  popCopyLook(doc);
  // Leave a note where it was, with a way to bring it back
  const holder = document.createElement("div");
  holder.className = "pophold small muted";
  holder.innerHTML = `<b>${esc(label)}</b> is in its own window. <button type="button" class="lbtn">Show it</button> <button type="button" class="lbtn">Bring it back</button>`;
  const [showBtn, backBtn] = holder.querySelectorAll("button");
  showBtn.onclick = () => win.focus();
  backBtn.onclick = () => popBack(id);
  el.before(holder);
  doc.body.appendChild(doc.adoptNode(el));
  // Parts that come along (Listen with the radio), unless they're already in a window of their own
  const extras = [];
  for (const xid of POP_WITH[id] || []) {
    const x = document.getElementById(xid);
    if (!x || popWins.has(xid)) continue;
    const xl = (POP_PARTS.find(([pid]) => pid === xid) || [, xid])[1];
    const xh = document.createElement("div");
    xh.className = "pophold small muted";
    xh.innerHTML = `<b>${esc(xl)}</b> is in the ${esc(label)} window. <button type="button" class="lbtn">Show it</button>`;
    xh.querySelector("button").onclick = () => win.focus();
    x.before(xh);
    x.querySelector(".popbtn") && (x.querySelector(".popbtn").hidden = true); // it goes back with the radio
    doc.body.appendChild(doc.adoptNode(x));
    extras.push({ id: xid, holder: xh });
  }
  popDocs.add(doc);
  popWins.set(id, { win, holder, doc, extras });
  doc.getElementById("popBack").onclick = () => popBack(id);
  // Remember where it was put (another screen, say) for next time
  const remember = () => {
    try {
      const all = popPlaces();
      all[id] = { x: win.screenX, y: win.screenY, w: win.outerWidth, h: win.outerHeight };
      store("bw-windows", JSON.stringify(all));
    } catch { /* closed */ }
  };
  win.addEventListener("resize", () => { clearTimeout(win.__t); win.__t = setTimeout(remember, 400); });
  win.addEventListener("pagehide", () => { remember(); popBack(id, true); });
  window.dispatchEvent(new Event("resize")); // canvases redraw at their new size
  win.dispatchEvent(new Event("resize"));
  if (id === "secPanel" && typeof renderPanel === "function") renderPanel(); // its Pop out key
}

/** Put a part back in the main window (closing its window unless it's already closing). */
function popBack(id, closing = false) {
  const p = popWins.get(id);
  if (!p) return;
  popWins.delete(id);
  // Sound that was started in that window stops with it: say so, so Listen can be pressed again here.
  if (typeof sdr !== "undefined" && sdr.running && sdr.ctxWin === p.win && typeof sdrStop === "function") {
    sdrStop("Moved back to the main window: press Listen to hear it here.");
  }
  if (typeof listen !== "undefined" && listen.win && listen.winHost === p.win) listen.win = null;
  const el = p.doc.getElementById(id);
  if (el) p.holder.replaceWith(document.adoptNode(el));
  else p.holder.remove();
  for (const x of p.extras || []) {
    const xe = p.doc.getElementById(x.id);
    if (xe) {
      x.holder.replaceWith(document.adoptNode(xe));
      const b = xe.querySelector(".popbtn");
      if (b) b.hidden = false;
    } else x.holder.remove();
  }
  popDocs.delete(p.doc);
  if (!closing) { try { p.win.close(); } catch { /* closed */ } }
  window.dispatchEvent(new Event("resize"));
  if (id === "secPanel" && typeof renderPanel === "function") renderPanel(); // its Pop out key
}

function setupWindows() {
  if (typeof window.open !== "function" || matchMedia("(pointer: coarse)").matches) return; // phones and tablets: no
  for (const [id, label] of POP_PARTS) {
    const el = document.getElementById(id);
    const head = el && el.querySelector("h2");
    if (!head) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lbtn popbtn";
    b.textContent = "⧉";
    b.title = `Open ${label} in its own window (to put on another screen)`;
    b.setAttribute("aria-label", `Open ${label} in its own window`);
    b.addEventListener("click", () => (popWins.has(id) ? popBack(id) : popOut(id, label)));
    // Beside the heading, not inside it (some headings are rewritten as things change): at the end of a panel's
    // header row, or floating at the right of a plain heading.
    const row = head.closest(".phead");
    if (row) { b.classList.add("inrow"); row.append(b); } else head.before(b);
  }
  // Theme, colours and text size changes reach the windows too
  new MutationObserver(() => { for (const p of popWins.values()) popCopyLook(p.doc); })
    .observe(document.documentElement, { attributes: true });
  window.addEventListener("pagehide", () => { for (const p of popWins.values()) try { p.win.close(); } catch { /* closed */ } });
}
