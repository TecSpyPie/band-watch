"use strict";
// The Android app (Google Play, a Trusted Web Activity): /.well-known/assetlinks.json on both servers
// (BW_SERVER=go for the Go one), the web app manifest the app is made from, android/twa-manifest.json,
// the build workflow and the privacy page.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { startUpstream, startServer, ROOT } = require("./helpers.js");
const { assetLinks, ANDROID_PACKAGE_DEFAULT } = require("../server.js");

const FP_A = "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
const FP_B = "11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF";
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));

/* ---------- assetLinks() ---------- */

test("assetLinks is empty until a valid fingerprint is set", () => {
  for (const certs of [undefined, "", " , ", "not-a-fingerprint", "AB:CD", FP_A.slice(3)]) {
    assert.equal(assetLinks({ ANDROID_CERT_SHA256: certs }), null, String(certs));
  }
  assert.equal(assetLinks({ ANDROID_CERT_SHA256: FP_A, ANDROID_PACKAGE: "not a package" }), null);
  assert.equal(assetLinks({ ANDROID_CERT_SHA256: FP_A, ANDROID_PACKAGE: "nodots" }), null);
});

test("assetLinks lists the app with tidied, de-duplicated fingerprints", () => {
  const links = assetLinks({ ANDROID_CERT_SHA256: ` ${FP_A.toLowerCase()}, ${FP_B},junk,${FP_A}` });
  assert.deepEqual(links, [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: ANDROID_PACKAGE_DEFAULT, sha256_cert_fingerprints: [FP_A, FP_B] },
  }]);
  assert.equal(assetLinks({ ANDROID_CERT_SHA256: FP_A, ANDROID_PACKAGE: " uk.example.radio " })[0].target.package_name, "uk.example.radio");
});

/* ---------- Both servers ---------- */

test("/.well-known/assetlinks.json is 404 when not set up, and the statement when it is", async () => {
  const up = await startUpstream(() => undefined);
  const off = await startServer(up.base, undefined, { ANDROID_CERT_SHA256: "", ANDROID_PACKAGE: "" });
  const on = await startServer(up.base, undefined, { ANDROID_CERT_SHA256: `${FP_A},${FP_B}`, ANDROID_PACKAGE: "" });
  try {
    assert.equal((await fetch(`${off.base}/.well-known/assetlinks.json`)).status, 404);
    const r = await fetch(`${on.base}/.well-known/assetlinks.json`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /^application\/json/);
    const body = await r.json();
    assert.equal(body[0].target.package_name, ANDROID_PACKAGE_DEFAULT);
    assert.deepEqual(body[0].target.sha256_cert_fingerprints, [FP_A, FP_B]);
    assert.equal((await fetch(`${on.base}/.well-known/assetlinks.json`, { method: "HEAD" })).status, 200);
    assert.equal((await fetch(`${on.base}/.well-known/assetlinks.json`, { method: "POST" })).status, 405);
    const priv = await fetch(`${on.base}/privacy`);
    assert.equal(priv.status, 200);
    assert.match(await priv.text(), /HamShack privacy/);
  } finally {
    await off.stop(); await on.stop(); await up.close();
  }
});

test("the Go server uses the same default package name", () => {
  const go = fs.readFileSync(path.join(ROOT, "desktop", "assetlinks.go"), "utf8");
  assert.match(go, new RegExp(`androidPackageDefault = "${ANDROID_PACKAGE_DEFAULT.replace(/\./g, "\\.")}"`));
});

/* ---------- What the Play Store app is made from ---------- */

test("the web app manifest has what Google Play and Bubblewrap need", () => {
  const m = readJson("public/manifest.webmanifest");
  assert.ok(m.name && m.short_name && m.short_name.length <= 12, "name, and a launcher name of 12 letters or fewer");
  assert.equal(m.display, "standalone");
  assert.ok(m.start_url.startsWith("/") && m.scope === "/");
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  const png = (purpose) => m.icons.find((i) => i.sizes === "512x512" && i.type === "image/png" && i.purpose.split(" ").includes(purpose));
  assert.ok(png("any"), "a 512x512 icon");
  assert.ok(png("maskable"), "a 512x512 maskable icon");
  for (const i of m.icons) assert.ok(fs.existsSync(path.join(ROOT, "public", i.src)), i.src);
});

test("android/twa-manifest.json matches the site and asks for nothing extra", () => {
  const t = readJson("android/twa-manifest.json");
  const m = readJson("public/manifest.webmanifest");
  assert.equal(t.packageId, ANDROID_PACKAGE_DEFAULT);
  assert.equal(t.host, "band-watch.ample.run");
  assert.equal(t.startUrl, m.start_url);
  assert.equal(t.launcherName, m.short_name);
  assert.equal(t.themeColor.toLowerCase(), m.theme_color.toLowerCase());
  assert.equal(t.backgroundColor.toLowerCase(), m.background_color.toLowerCase());
  assert.equal(t.fallbackType, "customtabs");
  assert.equal(t.enableNotifications, false, "no notification permission");
  assert.deepEqual(t.features, {}, "no location delegation, Play Billing or other permissions");
  for (const k of ["iconUrl", "maskableIconUrl", "webManifestUrl"]) {
    const u = new URL(t[k]);
    assert.equal(u.host, t.host, k);
    assert.ok(fs.existsSync(path.join(ROOT, "public", u.pathname)), `${k}: ${u.pathname}`);
  }
  assert.equal(t.appVersionName, require("../package.json").version, "the CI build sets this too, but keep it in step");
});

test("the Android workflow only runs by hand, keeps the key secret and makes no release", () => {
  const y = fs.readFileSync(path.join(ROOT, ".github", "workflows", "android.yml"), "utf8");
  const on = y.slice(y.indexOf("\non:"), y.indexOf("\npermissions:"));
  assert.match(on, /workflow_dispatch:/);
  assert.doesNotMatch(on, /\b(push|pull_request|schedule|release):/);
  assert.match(y, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(y, /gh release|softprops|git push|contents: write/);
  assert.match(y, /java-version: "17"/);
  assert.match(y, /npx --yes "\$BUBBLEWRAP"/);
  assert.match(y, /base64 -d > "\$RUNNER_TEMP\/upload-key\.jks"/);
  assert.doesNotMatch(y, /echo "?\$(KS|BUBBLEWRAP_KEYSTORE_PASSWORD|BUBBLEWRAP_KEY_PASSWORD)/);
  assert.match(y, /actions\/upload-artifact@v4/);
  assert.ok(!fs.existsSync(path.join(ROOT, "android", "upload-key.jks")), "no key in the repository");
  const pkg = require("../package.json");
  assert.ok(!pkg.dependencies && !pkg.devDependencies, "Bubblewrap runs in CI only, not as a dependency");
});

test("the privacy page is linked from help, and the store listing fits Play's limits", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "public", "help.html"), "utf8"), /href="\/privacy"/);
  const md = fs.readFileSync(path.join(ROOT, "android", "store-listing.md"), "utf8");
  const block = (name) => {
    const m = md.match(new RegExp(`<!-- ${name} -->\\n([\\s\\S]*?)\\n<!-- /${name} -->`));
    assert.ok(m, name);
    return m[1].trim();
  };
  assert.ok(block("short").length <= 80, `short description: ${block("short").length}`);
  assert.ok(block("full").length <= 4000, `full description: ${block("full").length}`);
  assert.ok(block("title").length <= 30, `app name: ${block("title").length}`);
});
