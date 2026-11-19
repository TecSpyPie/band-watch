/* The CW keyboard, in the Decoder panel's CW mode. Type, and each letter is sent in Morse as you type it: you hear it
   and see its dots and dashes. "Practice" plays to your speakers only (it starts that way every time). "On the air"
   keys the radio over its cable and plays the clean keyed tone (cwtx.js) into its USB sound (DATA-USB), with the
   same safety as FT8: Enable TX must be on, Stop TX / Esc stop at once, and the radio unkeys 0.8 s after the last
   letter (break-in). Message buttons send CQ, a call, a report and 73 with your callsign filled in. */
"use strict";

const CW_HANG = 0.8; // seconds after the last letter before the radio goes back to receive
const CW_MAX_AHEAD = 120; // never queue more than this many seconds of Morse
const cwk = {
  out: "practice", wpm: 20, farns: 0, hz: 700, rst: "5NN", msgs: {}, // saved (but not "out": always Practice at start)
  pctx: null, sources: [], cursor: 0, keyed: false, unkeyTimer: null, prev: "", pending: "", line: [], seq: 0, nextId: 0,
};

function cwLoad() {
  try {
    const s = JSON.parse(load("bw-cwkey") || "{}");
    if (s.wpm >= 5 && s.wpm <= 45) cwk.wpm = Math.round(s.wpm);
    if ([0, 5, 8, 10, 13, 15].includes(s.farns)) cwk.farns = s.farns;
    if (s.hz >= 400 && s.hz <= 1000) cwk.hz = Math.round(s.hz);
    if (typeof s.rst === "string") cwk.rst = s.rst.slice(0, 4);
    if (s.msgs && typeof s.msgs === "object") for (const k of Object.keys(CwTx.MESSAGES)) if (typeof s.msgs[k] === "string") cwk.msgs[k] = s.msgs[k].slice(0, 120);
  } catch { /* defaults */ }
  for (const k of Object.keys(CwTx.MESSAGES)) if (!cwk.msgs[k]) cwk.msgs[k] = CwTx.MESSAGES[k];
}
const cwSave = () => store("bw-cwkey", { wpm: cwk.wpm, farns: cwk.farns, hz: cwk.hz, rst: cwk.rst, msgs: cwk.msgs });

const cwAir = () => cwk.out === "air";

async function cwCtx() {
  if (cwAir()) return txAudio(); // the radio's USB sound
  if (!cwk.pctx) cwk.pctx = new AudioContext({ latencyHint: "interactive" });
  if (cwk.pctx.state === "suspended") await cwk.pctx.resume();
  return cwk.pctx;
}

/** Stop everything queued (called by Stop TX, Esc, and switching between Practice and On the air). */
function cwStopAll() {
  for (const s of cwk.sources) { s.onended = null; try { s.stop(); } catch { /* done */ } }
  cwk.sources = [];
  cwk.cursor = 0;
  cwk.keyed = false;
  cwk.pending = "";
  clearTimeout(cwk.unkeyTimer);
  cwk.unkeyTimer = null;
  cwk.seq++;
  cwRenderMorse();
}

function cwNote(t) { if ($("cwNote")) $("cwNote").textContent = t; }

/** Back to receive once everything has gone out. */
function cwIdleUnkey() {
  const ctx = cwAir() ? tx.ctx : cwk.pctx;
  if (ctx && cwk.cursor > ctx.currentTime + 0.02) {
    cwk.unkeyTimer = setTimeout(cwIdleUnkey, (cwk.cursor - ctx.currentTime + CW_HANG) * 1000);
    return;
  }
  if (cwk.keyed) { txUnkey(); renderTx(); cwRenderOut(); }
}

/** Send some text in Morse: queued after whatever is still going out. */
async function cwSend(text) {
  const toks = CwTx.tokens(text);
  if (!toks.length) return;
  const air = cwAir();
  if (air) {
    if (!tx.enabled) { cwNote("To send on the air, switch Enable TX on in the Transmit box first (or choose Practice)."); return; }
    const problem = txProblem("cw");
    if (problem) { txHalt(problem); cwNote(problem); return; }
  }
  let ctx;
  try { ctx = await cwCtx(); } catch (e) { cwNote(`Couldn't open the sound (${e.message || e}).`); return; }
  if (air && !tx.enabled) return; // stopped while the sound was opening
  const seq = cwk.seq;
  const now = ctx.currentTime;
  if (cwk.cursor - now > CW_MAX_AHEAD) { cwNote("That's plenty queued for now: wait for it to go out."); return; }
  if (cwk.cursor < now + 0.03) cwk.cursor = now + (air && !cwk.keyed ? 0.1 : 0.03); // the radio needs a moment to switch
  if (air && !cwk.keyed) { txKey(); cwk.keyed = true; tx.on = true; }
  const opts = { wpm: cwk.wpm, farns: cwk.farns, hz: cwk.hz, rate: ctx.sampleRate, amp: air ? tx.level / 100 : 0.5 };
  for (const tok of toks) {
    const r = CwTx.renderToken(tok, opts);
    const delay = cwk.cursor - ctx.currentTime;
    if (r.samples.length) {
      const src = txPlay(ctx, r.samples, Math.max(0, delay));
      src.onended = () => { cwk.sources = cwk.sources.filter((x) => x !== src); };
      cwk.sources.push(src);
    }
    const item = { ...tok, id: ++cwk.nextId };
    if (!tok.space || cwk.line.length) cwk.line.push(item);
    setTimeout(() => { if (cwk.seq === seq) cwRenderMorse(item.id); }, Math.max(0, delay) * 1000);
    cwk.cursor += r.seconds;
  }
  cwk.line = cwk.line.slice(-36); // the latest letters (two lines of them)
  cwRenderMorse();
  if (air) {
    tx.sending = { what: "CW", until: Date.now() + (cwk.cursor - ctx.currentTime) * 1000 };
    tx.log.unshift({ at: Date.now(), text: `CW: ${text.trim().slice(0, 60)}`, mode: "CW" });
    tx.log = tx.log.slice(0, 30);
    clearTimeout(cwk.unkeyTimer);
    cwk.unkeyTimer = setTimeout(cwIdleUnkey, (cwk.cursor - ctx.currentTime + CW_HANG) * 1000);
    tx.note = "";
    renderTx();
    cwRenderOut();
  }
}

/** The dots and dashes of what's been sent, the one sounding now picked out. */
function cwRenderMorse(nowId) {
  const el = $("cwMorse");
  if (!el) return;
  if (!cwk.line.length) { el.innerHTML = `<span class="muted">The Morse of what you send shows here.</span>`; return; }
  el.innerHTML = cwk.line.map((t) => (t.space ? `<span class="cwsp"> </span>`
    : `<span class="cwch${t.id === nowId ? " now" : ""}"><b>${esc(t.text)}</b><i>${t.code.replace(/\./g, "·").replace(/-/g, "–")}</i></span>`)).join("");
  // keep the newest in view: drop the oldest until it all fits in the strip
  while (el.scrollHeight > el.clientHeight + 2 && el.firstElementChild) el.firstElementChild.remove();
}

function cwFillMsg(key) {
  return CwTx.fill(cwk.msgs[key], { call: app.myCall || "", their: $("cwTheir").value.trim(), grid: typeof grid4 === "function" ? grid4() : "", rst: cwk.rst || "5NN" });
}

function cwRenderOut() {
  const air = cwAir();
  $("cwOutPractice").checked = !air;
  $("cwOutAir").checked = air;
  $("cwKeyBox").classList.toggle("air", air);
  const k = rig.hz ? (rig.hz / 1000 + cwk.hz / 1000).toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : "";
  cwNote(air
    ? `On the air${k ? ` at ${k} kHz` : ""}: what you type is sent as you type it${tx.enabled ? "." : ". Switch Enable TX on in the Transmit box first."}`
    : "Practice: you hear the Morse on your speakers; nothing is sent.");
}

function setupCwKey() {
  if (!$("cwKeyBox")) return;
  cwLoad();
  $("cwWpm").value = String(cwk.wpm);
  $("cwWpmVal").textContent = String(cwk.wpm);
  $("cwHz").value = String(cwk.hz);
  $("cwFarns").value = String(cwk.farns);
  $("cwRst").value = cwk.rst;
  const msgBox = $("cwMsgs");
  msgBox.innerHTML = Object.keys(CwTx.MESSAGES).map((k) => `<label class="small">${esc({ cq: "CQ", call: "Call", rpt: "Report", tu: "73", agn: "AGN?", qrz: "QRZ?" }[k])}
    <input type="text" data-msg="${k}" value="${esc(cwk.msgs[k])}" maxlength="120" spellcheck="false"></label>`).join("") +
    `<p class="small muted">{CALL} is your callsign, {THEIR} the call in "Their call", {GRID} your locator, {RST} the report. &lt;SK&gt;, &lt;KN&gt;, &lt;AR&gt;, &lt;BT&gt; are sent as prosigns.</p>`;
  msgBox.addEventListener("input", (e) => { const i = e.target.closest("input[data-msg]"); if (i) { cwk.msgs[i.dataset.msg] = i.value; cwSave(); } });
  $("cwWpm").addEventListener("input", () => { cwk.wpm = Number($("cwWpm").value) || 20; $("cwWpmVal").textContent = String(cwk.wpm); cwSave(); });
  $("cwHz").addEventListener("change", () => { const v = Math.round(Number($("cwHz").value)); if (v >= 400 && v <= 1000) { cwk.hz = v; cwSave(); } $("cwHz").value = String(cwk.hz); cwRenderOut(); });
  $("cwFarns").addEventListener("change", () => { cwk.farns = Number($("cwFarns").value) || 0; cwSave(); });
  $("cwRst").addEventListener("input", () => { cwk.rst = $("cwRst").value.trim().toUpperCase().slice(0, 4); cwSave(); });
  for (const id of ["cwOutPractice", "cwOutAir"]) {
    $(id).addEventListener("change", () => {
      const air = $("cwOutAir").checked;
      if (air === cwAir()) return;
      if (cwk.keyed) txUnkey(); else cwStopAll();
      cwk.out = air ? "air" : "practice";
      cwRenderOut();
      renderTx();
    });
  }
  // Typing: send what's new as it's typed. A prosign typed as <SK> waits for its ">".
  $("cwType").addEventListener("input", () => {
    const v = $("cwType").value.toUpperCase();
    let fresh = v.startsWith(cwk.prev) ? v.slice(cwk.prev.length) : "";
    cwk.prev = v;
    if (!fresh) return;
    fresh = cwk.pending + fresh;
    cwk.pending = "";
    const open = fresh.lastIndexOf("<");
    if (open >= 0 && fresh.indexOf(">", open) < 0 && fresh.length - open <= 4) { cwk.pending = fresh.slice(open); fresh = fresh.slice(0, open); }
    if (fresh) cwSend(fresh);
  });
  $("cwType").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); $("cwType").value = ""; cwk.prev = ""; cwSend(" "); }
  });
  $("cwKeyBox").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-send]");
    if (b) {
      const text = cwFillMsg(b.dataset.send);
      if (/\{THEIR\}/i.test(cwk.msgs[b.dataset.send]) && !$("cwTheir").value.trim()) { cwNote("Type their callsign in Their call first."); $("cwTheir").focus(); return; }
      cwSend(`${text} `);
    }
  });
  $("cwStop").addEventListener("click", () => { if (cwk.keyed) txHalt("Stopped."); else cwStopAll(); cwRenderOut(); });
  cwRenderMorse();
  cwRenderOut();
}
