"use strict";
// Test helpers: a fake upstream (PSK Reporter, NOAA, QRZ) and a way to start either Band Watch server
// against it. BW_SERVER=go runs the tests against the Go build (BandWatch.exe's code) instead of server.js.
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn, execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

/**
 * A fake upstream (kinds: noaa, psk, qrz, pota, sota). `handle(kind, url)` returns:
 *   a string (sent as text), an object/array (sent as JSON), { status } for an HTTP error,
 *   or an Error to drop the connection.
 */
async function startUpstream(handle) {
  const calls = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://upstream");
    calls.push(url.toString());
    const kind = ["psk", "qrz", "pota", "sota"].find((k) => url.pathname.startsWith(`/${k}`)) || "noaa";
    let out;
    try { out = handle(kind, url); } catch (e) { out = e; }
    if (out instanceof Error) { req.socket.destroy(); return; }
    if (out && typeof out === "object" && !Array.isArray(out) && out.status) { res.writeHead(out.status); res.end(); return; }
    if (out === undefined) { res.writeHead(404); res.end(); return; }
    const text = typeof out === "string" ? out : JSON.stringify(out);
    res.writeHead(200, { "Content-Type": typeof out === "string" ? "text/xml" : "application/json" });
    res.end(text);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, calls, close: () => new Promise((r) => server.close(r)) };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on("error", reject);
  });
}

let goBinary = null;
function buildGo() {
  if (goBinary) return goBinary;
  if (process.env.BW_GO_BIN) return (goBinary = process.env.BW_GO_BIN);
  execFileSync("sh", [path.join(ROOT, "desktop", "build.sh"), "test"], { stdio: "inherit" });
  return (goBinary = path.join(ROOT, "desktop", "build", "bandwatch-test"));
}

/** Start a Band Watch server (node or go) pointed at the fake upstream. */
async function startServer(upstreamBase, kind = process.env.BW_SERVER || "node") {
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    BW_TEST: "1",
    BW_NOAA_URL: `${upstreamBase}/noaa`,
    BW_PSK_URL: `${upstreamBase}/psk/query`,
    BW_QRZ_URL: `${upstreamBase}/qrz/xml/current/`,
    BW_POTA_URL: `${upstreamBase}/pota/spot/activator`,
    BW_SOTA_URL: `${upstreamBase}/sota/api/spots/60/all`,
  };
  const child = kind === "go"
    ? spawn(buildGo(), ["--serve"], { env, stdio: ["ignore", "inherit", "inherit"] })
    : spawn(process.execPath, [path.join(ROOT, "server.js")], { env, stdio: ["ignore", "ignore", "inherit"] });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${base}/healthz`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const post = (p) => fetch(base + p, { method: "POST" });
  return {
    base,
    kind,
    reset: () => post("/api/test/reset"),
    advance: (ms) => post(`/api/test/advance?ms=${ms}`),
    stop: () => new Promise((r) => { child.once("exit", r); child.kill(); }),
  };
}

module.exports = { startUpstream, startServer, ROOT };
