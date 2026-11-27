"use strict";
// Round 2 server parts: the chat (chat.js) and the contest calendar (contests.js).
const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

process.env.BW_CHAT_FILE = path.join(os.tmpdir(), `bw-chat-test-${process.pid}.json`); // never the real chat file
const chat = require("../chat.js");
const { parseFeed, parseWhen } = require("../contests.js");

/** Calls a handler with a fake request and collects the reply. */
function call(handler, { method = "GET", url = "/api/chat", body, ip = "10.0.0.1", type = "application/json" } = {}) {
  return new Promise((resolve) => {
    const req = Readable.from(body == null ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]);
    Object.assign(req, { method, headers: { "content-type": type, "x-forwarded-for": ip }, socket: { remoteAddress: ip } });
    const res = { code: 0, headers: null, writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { resolve({ code: this.code, headers: this.headers, json: JSON.parse(b || "{}") }); } };
    handler(req, res, new URL(url, "http://x"));
  });
}

test("chat: post and read back, newest after 'since', plain text only", async () => {
  let t = 1_000_000; chat._reset(() => t);
  const a = await call(chat.handle, { method: "POST", body: { room: "20", call: "m3vrv", text: "  CQ from IO83 <b>hi</b>  " } });
  assert.equal(a.code, 200);
  assert.equal(a.json.message.call, "M3VRV");
  assert.equal(a.json.message.text, "CQ from IO83 <b>hi</b>", "stored as text; the page shows it as text, never HTML");
  t += 4000;
  await call(chat.handle, { method: "POST", body: { room: "20", call: "G4ABC", text: "QSL" }, ip: "10.0.0.2" });
  const all = await call(chat.handle, { url: "/api/chat?room=20" });
  assert.deepEqual(all.json.messages.map((m) => m.text), ["CQ from IO83 <b>hi</b>", "QSL"]);
  const since = await call(chat.handle, { url: `/api/chat?room=20&since=${all.json.messages[0].id}` });
  assert.deepEqual(since.json.messages.map((m) => m.call), ["G4ABC"]);
  assert.equal((await call(chat.handle, { url: "/api/chat?room=general" })).json.messages.length, 0, "rooms are separate");
  assert.equal(all.headers["Cache-Control"], "no-store");
});

test("chat: refuses bad rooms, non-callsigns, empty text, non-JSON and big bodies", async () => {
  chat._reset(() => 2_000_000);
  assert.equal((await call(chat.handle, { url: "/api/chat?room=99" })).code, 400);
  assert.equal((await call(chat.handle, { method: "POST", body: { room: "nope", call: "G4ABC", text: "x" } })).code, 400);
  assert.equal((await call(chat.handle, { method: "POST", body: { call: "HELLO", text: "x" } })).code, 400);
  assert.equal((await call(chat.handle, { method: "POST", body: { call: "G4ABC", text: "\u0007​ " } })).code, 400);
  assert.equal((await call(chat.handle, { method: "POST", body: "call=G4ABC", type: "text/plain" })).code, 415);
  assert.equal((await call(chat.handle, { method: "POST", body: { call: "G4ABC", text: "x".repeat(3000) } })).code, 413);
  assert.equal((await call(chat.handle, { method: "DELETE" })).code, 405);
  assert.equal(chat.cleanText("a‮b\u0000c" + "z".repeat(400)).length, 300);
  assert.ok(chat.CALL_RE.test("EA8/G4ABC") && chat.CALL_RE.test("G4ABC/P") && !chat.CALL_RE.test("ABC"));
});

test("chat: one message every 3 seconds per address, 12 a minute, no instant repeats", async () => {
  let t = 3_000_000; chat._reset(() => t);
  const post = (text, ip = "10.1.1.1", c = "G4ABC") => call(chat.handle, { method: "POST", body: { call: c, text }, ip });
  assert.equal((await post("one")).code, 200);
  assert.equal((await post("two")).code, 429, "too soon");
  t += 3000;
  assert.equal((await post("one")).code, 409, "the same text again within a minute");
  for (let i = 0; i < 11; i++) { t += 3000; assert.equal((await post(`msg ${i}`)).code, 200); }
  t += 3000;
  assert.equal((await post("thirteenth")).code, 429, "12 a minute");
  assert.equal((await post("other person", "10.9.9.9", "M0XYZ")).code, 200, "other addresses aren't held up");
});

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>CQ WW DX Contest, CW</title><link>https://www.contestcalendar.com/contestdetails.php?ref=1</link><description>0000Z, Nov 28 to 2400Z, Nov 29</description></item>
<item><title>ARRL 10-Meter &amp; More</title><link>https://www.contestcalendar.com/contestdetails.php?ref=2</link><description>0000Z-0200Z, Dec 31</description></item>
<item><title>Late night sprint</title><link>https://www.contestcalendar.com/contestdetails.php?ref=3</link><description>2300Z-0100Z, Nov 26</description></item>
<item><title>Not from the calendar</title><link>https://example.com/x</link><description>0000Z-0100Z, Nov 27</description></item>
<item><title><![CDATA[Odd times]]></title><link>https://www.contestcalendar.com/contestdetails.php?ref=4</link><description>See rules</description></item>
</channel></rss>`;

test("chat: three people reporting a message removes it for everyone", async () => {
  let t = 4_000_000; chat._reset(() => t);
  const bad = (await call(chat.handle, { method: "POST", body: { room: "40", call: "G4BAD", text: "rude words" }, ip: "10.9.0.1" })).json.message;
  t += 5000;
  const ok = (await call(chat.handle, { method: "POST", body: { room: "40", call: "G4ABC", text: "73" }, ip: "10.9.0.2" })).json.message;
  const report = (id, ip, room = "40") => call(chat.handle, { method: "POST", body: { room, report: id }, ip });

  const r1 = await report(bad.id, "10.8.0.1");
  assert.equal(r1.code, 200); assert.equal(r1.json.removed, false);
  assert.equal((await report(bad.id, "10.8.0.1")).json.removed, false, "the same person twice counts once");
  let read = (await call(chat.handle, { url: "/api/chat?room=40" })).json;
  assert.equal(read.messages.length, 2);
  assert.ok(read.messages.every((m) => !("r" in m) && Object.keys(m).sort().join() === "call,id,t,text"), "who reported is never sent out");

  await report(bad.id, "10.8.0.2");
  const r3 = await report(bad.id, "10.8.0.3");
  assert.equal(r3.json.removed, true);
  read = (await call(chat.handle, { url: `/api/chat?room=40&since=${ok.id}` })).json;
  assert.deepEqual(read.removed, [bad.id], "people already showing it are told to take it down");
  read = (await call(chat.handle, { url: "/api/chat?room=40" })).json;
  assert.deepEqual(read.messages.map((m) => m.id), [ok.id]);
  assert.equal(read.last, ok.id);

  assert.equal((await report(9999, "10.8.0.4")).code, 404, "unknown message");
  assert.equal((await report(ok.id, "10.8.0.4", "20")).code, 404, "wrong room");
  assert.equal((await report("x", "10.8.0.4")).code, 400);
});

test("chat: made-up addresses at the front of X-Forwarded-For can't pose as more people reporting", async () => {
  let t = 4_500_000; chat._reset(() => t);
  const msg = (await call(chat.handle, { method: "POST", body: { room: "40", call: "G4ABC", text: "73 all" }, ip: "10.9.0.9" })).json.message;
  // One person sends three reports through the proxy, each with a different invented address in front.
  for (const fake of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
    const r = await call(chat.handle, { method: "POST", body: { room: "40", report: msg.id }, ip: `${fake}, 10.5.0.1` });
    assert.equal(r.json.removed, false, "still one person");
  }
  assert.equal((await call(chat.handle, { url: "/api/chat?room=40" })).json.messages.length, 1);
  assert.equal(chat.reporterOf({ headers: { "x-forwarded-for": " 9.9.9.9 , 10.5.0.1 " }, socket: {} }), "10.5.0.1");
  assert.equal(chat.reporterOf({ headers: {}, socket: { remoteAddress: "10.5.0.2" } }), "10.5.0.2");
});

test("chat: reports are rate limited per address", async () => {
  let t = 5_000_000; chat._reset(() => t);
  const ids = [];
  for (let i = 0; i < 12; i++) { ids.push((await call(chat.handle, { method: "POST", body: { room: "20", call: "G4ABC", text: `m${i}` }, ip: `10.7.0.${i}` })).json.message.id); }
  const codes = [];
  for (const id of ids) codes.push((await call(chat.handle, { method: "POST", body: { room: "20", report: id }, ip: "10.6.0.1" })).code);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.equal(codes[10], 429);
  t += 61_000;
  assert.equal((await call(chat.handle, { method: "POST", body: { room: "20", report: ids[11] }, ip: "10.6.0.1" })).code, 200);
});

test("contests: reads the WA7BNM feed, works out UTC times and the year, keeps only its own links", () => {
  const ref = Date.UTC(2026, 10, 26, 12);
  const c = parseFeed(RSS, ref);
  assert.deepEqual(c.map((x) => x.name), ["CQ WW DX Contest, CW", "ARRL 10-Meter & More", "Late night sprint", "Odd times"]);
  assert.equal(c[0].start, Date.UTC(2026, 10, 28, 0, 0));
  assert.equal(c[0].end, Date.UTC(2026, 10, 30, 0, 0), "2400Z is midnight at the end of the day");
  assert.equal(c[1].start, Date.UTC(2026, 11, 31, 0, 0));
  assert.equal(c[2].end - c[2].start, 2 * 3600e3, "runs past midnight");
  assert.equal(c[3].start, null, "times it can't read are left for the link");
  assert.deepEqual(parseWhen("0000Z-0100Z, Jan 2", Date.UTC(2026, 11, 30)), { start: Date.UTC(2027, 0, 2), end: Date.UTC(2027, 0, 2, 1) }, "the nearest year");
  assert.deepEqual(parseFeed("not xml"), []);
});
