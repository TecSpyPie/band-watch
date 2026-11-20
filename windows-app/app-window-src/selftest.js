// Checks the browser features Band Watch and ClearRX depend on, inside the app window.
(async () => {
  const r = { href: location.href, title: document.title, engine: navigator.userAgent };
  const check = async (name, fn) => {
    try { r[name] = await fn(); } catch (e) { r[name] = "ERROR " + e.name + ": " + e.message; }
  };

  await check("serialApi", () => "serial" in navigator);
  await check("serialKnownPorts", async () => (navigator.serial ? (await navigator.serial.getPorts()).length : "no serial API"));
  await check("microphone", async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    const label = s.getAudioTracks()[0].label;
    s.getTracks().forEach((t) => t.stop());
    return "ok: " + label;
  });
  await check("soundDevices", async () => {
    const d = await navigator.mediaDevices.enumerateDevices();
    return {
      inputs: d.filter((x) => x.kind === "audioinput").length,
      outputs: d.filter((x) => x.kind === "audiooutput").length,
      named: d.filter((x) => x.label).length,
    };
  });
  await check("chooseSpeakers", () => typeof HTMLMediaElement.prototype.setSinkId === "function");
  await check("audioEngine", async () => {
    const c = new AudioContext();
    const out = { state: c.state, worklet: !!c.audioWorklet, sinkId: typeof c.setSinkId === "function" };
    await c.close();
    return out;
  });
  await check("savedSettings", () => {
    localStorage.setItem("bw-selftest", "1");
    const ok = localStorage.getItem("bw-selftest") === "1";
    localStorage.removeItem("bw-selftest");
    return ok;
  });
  await check("popupWindow", async () => {
    const w = window.open("", "bw-selftest", "popup,width=320,height=220");
    if (!w) return "blocked";
    await new Promise((f) => setTimeout(f, 1500));
    w.document.title = "self-test";
    const ok = w.document.title === "self-test";
    w.close();
    return ok;
  });
  if (location.port === "8073") {
    await check("talksToClearRX", async () => {
      const x = await fetch("http://localhost:8074/api/settings", { cache: "no-store" });
      return x.ok ? "ok: preset " + (await x.json()).preset : "HTTP " + x.status;
    });
    await check("bandWatchServer", async () => (await (await fetch("/healthz")).json()).version);
  }

  const b = document.createElement("button");
  b.style.cssText = "position:fixed;left:0;top:0;width:40px;height:40px;z-index:2147483647;opacity:.01";
  b.onclick = async () => {
    await check("serialPicker", () => {
      if (!navigator.serial) return "no serial API";
      return Promise.race([
        navigator.serial.requestPort().then(() => "port chosen"),
        new Promise((f) => setTimeout(() => f("picker stayed open (it appeared)"), 4000)),
      ]);
    });
    b.remove();
    chrome.webview.postMessage(JSON.stringify(r));
  };
  document.body.appendChild(b);
  await new Promise((f) => setTimeout(f, 300));
  chrome.webview.postMessage("click");
})();
