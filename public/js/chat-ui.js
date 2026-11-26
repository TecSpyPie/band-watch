/* Band Watch chat panel: General plus one room per band. Messages are shown as text only. */
(function () {
  "use strict";
  if (window.__bwChat) return;
  window.__bwChat = true;

  const byId = (id) => document.getElementById(id);
  const mk = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") el.textContent = v;
      else if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  };
  const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const put = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

  const ROOMS = ["general", "160", "80", "60", "40", "30", "20", "17", "15", "12", "10", "6", "2", "70"];
  const roomName = (r) => (r === "general" ? "General" : r === "70" ? "70 cm" : `${r} m`);
  const S = { room: get("bwx-chat-room", "general"), msgs: [], last: 0, hidden: new Set(get("bwx-chat-hidden", [])), busy: false, err: "", timer: 0 };
  if (!ROOMS.includes(S.room)) S.room = "general";

  const css = `
.bwc-rooms{display:flex;gap:4px;flex-wrap:wrap;margin:6px 0 10px}
.bwc-rooms button{font:500 .8125rem Barlow,sans-serif;border:1px solid var(--line);background:var(--surface);color:var(--text);border-radius:999px;padding:3px 10px;cursor:pointer}
.bwc-rooms button[aria-pressed="true"]{background:var(--cool);border-color:var(--cool);color:var(--bg)}
.bwc-list{list-style:none;margin:0;padding:8px 10px;height:320px;overflow-y:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);display:flex;flex-direction:column;gap:6px}
.bwc-list li{display:grid;grid-template-columns:auto 1fr auto;gap:2px 8px;align-items:baseline}
.bwc-call{font-weight:600;color:var(--cool);font-variant-numeric:tabular-nums}
.bwc-call.me{color:var(--warm)}
.bwc-text{white-space:pre-wrap;overflow-wrap:anywhere;min-width:0}
.bwc-time{font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums}
.bwc-hide{grid-column:3;justify-self:end;font-size:.75rem;color:var(--muted);background:none;border:0;cursor:pointer;padding:0}
.bwc-empty{color:var(--muted);margin:auto;text-align:center}
.bwc-form{display:flex;gap:8px;margin-top:8px}
.bwc-form textarea{flex:1;min-width:0;font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--line);border-radius:6px;padding:6px 8px;resize:vertical;min-height:40px}
.bwc-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:.8125rem;color:var(--muted);margin-top:4px}
.bwc-err{color:var(--warm)}
`;
  document.head.append(mk("style", { id: "bwcStyle" }, css));

  function myCall() {
    const a = typeof app === "object" && app ? app.myCall : "";
    const v = String(a || (byId("mycall") && byId("mycall").value) || "").trim().toUpperCase();
    return v;
  }

  function hhmm(t) { const d = new Date(t); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}z`; }

  function renderList(stick) {
    const ul = byId("bwcList"); if (!ul) return;
    const atBottom = stick || ul.scrollHeight - ul.scrollTop - ul.clientHeight < 40;
    const me = myCall();
    const shown = S.msgs.filter((m) => !S.hidden.has(m.call));
    ul.replaceChildren();
    if (!shown.length) ul.append(mk("li", { class: "bwc-empty", text: S.err ? "Chat can't be reached right now. It will keep trying." : `No messages in ${roomName(S.room)} yet. Say hello!` }));
    for (const m of shown) {
      ul.append(mk("li", {},
        mk("span", { class: "bwc-call" + (m.call === me ? " me" : ""), text: m.call }),
        mk("span", { class: "bwc-text", text: m.text }),
        mk("span", { class: "bwc-time", title: new Date(m.t).toUTCString(), text: hhmm(m.t) }),
        m.call !== me ? mk("button", { type: "button", class: "bwc-hide", text: "Hide", title: `Hide all messages from ${m.call}`, "aria-label": `Hide messages from ${m.call}`, onclick: () => hideCall(m.call) }) : null));
    }
    if (atBottom) ul.scrollTop = ul.scrollHeight;
    const hid = byId("bwcHidden");
    if (hid) {
      hid.replaceChildren();
      if (S.hidden.size) hid.append(`Hiding ${[...S.hidden].join(", ")} `, mk("button", { type: "button", class: "lbtn", text: "Show all", onclick: () => { S.hidden.clear(); put("bwx-chat-hidden", []); renderList(); } }));
    }
  }
  function hideCall(c) { S.hidden.add(c); put("bwx-chat-hidden", [...S.hidden]); renderList(); }

  async function poll() {
    const room = S.room;
    try {
      const res = await fetch(`/api/chat?room=${encodeURIComponent(room)}&since=${S.last}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      const d = await res.json();
      if (room !== S.room) return;
      if (Array.isArray(d.messages) && d.messages.length) {
        const seen = new Set(S.msgs.map((m) => m.id));
        S.msgs = [...S.msgs, ...d.messages.filter((m) => !seen.has(m.id))].slice(-200);
        S.last = Math.max(S.last, ...d.messages.map((m) => m.id));
      }
      S.err = ""; renderList();
    } catch { S.err = "offline"; renderList(); }
  }
  function schedule() {
    clearTimeout(S.timer);
    S.timer = setTimeout(async () => { await poll(); schedule(); }, document.visibilityState === "visible" ? 5000 : 30000);
  }
  function switchRoom(r) {
    S.room = r; S.msgs = []; S.last = 0; put("bwx-chat-room", r);
    document.querySelectorAll("#bwcRooms button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.room === r ? "true" : "false"));
    byId("bwcText").placeholder = `Message ${roomName(r)}…`;
    renderList(true); poll().then(() => renderList(true));
  }
  async function sendMsg(e) {
    e.preventDefault();
    const ta = byId("bwcText"), note = byId("bwcNote");
    const call = myCall();
    if (!call) { note.textContent = "Enter your callsign at the top of the page first."; note.className = "bwc-err"; byId("mycall") && byId("mycall").focus(); return; }
    const text = ta.value.trim(); if (!text || S.busy) return;
    S.busy = true; byId("bwcSend").disabled = true;
    try {
      const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ room: S.room, call, text }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Couldn't send. Try again.");
      ta.value = ""; note.textContent = ""; note.className = "";
      await poll(); renderList(true);
    } catch (err) { note.textContent = err.message; note.className = "bwc-err"; }
    S.busy = false; byId("bwcSend").disabled = false; countLeft();
  }
  function countLeft() { const ta = byId("bwcText"), c = byId("bwcCount"); if (ta && c) c.textContent = `${300 - ta.value.length} left`; }

  function build() {
    const ta = mk("textarea", { id: "bwcText", maxlength: 300, rows: 2, "aria-label": "Your message", placeholder: `Message ${roomName(S.room)}…` });
    ta.addEventListener("input", countLeft);
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.form.requestSubmit(); } });
    const sec = mk("section", { class: "panel bwx-panel", id: "secChat", "aria-labelledby": "secChatT" },
      mk("div", { class: "phead" }, mk("h2", { id: "secChatT", text: "Chat" })),
      mk("p", { class: "bwx-note", style: "font-size:.875rem;color:var(--muted);margin:6px 0", text: "Talk to other Band Watch users. Pick General or a band room. Anyone using Band Watch can read these messages, so don't post anything private." }),
      mk("div", { class: "bwc-rooms", id: "bwcRooms", role: "group", "aria-label": "Chat rooms" },
        ROOMS.map((r) => mk("button", { type: "button", "data-room": r, "aria-pressed": r === S.room ? "true" : "false", text: roomName(r), onclick: () => switchRoom(r) }))),
      mk("ul", { class: "bwc-list", id: "bwcList", "aria-live": "polite", "aria-label": "Messages" }),
      mk("form", { class: "bwc-form", onsubmit: sendMsg }, ta, mk("button", { type: "submit", class: "lbtn on", id: "bwcSend", text: "Send" })),
      mk("div", { class: "bwc-meta" }, mk("span", { id: "bwcNote", role: "status" }), mk("span", { id: "bwcCount", text: "300 left" })),
      mk("p", { class: "bwc-meta", id: "bwcHidden" }));
    const after = byId("secCwTrain") || byId("secFcst") || byId("secAnt");
    if (after) after.after(sec); else (document.querySelector(".wrap") || document.body).append(sec);
  }

  function init() {
    build(); renderList(true); poll().then(() => renderList(true)); schedule();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { poll(); schedule(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.BWChat = { switchRoom, poll, S };
})();
