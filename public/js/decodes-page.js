/* HamShack by M0GLP & M3VRV: the decodes window. HamShack's main window sends each cycle's decodes here. */
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  let rows = [];
  let myCall = "";
  try { myCall = String(JSON.parse(localStorage.getItem("bw-call")) || "").toUpperCase(); } catch { try { myCall = String(localStorage.getItem("bw-call") || "").toUpperCase(); } catch { /* none */ } }
  try { const d = JSON.parse(localStorage.getItem("bw-display")); if (d && d.theme && d.theme !== "system") document.documentElement.dataset.theme = d.theme; } catch { /* default */ }

  const word = (w) => {
    const bare = w.replace(/^<|>$/g, "");
    if (/^[A-Z0-9/]{3,}$/.test(bare) && /\d/.test(bare) && /[A-Z]/.test(bare) && !/^[A-R]{2}\d{2}$/.test(bare) && !/^R?[+-]\d\d$/.test(bare) && bare !== "RR73") {
      const base = bare.split("/").filter((x) => /\d/.test(x) && x.length > 2).sort((a, b) => b.length - a.length)[0] || bare;
      const a = `<a class="call" href="https://www.qrz.com/db/${encodeURIComponent(base)}" target="_blank" rel="noopener noreferrer">${esc(bare)}</a>`;
      return w.startsWith("<") ? `&lt;${a}&gt;` : a;
    }
    return esc(w);
  };

  // CW and RTTY show a text box instead of the table.
  function setMode(mode) {
    const text = DcWording.isText(mode);
    $("dwCw").hidden = !text;
    $("dwTab").hidden = text;
    if (!text) $("dwCw").textContent = "";
  }

  const COLS = ["time", "mode", "snr", "dt", "freq", "rf", "msg"];

  function render() {
    const s = DcCols.get();
    const h = DcCols.head(s, COLS);
    $("dwCols").innerHTML = h.colgroup;
    $("dwHead").innerHTML = h.row;
    const find = $("dwFind").value.trim().toUpperCase();
    const list = rows.filter((r) => (!$("dwCq").checked || /^CQ /.test(r.text)) && (!find || r.text.includes(find)));
    let last = null;
    $("dwRows").innerHTML = list.slice(0, 1000).map((r) => {
      const mine = myCall && r.text.split(" ").some((w) => w.replace(/^<|>$/g, "").split("/").includes(myCall));
      const cls = (mine ? "dcmine" : /^CQ /.test(r.text) ? "dccq" : "") + (last !== null && r.cycle !== last ? " dcnew" : "");
      last = r.cycle;
      return `<tr class="${cls}">${DcCols.cells(s, h.shown, r, r.text.split(" ").map(word).join(" "))}</tr>`;
    }).join("") || `<tr><td colspan="${h.shown.length}" class="muted small">No decodes yet. Start decoding in HamShack.</td></tr>`;
  }
  const tick = () => { $("dwClock").textContent = DcCols.clock(DcCols.get()); };
  DcCols.menu($("dwColsBox"), COLS, () => { render(); tick(); });
  DcCols.resizable($("dwTab"), (id, w) => { DcCols.saveWidth(id, w); render(); });
  // Changed in HamShack's main window: follow it here.
  window.addEventListener("storage", (e) => { if (e.key === DcCols.KEY) { DcCols.menu($("dwColsBox"), COLS, () => { render(); tick(); }); render(); tick(); } });
  tick();
  setInterval(tick, 1000);

  if (!("BroadcastChannel" in window)) {
    $("dwStatus").textContent = "This browser can't link windows; use the decoder in HamShack itself.";
    return;
  }
  const ch = new BroadcastChannel("bw-decodes");
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "cw") {
      setMode("CW");
      $("dwCw").textContent = m.text || "";
      $("dwCw").scrollTop = $("dwCw").scrollHeight;
      $("dwStatus").textContent = `CW: ${m.wpm} WPM on a ${m.tone} Hz tone`;
      return;
    }
    if (m.type === "rtty") {
      setMode("RTTY");
      $("dwCw").textContent = m.text || "";
      $("dwCw").scrollTop = $("dwCw").scrollHeight;
      $("dwStatus").textContent = m.locked ? "RTTY: a signal is coming in." : "RTTY: waiting for a signal…";
      return;
    }
    if (m.type === "all") {
      rows = Array.isArray(m.rows) ? m.rows.slice() : [];
      if (typeof m.mode === "string") setMode(m.mode);
      if (DcWording.isText(m.mode)) { $("dwCw").textContent = m.text || ""; $("dwCw").scrollTop = $("dwCw").scrollHeight; }
    }
    else if (m.type === "cycle") rows = [...(m.rows || []), ...rows].slice(0, 3000);
    if (m.status) $("dwStatus").textContent = m.status;
    render();
  };
  ch.postMessage({ type: "hello" });
  $("dwCq").addEventListener("change", render);
  $("dwFind").addEventListener("input", render);
  $("dwClear").addEventListener("click", () => { rows = []; render(); });
  render();
})();
