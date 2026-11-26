"use strict";
// The hosted web version has no rtl_tcp bridge. Its availability check should answer plainly
// (200, available: false) so browsers don't log a 404 on every page load, while the receiver's
// other routes stay closed.
const test = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

test("web version: /api/sdr says not available, other receiver routes stay closed", async () => {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: "127.0.0.1" };
  delete env.BW_TEST; delete env.BW_SDR; // as on the hosted site: no test hooks, no receiver
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], { env, stdio: ["ignore", "ignore", "inherit"] });
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const r = await fetch(`${base}/api/sdr`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { available: false });

    const stream = await fetch(`${base}/api/sdr/stream?addr=127.0.0.1:1234`, { headers: { "X-Band-Watch": "sdr" } });
    assert.equal(stream.status, 404);
    const launch = await fetch(`${base}/api/sdr/launch`, { method: "POST", headers: { "X-Band-Watch": "sdr", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(launch.status, 404);
  } finally {
    await new Promise((r) => { child.once("exit", r); child.kill(); });
  }
});
