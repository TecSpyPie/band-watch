"use strict";
// End-to-end test: runs the real server with mocked feeds and drives the page in headless Chrome.
const test = require("node:test");
const assert = require("node:assert/strict");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  try { ({ chromium } = require("/opt/npm-tools/node_modules/playwright")); } catch { /* not installed */ }
}
const { startUpstream, startServer } = require("./helpers.js");

const nowSec = () => Math.floor(Date.now() / 1000);
let feed = {};

/** Build PSK Reporter XML: counts per frequency (MHz), half heard by us, half hearing us. */
function pskXml(counts) {
  const locs = ["FN42", "EM10", "JO62", "KP20", "PM95", "QF56", "GG66", "JN45", "KN03", "DM79"];
  let n = 0;
  const rows = [];
  for (const [mhz, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i++) {
      n++;
      const mine = i % 2 === 0;
      const loc = locs[n % locs.length];
      rows.push(`<receptionReport receiverCallsign="${mine ? `RX${n}` : "G0AAA"}" receiverLocator="${mine ? loc : "IO93ab"}" ` +
        `senderCallsign="${mine ? "G4XYZ" : `TX${n}`}" senderLocator="${mine ? "IO93fa" : loc}" frequency="${Math.round((+mhz + (i % 30) * 0.0001) * 1e6)}" ` +
        `flowStartSeconds="${nowSec() - (i % 25) * 60}" mode="FT8" sNR="${i % 5 ? -15 + (i % 20) : ""}" />`);
    }
  }
  return `<receptionReports>${rows.join("")}</receptionReports>`;
}

const SUN = {
  regions: [
    { observed_date: "2026-11-16", region: 4579, latitude: 15, longitude: 45, location: "N15E45", area: 170, number_spots: 6, spot_class: "Dai", mag_class: "BG", c_xray_events: 2, m_xray_events: 1, c_flare_probability: 50, m_flare_probability: 45, x_flare_probability: 5 },
    { observed_date: "2026-11-16", region: 4577, latitude: -6, longitude: -27, location: "S06W27", area: 20, number_spots: 2, spot_class: "Cso", mag_class: "B", c_flare_probability: 15, m_flare_probability: 1, x_flare_probability: 1 },
  ],
  ssn: [{ Obsdate: "2026-11-15T00:00:00", swpc_ssn: 88 }],
  flares: [{ current_class: "B6.3", max_class: "M1.2", max_time: "2026-11-16T11:36:00Z" }],
  scales: { 0: { R: { Scale: "1" }, S: { Scale: "0" }, G: { Scale: "0" } } },
  wind: [{ proton_speed: 412 }],
};

/** The fake PSK Reporter, NOAA and QRZ the server talks to during these tests. */
function upstreamHandler(kind, url) {
  if (kind === "qrz") {
    const q = url.searchParams;
    const xml = (inner) => `<QRZDatabase>${inner}</QRZDatabase>`;
    if (q.has("username")) {
      return q.get("password") === "secret"
        ? xml("<Session><Key>K</Key><SubExp>Thu Dec 31 2026</SubExp></Session>")
        : xml("<Session><Error>Username/password incorrect</Error></Session>");
    }
    const call = q.get("callsign");
    (feed.qrzLookups ||= []).push(call);
    return xml(`<Callsign><call>${call}</call><fname>Test</fname><name>Operator</name><addr2>Tokyo</addr2><country>Japan</country><grid>PM95</grid><lat>35.5</lat><lon>139</lon><lotw>1</lotw><TimeZone>Asia/Tokyo</TimeZone></Callsign><Session><Key>K</Key></Session>`);
  }
  if (kind === "psk") {
    (feed.pskCalls ||= []).push(url.toString());
    return feed.pskDown ? new Error("down") : feed.psk;
  }
  const p = url.pathname;
  if (p.endsWith("solar_regions.json")) return feed.sunDown ? { status: 503 } : SUN.regions;
  if (p.endsWith("swpc_observed_ssn.json")) return SUN.ssn;
  if (p.endsWith("xray-flares-latest.json")) return SUN.flares;
  if (p.endsWith("noaa-scales.json")) return SUN.scales;
  if (p.endsWith("solar-wind-speed.json")) return SUN.wind;
  if (feed.solarDown) return new Error("down");
  return p.includes("f107") ? [{ time_tag: "t", flux: 113 }] : [{ time_tag: "t", kp_index: 0.33 }];
}

let srv, upstream, base, browser;
test.before(async () => {
  upstream = await startUpstream((kind, url) => upstreamHandler(kind, url));
  srv = await startServer(upstream.base);
  base = srv.base;
  if (chromium) browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome" });
});
test.after(async () => { if (browser) await browser.close(); await srv.stop(); await upstream.close(); });

async function openPage(t, setup) {
  await srv.reset();
  feed = { pskCalls: [], qrzLookups: [], psk: pskXml({ 14.074: 40, 7.074: 60, 21.074: 3, 28.074: 8 }), pskDown: false, solarDown: false, ...setup };
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 1400 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)/.test(m.location().url || "")) errors.push(m.text()); });
  page.on("requestfailed", (r) => { if (!/fonts\.|unpkg\.com|tile\.openstreetmap|sdo\.gsfc|websdr|about:blank/.test(r.url())) errors.push(`request failed: ${r.url()}`); });
  t.after(() => page.context().close());
  await page.context().route("https://www.qrz.com/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>QRZ</title>" }));
  await page.goto(base + "/");
  await page.waitForFunction(() => document.getElementById("banner").textContent !== "Loading live data…");
  return { page, errors };
}

const skip = !chromium && "Playwright is not installed";

test("loads live data with no errors", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  assert.equal(await page.title(), "Band Watch by M3vrv");
  assert.equal((await page.textContent("h1")).replace(/\s+/g, " "), "Band Watch by M3vrv");
  assert.match(await page.textContent("#banner"), /^Live spots for grid IO93, updated just now\.$/);
  assert.match(await page.textContent("#hero"), /40 m is your best band/);
  assert.equal(await page.textContent("#mapTitle"), "40 m spots", "map follows the best band");
  assert.match(await page.textContent("#solar"), /113.*Solar flux index.*0.*Kp index, Quiet/s);
  const rows = await page.$$eval("#bands tr", (r) => r.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
  assert.equal(rows.length, 11, "11 bands, including 60 m");
  assert.match(rows.find((r) => r.startsWith("20 m")), /40 .* Open$/);
  assert.match(rows.find((r) => r.startsWith("15 m")), /3 .* Closed$/);
  assert.match(rows.find((r) => r.startsWith("10 m")), /8 .* Marginal$/);
  assert.match(rows.find((r) => r.startsWith("6 m")), /0 none Closed$/);
  assert.equal(await page.$eval("link[rel=icon]", (l) => l.href), base + "/favicon.svg");
  assert.deepEqual(errors, []);
});

test("band selection drives the map, spot list and scope", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.click('#bands tr[data-b="20"]');
  assert.equal(await page.textContent("#mapTitle"), "20 m spots");
  assert.equal(await page.textContent("#scopeTitle"), "20 m band scope");
  assert.equal(await page.$$eval("#map circle", (c) => c.length), 41, "40 spots plus home");
  assert.equal(await page.$$eval("#spots li", (l) => l.length), 10);
  assert.match(await page.textContent("#spots li"), /(hears your grid|heard in your grid)/);

  await page.click('#scopeSpan button[data-s="ft8"]');
  const box = await page.locator("#scope").boundingBox();
  await page.mouse.move(box.x + box.width * ((14.0747 - 14.074) / 0.003), box.y + 50); // a sample signal sits at 14.0747
  assert.match(await page.textContent("#scopeRead"), /14,074\.\d+ kHz Listen here · Data · \d+ stations?:/);
  await page.focus("#scope");
  await page.keyboard.press("Escape");
  assert.match(await page.textContent("#scopeRead"), /Hover, tap or use the arrow keys/);

  await page.click('#scopeBands button[data-b="6"]');
  assert.equal(await page.textContent("#mapTitle"), "6 m spots");
  assert.match(await page.textContent("#scopeNote"), /No stations spotted/);
  assert.deepEqual(errors, []);
});

test("monitor alerts when a watched band opens, and remembers settings", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  assert.match(await page.textContent("#mon"), /15 mClosed for under a minute3 spots/);
  await page.click('#chips button[data-b="40"]');
  assert.equal(await page.getAttribute('#chips button[data-b="40"]', "aria-pressed"), "true");

  // 15 m goes from 3 spots to 20: refresh and expect an alert.
  feed.psk = pskXml({ 14.074: 40, 7.074: 60, 21.074: 20, 28.074: 8 });
  await srv.reset();
  await page.evaluate(() => refresh());
  await page.waitForSelector("#toast.on");
  assert.match(await page.textContent("#toast"), /15 m just opened20 stations spotted/);
  assert.match(await page.textContent("#mlog"), /15 m went from Closed to Open/);
  assert.match(await page.textContent("#mon"), /15 mOpen for under a minute20 spots/);

  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.getAttribute('#chips button[data-b="40"]', "aria-pressed"), "true", "watched bands persist");
  assert.match(await page.textContent("#mlog"), /15 m went from Closed to Open/, "log persists");
  assert.deepEqual(errors, []);
});

test("changing grid square fetches that square and validates input", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.fill("#grid", "ZZ");
  await page.dispatchEvent("#grid", "change");
  assert.match(await page.textContent("#gerr"), /Enter a locator like IO93 or IO93fa/);

  await page.fill("#grid", "JO62qm");
  await page.dispatchEvent("#grid", "change");
  await page.waitForFunction(() => document.getElementById("banner").textContent.includes("JO62"));
  assert.equal(await page.textContent("#gerr"), "");
  assert.ok(feed.pskCalls.some((u) => u.includes("callsign=JO62")));
  assert.deepEqual(errors, []);
});

test("shows a clear state when the spot feed is down", { skip }, async (t) => {
  const { page, errors } = await openPage(t, { pskDown: true, solarDown: true });
  assert.match(await page.textContent("#banner"), /could not be loaded from PSK Reporter/);
  assert.match(await page.textContent("#hero"), /Live data unavailable/);
  assert.match(await page.textContent("#solar"), /–Solar flux index/);
  assert.match(await page.textContent("#bands"), /No data/);
  assert.match(await page.textContent("#mon"), /No data.*Waiting for live spots/s);
  assert.equal(await page.$eval("#toast", (el) => el.classList.contains("on")), false, "no false alert");
  // The page's own fetches to /api fail with 502; those are expected here.
  assert.deepEqual(errors.filter((e) => !/502/.test(e)), []);
});

test("callsign lookup", { skip }, async (t) => {
  const { page } = await openPage(t);
  await page.fill("#call", "ea8/g4abc");
  await page.click("#lk button");
  assert.match(await page.textContent("#lkout"), /EA8\/G4ABC: prefix suggests England\. View G4ABC on QRZ\.com/);
  assert.equal(await page.$eval("#station", (d) => d.open), true, "the lookup opens the station window");
  assert.equal(await page.textContent("#qcTitle"), "G4ABC");
  assert.match(await page.textContent("#stSub"), /^England$/);
  await page.keyboard.press("Escape");
  await page.fill("#call", "hello");
  await page.click("#lk button");
  assert.match(await page.textContent("#lkout"), /doesn’t look like a callsign/);
});

test("works on a phone-sized screen in dark mode", { skip }, async (t) => {
  await srv.reset();
  feed = { pskCalls: [], psk: pskXml({ 14.074: 20 }) };
  const page = await browser.newPage({ viewport: { width: 380, height: 800 }, colorScheme: "dark" });
  t.after(() => page.close());
  await page.route("https://www.qrz.com/**", (r) => r.fulfill({ body: "" }));
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/");
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  const clipped = await page.$eval(".scroll", (el) => el.scrollWidth - el.clientWidth);
  assert.ok(clipped <= 0, `band table is cut off by ${clipped}px`);
  assert.equal(await page.textContent("#mapTitle"), "20 m spots", "selects the best band once data arrives");
  assert.equal(await page.isVisible("#actRows a.call >> nth=0"), true, "activity callsigns stay visible on phones");
  assert.equal(await page.isVisible("#bands tr >> nth=0 >> td >> nth=1"), false, "band table drops its bar column on phones");
  await page.screenshot({ path: "/tmp/bw-mobile-dark.png", fullPage: true });
  assert.deepEqual(errors, []);
});

test("world clock shows cities, day or night, and remembers changes", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const cities = () => page.$$eval("#wclock .wcc .city", (c) => c.map((x) => x.textContent));
  assert.deepEqual(await cities(), ["UTC", "Your time", "New York", "Tokyo", "Sydney"]);
  const utc = await page.textContent('#wclock .wcc[data-id="UTC"] .t');
  const now = new Date();
  const expect = [now, new Date(now - 60e3)].map((d) => d.toISOString().slice(11, 16));
  assert.ok(expect.includes(utc), `UTC clock shows ${utc}`);
  assert.match(await page.textContent('#wclock .wcc[data-id="Tokyo"] .d'), /· UTC\+9$/);
  assert.match(await page.textContent('#wclock .wcc[data-id="Tokyo"] .sun'), /^(Daylight|Night|Greyline)$/);
  assert.equal(await page.$('#wclock .wcc[data-id="UTC"] .rm'), null, "UTC cannot be removed");

  await page.selectOption("#wcAdd", "Honolulu");
  await page.click('#wclock [data-rm="Sydney"]');
  assert.deepEqual(await cities(), ["UTC", "Your time", "New York", "Tokyo", "Honolulu"]);
  assert.match(await page.textContent('#wclock .wcc[data-id="Honolulu"] .d'), /UTC-10$/);
  await page.reload();
  await page.waitForSelector('#wclock .wcc[data-id="Honolulu"]');
  assert.deepEqual(await cities(), ["UTC", "Your time", "New York", "Tokyo", "Honolulu"]);
  assert.deepEqual(errors, []);
});

test("band activity window lists, filters and highlights new spots", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const rowCount = () => page.$$eval("#actRows tr", (r) => r.length);
  assert.match(await page.textContent("#actCount"), /^Showing 100 of 111 spots$/);
  assert.equal(await rowCount(), 100);
  assert.equal(await page.isVisible("#actMore"), true);
  await page.click("#actMore");
  assert.equal(await rowCount(), 111);

  await page.click('#actBands button[data-b="10"]');
  assert.match(await page.textContent("#actCount"), /^Showing 8 of 8 spots$/);
  assert.match(await page.textContent('#actBands button[data-b="10"]'), /10 m \(8\)/);
  const bands = await page.$$eval("#actRows tr td:nth-child(3)", (c) => [...new Set(c.map((x) => x.textContent))]);
  assert.deepEqual(bands, ["10 m"]);

  await page.click('#actBands button[data-b="all"]');
  await page.selectOption("#actDir", "heard in your grid");
  const dirs = await page.$$eval("#actRows tr td:nth-child(8)", (c) => [...new Set(c.map((x) => x.textContent))]);
  assert.deepEqual(dirs, ["heard in your grid"]);
  await page.selectOption("#actDir", "all");

  await page.fill("#actQ", "rx1");
  const calls = await page.$$eval("#actRows td:nth-child(2) a.call", (a) => a.map((x) => x.textContent));
  assert.ok(calls.length > 0 && calls.every((c) => c.startsWith("RX1")), calls.join());
  const href = await page.getAttribute("#actRows a.call", "href");
  assert.match(href, /^https:\/\/www\.qrz\.com\/db\/RX1\d*$/);
  await page.fill("#actQ", "");

  // Newer spots arrive: they are highlighted.
  feed.psk = pskXml({ 14.074: 40, 7.074: 60, 21.074: 3, 28.074: 8, 18.1: 4 });
  await srv.reset();
  await page.evaluate(() => refresh());
  await page.waitForFunction(() => document.getElementById("actCount").textContent.includes("new"));
  assert.ok((await page.$$("#actRows tr.new")).length > 0);
  assert.deepEqual(errors, []);
});

test("clicking a callsign opens the station window; QRZ.com is one click away", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const first = page.locator("#actRows a.call").first();
  const call = await first.getAttribute("data-call");
  await first.click();
  assert.equal(await page.$eval("#station", (d) => d.open), true);
  assert.equal(await page.textContent("#qcTitle"), call);
  assert.equal(await page.getAttribute("#stFoot a.go", "href"), `https://www.qrz.com/db/${call}`);
  const [popup] = await Promise.all([page.context().waitForEvent("page"), page.click("#stFoot a.go")]);
  await popup.waitForLoadState();
  assert.equal(popup.url(), `https://www.qrz.com/db/${call}`);
  await page.keyboard.press("Escape");

  // Ctrl-click is left to the browser (opens QRZ.com in a new tab) instead of opening the window.
  const prevented = await page.$eval("#spots a.call", (a) => {
    const e = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    a.addEventListener("click", (ev) => ev.preventDefault(), { once: true }); // stop the real navigation in the test
    document.addEventListener("click", (ev) => { window.__defaultWasPrevented = ev.defaultPrevented; }, { once: true });
    a.dispatchEvent(e);
    return document.getElementById("station").open;
  });
  assert.equal(prevented, false, "Ctrl-click does not open the station window");
  assert.match(await page.getAttribute("#spots a.call", "href"), /^https:\/\/www\.qrz\.com\/db\//);
  assert.deepEqual(errors.filter((e) => !/unpkg|tile\.openstreetmap/.test(e)), []);
});

test("QRZ login window, callsign card and logout", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  assert.equal(await page.textContent("#qrzBtn"), "Log in to QRZ");
  await page.click("#qrzBtn");
  assert.equal(await page.$eval("#qrzLogin", (d) => d.open), true);

  await page.fill("#qlUser", "m3vrv");
  await page.fill("#qlPass", "wrong");
  await page.click("#qlSubmit");
  await page.waitForFunction(() => document.getElementById("qlErr").textContent.includes("did not accept"));
  assert.equal(await page.$eval("#qrzLogin", (d) => d.open), true);

  await page.fill("#qlPass", "secret");
  await page.click("#qlSubmit");
  await page.waitForFunction(() => document.getElementById("qrzBtn").textContent === "QRZ: M3VRV");
  assert.equal(await page.$eval("#qrzLogin", (d) => d.open), false);
  await page.waitForFunction(() => document.getElementById("grid").value === "PM95" && document.getElementById("banner").textContent.includes("PM95"));
  await page.waitForSelector("#actRows a.call");
  assert.equal(await page.inputValue("#qlPass"), "", "password is cleared");
  const cookies = await page.context().cookies();
  assert.equal(cookies.find((c) => c.name === "bw_qrz").httpOnly, true);
  assert.equal(await page.evaluate(() => document.cookie), "", "the page cannot read the QRZ cookie");

  // Signed in: a callsign click opens the station window with QRZ details, not a new tab.
  let popups = 0;
  page.context().on("page", () => popups++);
  const link = page.locator("#actRows a.call").first();
  const call = await link.getAttribute("data-call");
  await link.click();
  await page.waitForFunction(() => document.querySelector("#qcBody dl"));
  assert.equal(await page.textContent("#qcTitle"), call);
  const card = (await page.textContent("#qcBody")).replace(/\s+/g, " ");
  assert.match(card, /NameTest Operator/);
  assert.match(card, /LocationTokyo, Japan/);
  assert.match(card, /GridPM95/);
  assert.match(card, /QSLLoTW/);
  await page.waitForFunction(() => document.getElementById("stTzNote").textContent === "Time zone from QRZ.");
  assert.match(await page.textContent("#stPath"), /from your locator · beam heading \d+° short path/);
  assert.equal(await page.getAttribute("#stFoot a.go", "href"), `https://www.qrz.com/db/${call}`);
  assert.equal(popups, 0);
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#station", (d) => d.open), false);

  // Lookup box uses QRZ too.
  await page.fill("#call", "G4ABC");
  await page.click("#lk button");
  await page.waitForFunction(() => document.getElementById("qcTitle").textContent === "G4ABC" && document.querySelector("#qcBody dl"));
  await page.click("#qcClose");

  // Session survives a reload, then log out.
  await page.reload();
  await page.waitForFunction(() => document.getElementById("qrzBtn").textContent === "QRZ: M3VRV");
  await page.click("#qrzBtn");
  assert.match(await page.textContent("#qlIn"), /Signed in to QRZ as M3VRV/);
  await page.click("#qlLogout");
  await page.waitForFunction(() => document.getElementById("qrzBtn").textContent === "Log in to QRZ");
  // The one deliberate wrong-password attempt is logged by the browser as a 401; nothing else may fail.
  assert.deepEqual(errors.filter((e) => !/status of 401/.test(e)), []);
  assert.equal(errors.length, 1);
});

test("your callsign box: validates, remembers, marks and filters your spots", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  assert.equal(await page.isHidden("#mySummary"), true, "no summary until a callsign is set");
  assert.equal(await page.isDisabled("#actMine"), true);

  await page.fill("#mycall", "hello");
  await page.dispatchEvent("#mycall", "change");
  assert.match(await page.textContent("#cerr"), /doesn’t look like a callsign/);

  // In the sample data G4XYZ is the local station on every "hears your grid" path.
  await page.fill("#mycall", "g4xyz/p");
  await page.dispatchEvent("#mycall", "change");
  assert.equal(await page.textContent("#cerr"), "");
  assert.equal(await page.inputValue("#mycall"), "G4XYZ/P");
  const sum = await page.textContent("#mySummary");
  assert.match(sum, /^G4XYZ in the last 30 minutes: heard by 56 stations on 40 m, 20 m, 15 m, 10 m, the farthest \w+ at [\d,]+ km\.$/);
  assert.ok((await page.$$("#actRows tr.mine")).length > 0, "your spots are marked");
  assert.match(await page.textContent("#actRows tr.mine"), /G4XYZyou/);

  await page.check("#actMine");
  assert.match(await page.textContent("#actCount"), /^Showing 56 of 56 spots$/);
  const locals = await page.$$eval("#actRows td:nth-child(9)", (c) => [...new Set(c.map((x) => x.textContent))]);
  assert.deepEqual(locals, ["G4XYZyou"]);

  // The same stations reporting again: no alert.
  await page.evaluate(() => refresh());
  feed.psk = pskXml({ 14.074: 40, 7.074: 60, 21.074: 3, 28.074: 8 });
  await srv.reset();
  await page.evaluate(() => refresh());
  assert.equal(await page.$eval("#toast", (el) => el.classList.contains("on")), false, "repeat reports don't alert");
  // Three stations that weren't hearing you before (the new 17 m spots): alert.
  feed.psk = pskXml({ 14.074: 40, 7.074: 60, 21.074: 3, 28.074: 8, 18.1: 6 });
  await srv.reset();
  await page.evaluate(() => refresh());
  await page.waitForSelector("#toast.on");
  assert.match(await page.textContent("#toast"), /^G4XYZ was heard3 new stations: RX\d+, RX\d+, RX\d+$/);

  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.inputValue("#mycall"), "G4XYZ/P", "callsign is remembered");
  assert.match(await page.textContent("#mySummary"), /^G4XYZ in the last 30 minutes/);

  await page.fill("#mycall", "");
  await page.dispatchEvent("#mycall", "change");
  assert.equal(await page.isHidden("#mySummary"), true, "clearing the box removes your callsign");
  assert.equal(await page.$$eval("#actRows tr.mine", (r) => r.length), 0);
  assert.deepEqual(errors, []);
});

test("an unknown callsign gets a helpful summary, and QRZ login fills an empty box", { skip }, async (t) => {
  const { page } = await openPage(t);
  await page.fill("#mycall", "M3VRV");
  await page.dispatchEvent("#mycall", "change");
  assert.match(await page.textContent("#mySummary"), /^M3VRV: no spots in the last 30 minutes from grid IO93\./);
  await page.fill("#mycall", "");
  await page.dispatchEvent("#mycall", "change");

  await page.click("#qrzBtn");
  await page.fill("#qlUser", "m3vrv");
  await page.fill("#qlPass", "secret");
  await page.click("#qlSubmit");
  await page.waitForFunction(() => document.getElementById("mycall").value === "M3VRV");
});

test("locator options: manual 6-character locator, device location and QRZ", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 35.68, longitude: 139.69 }); // Tokyo

  await page.click("#locBtn");
  assert.equal(await page.$eval("#locDlg", (d) => d.open), true);
  assert.equal(await page.inputValue("#locIn"), "IO93");
  assert.match(await page.textContent("#locInfo"), /^Grid square IO93 · 53\.50°N, 1\.00°W · accurate to about 100 km$/);
  await page.fill("#locIn", "IO9");
  assert.match(await page.textContent("#locInfo"), /Enter 4 or 6 characters/);
  await page.click("#locSave");
  assert.match(await page.textContent("#locErr"), /Enter a locator/);

  await page.fill("#locIn", "io93FA");
  assert.match(await page.textContent("#locInfo"), /Grid square IO93 · 53\.02°N, 1\.54°W · accurate to about 5 km/);
  await page.click("#locSave");
  assert.equal(await page.inputValue("#grid"), "IO93fa", "saved and tidied to IO93fa");
  assert.equal(feed.pskCalls.filter((u) => u.includes("callsign=JO")).length, 0);

  // Device location
  await page.click("#locBtn");
  await page.click("#locGeo");
  await page.waitForFunction(() => document.getElementById("locIn").value === "PM95uq");
  assert.match(await page.textContent("#locInfo"), /^From this device’s location\. Grid square PM95/);
  await page.click("#locSave");
  await page.waitForFunction(() => document.getElementById("banner").textContent.includes("PM95"));
  assert.ok(feed.pskCalls.some((u) => u.includes("callsign=PM95")), "spots fetched for the new square");

  // QRZ button before signing in
  await page.click("#locBtn");
  await page.click("#locQrz");
  assert.match(await page.textContent("#locErr"), /Log in to QRZ first/);
  await page.click("#locClose");

  // Turn off "set from QRZ on login", then sign in: locator must stay put.
  await page.click("#locBtn");
  await page.uncheck("#locAuto");
  await page.fill("#locIn", "IO93fa");
  await page.click("#locSave");
  await page.click("#qrzBtn");
  await page.fill("#qlUser", "m3vrv");
  await page.fill("#qlPass", "secret");
  await page.click("#qlSubmit");
  await page.waitForFunction(() => document.getElementById("qrzBtn").textContent === "QRZ: M3VRV");
  await page.waitForTimeout(500);
  assert.equal(await page.inputValue("#grid"), "IO93fa", "auto-set is off, so the locator is unchanged");

  // The QRZ button fills the box from the user's own QRZ entry (the mock says PM95).
  await page.click("#locBtn");
  assert.equal(await page.isChecked("#locAuto"), false, "the choice is remembered");
  await page.click("#locQrz");
  await page.waitForFunction(() => document.getElementById("locIn").value === "PM95");
  assert.match(await page.textContent("#locInfo"), /^From M3VRV's QRZ profile\. Grid square PM95/);
  await page.click("#locClose");
  assert.equal(await page.inputValue("#grid"), "IO93fa", "cancel keeps the old locator");
  assert.deepEqual(errors, []);
});

test("locator is set from QRZ automatically on login (default)", { skip }, async (t) => {
  const { page } = await openPage(t);
  await page.click("#qrzBtn");
  await page.fill("#qlUser", "m3vrv");
  await page.fill("#qlPass", "secret");
  await page.click("#qlSubmit");
  await page.waitForFunction(() => document.getElementById("grid").value === "PM95");
  await page.waitForSelector("#toast.on");
  assert.match(await page.textContent("#toast"), /^Locator set from QRZPM95, from M3VRV's QRZ profile\.$/);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.inputValue("#grid"), "PM95", "remembered after reload");
});

test("world clock can follow the busiest areas", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const cards = () => page.$$eval("#wclock .wcc", (c) => c.map((x) => ({ id: x.dataset.id, act: x.querySelector(".wact")?.textContent || "", rm: !!x.querySelector(".rm") })));
  await page.check("#wcAuto");
  const auto = await cards();
  assert.deepEqual(auto.slice(0, 2).map((c) => c.id), ["UTC", "local"]);
  assert.equal(auto.length, 6, "UTC, your time and the four busiest cities");
  const counts = auto.slice(2).map((c) => Number(c.act.replace(/\D/g, "")));
  assert.ok(counts.every((n) => n > 0), JSON.stringify(auto));
  assert.deepEqual([...counts].sort((a, b) => b - a), counts, "busiest first");
  assert.ok(auto.every((c) => !c.rm), "no remove buttons in automatic mode");
  assert.equal(await page.isDisabled("#wcAdd"), true);

  // The busiest cities follow the spots.
  feed.psk = pskXml({ 14.074: 3 });
  await srv.reset();
  await page.evaluate(() => refresh());
  await page.waitForFunction(() => document.querySelectorAll("#wclock .wcc").length <= 5);

  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.isChecked("#wcAuto"), true, "the mode is remembered");
  await page.uncheck("#wcAuto");
  assert.deepEqual((await cards()).map((c) => c.id), ["UTC", "local", "New York", "Tokyo", "Sydney"], "back to your own list");
  assert.deepEqual(errors, []);
});

/* A tiny stand-in for Leaflet, so the street-map code can be checked without the internet. */
const FAKE_LEAFLET = `
window.__leaflet = { calls: [] };
(function () {
  const rec = (name, args) => window.__leaflet.calls.push([name, args]);
  const layer = (name, args) => { rec(name, args); const o = { addTo() { return o; }, bindTooltip(t) { rec("tooltip", [t]); return o; } }; return o; };
  window.L = {
    map(el, opts) { rec("map", [el.id]); const m = { fitBounds(b) { rec("fitBounds", [b]); }, invalidateSize() { rec("invalidateSize", []); }, remove() { rec("remove", []); } }; return m; },
    tileLayer(url) { return layer("tileLayer", [url]); },
    polyline(pts, o) { return layer("polyline", [pts.length, o.color]); },
    circleMarker(ll) { return layer("circleMarker", [ll]); },
    latLngBounds(pts) { return { n: pts.length }; },
  };
})();`;

test("station window: transmitting station time, map, listen links and recent spots", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.context().route("https://unpkg.com/**", (r) => r.request().url().endsWith(".js")
    ? r.fulfill({ contentType: "text/javascript", body: FAKE_LEAFLET })
    : r.fulfill({ contentType: "text/css", body: "" }));
  // Pick a 20 m FT8 station whose locator is in Japan (PM95 in the sample data).
  await page.click('#actBands button[data-b="20"]');
  const call = await page.evaluate(() => app.pairs.find((p) => p.band === "20" && p.g === "PM95" && p.dir === "heard in your grid").c);
  await page.evaluate((c) => openStation(c), call);
  await page.waitForFunction(() => document.getElementById("stTime").textContent !== "--:--:--");

  assert.equal(await page.textContent("#stTimeH"), "Transmitting station time");
  const shown = await page.textContent("#stTime");
  const tokyo = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(d);
  const now = Date.now();
  assert.ok([tokyo(now), tokyo(now - 1000), tokyo(now - 2000)].includes(shown), `station time ${shown} should be Tokyo time`);
  assert.match(await page.textContent("#stDate"), /· UTC\+9$/);
  assert.match(await page.textContent("#stTzNote"), /estimated from the station’s location \(near Tokyo\)/);
  assert.match(await page.textContent("#stSun"), /^(Daylight|Night|Greyline) at the station$/);
  assert.match(await page.textContent("#stSub"), /PM95$/);

  // The clock ticks.
  await page.waitForFunction((before) => document.getElementById("stTime").textContent !== before, shown, { timeout: 3000 });

  // Map: Leaflet stand-in with OSM tiles, the great-circle path and both stations.
  await page.waitForFunction(() => window.__leaflet && window.__leaflet.calls.some((c) => c[0] === "fitBounds"));
  const calls = await page.evaluate(() => window.__leaflet.calls);
  assert.deepEqual(calls.find((c) => c[0] === "tileLayer")[1], ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"]);
  assert.equal(calls.find((c) => c[0] === "polyline")[1][0], 65, "great-circle path");
  assert.deepEqual(calls.filter((c) => c[0] === "tooltip").map((c) => c[1][0]), ["You", call]);
  assert.match(await page.textContent("#stPath"), /^[\d,]+ km \([\d,]+ miles\) from your locator · beam heading \d+° short path, \d+° long path · locator PM95$/);
  const [sp, lp] = (await page.textContent("#stPath")).match(/(\d+)° short path, (\d+)° long path/).slice(1).map(Number);
  assert.equal((sp + 180) % 360, lp);
  assert.ok(sp > 0 && sp < 90, `Japan is north-east of England, got ${sp}°`);

  // Listen: WebSDR tuned to the FT8 dial frequency, with an honest note about FT8.
  assert.equal(await page.textContent("#stTune"), "Listen on 14,074 kHz USB");
  assert.match(await page.textContent("#stListenNote"), /FT8 is a data mode, so you’ll hear tones rather than speech/);
  assert.match(await page.textContent("#stListen"), /Find a KiwiSDR near/);
  assert.match(await page.textContent("#stSpots"), /20 m, 14,07\d\.\d kHz/);
  assert.match(await page.textContent("#qcBody"), /Log in to QRZ to see/);

  await page.click("#qcClose");
  await page.waitForFunction(() => station.timer === null, null, { timeout: 2000 }); // clock stops when the window closes
  assert.ok((await page.evaluate(() => window.__leaflet.calls)).some((c) => c[0] === "remove"), "map is cleaned up");
  assert.deepEqual(errors, []);
});

test("station window without the street map still shows a simple map", { skip }, async (t) => {
  const { page } = await openPage(t);
  await page.context().route("https://unpkg.com/**", (r) => r.abort());
  const call = await page.getAttribute("#actRows a.call", "data-call");
  await page.click("#actRows a.call >> nth=0");
  await page.waitForFunction(() => document.getElementById("stPath").textContent.includes("couldn’t load"));
  assert.equal(await page.$$eval("#stMap svg path", (p) => p.length), 1);
  assert.equal(await page.$$eval("#stMap svg circle", (c) => c.length), 2);
  assert.equal(await page.textContent("#qcTitle"), call);
});

test("station time for a callsign that hasn't been spotted", { skip }, async (t) => {
  const { page } = await openPage(t);
  await page.fill("#call", "ZL9ZZZ");
  await page.click("#lk button");
  await page.waitForFunction(() => document.getElementById("station").open);
  assert.equal(await page.textContent("#stTime"), "--:--:--");
  assert.match(await page.textContent("#stTzNote"), /location isn’t known yet/);
  assert.match(await page.textContent("#stSpots"), /Not spotted from IO93/);
  assert.equal(await page.$("#stTune"), null, "no frequency to tune to");
  assert.equal(await page.getAttribute("#stListen a", "href"), "http://rx.linkfanel.net/");
});

test("display options: colours, accent, text size, scale, layout, sections and scope resolution", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const css = (sel, prop) => page.$eval(sel, (el, p) => getComputedStyle(el)[p], prop);
  const rootVar = (v) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), v);
  await page.click("#optBtn");
  assert.equal(await page.$eval("#optDlg", (d) => d.open), true);

  await page.selectOption("#optTheme", "night");
  assert.equal(await page.getAttribute("html", "data-theme"), "night");
  assert.equal(await rootVar("--bg"), "#050000");
  await page.selectOption("#optTheme", "contrast");
  assert.equal(await rootVar("--text"), "#fff");

  await page.click('#optAccent button[aria-label="Orange"]');
  assert.equal(await rootVar("--cool"), "#d9480f");
  assert.equal(await page.getAttribute('#optAccent button[aria-label="Orange"]', "aria-pressed"), "true");

  await page.fill("#optText", "150");
  assert.equal(await css("html", "fontSize"), "24px");
  assert.equal(await page.textContent("#optTextVal"), "150%");
  await page.fill("#optZoom", "80");
  assert.equal(await css("body", "zoom"), "0.8");

  await page.selectOption("#optWidth", "100%");
  assert.equal(await css(".wrap", "maxWidth"), "100%");
  await page.selectOption("#optCols", "one");
  assert.equal((await css(".cols", "gridTemplateColumns")).split(" ").length, 1);
  await page.selectOption("#optDensity", "compact");
  assert.equal(await page.getAttribute("html", "data-density"), "compact");

  await page.selectOption("#optScopeRes", "low");
  await page.selectOption("#optScopeH", "400px");
  const scope = await page.$eval("#scope", (c) => ({ w: c.width, cw: c.clientWidth, h: c.clientHeight }));
  assert.equal(scope.h, 400);
  assert.equal(scope.w, scope.cw, "low resolution draws at 1x");

  await page.uncheck('#optSecs input[data-sec="map"]');
  await page.uncheck('#optSecs input[data-sec="clock"]');
  assert.equal(await page.isVisible("#secMap"), false);
  assert.equal(await page.isVisible("#secClock"), false);
  assert.equal(await page.isVisible("#secScope"), true);
  await page.click("#optDone");

  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.getAttribute("html", "data-theme"), "contrast", "settings are remembered");
  assert.equal(await css("html", "fontSize"), "24px");
  assert.equal(await page.isVisible("#secMap"), false);

  await page.click("#optBtn");
  await page.click("#optReset");
  assert.equal(await page.getAttribute("html", "data-theme"), null);
  assert.equal(await css("html", "fontSize"), "16px");
  assert.equal(await page.isVisible("#secMap"), true);
  assert.equal(await rootVar("--cool"), "#0b7285");
  assert.deepEqual(errors, []);
});

test("large text on a phone still fits the screen", { skip }, async (t) => {
  await srv.reset();
  feed = { pskCalls: [], psk: pskXml({ 14.074: 20 }) };
  const ctx = await browser.newContext({ viewport: { width: 380, height: 800 } });
  t.after(() => ctx.close());
  const page = await ctx.newPage();
  await page.addInitScript(() => localStorage.setItem("bw-display", JSON.stringify({ text: 140, theme: "night" })));
  await page.goto(base + "/");
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);
  await page.screenshot({ path: "/tmp/bw-phone-night.png", fullPage: false });
});

/* ---------- 1.6: modes, hover card, listening, band plan, sunspots, profiles, background ---------- */

/** PSK Reporter XML with chosen modes: [MHz, mode, count]. All heard in our grid. */
function mixedXml(rows) {
  let n = 0;
  const out = [];
  for (const [mhz, mode, count] of rows) {
    for (let i = 0; i < count; i++) {
      n++;
      out.push(`<receptionReport receiverCallsign="G0AAA" receiverLocator="IO93ab" senderCallsign="M${mode[0]}${n}XX" senderLocator="JO62" ` +
        `frequency="${Math.round((mhz + i * 0.0002) * 1e6)}" flowStartSeconds="${nowSec() - i * 60}" mode="${mode}" sNR="-5" />`);
    }
  }
  return `<receptionReports>${out.join("")}</receptionReports>`;
}

const WEBSDR_STUB = `<!doctype html><title>WebSDR</title><body>stub receiver<script>
  window.msgs = [];
  addEventListener("message", (e) => window.msgs.push(String(e.data)));
</script>`;

async function routeReceivers(page) {
  await page.context().route("http://websdr.ewi.utwente.nl:8901/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: WEBSDR_STUB }));
  await page.context().route("http://kiwi.example.org:8073/**", (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<title>Kiwi</title>kiwi" }));
}

test("mode filter box: presets, single modes, remembered, applied everywhere", { skip }, async (t) => {
  const { page, errors } = await openPage(t, { psk: mixedXml([[14.074, "FT8", 20], [14.025, "CW", 6], [7.04, "JS8", 4], [14.07, "PSK31", 3], [7.02, "CW", 2]]) });
  assert.equal(await page.textContent("#modesBtn"), "Modes: all");
  await page.click("#modesBtn");
  assert.equal(await page.$eval("#modesBox", (d) => d.open), true);
  const counts = await page.$$eval("#modesList .mode", (l) => Object.fromEntries(l.map((x) => [x.querySelector("input").dataset.mode, x.querySelector(".cnt").textContent])));
  assert.equal(counts.FT8, "20");
  assert.equal(counts.CW, "8");
  assert.equal(counts.PSK, "3", "PSK31 is grouped under PSK");
  assert.equal(counts.JS8, "4");
  assert.match(await page.textContent("#modesSum"), /Showing 35 of 35 spots/);

  await page.click("#modesCw");
  await page.waitForFunction(() => document.getElementById("modesSum").textContent.includes("Showing 8 of 35"));
  assert.match(await page.textContent("#modesBtn"), /^Modes: 1 of \d+$/);
  assert.match(await page.textContent("#hero"), /20 m is your best band/);
  assert.match(await page.$eval('#bands tr[data-b="20"]', (r) => r.innerText), /\s6\s/);
  assert.equal(await page.$$eval("#actRows tr", (r) => r.length), 8);
  assert.match(await page.textContent("#actModes"), /27 spots hidden/);

  await page.click("#modesData");
  await page.waitForFunction(() => document.getElementById("modesSum").textContent.includes("Showing 27 of 35"));
  await page.uncheck('#modesList input[data-mode="FT8"]');
  await page.waitForFunction(() => document.getElementById("modesSum").textContent.includes("Showing 7 of 35"));
  assert.match(await page.textContent("#hero"), /40 m is your best band/);
  assert.equal(await page.$eval('#modesList input[data-group="2"]', (i) => i.indeterminate), true, "WSJT-X group is partly ticked");

  await page.click("#modesNone");
  await page.waitForFunction(() => document.getElementById("hero").textContent.includes("Nothing in your chosen modes"));
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#modesBox", (d) => d.open), false);

  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.match(await page.textContent("#hero"), /Nothing in your chosen modes/, "the filter is remembered");
  await page.click("#modesBtn");
  await page.click("#modesAll");
  await page.waitForFunction(() => document.getElementById("modesBtn").textContent === "Modes: all");
  assert.deepEqual(errors, []);
});

test("hovering a callsign shows a card with QRZ details, cached", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const call = await page.textContent("#actRows a.call");
  await page.hover("#actRows a.call");
  await page.waitForSelector("#hovercard:not([hidden])");
  assert.match(await page.textContent("#hovercard"), new RegExp(`^${call}`));
  assert.match(await page.textContent("#hovercard"), /Last spot .* m, [\d,.]+ kHz, FT8/);
  assert.match(await page.textContent("#hovercard"), /Log in to QRZ to see name and location/);
  await page.mouse.move(5, 5);
  await page.waitForSelector("#hovercard[hidden]", { state: "attached" });

  await page.click("#qrzBtn");
  await page.fill("#qlUser", "m3vrv");
  await page.fill("#qlPass", "secret");
  await page.click("#qlSubmit");
  await page.waitForFunction(() => document.getElementById("qrzBtn").textContent === "QRZ: M3VRV");
  await page.waitForSelector("#actRows a.call");
  feed.qrzLookups = [];
  const link = page.locator("#actRows a.call").nth(1);
  const name = await link.textContent();
  await link.hover();
  await page.waitForFunction(() => document.getElementById("hovercard").textContent.includes("Test Operator"));
  const text = await page.textContent("#hovercard");
  assert.match(text, /Tokyo, Japan/);
  assert.match(text, /\d\d:\d\d local/);
  assert.match(text, /QSL: LoTW/);
  await page.mouse.move(5, 5);
  await page.waitForSelector("#hovercard[hidden]", { state: "attached" });
  await link.hover();
  await page.waitForFunction(() => !document.getElementById("hovercard").hidden && document.getElementById("hovercard").textContent.includes("Test Operator"));
  await page.keyboard.press("Escape");
  assert.equal(await page.$eval("#hovercard", (c) => c.hidden), true);

  await link.click();
  await page.waitForFunction(() => document.getElementById("qcBody").textContent.includes("Test Operator"));
  assert.deepEqual(feed.qrzLookups.filter((c) => c === name), [name], "QRZ was asked once for hover and station window");
  assert.deepEqual(errors.filter((e) => !/unpkg|tile\.openstreetmap/.test(e)), []);
});

test("listen panel: tunes, plays inside Band Watch, retunes from the scope, and checks receiver range", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await routeReceivers(page);
  assert.equal(await page.inputValue("#lsFreq"), "14200");
  assert.equal(await page.inputValue("#lsMode"), "usb");
  assert.equal(await page.isChecked("#lsEmbed"), true, "plain http page: receiver can play inside");

  await page.selectOption("#lsBand", "40");
  assert.equal(await page.inputValue("#lsMode"), "lsb", "phone below 10 MHz is LSB");
  const k40 = Number(await page.inputValue("#lsFreq"));
  assert.ok(k40 >= 7060 && k40 <= 7200, String(k40));
  await page.click('#lsPresets button:has-text("CW QRP")');
  assert.equal(await page.inputValue("#lsFreq"), "7030");
  assert.equal(await page.inputValue("#lsMode"), "cw");
  assert.match(await page.textContent("#lsWhere"), /7,030 kHz CW · CW; QRP centre 7030/);

  await page.click("#lsGo");
  await page.waitForSelector("#lsFrame:not([hidden])");
  const src = await page.getAttribute("#lsFrame", "src");
  assert.equal(src, `http://websdr.ewi.utwente.nl:8901/?tune=7030cw&messageorigin=${encodeURIComponent(base)}`);
  await page.waitForFunction(() => document.getElementById("lsFrame").contentWindow && document.getElementById("lsGo").textContent === "Retune");
  const frame = () => page.frames().find((f) => f.url().startsWith("http://websdr.ewi.utwente.nl"));
  await page.waitForFunction(() => true);
  for (let i = 0; i < 50 && !(frame() && await frame().evaluate(() => Array.isArray(window.msgs)).catch(() => false)); i++) await page.waitForTimeout(100);

  // Clicking the scope retunes the open receiver without reloading it.
  await page.click('#bands tr[data-b="20"]');
  await page.click('#scopeSpan button[data-s="ft8"]');
  const box = await page.locator("#scope").boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + 60);
  await page.waitForFunction(() => document.getElementById("lsFreq").value.startsWith("14075"));
  assert.equal(await page.inputValue("#lsMode"), "usb");
  await page.waitForFunction(() => true);
  for (let i = 0; i < 30 && !(await frame().evaluate(() => window.msgs.length)); i++) await page.waitForTimeout(100);
  const msgs = await frame().evaluate(() => window.msgs);
  assert.match(msgs[msgs.length - 1], /^tune 1407[45](\.\d+)?usb$/);
  assert.equal(await page.getAttribute("#lsFrame", "src"), src, "the frame was not reloaded");
  assert.match(await page.textContent("#scopeRead"), /Listen here/);

  await page.click("#lsStop");
  assert.equal(await page.isVisible("#lsFrame"), false);

  // In its own window instead.
  await page.uncheck("#lsEmbed");
  const [popup] = await Promise.all([page.waitForEvent("popup"), page.click("#lsGo")]);
  assert.match(popup.url(), /^http:\/\/websdr\.ewi\.utwente\.nl:8901\/\?tune=1407[45](\.\d+)?usb/);
  await page.click("#lsStop");

  // 6 m is beyond the Twente receiver; a KiwiSDR needs its address.
  await page.selectOption("#lsBand", "6");
  assert.match(await page.textContent("#lsErr"), /only covers up to 29\.16 MHz/);
  assert.equal(await page.isDisabled("#lsGo"), true);
  await page.selectOption("#lsBand", "20");
  await page.selectOption("#lsRx", "kiwi");
  assert.match(await page.textContent("#lsErr"), /Enter the address of a KiwiSDR/);
  await page.fill("#lsKiwi", "kiwi.example.org:8073/some/path");
  await page.press("#lsKiwi", "Enter");
  await page.locator("#lsKiwi").blur();
  await page.waitForFunction(() => !document.getElementById("lsGo").disabled);
  assert.equal(await page.inputValue("#lsKiwi"), "http://kiwi.example.org:8073");
  await page.selectOption("#lsMode", "fm");
  await page.check("#lsEmbed");
  await page.click("#lsGo");
  await page.waitForSelector("#lsFrame:not([hidden])");
  assert.match(await page.getAttribute("#lsFrame", "src"), /^http:\/\/kiwi\.example\.org:8073\/\?f=[\d.]+nbfm$/);

  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.inputValue("#lsRx"), "kiwi", "receiver choice is remembered");
  assert.deepEqual(errors, []);
});

test("band activity frequencies and the station window tune the receiver", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await routeReceivers(page);
  const btn = page.locator("#actRows button.khz").first();
  const k = await btn.getAttribute("data-k");
  await btn.click();
  assert.equal(await page.inputValue("#lsFreq"), k);
  assert.equal(await page.isVisible("#lsFrame"), false, "only tunes; doesn't start playing");
  assert.match(await page.textContent("#toast"), /Press Listen to hear it/);

  await page.click("#actRows a.call");
  await page.waitForSelector("#stTune");
  const label = await page.textContent("#stTune");
  await page.click("#stTune");
  assert.equal(await page.$eval("#station", (d) => d.open), false);
  await page.waitForSelector("#lsFrame:not([hidden])");
  assert.ok(label.includes(Number(await page.inputValue("#lsFreq")).toLocaleString("en-GB")), label);
  assert.deepEqual(errors.filter((e) => !/unpkg|tile\.openstreetmap/.test(e)), []);
});

test("scope: drag to zoom, reset, keyboard zoom", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.click('#bands tr[data-b="20"]');
  await page.click('#scopeSpan button[data-s="full"]');
  const box = await page.locator("#scope").boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, box.y + 60, { steps: 5 });
  assert.equal(await page.$eval("#scopeSel", (s) => s.style.display), "block");
  await page.mouse.up();
  assert.match(await page.textContent("#scopeSpan"), /Zoomed · reset/);
  const label = await page.getAttribute("#scope", "aria-label");
  const [, lo, hi] = label.match(/([\d.]+) to ([\d.]+) MHz/).map(Number);
  assert.ok(lo > 14.06 && hi < 14.13 && hi - lo < 0.06, label);
  await page.click('#scopeSpan button[data-s="unzoom"]');
  assert.match(await page.getAttribute("#scope", "aria-label"), /14\.000 to 14\.350 MHz/);
  await page.focus("#scope");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("+");
  assert.match(await page.textContent("#scopeSpan"), /Zoomed/);
  await page.keyboard.press("-");
  await page.keyboard.press("-");
  assert.doesNotMatch(await page.textContent("#scopeSpan"), /Zoomed/);
  assert.deepEqual(errors, []);
});

test("UK band plan chart: bands, segments, UK notes and click to tune", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  assert.equal(await page.$$eval("#planBands button", (b) => b.length), 11);
  assert.equal(await page.$$eval("#planRows tr", (r) => r.length), 9, "20 m has 9 segments");
  assert.match(await page.textContent("#planRows"), /14,099–14,101.*Beacons/s);
  assert.ok(await page.$$eval("#planChart line", (l) => l.length) >= 40, "live spots are ticked on the chart");
  assert.match(await page.textContent('#planRows tr[data-i="2"]'), /14,070–14,089500 HzData.*\d+$/);

  await page.click('#planBands button[data-b="60"]');
  assert.match(await page.textContent("#planNote"), /Full licence only.*5358–5362 kHz/);
  assert.match(await page.textContent("#planLegend"), /No UK amateur allocation/);
  await page.click('#planBands button[data-b="40"]');
  await page.click('#planRows tr[data-i="0"]');
  assert.equal(await page.inputValue("#lsFreq"), "7030");
  assert.equal(await page.inputValue("#lsMode"), "cw");
  assert.equal(await page.$$eval("#planChart path", (p) => p.length), 1, "the tuned frequency is marked");
  await page.click('#planChart .pseg[data-i="5"]');
  assert.equal(await page.inputValue("#lsMode"), "lsb");
  assert.deepEqual(errors, []);
});

test("sunspots: map of the Sun, NOAA numbers and what they mean", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.context().route("https://sdo.gsfc.nasa.gov/**", (r) => r.fulfill({ status: 200, contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64") }));
  await page.waitForSelector("#sunDisc .sreg");
  assert.equal(await page.$$eval("#sunDisc .sreg", (g) => g.length), 2);
  assert.equal(await page.$$eval("#sunDisc .sreg.complex", (g) => g.length), 1, "beta-gamma region is marked complex");
  const facts = await page.textContent("#sunFacts");
  assert.match(facts, /Sunspot number88/);
  assert.match(facts, /Latest flareM1\.2/);
  assert.match(facts, /Solar wind412 km\/s/);
  assert.match(facts, /R1 minor/);
  assert.match(facts, /radio blackout is happening/);
  assert.match(facts, /Flare chance todayC 50% · M 45% · X 5%/);
  assert.match(await page.textContent("#sunRows"), /4579N15E451706DaiBG complex50 \/ 45 \/ 52C 1M 0X/);
  const east = await page.$eval('#sunDisc .sreg[data-i="0"] circle', (c) => Number(c.getAttribute("cx")));
  const west = await page.$eval('#sunDisc .sreg[data-i="1"] circle', (c) => Number(c.getAttribute("cx")));
  assert.ok(east < 130 && west > 130, "east of the central meridian is drawn on the left");
  await page.click('#sunRows tr[data-i="1"]');
  assert.equal(await page.$$eval("#sunDisc .sreg.sel", (g) => g.length), 1);
  await page.click("#sunPhoto");
  assert.equal(await page.getAttribute("#sunDisc img", "src"), "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIF.jpg");
  await page.click("#sunPhoto");
  assert.equal(await page.$("#sunDisc img"), null);
  assert.deepEqual(errors, []);
});

test("sunspots: a clear message when NOAA can't be reached", { skip }, async (t) => {
  const { page } = await openPage(t, { sunDown: true });
  await page.waitForFunction(() => document.getElementById("sunDisc").textContent.includes("couldn’t be loaded"));
});

test("settings: background presets, a picture from this computer, a web address, and fading", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.click("#optBtn");
  await page.click('#optBgPresets button[data-bg="Aurora"]');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("has-bg")), true);
  assert.match(await page.evaluate(() => getComputedStyle(document.body, "::before").backgroundImage), /linear-gradient/);
  await page.fill("#optDim", "80");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body, "::after").opacity), "0.8");

  // A picture chosen from this computer is shrunk and kept.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 3000; c.height = 1500;
    const g = c.getContext("2d"); g.fillStyle = "#3366aa"; g.fillRect(0, 0, 3000, 1500);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.setInputFiles("#optBgFile", { name: "shack.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForFunction(() => document.getElementById("optBgMsg").textContent === "Using shack.png.");
  const stored = await page.evaluate(() => localStorage.getItem("bw-bg"));
  assert.match(stored, /^data:image\/jpeg;base64,/);
  const size = await page.evaluate((u) => new Promise((r) => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = u; }), stored);
  assert.deepEqual(size, [1920, 960]);
  await page.setInputFiles("#optBgFile", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await page.waitForFunction(() => document.getElementById("optBgMsg").textContent === "That file isn't a picture.");

  await page.fill("#optBgUrl", "javascript:alert(1)");
  await page.click("#optBgUrlSet");
  assert.match(await page.textContent("#optBgMsg"), /starting with https/);
  await page.fill("#optBgUrl", 'https://example.org/sky.jpg");}body{color:red');
  await page.click("#optBgUrlSet");
  assert.match(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bgimg")), /^url\("https:\/\/example\.org\/sky\.jpg%22\);%7Dbody%7Bcolor:red"\)$/);

  await page.click("#optBgNone");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("has-bg")), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("bw-bg")), null);
  assert.equal(await page.isVisible("#optQuitRow"), false, "no Quit button on the web version");
  assert.deepEqual(errors.filter((e) => !/example\.org/.test(e)), []);
});

test("settings: profiles save, load, export and import everything", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const css = (sel, prop) => page.$eval(sel, (el, p) => getComputedStyle(el)[p], prop);
  await page.fill("#mycall", "M3VRV");
  await page.press("#mycall", "Enter");
  await page.click("#optBtn");
  await page.selectOption("#optTheme", "night");
  await page.fill("#optText", "120");
  await page.click('#optBgPresets button[data-bg="Sunset"]');
  await page.fill("#profName", "Night shift");
  await page.click("#profSave");
  assert.match(await page.textContent("#profMsg"), /Saved “Night shift”/);
  await page.fill("#profName", "");
  await page.click("#profSave");
  assert.match(await page.textContent("#profMsg"), /Give the profile a name/);

  // Change everything, then load the profile back.
  await page.click("#optReset");
  await page.click("#optBgNone");
  await page.click("#optDone");
  await page.fill("#mycall", "G4ABC");
  await page.press("#mycall", "Enter");
  await page.fill("#grid", "JO62");
  await page.press("#grid", "Enter");
  await page.click("#optBtn");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#profExport")]);
  assert.match(download.suggestedFilename(), /^band-watch-profile-\d{4}-\d\d-\d\d\.json$/);
  const exported = JSON.parse(require("fs").readFileSync(await download.path(), "utf8"));
  assert.equal(JSON.parse(exported.bandWatchProfile.data["bw-call"] ? `"${exported.bandWatchProfile.data["bw-call"]}"` : '""'), "G4ABC");

  await Promise.all([page.waitForNavigation(), page.click('#profList [data-load="Night shift"]')]);
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.getAttribute("html", "data-theme"), "night");
  assert.equal(await css("html", "fontSize"), "19.2px");
  assert.equal(await page.inputValue("#mycall"), "M3VRV");
  assert.equal(await page.inputValue("#grid"), "IO93");
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains("has-bg")), true);

  // Import the exported file: back to G4ABC in JO62.
  await page.click("#optBtn");
  await Promise.all([page.waitForNavigation(), page.setInputFiles("#profImport", { name: "p.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) })]);
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  assert.equal(await page.inputValue("#mycall"), "G4ABC");
  assert.equal(await page.inputValue("#grid"), "JO62");
  assert.equal(await page.getAttribute("html", "data-theme"), null);

  await page.click("#optBtn");
  await page.setInputFiles("#profImport", { name: "bad.json", mimeType: "application/json", buffer: Buffer.from("{oops") });
  await page.waitForFunction(() => document.getElementById("profMsg").textContent === "That file isn't a Band Watch profile.");
  await page.click('#profList [data-del="Night shift"]');
  assert.match(await page.textContent("#profList"), /No saved profiles yet/);
  assert.deepEqual(errors, []);
});

test("listen panel pops out into a window you can drag, resize and dock, without stopping the receiver", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await routeReceivers(page);
  await page.click("#lsGo");
  await page.waitForSelector("#lsFrame:not([hidden])");
  const frameOf = () => page.frames().find((f) => f.url().startsWith("http://websdr.ewi.utwente.nl"));
  for (let i = 0; i < 50 && !(frameOf() && await frameOf().evaluate(() => Array.isArray(window.msgs)).catch(() => false)); i++) await page.waitForTimeout(100);
  await frameOf().evaluate(() => { window.marker = "still the same page"; });

  await page.click("#lsPop");
  assert.equal(await page.$eval("#secListen", (s) => getComputedStyle(s).position), "fixed");
  assert.equal(await page.isVisible("#lsDock"), true, "a placeholder shows where the panel was");
  assert.equal(await page.textContent("#lsPop"), "Dock");
  const before = await page.locator("#secListen").boundingBox();
  const head = await page.locator("#lsTitle").boundingBox();
  await page.mouse.move(head.x + 5, head.y + 5);
  await page.mouse.down();
  await page.mouse.move(head.x - 300, head.y + 150, { steps: 6 });
  await page.mouse.up();
  const after = await page.locator("#secListen").boundingBox();
  assert.ok(Math.abs(after.x - (before.x - 305)) < 3 && Math.abs(after.y - (before.y + 145)) < 3, JSON.stringify({ before, after }));
  assert.equal(await frameOf().evaluate(() => window.marker), "still the same page", "moving the window doesn't reload the receiver");

  // Resize it, and it remembers where it was and how big.
  await page.$eval("#secListen", (s) => { s.style.width = "480px"; s.style.height = "500px"; });
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForFunction(() => document.getElementById("banner").className.includes("live"));
  const again = await page.locator("#secListen").boundingBox();
  assert.ok(Math.abs(again.x - after.x) < 3 && Math.abs(again.y - after.y) < 3, "position remembered");
  assert.ok(Math.abs(again.width - 480) < 3 && Math.abs(again.height - 500) < 3, `size remembered: ${again.width}x${again.height}`);

  await page.click("#lsDockBtn");
  assert.equal(await page.$eval("#secListen", (s) => getComputedStyle(s).position), "static");
  assert.equal(await page.isVisible("#lsDock"), false);
  assert.deepEqual(errors, []);
});

test("tuning controls: step buttons, dial, wheel, and the stations heard on the band", { skip }, async (t) => {
  const { page, errors } = await openPage(t, { psk: mixedXml([[14.074, "FT8", 5], [14.025, "CW", 3], [14.0255, "CW", 1], [7.04, "JS8", 2]]) });
  await routeReceivers(page);
  assert.equal(await page.inputValue("#lsFreq"), "14200");
  await page.selectOption("#lsStep", "5");
  await page.click("#lsUp");
  assert.equal(await page.inputValue("#lsFreq"), "14205");
  await page.click("#lsDown");
  await page.click("#lsDown");
  assert.equal(await page.inputValue("#lsFreq"), "14195");
  await page.selectOption("#lsStep", "0.1");
  await page.hover("#lsFreq");
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => document.getElementById("lsFreq").value === "14195.1");

  // The dial covers the band and retunes when it settles.
  assert.deepEqual(await page.$eval("#lsSlider", (s) => [s.min, s.max]), ["14000", "14350"]);
  await page.$eval("#lsSlider", (s) => { s.value = "14250"; s.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal(await page.inputValue("#lsFreq"), "14250");

  // Stations heard on 20 m: the five FT8 stations share one dial frequency; the CW ones each have their own.
  const opts = await page.$$eval("#lsStations option", (o) => o.map((x) => x.textContent));
  assert.match(opts[0], /Stations heard on 20 m \(5\)/);
  assert.match(opts.find((o) => o.includes("FT8")), /^14,074 kHz USB · FT8 · 5 stations: /);
  assert.equal(opts.filter((o) => / CW · CW · /.test(o)).length, 4);
  await page.click("#lsPrev");
  assert.equal(await page.inputValue("#lsFreq"), "14074");
  assert.equal(await page.inputValue("#lsMode"), "usb");
  await page.click("#lsPrev");
  assert.equal(await page.inputValue("#lsMode"), "cw");
  const cw = Number(await page.inputValue("#lsFreq"));
  assert.ok(cw > 14025 && cw < 14026, String(cw));
  await page.click("#lsNext");
  assert.equal(await page.inputValue("#lsFreq"), "14074");
  assert.equal(await page.isDisabled("#lsNext"), true, "nothing above FT8 on 20 m");
  await page.selectOption("#lsStations", { index: 1 });
  assert.equal(await page.inputValue("#lsFreq"), "14025");

  // With the receiver open, tuning sends the new frequency to it.
  await page.click("#lsGo");
  await page.waitForSelector("#lsFrame:not([hidden])");
  const frameOf = () => page.frames().find((f) => f.url().startsWith("http://websdr.ewi.utwente.nl"));
  for (let i = 0; i < 50 && !(frameOf() && await frameOf().evaluate(() => Array.isArray(window.msgs)).catch(() => false)); i++) await page.waitForTimeout(100);
  await page.click("#lsNext");
  for (let i = 0; i < 30 && !(await frameOf().evaluate(() => window.msgs.length)); i++) await page.waitForTimeout(100);
  assert.match((await frameOf().evaluate(() => window.msgs)).pop(), /^tune 14025\.\d+cw$/);

  await page.selectOption("#lsBand", "40");
  assert.match(await page.textContent("#lsStations option"), /Stations heard on 40 m \(2\)/);
  assert.deepEqual(errors, []);
});

test("install page: Windows, iPhone and Android steps, chosen for the device, with a QR code for phones", { skip }, async (t) => {
  const ctxFor = async (ua, opts = {}) => {
    const ctx = await browser.newContext({ userAgent: ua, viewport: { width: 1200, height: 1000 }, ...opts });
    t.after(() => ctx.close());
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    return { page, errors };
  };
  const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
  const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";
  const visible = (page) => page.$$eval(".ipanel[role=tabpanel]", (ps) => ps.filter((p) => !p.hidden).map((p) => p.id));

  // Windows computer: Windows steps first, phone QR codes available on the other tabs.
  let { page, errors } = await ctxFor(WIN);
  await page.goto(base + "/install");
  assert.deepEqual(await visible(page), ["pWindows"]);
  assert.match(await page.textContent("#here"), /Windows PC/);
  assert.equal(await page.getAttribute("#tabWindows", "aria-selected"), "true");
  await page.click("#tabIphone");
  assert.deepEqual(await visible(page), ["pIphone"]);
  assert.ok(await page.isVisible("#pIphone .iqr img"), "QR code shown on a computer");
  assert.match(await page.textContent("#pIphone"), /Add to Home Screen/);
  assert.match(page.url(), /\?for=iphone$/);
  await page.focus("#tabIphone");
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await visible(page), ["pAndroid"]);
  assert.match(await page.textContent("#pAndroid"), /Install app/);
  const qrOk = await page.$eval("#pAndroid .iqr img", (i) => i.complete && i.naturalWidth > 0);
  assert.ok(qrOk, "QR image loads");
  // The Windows download is the latest GitHub release (the test server has no copy of its own).
  // The browser's own install prompt, where it offers one.
  await page.click("#tabWindows");
  assert.ok(await page.isVisible("#winDl"));
  assert.match(await page.getAttribute("#winDl", "href"), /^https:\/\/github\.com\/[^/]+\/band-watch\/releases\/latest\/download\/BandWatch-Setup\.exe$/);
  assert.ok(await page.isHidden("#pWindows .installNow"));
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  assert.ok(await page.isVisible("#pWindows .installNow"));
  await page.click("#pWindows .installNow");
  assert.equal(await page.evaluate(() => window.__prompted), true);
  await page.waitForFunction(() => document.querySelector("#pWindows .installNow").hidden);
  assert.deepEqual(errors, []);

  // iPhone: iPhone steps, no QR code (you're already on the phone), no Windows-only notes in view.
  ({ page, errors } = await ctxFor(IPHONE, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }));
  await page.goto(base + "/install");
  assert.deepEqual(await visible(page), ["pIphone"]);
  assert.match(await page.textContent("#here"), /iPhone or iPad/);
  assert.ok(await page.isHidden("#pIphone .iqr"), "no QR code on the phone itself");
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  assert.ok(fits, "fits the phone screen");
  assert.deepEqual(errors, []);

  // Android, and ?for= picks a tab regardless of the device.
  ({ page, errors } = await ctxFor(ANDROID, { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }));
  await page.goto(base + "/install");
  assert.deepEqual(await visible(page), ["pAndroid"]);
  await page.goto(base + "/install?for=windows");
  assert.deepEqual(await visible(page), ["pWindows"]);
  assert.deepEqual(errors, []);
});

test("app: installable (manifest and service worker), works offline, and settings link to the install page", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return r.active && r.active.scriptURL;
  });
  assert.match(reg, /\/sw\.js$/);
  const man = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
  assert.equal(man.short_name, "Band Watch");
  // Settings: install section with a link to the install page; the install button appears with the browser's prompt.
  await page.click("#optBtn");
  assert.ok(await page.isHidden("#optInstall"));
  assert.equal(await page.getAttribute("#optInstallPage", "href"), "/install?for=windows");
  await page.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => { window.__prompted = true; };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  assert.ok(await page.isVisible("#optInstall"));
  await page.click("#optInstall");
  await page.waitForFunction(() => window.__prompted === true);
  await page.waitForFunction(() => /installed as an app/.test(document.getElementById("optInstMsg").textContent));
  await page.keyboard.press("Escape");
  // Live data is never served from the saved copy; the page itself opens with no connection.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.context().setOffline(true);
  await page.reload();
  assert.equal(await page.title(), "Band Watch by M3vrv");
  await page.waitForFunction(() => document.getElementById("banner").textContent !== "Loading live data…");
  assert.ok(await page.evaluate(() => document.getElementById("banner").classList.contains("err") || /couldn|offline|not|fail/i.test(document.getElementById("banner").textContent)));
  await page.context().setOffline(false);
  assert.deepEqual(errors.filter((e) => !/Failed to fetch|ERR_INTERNET_DISCONNECTED|net::|request failed: .*\/(api\/|healthz)/.test(e)), []);
});

const waitFor = async (fn, ms = 5000) => {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
};

/** A stand-in for rtl_tcp that streams, in real time, a USB signal: a 1 kHz note 1 kHz above
 *  whatever dial frequency the page tunes to. Records the commands it receives. */
function startStreamingRtlTcp() {
  const net = require("net");
  const FS = 960000;
  const secs = 1;
  const n = FS * secs;
  const bytes = Buffer.alloc(n * 2);
  // The page tunes the dongle 240 kHz above the dial, so the dial is at -240 kHz; the note is at -239 kHz.
  const f = -240000 + 1000;
  for (let k = 0; k < n; k++) {
    const ph = (2 * Math.PI * f * k) / FS;
    bytes[2 * k] = Math.round(127.5 + 60 * Math.cos(ph) + (Math.random() - 0.5) * 4);
    bytes[2 * k + 1] = Math.round(127.5 + 60 * Math.sin(ph) + (Math.random() - 0.5) * 4);
  }
  const state = { cmds: [], sockets: new Set() };
  const server = net.createServer((sock) => {
    state.sockets.add(sock);
    sock.write(Buffer.from([0x52, 0x54, 0x4c, 0x30, 0, 0, 0, 6, 0, 0, 0, 29]));
    let pos = 0;
    let pend = Buffer.alloc(0);
    const timer = setInterval(() => {
      const len = FS * 2 * 0.02; // 20 ms of samples
      const out = Buffer.alloc(len);
      for (let i = 0; i < len; i++) { out[i] = bytes[pos]; pos = (pos + 1) % bytes.length; }
      if (!sock.destroyed) sock.write(out);
    }, 20);
    sock.on("data", (d) => {
      pend = Buffer.concat([pend, d]);
      while (pend.length >= 5) {
        state.cmds.push([pend[0], pend.readUInt32BE(1)]);
        pend = pend.subarray(5);
      }
    });
    sock.on("close", () => { clearInterval(timer); state.sockets.delete(sock); });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}

test("RTL-SDR: connects to rtl_tcp, tunes, plays and shows the waterfall; click and buttons retune", { skip }, async (t) => {
  const fake = await startStreamingRtlTcp();
  t.after(() => { for (const s of fake.state.sockets) s.destroy(); fake.server.close(); });
  const { page, errors } = await openPage(t);
  await page.selectOption("#lsRx", "rtl");
  assert.ok(await page.isVisible("#lsRtl"));
  assert.ok(await page.isHidden("#lsEmbedRow"), "the web-receiver option is hidden");
  assert.ok((await page.$$eval("#lsMode option", (o) => o.map((x) => x.value))).includes("wfm"), "broadcast FM offered");
  assert.equal(await page.inputValue("#rtlAddr"), "127.0.0.1:1234");
  await page.fill("#rtlAddr", `127.0.0.1:${fake.port}`);
  await page.press("#rtlAddr", "Enter");
  await page.fill("#lsFreq", "14200");
  await page.press("#lsFreq", "Enter");
  await page.selectOption("#lsMode", "usb");
  await page.selectOption("#rtlGain", "254"); // 25.4 dB
  await page.click("#lsGo");

  await page.waitForFunction(() => /Connected: R828D \(RTL-SDR Blog V4\)/.test(document.getElementById("rtlStatus").textContent));
  const cmds = () => fake.state.cmds.map(([c, v]) => `${c}:${v}`);
  await page.waitForFunction(() => sdr.demod && sdr.demod.level > -40, null, { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 300));
  const sent = cmds();
  assert.ok(sent.includes("2:960000"), "sample rate");
  assert.ok(sent.includes("3:1") && sent.includes("4:254"), "manual gain 25.4 dB");
  assert.ok(sent.includes("5:0"), "ppm");
  assert.ok(sent.includes("14:0"), "bias tee off");
  assert.equal(sent.filter((c) => c.startsWith("1:")).pop(), "1:14440000", "dongle tuned 240 kHz above 14,200 kHz");
  assert.equal(await page.evaluate(() => sdr.ctx && sdr.ctx.state), "running", "sound is playing");
  assert.match(await page.textContent("#rtlMeter"), /Signal -?\d+ dBFS/);
  assert.equal(await page.textContent("#lsGo"), "Retune");

  // The waterfall has drawn something other than the background.
  await page.waitForTimeout(400);
  const lit = await page.$eval("#rtlFall", (c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, 1).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 0) n++;
    return n;
  });
  assert.ok(lit > 100, `waterfall row drawn (${lit} px)`);

  // + button: 1 kHz step
  await page.click("#lsUp");
  await page.waitForFunction(() => listen.kHz === 14201);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(cmds().filter((c) => c.startsWith("1:")).pop(), "1:14441000");

  // Click on the waterfall a quarter of the way across: 120 kHz below the dial
  const box = await (await page.$("#rtlFall")).boundingBox();
  await page.click("#rtlFall", { position: { x: box.width / 4, y: 20 } });
  await page.waitForFunction(() => Math.abs(listen.kHz - 14081) < 1);
  await new Promise((r) => setTimeout(r, 200));
  const last = Number(cmds().filter((c) => c.startsWith("1:")).pop().slice(2));
  assert.ok(Math.abs(last - (14081000 + 240000)) < 1000, `retuned to ${last}`);

  // Bias tee, ppm
  await page.check("#rtlBias");
  await page.fill("#rtlPpm", "-3");
  await page.press("#rtlPpm", "Enter");
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(cmds().includes("14:1"));
  assert.ok(cmds().includes(`5:${(-3) >>> 0}`));

  // Settings are kept
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bw-sdr")));
  assert.equal(saved.addr, `127.0.0.1:${fake.port}`);
  assert.equal(saved.gain, 254);
  assert.equal(saved.ppm, -3);
  assert.equal(saved.bias, true);

  // Stop closes the connection to rtl_tcp
  await page.click("#lsStop");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(fake.state.sockets.size, 0, "connection closed");
  assert.equal(await page.evaluate(() => sdr.running), false);
  // (Stop cancels the stream on purpose; the browser reports that as a failed request.)
  assert.deepEqual(errors.filter((e) => !/request failed: .*\/api\/sdr\/stream/.test(e)), []);
});

test("RTL-SDR: clear messages when rtl_tcp isn't running, or the address is wrong", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.selectOption("#lsRx", "rtl");
  await page.fill("#rtlAddr", "127.0.0.1:1");
  await page.press("#rtlAddr", "Enter");
  await page.click("#lsGo");
  await page.waitForFunction(() => /Is rtl_tcp running\?/.test(document.getElementById("rtlStatus").textContent));
  assert.equal(await page.textContent("#lsGo"), "Listen", "not left looking connected");
  await page.fill("#rtlAddr", "8.8.8.8:1234");
  await page.press("#rtlAddr", "Enter");
  await page.click("#lsGo");
  await page.waitForFunction(() => /home-network address/.test(document.getElementById("rtlStatus").textContent));
  // out of range
  await page.fill("#lsFreq", "0.3"); // MHz: 300 kHz
  await page.press("#lsFreq", "Enter");
  assert.match(await page.textContent("#lsErr"), /500 kHz to 1,766 MHz/);
  assert.deepEqual(errors.filter((e) => !/the server responded with a status of (502|400)/.test(e)), []);
});

test("RTL-SDR settings: test connection, all settings kept in step with Listen and applied live", { skip }, async (t) => {
  const fake = await startStreamingRtlTcp();
  t.after(() => { for (const s of fake.state.sockets) s.destroy(); fake.server.close(); });
  const { page, errors } = await openPage(t);
  await page.click("#optBtn");
  assert.ok(await page.isVisible("#optRtlAddr"));
  assert.equal(await page.inputValue("#optRtlAddr"), "127.0.0.1:1234");
  assert.equal(await page.isChecked("#optRtlAudioAgc"), true, "audio AGC on by default");
  assert.equal(await page.isChecked("#optRtlAuto"), true);
  assert.equal(await page.textContent("#optRtlRangeVal"), "60 dB");

  // Wrong address first, then the right one
  await page.fill("#optRtlAddr", "127.0.0.1:1");
  await page.press("#optRtlAddr", "Enter");
  await page.click("#optRtlTest");
  await page.waitForFunction(() => /Is rtl_tcp running\?/.test(document.getElementById("optRtlMsg").textContent));
  await page.fill("#optRtlAddr", `localhost:${fake.port}`);
  await page.press("#optRtlAddr", "Enter");
  await page.click("#optRtlTest");
  await page.waitForFunction(() => /^Working:/.test(document.getElementById("optRtlMsg").textContent));
  assert.equal(await page.textContent("#optRtlMsg"), `Working: rtl_tcp at localhost:${fake.port} has an R828D tuner (RTL-SDR Blog V4) with 29 gain steps.`);
  await waitFor(() => fake.state.sockets.size === 0); // the test connection was closed again

  await page.selectOption("#optRtlGain", "372");
  await page.fill("#optRtlPpm", "4");
  await page.press("#optRtlPpm", "Enter");
  await page.check("#optRtlAgc");
  await page.uncheck("#optRtlAudioAgc");
  await page.uncheck("#optRtlAuto");
  await page.selectOption("#optRtlSpeed", "fast");
  await page.$eval("#optRtlRange", (el) => { el.value = "80"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal(await page.textContent("#optRtlRangeVal"), "80 dB");
  await page.keyboard.press("Escape");

  // The Listen panel shows the same settings
  await page.selectOption("#lsRx", "rtl");
  assert.equal(await page.inputValue("#rtlAddr"), `localhost:${fake.port}`);
  assert.equal(await page.inputValue("#rtlGain"), "372");
  assert.equal(await page.inputValue("#rtlPpm"), "4");

  // ...and they are sent when the receiver starts
  await page.fill("#lsFreq", "7100");
  await page.press("#lsFreq", "Enter");
  await page.selectOption("#lsMode", "lsb");
  await page.click("#lsGo");
  await page.waitForFunction(() => /Connected: R828D/.test(document.getElementById("rtlStatus").textContent));
  await waitFor(() => fake.state.cmds.some(([c]) => c === 1));
  const sent = fake.state.cmds.map(([c, v]) => `${c}:${v}`);
  for (const want of ["3:1", "4:372", "5:4", "8:1", "14:0", "1:7340000"]) assert.ok(sent.includes(want), want);
  assert.equal(await page.evaluate(() => sdr.demod.autoGain), false);

  // Changing a setting while listening applies at once
  await page.click("#optBtn");
  await page.uncheck("#optRtlAgc");
  await page.selectOption("#optRtlGain", "-1");
  await waitFor(() => fake.state.cmds.some(([c, v]) => c === 3 && v === 0));
  const later = fake.state.cmds.map(([c, v]) => `${c}:${v}`);
  assert.ok(later.lastIndexOf("8:0") > later.indexOf("8:1"), "RTL AGC switched off");
  assert.ok(later.lastIndexOf("3:0") > later.indexOf("3:1"), "back to automatic gain");

  // Reset keeps the address
  await page.click("#optRtlReset");
  assert.equal(await page.inputValue("#optRtlAddr"), `localhost:${fake.port}`);
  assert.equal(await page.inputValue("#optRtlPpm"), "0");
  assert.equal(await page.isChecked("#optRtlAudioAgc"), true);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bw-sdr")));
  assert.deepEqual(saved, { addr: `localhost:${fake.port}`, gain: -1, ppm: 0, bias: false, volume: 70, rtlAgc: false, audioAgc: true, autoLevel: true, range: 60, speed: "normal", device: 0, autoStart: false, exePath: "", reconnect: true,
    dongle: "v4", rate: 960000, widths: { usb: 2700, lsb: 2700, cw: 500, am: 6000, fm: 12000 }, squelch: null, agcSpeed: "normal", deemph: 50 });
  // saved in profiles too
  assert.ok(await page.evaluate(() => PROFILE_KEYS.includes("bw-sdr")));
  await page.keyboard.press("Escape");
  await page.click("#lsStop");
  assert.deepEqual(errors.filter((e) => !/request failed: .*\/api\/sdr\/stream|status of 502/.test(e)), []);
});

test("RTL-SDR V4 receiver settings: dongle, sample rate, filter width, squelch, AGC, de-emphasis", { skip }, async (t) => {
  const fake = await startStreamingRtlTcp();
  t.after(() => { for (const s of fake.state.sockets) s.destroy(); fake.server.close(); });
  const { page, errors } = await openPage(t);
  await page.click("#optBtn");
  assert.equal(await page.inputValue("#optRtlDongle"), "v4");
  assert.equal(await page.inputValue("#optRtlRate"), "960000");
  assert.equal(await page.inputValue("#optRtlWSsb"), "2700");
  assert.equal(await page.inputValue("#optRtlWCw"), "500");
  assert.equal(await page.textContent("#optRtlSqlVal"), "Off");
  await page.fill("#optRtlAddr", `127.0.0.1:${fake.port}`);
  await page.press("#optRtlAddr", "Enter");
  await page.selectOption("#optRtlRate", "1920000");
  await page.selectOption("#optRtlWSsb", "1800");
  await page.selectOption("#optRtlAgcSpd", "slow");
  await page.selectOption("#optRtlDeemph", "75");
  await page.fill("#optRtlSql", "-40");
  await page.dispatchEvent("#optRtlSql", "input");
  assert.equal(await page.textContent("#optRtlSqlVal"), "-40 dBFS");
  await page.keyboard.press("Escape");

  // Listening on 40 m USB at 1.92 MS/s: dongle set to that rate, tuned a quarter of it above the dial
  await page.selectOption("#lsRx", "rtl");
  await page.fill("#lsFreq", "7074");
  await page.press("#lsFreq", "Enter");
  await page.selectOption("#lsMode", "usb");
  await page.click("#lsGo");
  await page.waitForFunction(() => /Connected: R828D.*1\.92 MS\/s/.test(document.getElementById("rtlStatus").textContent));
  await waitFor(() => fake.state.cmds.some(([c]) => c === 1));
  let sent = fake.state.cmds.map(([c, v]) => `${c}:${v}`);
  assert.ok(sent.includes("2:1920000"), "sample rate");
  assert.ok(sent.includes(`1:${7074000 + 480000}`), "tuned for 1.92 MS/s");
  assert.ok(!sent.includes("9:2"), "the V4 doesn't use direct sampling");
  const d = await page.evaluate(() => ({ rate: sdr.demod.inRate, w: sdr.demod.widths.usb, sq: sdr.demod.squelch, agc: sdr.demod.agcDecay, de: sdr.demod.deemphUs }));
  assert.deepEqual(d, { rate: 1920000, w: 1800, sq: -40, agc: SdrDspAgcSlow(), de: 75 });
  // The Listen panel's filter list matches
  assert.equal(await page.inputValue("#rtlWidth"), "1800");
  await page.selectOption("#rtlWidth", "3000");
  assert.equal(await page.evaluate(() => sdr.demod.widths.lsb), 3000, "SSB width covers USB and LSB");

  // Blog V3: direct sampling (Q branch) on HF, off again above 24 MHz
  await page.click("#optBtn");
  await page.selectOption("#optRtlDongle", "v3");
  await waitFor(() => fake.state.cmds.some(([c, v]) => c === 9 && v === 2));
  // Changing the rate while listening re-tunes for the new rate
  await page.selectOption("#optRtlRate", "2400000");
  await waitFor(() => fake.state.cmds.some(([c, v]) => c === 2 && v === 2400000));
  await waitFor(() => fake.state.cmds.some(([c, v]) => c === 1 && v === 7074000 + 600000));
  assert.equal(await page.evaluate(() => sdr.demod.inRate), 2400000);
  await page.keyboard.press("Escape");
  await page.fill("#lsFreq", "145500");
  await page.press("#lsFreq", "Enter");
  await waitFor(() => fake.state.cmds.some(([c, v]) => c === 9 && v === 0));

  // Other dongles start at 24 MHz
  await page.click("#optBtn");
  await page.selectOption("#optRtlDongle", "other");
  await page.keyboard.press("Escape");
  await page.fill("#lsFreq", "7074");
  await page.press("#lsFreq", "Enter");
  assert.match(await page.textContent("#lsErr"), /Other RTL-SDR tunes from 24 MHz/);

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bw-sdr")));
  assert.equal(saved.dongle, "other");
  assert.equal(saved.rate, 2400000);
  assert.equal(saved.widths.usb, 3000);
  assert.equal(saved.squelch, -40);
  assert.equal(saved.agcSpeed, "slow");
  assert.equal(saved.deemph, 75);
  await page.click("#lsStop");
  assert.deepEqual(errors.filter((e) => !/request failed: .*\/api\/sdr\/stream|status of 502/.test(e)), []);
});

function SdrDspAgcSlow() { return require("../public/js/sdr-dsp.js").AGC_DECAY.slow; }

test("About this build: version, build date and where it's running", { skip }, async (t) => {
  const { page, errors } = await openPage(t);
  await page.click("#optBtn");
  await page.waitForFunction(() => /Running as/.test(document.getElementById("optAbout").textContent));
  const text = await page.textContent("#optAbout");
  const version = require("../package.json").version;
  assert.match(text, new RegExp(`Version${version.replace(/\./g, "\\.")}`));
  assert.match(text, /Built/);
  assert.match(text, /Server(Node\.js v|BandWatch\.exe go)/);
  assert.match(await page.textContent("#abHist"), new RegExp(version.replace(/\./g, "\\.")));
  assert.deepEqual(errors, []);
});

test("live band scope: real spectrum and waterfall from the RTL-SDR, spots marked, switch back to spots", { skip }, async (t) => {
  const fake = await startStreamingRtlTcp();
  t.after(() => { for (const s of fake.state.sockets) s.destroy(); fake.server.close(); });
  const { page, errors } = await openPage(t);
  await page.evaluate((port) => { sdrSet("addr", `127.0.0.1:${port}`); selectBand("20"); }, fake.port);
  await page.click('#scopeSpan button[data-s="full"]');
  // Live is the default; with no receiver running the scope says so and offers to start it
  assert.equal(await page.getAttribute('#scopeSrc button[data-src="live"]', "aria-pressed"), "true");
  assert.match(await page.textContent("#scopeLiveMsg"), /isn't running/);
  assert.equal(await page.isVisible("#scopeLiveGo"), true);
  await page.click("#scopeLiveGo");
  await page.waitForFunction(() => scope && scope.live && scope.spec && scope.spec.some((v) => !Number.isNaN(v)), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => listen.rx), "rtl");
  assert.equal(await page.evaluate(() => listen.kHz), 14200, "kept the frequency already chosen, as it's on 20 m");
  assert.match(await page.textContent("#scopeTitle"), /20 m band scope · live/);
  assert.match(await page.textContent("#scopeLiveMsg"), /Live from your RTL-SDR/);
  // The fake rtl_tcp sends a note 1 kHz above the dial: the live trace peaks there
  await page.waitForFunction(() => liveScope.rows > 5);
  const peak = await page.evaluate(() => {
    let best = 0;
    scope.spec.forEach((v, i) => { if (v > scope.spec[best]) best = i; });
    return { mhz: scope.lo + ((best + 0.5) / scope.spec.length) * (scope.hi - scope.lo), dB: scope.spec[best], bin: scope.binW };
  });
  assert.ok(Math.abs(peak.mhz - 14.201) <= peak.bin * 1.5, `peak at ${peak.mhz} MHz`);
  assert.ok(peak.dB > 20, `${peak.dB} dB above the noise`);
  // The whole 20 m band is within what the dongle sees at 0.96 MS/s
  assert.equal(await page.evaluate(() => scope.spec.filter((v) => Number.isNaN(v)).length), 0);
  if (process.env.SHOT) await page.locator("#secScope").screenshot({ path: process.env.SHOT });
  // Hover readout gives the live level
  const box = await page.locator("#scope").boundingBox();
  const fr = (14.201 - (await page.evaluate(() => scope.lo))) / (await page.evaluate(() => scope.hi - scope.lo));
  await page.mouse.move(box.x + box.width * fr, box.y + 40);
  assert.match(await page.textContent("#scopeRead"), /dB above the noise/);
  // Zoom into the FT8 span: finer bins, still live, waterfall restarts for the new span
  await page.click('#scopeSpan button[data-s="ft8"]');
  await page.waitForFunction(() => scope.live && liveScope.key.startsWith(`${scope.lo}|`) && liveScope.rows > 2);
  // Retuning within the band keeps the waterfall (it's kept in frequency order)
  await page.click('#scopeSpan button[data-s="full"]');
  await page.waitForFunction(() => liveScope.rows > 10);
  await page.evaluate(() => tuneTo(14100, "usb", { quiet: true }));
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(await page.evaluate(() => liveScope.rows > 10), "waterfall kept");
  // Switch to the spot-based scope, and back
  await page.click('#scopeSrc button[data-src="spots"]');
  assert.equal(await page.evaluate(() => scope.live), false);
  assert.equal(await page.evaluate(() => localStorage.getItem("bw-scope-src")), "spots");
  await page.click('#scopeSrc button[data-src="live"]');
  await page.waitForFunction(() => scope.live);
  // Stopping the receiver goes back to spots, with the offer to start again
  await page.click("#lsStop");
  await page.waitForFunction(() => !scope.live);
  assert.equal(await page.isVisible("#scopeLiveGo"), true);
  assert.deepEqual(errors.filter((e) => !/request failed: .*\/api\/sdr\/stream|status of 502/.test(e)), []);
});

/** rtl_tcp stand-in that transmits a real FT4 (or FT8) signal in step with the UTC clock,
 *  as an on-air station would: a USB signal `audioHz` above the dial frequency the page tunes to. */
function startFtxRtlTcp({ text, mode = "FT4", audioHz = 1200, amp = 40 }) {
  const net = require("net");
  const Ftx = require("../public/js/ft8.js");
  const proto = Ftx.PROTOCOLS[mode];
  const tones = Ftx.encodeTones(text, proto);
  const FS = 960000;
  const spacing = proto.fs / proto.nsps;
  const symSec = proto.nsps / proto.fs;
  const state = { sockets: new Set() };
  const server = net.createServer((sock) => {
    state.sockets.add(sock);
    sock.write(Buffer.from([0x52, 0x54, 0x4c, 0x30, 0, 0, 0, 6, 0, 0, 0, 29]));
    const t0 = Date.now();
    let n = 0; // samples sent
    let ph = 0;
    const timer = setInterval(() => {
      const target = Math.floor(((Date.now() - t0) / 1000) * FS);
      const len = Math.min(target - n, FS / 10);
      if (len <= 0) return;
      const out = Buffer.alloc(len * 2);
      for (let i = 0; i < len; i++) {
        const tMs = t0 + ((n + i) / FS) * 1000;
        const intoCycle = (tMs % (proto.period * 1000)) / 1000 - proto.start;
        const s = Math.floor(intoCycle / symSec);
        let a = 0;
        if (s >= 0 && s < tones.length) {
          a = amp;
          ph += (2 * Math.PI * (-240000 + audioHz + tones[s] * spacing)) / FS;
          if (ph > Math.PI) ph -= 2 * Math.PI; else if (ph < -Math.PI) ph += 2 * Math.PI;
        }
        out[2 * i] = Math.round(127.5 + a * Math.cos(ph) + (Math.random() - 0.5) * 6);
        out[2 * i + 1] = Math.round(127.5 + a * Math.sin(ph) + (Math.random() - 0.5) * 6);
      }
      n += len;
      if (!sock.destroyed) sock.write(out);
    }, 20);
    sock.on("data", () => {});
    sock.on("close", () => { clearInterval(timer); state.sockets.delete(sock); });
    sock.on("error", () => {});
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port })));
}

test("FT4 decoder: decodes a station heard on the RTL-SDR, in the panel and the results window", { skip, timeout: 60000 }, async (t) => {
  const fake = await startFtxRtlTcp({ text: "CQ M3VRV IO93", mode: "FT4", audioHz: 1200 });
  t.after(() => { for (const s of fake.state.sockets) s.destroy(); fake.server.close(); });
  const { page, errors } = await openPage(t);
  await page.fill("#mycall", "M3VRV");
  await page.press("#mycall", "Enter");
  await page.waitForFunction(() => app.myCall === "M3VRV");
  // Decoder: FT4, from the RTL-SDR
  await page.selectOption("#dcMode", "FT4");
  await page.selectOption("#dcSrc", "rtl");
  await page.selectOption("#lsBand", "20");
  assert.match(await page.textContent("#dcTune"), /Tune to FT4 on 20 m \(14,080 kHz USB\)/);
  await page.click("#dcTune");
  assert.equal(await page.evaluate(() => [listen.rx, listen.kHz, listen.mode].join()), "rtl,14080,usb");
  await page.fill("#rtlAddr", `127.0.0.1:${fake.port}`);
  await page.press("#rtlAddr", "Enter");
  await page.click("#lsGo");
  await page.waitForFunction(() => /Connected: R828D/.test(document.getElementById("rtlStatus").textContent));
  await page.click("#dcStart");
  assert.equal(await page.textContent("#dcStart"), "Stop decoding");
  const popupP = page.waitForEvent("popup");
  await page.click("#dcWindow");
  const popup = await popupP;
  await popup.waitForLoadState();

  // Within two FT4 cycles (15 s) the CQ should be decoded
  await page.waitForFunction(() => dc.rows.some((r) => r.text === "CQ M3VRV IO93"), null, { timeout: 25000 });
  const row = await page.evaluate(() => dc.rows.find((r) => r.text === "CQ M3VRV IO93"));
  assert.equal(row.mode, "FT4");
  assert.ok(Math.abs(row.freq - 1200) <= 15, `freq ${row.freq}`);
  assert.ok(Math.abs(row.dt) <= 0.3, `dt ${row.dt}`);
  assert.match(row.utc, /^\d{6}$/);
  const html = await page.innerHTML("#dcRows");
  assert.match(html, /class="dcmine/, "my own call is highlighted");
  assert.match(html, /data-call="M3VRV"/, "callsigns are links");
  assert.match(await page.textContent("#dcStatus"), /FT4: \d+ decoded/);
  // the results window shows it too
  await popup.waitForFunction(() => /CQ M3VRV IO93/.test(document.getElementById("dwRows").textContent), null, { timeout: 10000 });
  assert.match(await popup.textContent("#dwRows"), /FT4/);
  // CQ only filter keeps it, a search for another call hides it
  await popup.fill("#dwFind", "G4ABC");
  assert.match(await popup.textContent("#dwRows"), /No decodes yet/);
  await popup.close();

  // Settings saved; stop
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("bw-decode"))), { mode: "FT4", src: "rtl", device: "", cqOnly: false });
  await page.click("#dcStart");
  assert.equal(await page.evaluate(() => dc.running), false);
  await page.click("#lsStop");
  assert.deepEqual(errors.filter((e) => !/request failed: .*\/api\/sdr\/stream/.test(e)), []);
});

test("decoder: sound-card input starts (with a test microphone) and the panel can be hidden", { skip, timeout: 30000 }, async (t) => {
  const b2 = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  t.after(() => b2.close());
  await srv.reset();
  const page = await (await b2.newContext({ viewport: { width: 1200, height: 1200 } })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/");
  await page.selectOption("#dcSrc", "mic");
  assert.ok(await page.isVisible("#dcDevRow"));
  assert.ok(await page.isHidden("#dcTune"), "no tune button for the sound input");
  await page.click("#dcStart");
  await page.waitForFunction(() => /Listening for FT8|Listening to the sound input|Waiting/.test(document.getElementById("dcStatus").textContent));
  await page.waitForFunction(() => dc.rate > 0, null, { timeout: 10000 }); // audio is flowing to the decoder
  const opts = await page.$$eval("#dcDev option", (o) => o.length);
  assert.ok(opts >= 1);
  await page.click("#dcStart");
  assert.equal(await page.evaluate(() => dc.running), false);
  // the section can be hidden from Settings
  await page.click("#optBtn");
  await page.uncheck('#optSecs input[data-sec="decode"]');
  await page.keyboard.press("Escape");
  assert.ok(await page.isHidden("#secDecode"));
  assert.deepEqual(errors, []);
});

test("RTL-SDR connection settings: Band Watch starts rtl_tcp itself, and reconnects when it drops", { skip, timeout: 60000 }, async (t) => {
  const path = require("path");
  const net = require("net");
  const exe = path.join(__dirname, "fixtures", "rtl_tcp");
  const port = await new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const { page, errors } = await openPage(t);
  t.after(() => page.evaluate(() => fetch("/api/sdr/launch/stop", { method: "POST", headers: { "Content-Type": "application/json", "X-Band-Watch": "sdr" }, body: "{}" })).catch(() => {}));
  await page.click("#optBtn");
  await page.fill("#optRtlAddr", `127.0.0.1:${port}`);
  await page.press("#optRtlAddr", "Enter");
  await page.fill("#optRtlDev", "0");
  await page.press("#optRtlDev", "Enter");
  await page.check("#optRtlAuto2");
  await page.fill("#optRtlExe", exe);
  await page.press("#optRtlExe", "Enter");
  assert.equal(await page.isChecked("#optRtlReconnect"), true, "reconnect is on by default");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("bw-sdr")));
  assert.equal(saved.autoStart, true);
  assert.equal(saved.exePath, exe);
  assert.equal(saved.device, 0);
  await page.keyboard.press("Escape");

  // Press Listen: Band Watch starts rtl_tcp, waits for it, connects
  await page.selectOption("#lsRx", "rtl");
  await page.click("#lsGo");
  await page.waitForFunction(() => /Connected: R828D/.test(document.getElementById("rtlStatus").textContent), null, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 500)); // let the start-up settings reach it
  // ...then rtl_tcp goes away (as if it crashed): Band Watch starts it again and reconnects by itself
  await page.evaluate(() => fetch("/api/sdr/launch/stop", { method: "POST", headers: { "Content-Type": "application/json", "X-Band-Watch": "sdr" }, body: "{}" }));
  await page.waitForFunction(() => /reconnecting \(1 of 5\)/.test(document.getElementById("rtlStatus").textContent), null, { timeout: 10000 });
  await page.waitForFunction(() => /Connected: R828D/.test(document.getElementById("rtlStatus").textContent), null, { timeout: 15000 });
  assert.equal(await page.evaluate(() => sdr.running), true);

  // Settings shows what rtl_tcp is doing
  await page.click("#optBtn");
  await page.waitForFunction(() => /rtl_tcp is running/.test(document.getElementById("optRtlProc").textContent));
  assert.match(await page.textContent("#optRtlProc"), /Blog V4/);
  await page.click("#optRtlKill");
  await page.waitForFunction(() => /rtl_tcp stopped/.test(document.getElementById("optRtlMsg").textContent));
  await page.keyboard.press("Escape");
  await page.click("#lsStop");
  assert.deepEqual(errors.filter((e) => !/request failed: .*\/api\/sdr\/stream|status of 502/.test(e)), []);
});

/* Screenshots for the README and release page: SHOTS_DIR=docs/images npm run test:browser -- --test-name-pattern=screenshots */
test("screenshots for the README", { skip: (!process.env.SHOTS_DIR && "set SHOTS_DIR to take them") || skip, timeout: 120000 }, async (t) => {
  const dir = process.env.SHOTS_DIR;
  require("fs").mkdirSync(dir, { recursive: true });
  const shot = (p, name, opts = {}) => p.screenshot({ path: require("path").join(dir, name), ...opts });

  // 1. The main page
  const { page } = await openPage(t);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.fill("#mycall", "M3VRV");
  await page.press("#mycall", "Enter");
  await new Promise((r) => setTimeout(r, 800));
  await shot(page, "overview.png");

  // 2. Live band scope from the RTL-SDR
  const fake = await startStreamingRtlTcp();
  t.after(() => { for (const s of fake.state.sockets) s.destroy(); fake.server.close(); });
  await page.evaluate((port) => { sdrSet("addr", `127.0.0.1:${port}`); selectBand("20"); }, fake.port);
  await page.click('#scopeSpan button[data-s="full"]');
  await page.click("#scopeLiveGo");
  await page.waitForFunction(() => scope && scope.live && liveScope.rows >= 235, null, { timeout: 45000 });
  // Show the usual rtl_tcp address rather than the test's random port
  const tidy = () => page.evaluate(() => { for (const id of ["rtlAddr", "optRtlAddr"]) if (document.getElementById(id)) document.getElementById(id).value = "127.0.0.1:1234";
    const st = document.getElementById("rtlStatus"); st.textContent = st.textContent.replace(/127\.0\.0\.1:\d+/, "127.0.0.1:1234"); });
  await tidy();
  const top = await page.locator("#scopeTitle").boundingBox();
  const note = await page.locator("#scopeNote").boundingBox();
  await page.screenshot({ path: require("path").join(dir, "live-scope.png"), clip: { x: top.x - 8, y: top.y - 8, width: note.width + 16, height: note.y + note.height - top.y + 16 } });
  // 3. Listen panel with the RTL-SDR waterfall
  await page.locator("#secListen").screenshot({ path: require("path").join(dir, "listen-rtl-sdr.png") });
  // 4. Settings: RTL-SDR receiver and About this build
  await page.click("#optBtn");
  await tidy();
  await page.locator("#optRtlDongle").scrollIntoViewIfNeeded();
  await new Promise((r) => setTimeout(r, 300));
  await shot(page, "settings-rtl-sdr.png");
  await page.keyboard.press("Escape");
  await page.click("#lsStop");

  // 5. FT4 decoder and its results window
  const ftx = await startFtxRtlTcp({ text: "CQ M3VRV IO93", mode: "FT4", audioHz: 1200 });
  t.after(() => { for (const s of ftx.state.sockets) s.destroy(); ftx.server.close(); });
  await page.selectOption("#dcMode", "FT4");
  await page.selectOption("#dcSrc", "rtl");
  await page.selectOption("#lsBand", "20");
  await page.click("#dcTune");
  await page.fill("#rtlAddr", `127.0.0.1:${ftx.port}`);
  await page.press("#rtlAddr", "Enter");
  await page.click("#lsGo");
  await page.waitForFunction(() => /Connected: R828D/.test(document.getElementById("rtlStatus").textContent));
  await page.click("#dcStart");
  const popupP = page.waitForEvent("popup");
  await page.click("#dcWindow");
  const popup = await popupP;
  await popup.setViewportSize({ width: 900, height: 230 });
  await page.waitForFunction(() => dc.rows.length >= 2, null, { timeout: 40000 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { const st = document.getElementById("rtlStatus"); st.textContent = st.textContent.replace(/127\.0\.0\.1:\d+/, "127.0.0.1:1234"); });
  await page.locator("#secDecode").screenshot({ path: require("path").join(dir, "ft4-decoder.png") });
  await shot(popup, "decode-results.png");
  await page.click("#dcStart");
  await page.click("#lsStop");

  // 6. On a phone, dark mode
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", isMobile: true, hasTouch: true })).newPage();
  t.after(() => phone.context().close());
  await phone.goto(base + "/");
  await phone.waitForFunction(() => document.getElementById("banner").textContent !== "Loading live data…");
  await new Promise((r) => setTimeout(r, 800));
  await shot(phone, "phone.png");
});
