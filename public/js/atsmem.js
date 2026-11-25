/* The ATS Mini's memory slots, in its panel: read them from the radio, tune to one, add, change or clear one,
   and keep a backup file. The radio's commands are read and written by atsmem-data.js (AtsMem); this file is the
   screen part. Writing waits for the radio's screen picture and any tuning to finish, so they don't get mixed up. */
"use strict";

const atsMem = {
  list: [], // what the radio holds: { slot, band, hz, mode, name }
  read: false, // read from the radio at least once since connecting
  reading: false, readSent: 0, lastLine: 0,
  queue: [], // commands still to send: { cmd, what }
  sentAt: 0, wrote: 0, errors: [],
  msg: "", clearing: 0, clearAt: 0,
};

const ATS_MEM_GAP = 300; // ms between commands, so the radio keeps up

function atsMemBusy() {
  return atsMem.reading || atsMem.queue.length > 0 || (atsMem.sentAt && Date.now() - atsMem.sentAt < ATS_MEM_GAP);
}

function atsMemNames() {
  return AtsMem.hasNames(rig.ats.version);
}

/** A memory line from the radio (called by atsLine). True if it was one. */
function atsMemLine(line) {
  const m = AtsMem.parseLine(line);
  if (!m) return false;
  atsMem.lastLine = Date.now();
  if (atsMem.reading) {
    atsMem.got = atsMem.got || new Map();
    atsMem.got.set(m.slot, m);
  }
  return true;
}

/** An error from the radio (called by atsLine): if it came just after a memory command, it's about that. */
function atsMemError(text) {
  if (!atsMem.sentAt || Date.now() - atsMem.sentAt > 2000 || !atsMem.lastWhat) return false;
  atsMem.errors.push(`${atsMem.lastWhat}: ${text}`);
  return true;
}

function atsMemRead() {
  atsMem.queue.push({ cmd: "$", what: "read" });
  atsMemMsg("Reading the memory slots…");
}

function atsMemSend(cmd, what) {
  atsMem.queue.push({ cmd, what });
}

/** Every tenth of a second: send the next command, or finish reading. */
function atsMemTick() {
  if (rig.kind !== "atsmini") return;
  if (!rig.connected) {
    if (atsMem.queue.length || atsMem.reading) { atsMem.queue = []; atsMem.reading = false; atsMemMsg("The radio was disconnected."); }
    atsMem.read = false;
    return;
  }
  const a = rig.ats;
  if (atsMem.reading) {
    // "$" has no end marker: done once the lines stop (the status line keeps coming, so go by memory lines)
    if (Date.now() - Math.max(atsMem.readSent + 1500, atsMem.lastLine + 700) < 0) return;
    atsMem.reading = false;
    atsMem.read = true;
    atsMem.list = [...(atsMem.got || new Map()).values()].sort((x, y) => x.slot - y.slot);
    atsMem.got = null;
    const n = atsMem.list.length;
    const bad = atsMem.errors.length ? ` The radio said no to ${atsMem.errors.length}: ${atsMem.errors.slice(0, 3).join("; ")}.` : "";
    const saved = atsMem.wrote - atsMem.errors.length;
    const wrote = saved > 0 ? `Saved ${saved} to the radio. ` : "";
    atsMem.wrote = 0;
    atsMem.errors = [];
    atsMemMsg(`${wrote}${n ? `${n} of ${AtsMem.SLOTS} slots in use.` : "All the memory slots are empty."}${bad}`);
    atsMemRows();
    return;
  }
  if (!atsMem.queue.length || !a.lastLine) return;
  if (a.shotWanted || a.want || Date.now() - atsMem.sentAt < ATS_MEM_GAP) return; // a screen picture or tuning first
  if (typeof atsScanBusy === "function" && atsScanBusy()) return; // a band scan first
  const next = atsMem.queue.shift();
  atsMem.sentAt = Date.now();
  atsMem.lastWhat = next.what === "read" ? "" : next.what;
  if (next.cmd === "$") {
    atsMem.reading = true;
    atsMem.readSent = Date.now();
    atsMem.lastLine = 0;
    atsMem.got = new Map();
  } else {
    atsMem.wrote++;
    if (!atsMem.queue.length) atsMem.queue.push({ cmd: "$", what: "read" }); // read back what the radio kept
  }
  rigWrite(next.cmd);
}

function atsMemMsg(text) {
  atsMem.msg = text;
  if ($("atsMemMsg")) $("atsMemMsg").textContent = text;
}

/** The slots table. */
function atsMemRows() {
  const body = $("atsMemRows");
  if (!body) return;
  body.textContent = "";
  for (const m of atsMem.list) {
    const tr = document.createElement("tr");
    tr.dataset.slot = String(m.slot);
    const cell = (text) => { const td = document.createElement("td"); td.textContent = text; tr.append(td); return td; };
    cell(String(m.slot).padStart(2, "0"));
    cell(m.name || "");
    cell(AtsMem.showFreq(m.hz, m.mode));
    cell(m.mode);
    cell(m.band);
    const td = document.createElement("td");
    td.className = "atsmem-acts";
    for (const [act, label, cls, title] of [
      ["tune", "Tune", "tune", "Tune the radio and Band Watch here"],
      ["edit", "Change", "lbtn", "Put this slot in the boxes above to change it"],
      ["clear", "Clear", "linkbtn", "Empty this slot on the radio"],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.dataset.act = act;
      b.title = title;
      b.textContent = act === "clear" && atsMem.clearing === m.slot && Date.now() - atsMem.clearAt < 4000 ? "Sure? Clear" : label;
      td.append(b);
    }
    tr.append(td);
    body.append(tr);
  }
  $("atsMemTable").hidden = !atsMem.list.length;
  atsMemState();
}

/** Buttons on or off, and the name box only for firmware that keeps names. */
function atsMemState() {
  const box = $("atsMemBox");
  if (!box) return;
  const on = rig.kind === "atsmini" && rig.connected && !!rig.ats.lastLine;
  for (const el of box.querySelectorAll("button, input, select")) {
    if (el.id === "atsMemBackup") el.disabled = !atsMem.list.length;
    else if (el.type !== "file") el.disabled = !on;
  }
  const names = on ? atsMemNames() : true;
  $("atsMemNameWrap").hidden = !names;
  $("atsMemOldFw").hidden = names;
  if (!on && !atsMem.msg) $("atsMemMsg").textContent = "Connect the ATS Mini to read its memory slots.";
}

/** Fill the boxes (to save what the radio is on, or to change a slot). */
function atsMemFill(m) {
  $("atsMemSlot").value = String(m.slot || "");
  $("atsMemMode").value = AtsMem.MODES.includes(m.mode) ? m.mode : "AM";
  $("atsMemFreq").value = m.hz ? (m.mode === "FM" ? String(m.hz / 1e6) : String(m.hz / 1000)) : "";
  $("atsMemName").value = m.name || "";
  $("atsMemFreq").focus();
}

function atsMemFromForm() {
  const mode = $("atsMemMode").value;
  return {
    slot: Number($("atsMemSlot").value),
    mode,
    hz: AtsMem.readFreq($("atsMemFreq").value, mode),
    name: AtsMem.cleanName($("atsMemName").value),
  };
}

function atsMemWrite(mem) {
  const bad = AtsMem.problem(mem);
  if (bad) { atsMemMsg(bad); return false; }
  const old = atsMem.list.find((m) => m.slot === mem.slot);
  // Firmware without names keeps the old name if the name is left out, so there's nothing to lose
  atsMemSend(AtsMem.command(mem, { names: atsMemNames() }), `slot ${mem.slot}`);
  atsMemMsg(old ? `Changing slot ${mem.slot}…` : `Saving slot ${mem.slot}…`);
  return true;
}

function atsMemClear(slot) {
  const m = atsMem.list.find((x) => x.slot === slot);
  if (!m) return;
  if (atsMem.clearing !== slot || Date.now() - atsMem.clearAt > 4000) {
    atsMem.clearing = slot;
    atsMem.clearAt = Date.now();
    atsMemRows();
    atsMemMsg(`Click "Sure? Clear" to empty slot ${slot}.`);
    return;
  }
  atsMem.clearing = 0;
  atsMemSend(AtsMem.clearCommand(m), `slot ${slot}`);
  atsMemMsg(`Clearing slot ${slot}…`);
}

function atsMemBackup() {
  if (!atsMem.list.length) return;
  const blob = new Blob([AtsMem.backupText(atsMem.list)], { type: "text/plain" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ats-mini-memories-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  atsMemMsg(`Saved ${atsMem.list.length} slots to a file in your Downloads.`);
}

async function atsMemRestore(file) {
  const text = await file.text();
  const list = AtsMem.parseBackup(text);
  const good = list.filter((m) => !AtsMem.problem(m));
  if (!good.length) { atsMemMsg("That file has no ATS Mini memory slots in it."); return; }
  const names = atsMemNames();
  for (const m of good) atsMemSend(AtsMem.command(m, { names }), `slot ${m.slot}`);
  atsMemMsg(`Loading ${good.length} slots into the radio… Slots not in the file are left as they are.`);
}

function renderAtsMem() {
  atsMemState();
  // Read the slots the first time the box is open with the radio connected
  const box = $("atsMemBox");
  if (box && box.open && rig.connected && rig.ats.lastLine && !atsMem.read && !atsMemBusy()) atsMemRead();
}

function setupAtsMem() {
  const box = $("atsMemBox");
  if (!box) return;
  box.addEventListener("toggle", renderAtsMem);
  $("atsMemRead").addEventListener("click", atsMemRead);
  $("atsMemHere").addEventListener("click", () => {
    const mode = AtsMem.MODES.includes(rig.modeName) ? rig.modeName : "AM";
    atsMemFill({ slot: AtsMem.firstFree(atsMem.list), mode, hz: rig.hz, name: "" });
    atsMemMsg(AtsMem.firstFree(atsMem.list) ? "Add a name if you like, then click Save to radio." : "All 99 slots are in use: pick one to write over.");
  });
  $("atsMemForm").addEventListener("submit", (e) => {
    e.preventDefault();
    atsMemWrite(atsMemFromForm());
  });
  $("atsMemBackup").addEventListener("click", atsMemBackup);
  $("atsMemRestoreBtn").addEventListener("click", () => $("atsMemRestore").click());
  $("atsMemRestore").addEventListener("change", () => {
    const f = $("atsMemRestore").files[0];
    $("atsMemRestore").value = "";
    if (f) atsMemRestore(f);
  });
  $("atsMemRows").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const slot = Number(b.closest("tr").dataset.slot);
    const m = atsMem.list.find((x) => x.slot === slot);
    if (!m) return;
    if (b.dataset.act === "tune") tuneTo(m.hz / 1000, AtsMem.LISTEN[m.mode], { quiet: true });
    else if (b.dataset.act === "edit") { atsMemFill(m); atsMemMsg(`Change slot ${slot}, then click Save to radio.`); }
    else if (b.dataset.act === "clear") atsMemClear(slot);
  });
  setInterval(atsMemTick, 100);
  atsMemRows();
}
