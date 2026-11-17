// Band Watch by M3vrv: the install page. Shows the steps for the chosen device, starting with this one.
"use strict";
(function () {
  const bw = window.bwInstall;
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll(".itabs [role=tab]")];
  const NAMES = { windows: "a Windows PC", iphone: "an iPhone or iPad", android: "an Android device" };

  function show(p) {
    for (const t of tabs) {
      const on = t.dataset.p === p;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    }
  }
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => { show(t.dataset.p); history.replaceState(null, "", `?for=${t.dataset.p}`); });
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      const n = tabs[(i + d + tabs.length) % tabs.length];
      n.focus(); n.click();
    });
  });

  const asked = new URLSearchParams(location.search).get("for");
  const mine = bw.platform();
  const onPhone = mine === "iphone" || mine === "android";
  document.documentElement.classList.toggle("onphone", onPhone);
  show(NAMES[asked] ? asked : mine || "windows");
  if (mine) {
    $("here").hidden = false;
    $("here").textContent = bw.standalone()
      ? "Band Watch is already installed as an app on this device."
      : `You're on ${NAMES[mine]}.`;
  }

  // The Windows download, where this server offers one.
  fetch("/download/BandWatch-Windows.zip", { method: "HEAD" })
    .then((r) => { if (r.ok) { $("winDl").hidden = false; $("winGet").innerHTML = "Download <b>BandWatch-Windows.zip</b>:"; } })
    .catch(() => {});
  // In the Windows app itself.
  fetch("/healthz").then((r) => r.json()).then((h) => { if (h.desktop) $("winInstalled").hidden = false; }).catch(() => {});

  bw.onChange(() => {
    for (const b of document.querySelectorAll(".installNow")) b.hidden = !bw.prompt;
  });
  for (const b of document.querySelectorAll(".installNow")) b.addEventListener("click", () => bw.install());
})();
