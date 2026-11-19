/* Band Watch by M3vrv: the decode table's columns, shared by the Decoder panel and the Results window.
 * Which columns show, how wide they are (drag a heading's edge), and which time zone the Time column and the
 * little clock use (UTC, this computer's local time, or any zone). Saved in this browser as "bw-dccols", so both
 * windows follow the same choices. */
(function (root) {
  "use strict";
  const KEY = "bw-dccols";
  const COLS = [
    { id: "time", label: "Time", title: "When the cycle started" },
    { id: "mode", label: "Mode", title: "FT8 or FT4" },
    { id: "snr", label: "dB", title: "Signal-to-noise ratio" },
    { id: "dt", label: "DT", title: "Time offset in seconds (how far their clock is out)" },
    { id: "freq", label: "Audio Hz", title: "Where in the receiver's passband (audio offset, Hz)" },
    { id: "rf", label: "Frequency", title: "The frequency on the air: the radio's dial plus the audio offset (kHz)" },
    { id: "msg", label: "Message", title: "The message" },
  ];
  const DEFAULT = { show: { time: true, mode: true, snr: true, dt: true, freq: true, rf: false, msg: true }, widths: {}, tz: "UTC" };
  const MIN_W = 36;
  // Starting widths (px); the message takes whatever is left.
  const START_W = { time: 82, mode: 52, snr: 48, dt: 48, freq: 74, rf: 104 };

  function get() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || "{}");
      const show = { ...DEFAULT.show, ...(s.show && typeof s.show === "object" ? s.show : {}) };
      show.msg = true; // the message is what it's all about
      const widths = {};
      if (s.widths && typeof s.widths === "object") for (const c of COLS) if (Number(s.widths[c.id]) >= MIN_W) widths[c.id] = Math.min(800, Math.round(s.widths[c.id]));
      return { show, widths, tz: typeof s.tz === "string" && validTz(s.tz) ? s.tz : "UTC" };
    } catch { return { show: { ...DEFAULT.show }, widths: {}, tz: "UTC" }; }
  }
  function set(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
  }

  function validTz(tz) {
    if (tz === "UTC" || tz === "local") return true;
    try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
  }
  /** Every time zone this browser knows, for the picker. */
  function zones() {
    try { if (typeof Intl.supportedValuesOf === "function") return Intl.supportedValuesOf("timeZone"); } catch { /* old browser */ }
    return ["Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome", "Europe/Athens", "Europe/Moscow",
      "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
      "America/Sao_Paulo", "Africa/Johannesburg", "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo", "Australia/Sydney", "Pacific/Auckland"];
  }
  const tzOpt = (tz) => (tz === "local" ? undefined : tz);

  /** Time of day in the chosen zone: "14:32:15". */
  function time(t, tz) {
    if (tz === "UTC") return new Date(t).toISOString().slice(11, 19);
    try {
      return new Intl.DateTimeFormat("en-GB", { timeZone: tzOpt(tz), hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(t));
    } catch { return new Date(t).toISOString().slice(11, 19); }
  }
  /** The zone's short name right now: "UTC", "GMT", "BST", "CET", "EST"… */
  function tzShort(tz, t = Date.now()) {
    if (tz === "UTC") return "UTC";
    try {
      const p = new Intl.DateTimeFormat("en-GB", { timeZone: tzOpt(tz), timeZoneName: "short" }).formatToParts(new Date(t));
      const n = p.find((x) => x.type === "timeZoneName");
      return n ? n.value : tz;
    } catch { return tz; }
  }
  /** A friendly name for the picker: "Local (this computer)", "Europe/London". */
  const tzLabel = (tz) => (tz === "local" ? "Local (this computer)" : tz === "UTC" ? "UTC" : tz.replace(/_/g, " "));

  /** The table's <colgroup> and header. extra: more header cells after (e.g. the Reply/Log column). */
  function head(s, cols, extra = "") {
    const shown = cols.filter((id) => s.show[id]);
    const w = (id) => s.widths[id] || START_W[id];
    const cg = shown.map((id) => `<col data-col="${id}"${w(id) ? ` style="width:${w(id)}px"` : ""}>`).join("") + (extra ? `<col style="width:7.5em">` : "");
    const th = shown.map((id) => {
      const c = COLS.find((x) => x.id === id);
      const label = id === "time" ? (s.tz === "UTC" ? "UTC" : `Time (${tzShort(s.tz)})`) : c.label;
      return `<th data-col="${id}" title="${c.title}">${label}${id === "msg" ? "" : `<span class="dcrsz" data-col="${id}" role="separator" aria-orientation="vertical" aria-label="Resize the ${label} column" tabindex="0"></span>`}</th>`;
    }).join("");
    return { colgroup: cg, row: `<tr>${th}${extra}</tr>`, shown };
  }

  const fmtKHz = (k) => k.toLocaleString("en-GB", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  /** One row's cells, for the shown columns. msgHtml: the message already made into HTML (call links). */
  function cells(s, shown, r, msgHtml) {
    return shown.map((id) => {
      switch (id) {
        case "time": return `<td>${time(r.cycle, s.tz)}</td>`;
        case "mode": return `<td>${r.mode || ""}</td>`;
        case "snr": return `<td class="num">${r.snr > 0 ? "+" : ""}${r.snr}</td>`;
        case "dt": return `<td class="num">${Number(r.dt).toFixed(1)}</td>`;
        case "freq": return `<td class="num">${r.freq}</td>`;
        case "rf": return `<td class="num">${r.dial ? fmtKHz(r.dial + r.freq / 1000) : "–"}</td>`;
        case "msg": return `<td class="dcmsg">${msgHtml}</td>`;
        default: return "<td></td>";
      }
    }).join("");
  }

  /** Let the headings' edges be dragged (mouse, touch, or arrow keys on a focused edge). onDone(id, width). */
  function resizable(table, onDone) {
    if (table.dataset.rsz) return;
    table.dataset.rsz = "1";
    const colFor = (id) => table.querySelector(`col[data-col="${id}"]`);
    table.addEventListener("pointerdown", (e) => {
      const h = e.target.closest(".dcrsz");
      if (!h) return;
      e.preventDefault();
      const id = h.dataset.col;
      const th = h.parentElement;
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width;
      const col = colFor(id);
      h.setPointerCapture(e.pointerId);
      const move = (ev) => { const w = Math.max(MIN_W, Math.round(w0 + ev.clientX - x0)); if (col) col.style.width = `${w}px`; };
      const up = (ev) => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        onDone(id, Math.max(MIN_W, Math.round(w0 + ev.clientX - x0)));
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
    });
    table.addEventListener("keydown", (e) => {
      const h = e.target.closest(".dcrsz");
      if (!h || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      e.preventDefault();
      const w = h.parentElement.getBoundingClientRect().width + (e.key === "ArrowRight" ? 10 : -10);
      onDone(h.dataset.col, Math.max(MIN_W, Math.round(w)));
    });
  }

  /** The Columns menu: a tick box per column, the time zone, and a reset. Built into `box`. */
  function menu(box, cols, onChange) {
    const s = get();
    const zs = zones();
    box.innerHTML = `<fieldset class="dccolset"><legend class="small">Show these columns</legend>${cols.filter((id) => id !== "msg").map((id) => {
      const c = COLS.find((x) => x.id === id);
      return `<label class="small"><input type="checkbox" data-col="${id}"${s.show[id] ? " checked" : ""}> ${c.label}</label>`;
    }).join("")}</fieldset>
      <label class="small dctzrow">Times in <select class="dctz">
        <option value="UTC"${s.tz === "UTC" ? " selected" : ""}>UTC</option>
        <option value="local"${s.tz === "local" ? " selected" : ""}>Local (this computer)</option>
        ${zs.filter((z) => z !== "UTC").map((z) => `<option value="${z}"${s.tz === z ? " selected" : ""}>${tzLabel(z)}</option>`).join("")}
      </select></label>
      <button type="button" class="linkbtn dcwreset">Reset column widths</button>`;
    box._onChange = onChange;
    if (box.dataset.bound) return; // built again (the other window changed something): the handlers are already there
    box.dataset.bound = "1";
    box.addEventListener("change", (e) => {
      const st = get();
      const cb = e.target.closest("input[data-col]");
      if (cb) st.show[cb.dataset.col] = cb.checked;
      if (e.target.classList.contains("dctz")) st.tz = e.target.value;
      set(st);
      box._onChange();
    });
    box.addEventListener("click", (e) => {
      if (!e.target.closest(".dcwreset")) return;
      const st = get(); st.widths = {}; set(st); box._onChange();
    });
  }

  /** The little clock above the table: the chosen zone, and UTC beside it if that's not UTC. */
  function clock(s, t = Date.now()) {
    if (s.tz === "UTC") return `${time(t, "UTC")} UTC`;
    return `${time(t, s.tz)} ${tzShort(s.tz, t)} · ${time(t, "UTC")} UTC`;
  }

  function saveWidth(id, w) { const s = get(); s.widths[id] = w; set(s); }

  root.DcCols = { KEY, COLS, get, set, head, cells, resizable, menu, clock, time, tzShort, tzLabel, zones, saveWidth, validTz };
})(typeof self !== "undefined" ? self : this);
