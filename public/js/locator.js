/* Locator options window: manual, from QRZ, or from this device. */
"use strict";

/* ===================== Locator options ===================== */

const locatorAutoFromQrz = () => load("bw-locauto") !== "0"; // on unless the user turns it off

function setLocator(value) {
  $("grid").value = value;
  setGrid();
}

function describeLocator(value) {
  const v = normaliseLocator(value);
  const pos = v && v.length === String(value).trim().length ? gridToLatLon(v) : null;
  if (!pos) return null;
  const ns = pos.lat >= 0 ? "N" : "S", ew = pos.lon >= 0 ? "E" : "W";
  return `Grid square ${v.slice(0, 4)} · ${Math.abs(pos.lat).toFixed(2)}°${ns}, ${Math.abs(pos.lon).toFixed(2)}°${ew}` +
    (v.length === 6 ? " · accurate to about 5 km" : " · accurate to about 100 km");
}

function updateLocInfo() {
  const d = describeLocator($("locIn").value);
  $("locInfo").textContent = d || "Enter 4 or 6 characters, like IO93 or IO93fa.";
}

function openLocator() {
  $("locIn").value = $("grid").value.trim();
  $("locAuto").checked = locatorAutoFromQrz();
  $("locErr").textContent = "";
  $("locQrz").disabled = false;
  updateLocInfo();
  $("locDlg").showModal();
  $("locIn").focus();
}

/** Look up the user's own callsign on QRZ and return its locator, or throw a readable message. */
async function qrzLocator() {
  if (!qrzState.loggedIn) throw new Error("Log in to QRZ first, using the button at the top of the page.");
  const call = app.myCall || baseCall(qrzState.user || "");
  if (!call) throw new Error("Enter your callsign first.");
  const r = await qrzRequest(`/api/qrz/lookup?call=${encodeURIComponent(call)}`).catch(() => ({ ok: false, body: {} }));
  if (r.status === 401) setQrzState({ loggedIn: false });
  if (!r.ok) throw new Error(r.body.error || "QRZ could not be reached.");
  const loc = normaliseLocator(r.body.grid);
  if (!loc) throw new Error(`QRZ has no locator for ${call}. You can add one to your QRZ profile, or type it here.`);
  return { loc, call };
}

async function autoLocatorFromQrz() {
  if (!locatorAutoFromQrz()) return;
  try {
    const { loc, call } = await qrzLocator();
    if (loc !== normaliseLocator($("grid").value)) {
      setLocator(loc);
      showToast("Locator set from QRZ", `${loc}, from ${call}'s QRZ profile.`);
    }
  } catch { /* no locator on QRZ: keep the current one */ }
}

function setupLocator() {
  $("locBtn").addEventListener("click", openLocator);
  $("locIn").addEventListener("input", () => { $("locErr").textContent = ""; updateLocInfo(); });
  $("locClose").addEventListener("click", () => $("locDlg").close());
  $("locDlg").addEventListener("click", (e) => { if (e.target === $("locDlg")) $("locDlg").close(); });
  $("locQrz").addEventListener("click", async () => {
    $("locErr").textContent = "";
    $("locInfo").textContent = "Asking QRZ…";
    try {
      const { loc, call } = await qrzLocator();
      $("locIn").value = loc;
      updateLocInfo();
      $("locInfo").textContent = `From ${call}'s QRZ profile. ${$("locInfo").textContent}`;
    } catch (err) {
      updateLocInfo();
      $("locErr").textContent = err.message;
    }
  });
  $("locGeo").addEventListener("click", () => {
    $("locErr").textContent = "";
    if (!("geolocation" in navigator)) { $("locErr").textContent = "This browser can’t share its location."; return; }
    $("locInfo").textContent = "Finding your location…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $("locIn").value = latLonToLocator(pos.coords.latitude, pos.coords.longitude);
        updateLocInfo();
        $("locInfo").textContent = `From this device’s location. ${$("locInfo").textContent}`;
      },
      (err) => {
        updateLocInfo();
        $("locErr").textContent = err.code === 1 ? "Location permission was refused. You can type your locator instead." : "Your location couldn’t be found. You can type your locator instead.";
      },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  });
  $("locForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const typed = $("locIn").value.trim();
    if (!describeLocator(typed)) { $("locErr").textContent = "Enter a locator like IO93 or IO93fa."; return; }
    store("bw-locauto", $("locAuto").checked ? "1" : "0");
    $("locDlg").close();
    setLocator(normaliseLocator(typed));
  });
}
