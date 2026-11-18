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

  // Band Watch reading the settings lights "Band Watch is using these settings"
  await fetch(base + "/api/settings", { headers: { Origin: "http://localhost:8073" } });
  await page.waitForSelector("#bwLink:not([hidden])", { timeout: 6000 });

  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
  assert.deepEqual(errors, []);
});
