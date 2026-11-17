/* Band Watch by M3vrv: the decodes window. Band Watch's main window sends each cycle's decodes here. */
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

  function render() {
    const find = $("dwFind").value.trim().toUpperCase();
    const list = rows.filter((r) => (!$("dwCq").checked || /^CQ /.test(r.text)) && (!find || r.text.includes(find)));
    let last = null;
    $("dwRows").innerHTML = list.slice(0, 1000).map((r) => {
      const mine = myCall && r.text.split(" ").some((w) => w.replace(/^<|>$/g, "").split("/").includes(myCall));
      const cls = (mine ? "dcmine" : /^CQ /.test(r.text) ? "dccq" : "") + (last !== null && r.cycle !== last ? " dcnew" : "");
      last = r.cycle;
      return `<tr class="${cls}"><td>${r.utc}</td><td>${r.mode}</td><td>${r.snr > 0 ? "+" : ""}${r.snr}</td><td>${r.dt.toFixed(1)}</td><td>${r.freq}</td><td class="dcmsg">${r.text.split(" ").map(word).join(" ")}</td></tr>`;
    }).join("") || `<tr><td colspan="6" class="muted small">No decodes yet. Start decoding in Band Watch.</td></tr>`;
  }

  if (!("BroadcastChannel" in window)) {
    $("dwStatus").textContent = "This browser can't link windows; use the decoder in Band Watch itself.";
    return;
  }
  const ch = new BroadcastChannel("bw-decodes");
  ch.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "cw") {
      $("dwCw").hidden = false;
      $("dwCw").textContent = m.text || "";
      $("dwCw").scrollTop = $("dwCw").scrollHeight;
      $("dwStatus").textContent = `CW: ${m.wpm} WPM on a ${m.tone} Hz tone`;
      return;
    }
    if (m.type === "all") rows = Array.isArray(m.rows) ? m.rows.slice() : [];
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
