"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../public/js/support.js");

test("validateSupportUrl: only https on the allowed sites", () => {
  for (const ok of ["https://ko-fi.com/someone", "https://www.ko-fi.com/someone", "https://github.com/sponsors/someone",
    "https://buymeacoffee.com/someone", "https://www.buymeacoffee.com/someone", "https://liberapay.com/someone"]) {
    assert.ok(S.validateSupportUrl(ok), ok);
  }
  for (const bad of ["", "   ", null, undefined, 5, "http://ko-fi.com/x", "https://example.com/x", "https://ko-fi.com.evil.com/x",
    "https://evil.com/ko-fi.com", "https://github.com/someone", "https://github.com/sponsors", "javascript:alert(1)",
    "https://user:pw@ko-fi.com/x", "https://ko-fi.com:8443/x", "ko-fi.com/x", "https://xko-fi.com/x"]) {
    assert.equal(S.validateSupportUrl(bad), "", String(bad));
  }
});

test("supportState: hidden when empty or invalid, supporters only with a valid link", () => {
  assert.equal(S.SUPPORT_URL, "", "shipped with no support link");
  assert.deepEqual(S.SUPPORTERS, []);
  assert.deepEqual(S.supportState("", ["M3VRV"]), { show: false, url: "", supporters: [] });
  assert.deepEqual(S.supportState("http://ko-fi.com/x", []), { show: false, url: "", supporters: [] });
  const on = S.supportState("https://ko-fi.com/x", ["M3VRV", " G4ABC ", "<b>", "", null, "no way"]);
  assert.equal(on.show, true);
  assert.equal(on.url, "https://ko-fi.com/x");
  assert.deepEqual(on.supporters, ["M3VRV", "G4ABC"]);
  assert.deepEqual(S.supportState("https://ko-fi.com/x", null).supporters, []);
});
