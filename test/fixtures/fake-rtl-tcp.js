"use strict";
// Stands in for rtl_tcp in tests: "rtl_tcp -a 127.0.0.1 -p PORT -d N". Sends the header and silence,
// prints like rtl_tcp does. With FAKE_RTL_DROP_MS set, drops the first connection after that long.
const net = require("net");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const port = Number(opt("-p", 1234));
const host = opt("-a", "127.0.0.1");
let first = true;
const server = net.createServer((sock) => {
  console.log("client accepted!");
  sock.write(Buffer.from([0x52, 0x54, 0x4c, 0x30, 0, 0, 0, 6, 0, 0, 0, 29]));
  const t = setInterval(() => { if (!sock.destroyed) sock.write(Buffer.alloc(38400, 127)); }, 20);
  if (first && process.env.FAKE_RTL_DROP_MS) setTimeout(() => sock.destroy(), Number(process.env.FAKE_RTL_DROP_MS));
  first = false;
  sock.on("close", () => clearInterval(t));
  sock.on("error", () => {});
  sock.on("data", () => {});
});
server.listen(port, host, () => console.log(`Found 1 device(s): 0: RTLSDRBlog, Blog V4, SN: 00000001 (device ${opt("-d", "0")})\nlistening...`));
