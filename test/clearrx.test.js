"use strict";
// ClearRX by M3VRV, end to end: runs the real ClearRX program (clearrx/build/clearrx-test --serve) and drives its window
// in headless Chrome with a test microphone (Chrome's fake input plays a beeping tone).
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

let chromium;
try { ({ chromium } = require("playwright")); } catch {
  try { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); } catch { /* not installed */ }
}
const skip = !chromium && "Playwright isn't installed";
const exe = path.join(__dirname, "..", "clearrx", "build", "clearrx-test");
const PORT = 18074;
const base = `http://127.0.0.1:${PORT}`;

let proc, browser;
test.before(async () => {
  if (skip) return;
  execFileSync("sh", [path.join(__dirname, "..", "clearrx", "build.sh"), "test"], { stdio: "inherit" });
  assert.ok(fs.existsSync(exe));
  proc = spawn(exe, ["--serve"], { env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + "/healthz")).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome",
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] });
});
test.after(async () => { if (browser) await browser.close(); if (proc) proc.kill(); });

test("ClearRX starts with a test input, the effects run, presets are saved", { skip, timeout: 40000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + "/");
  await page.waitForSelector('#presets button[data-p="cw"]');
  assert.equal(await page.getAttribute('#presets button[data-p="ssb"]', "aria-pressed"), "true", "SSB voice is the first preset");

  await page.click("#power");
  await page.waitForFunction(() => app.running, null, { timeout: 10000 });
  assert.equal(await page.textContent("#power"), "Stop");
  // Sound flows through the worklet: the meters report back
  await page.waitForFunction(() => app.meter.inPeak > -60 && app.meter.outPeak > -90, null, { timeout: 10000 });
  assert.match(await page.textContent("#status"), /Running/);

  // CW preset: the switches follow, and it's kept by ClearRX.exe
  await page.click('#presets button[data-p="cw"]');
  assert.equal(await page.isChecked("#fxCw"), true);
  await page.waitForTimeout(600);
  let s = await (await fetch(base + "/api/settings")).json();
  assert.equal(s.preset, "cw");
  assert.equal(s.cw, true);

  // Changing a switch makes it Custom
  await page.click("#fxNotch");
  await page.waitForTimeout(600);
  s = await (await fetch(base + "/api/settings")).json();
  assert.equal(s.preset, "custom");
  assert.equal(s.notch, true);
  assert.equal(await page.getAttribute('#presets button[data-p="custom"]', "aria-pressed"), "true");

  // Bypass, and the volume
  await page.check("#bypass");
  assert.equal(await page.evaluate(() => app.bypass), true);
  await page.fill("#vol", "150");
  assert.equal(await page.textContent("#volVal"), "150%");

  // Settings come back on a fresh page
  await page.reload();
  await page.waitForSelector('#presets button[data-p="custom"][aria-pressed="true"]');
  assert.equal(await page.isChecked("#fxNotch"), true);
  assert.equal(await page.textContent("#volVal"), "150%");

  // HamShack reading the settings lights "HamShack is using these settings"
  await fetch(base + "/api/settings", { headers: { Origin: "http://localhost:8073" } });
  await page.waitForSelector("#bwLink:not([hidden])", { timeout: 6000 });

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
  assert.deepEqual(errors, []);
});

test("ClearRX My radio: each radio sets its preset and tip, finds its input, and is remembered", { skip, timeout: 40000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/");
  await page.waitForSelector('#radios button[data-r="yaesu"]');
  assert.match(await page.textContent("#radioTip"), /Pick your radio/);
  await page.click("#power");
  await page.waitForFunction(() => app.running, null, { timeout: 10000 });

  // Yaesu: SSB voice, the USB Audio CODEC tip; the test PC has no Yaesu, so it says so
  await page.click('#radios button[data-r="yaesu"]');
  assert.equal(await page.getAttribute('#radios button[data-r="yaesu"]', "aria-pressed"), "true");
  assert.equal(await page.getAttribute('#presets button[data-p="ssb"]', "aria-pressed"), "true");
  assert.match(await page.textContent("#radioTip"), /USB Audio CODEC/);
  assert.match(await page.textContent("#status"), /couldn't find a sound input for your Yaesu/);

  // ATS Mini: AM broadcast, the headphone-lead tip
  await page.click('#radios button[data-r="ats"]');
  assert.equal(await page.getAttribute('#presets button[data-p="am"]', "aria-pressed"), "true");
  assert.match(await page.textContent("#radioTip"), /headphone socket/);

  // Finding the input by its name: an Icom's USB Audio CODEC, an ATS Mini on the line-in
  const found = await page.evaluate(() => {
    const sel = $("inDev");
    for (const [v, t] of [["spk", "Microphone (Realtek)"], ["codec", "Microphone (2- USB Audio CODEC)"], ["line", "Line In (Realtek)"]]) {
      const o = document.createElement("option"); o.value = v; o.textContent = t; sel.append(o);
    }
    return { icom: findInput(RADIOS.find((r) => r.id === "icom")), ats: findInput(RADIOS.find((r) => r.id === "ats")),
      other: findInput(RADIOS.find((r) => r.id === "other")) };
  });
  assert.deepEqual(found, { icom: "codec", ats: "line", other: null });

  // RTL-SDR: points to HamShack's Listen; kept by ClearRX.exe
  await page.click('#radios button[data-r="rtl"]');
  assert.match(await page.textContent("#radioTip"), /Send my RTL-SDR sound through ClearRX/);
  await page.waitForTimeout(600);
  assert.equal((await (await fetch(base + "/api/settings")).json()).radio, "rtl");
  await page.reload();
  await page.waitForSelector('#radios button[data-r="rtl"][aria-pressed="true"]');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(".png", "-radio.png"), fullPage: true });
  assert.deepEqual(errors, []);
});

test("ClearRX rack: modules move and keep their order, the EQ and compressor are kept, presets set the EQ", { skip, timeout: 40000 }, async () => {
  const page = await (await browser.newContext({ viewport: { width: 1000, height: 900 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const saved = async () => { await page.waitForTimeout(600); return (await fetch(base + "/api/settings")).json(); };
  const domOrder = () => page.$$eval("#mods > li", (els) => els.map((e) => e.dataset.mod).join());
  await page.goto(base + "/");
  await page.waitForSelector('#mods [data-mod="eq"]');
  const usual = "nb,voice,cw,mnotch,notch,nr,sq,comp,eq,tone,cmp";
  assert.equal(await domOrder(), usual);
  await page.click("#power");
  await page.waitForFunction(() => app.running, null, { timeout: 10000 });

  // The SSB preset sets the EQ curve; the CW preset another; Off is flat and off
  assert.equal(await page.isChecked("#fxEq"), true);
  assert.equal(await page.getAttribute('[data-eqp="ssb"]', "aria-pressed"), "true");
  await page.click('#presets button[data-p="cw"]');
  assert.equal(await page.getAttribute('[data-eqp="cw"]', "aria-pressed"), "true");
  await page.click('#presets button[data-p="off"]');
  assert.equal(await page.isChecked("#fxEq"), false);
  assert.equal(await page.inputValue('[data-eq="5"]'), "0");

  // An EQ slider: moves the gain, switches the EQ on, makes the preset Custom; it's kept
  await page.locator('[data-eq="5"]').fill("12");
  assert.equal(await page.isChecked("#fxEq"), true);
  assert.equal(await page.textContent('[data-ev="5"]'), "+12");
  let s = await saved();
  assert.equal(s.eq, true);
  assert.equal(s.eqGains[5], 12);
  assert.equal(s.preset, "custom");

  // Compressor / limiter: switch on, set the threshold and ratio, limiter on by default
  await page.click("#fxCmp");
  await page.locator('[data-k="cmpThr"]').fill("-30");
  await page.locator('[data-k="cmpRatio"]').fill("6");
  assert.equal(await page.textContent('[data-o="cmpRatio"]'), "6:1");
  s = await saved();
  assert.deepEqual([s.cmp, s.cmpThr, s.cmpRatio, s.cmpLimit], [true, -30, 6, true]);

  // Move the compressor up two places: the cards, the numbers and the saved order follow, and the keyboard focus stays on the arrow
  await page.click('[data-mod="cmp"] [data-move="-1"]');
  await page.click('[data-mod="cmp"] [data-move="-1"]');
  assert.equal(await domOrder(), "nb,voice,cw,mnotch,notch,nr,sq,comp,cmp,eq,tone");
  assert.equal(await page.textContent('[data-mod="cmp"] .idx'), "9");
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Move Compressor / limiter up");
  assert.equal(await page.isDisabled('[data-mod="nb"] [data-move="-1"]'), true, "the top one can't go up");
  assert.equal(await page.isDisabled('[data-mod="tone"] [data-move="1"]'), true, "the bottom one can't go down");
  assert.equal((await saved()).order.join(), "nb,voice,cw,mnotch,notch,nr,sq,comp,cmp,eq,tone");

  // It all comes back on a fresh page; Reset puts a module back; Default order puts them all back
  await page.reload();
  await page.waitForSelector('#mods [data-mod="eq"]');
  assert.equal(await domOrder(), "nb,voice,cw,mnotch,notch,nr,sq,comp,cmp,eq,tone");
  assert.equal(await page.inputValue('[data-eq="5"]'), "12");
  assert.equal(await page.inputValue('[data-k="cmpThr"]'), "-30");
  await page.click('[data-mod="eq"] [data-reset]');
  assert.equal(await page.inputValue('[data-eq="5"]'), "0");
  await page.click("#resetOrder");
  assert.equal(await domOrder(), usual);
  s = await saved();
  assert.deepEqual([s.order.join(), s.eqGains.join()], [usual, "0,0,0,0,0,0,0,0,0,0"]);

  // The output meter and the narrow layout
  assert.equal(await page.isVisible("#outBar"), true);
  await page.setViewportSize({ width: 360, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "no sideways scrolling on a phone");
  assert.deepEqual(errors, []);
});
