/* QRZ login, logout and cached callsign lookups. */
"use strict";

/* ===================== QRZ ===================== */

const qrzState = { loggedIn: false, user: null, subscriber: false };

async function qrzRequest(path, options) {
  const res = await fetch(path, { cache: "no-store", credentials: "same-origin", ...options });
  let body = {};
  try { body = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, body };
}

/* Lookups are kept for the page's lifetime, so hovering and the station window don't ask QRZ twice. */
const qrzCache = new Map(); // call -> Promise<{ ok, status, body }>

function qrzLookupCached(call) {
  if (!qrzCache.has(call)) {
    const p = qrzRequest(`/api/qrz/lookup?call=${encodeURIComponent(call)}`).catch(() => ({ ok: false, status: 0, body: {} }));
    qrzCache.set(call, p);
    p.then((r) => {
      if (!r.ok && r.status !== 404) qrzCache.delete(call);
      if (r.status === 401) setQrzState({ loggedIn: false });
    });
    while (qrzCache.size > 300) qrzCache.delete(qrzCache.keys().next().value);
  }
  return qrzCache.get(call);
}

function setQrzState(info) {
  const was = qrzState.loggedIn;
  qrzState.loggedIn = Boolean(info && info.loggedIn);
  if (was !== qrzState.loggedIn) qrzCache.clear();
  qrzState.user = qrzState.loggedIn ? info.user : null;
  qrzState.subscriber = qrzState.loggedIn && Boolean(info.subscriber);
  const btn = $("qrzBtn");
  btn.textContent = qrzState.loggedIn ? `QRZ: ${qrzState.user}` : "Log in to QRZ";
  btn.classList.toggle("on", qrzState.loggedIn);
}

function openQrzLogin() {
  const signedIn = qrzState.loggedIn;
  $("qlTitle").textContent = signedIn ? "QRZ account" : "Log in to QRZ";
  $("qlOut").hidden = signedIn;
  $("qlIn").hidden = !signedIn;
  $("qlSubmit").hidden = signedIn;
  $("qlLogout").hidden = !signedIn;
  $("qlUser").required = !signedIn;
  $("qlPass").required = !signedIn;
  $("qlErr").textContent = "";
  if (signedIn) {
    $("qlWho").textContent = qrzState.user;
    $("qlSub").textContent = qrzState.subscriber
      ? "Your XML subscription is active, so full callsign details are shown."
      : "Without a QRZ XML subscription, QRZ only returns some details, such as name and country.";
  }
  $("qrzLogin").showModal();
  if (!signedIn) $("qlUser").focus();
}

async function submitQrzLogin(e) {
  e.preventDefault();
  if (qrzState.loggedIn) return;
  const username = $("qlUser").value.trim();
  const password = $("qlPass").value;
  if (!username || !password) { $("qlErr").textContent = "Enter your QRZ username and password."; return; }
  $("qlSubmit").disabled = true;
  $("qlErr").textContent = "Signing in…";
  try {
    const r = await qrzRequest("/api/qrz/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) { $("qlErr").textContent = r.body.error || "Sign-in failed."; return; }
    setQrzState(r.body);
    if (!app.myCall && validCall(qrzState.user || "")) setMyCall(qrzState.user);
    $("qlPass").value = "";
    $("qrzLogin").close();
    autoLocatorFromQrz();
  } catch {
    $("qlErr").textContent = "Could not reach HamShack. Check your connection.";
  } finally {
    $("qlSubmit").disabled = false;
  }
}

async function logoutQrz() {
  await qrzRequest("/api/qrz/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  setQrzState({ loggedIn: false });
  $("qrzLogin").close();
}

function qrzPageLink(call, label) {
  return `<a class="go" href="https://www.qrz.com/db/${encodeURIComponent(call)}" target="_blank" rel="noopener noreferrer">${esc(label || "Open on QRZ.com")}</a>`;
}
