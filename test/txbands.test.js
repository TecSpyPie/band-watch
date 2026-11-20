// Band Watch: transmitting stays on HF and 6 m. 2 m and 70 cm are in the band plan for listening only.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function txContext() {
  const plan = require("../public/js/bandplan.js");
  const ctx = { ...plan, console, document: { getElementById: () => null, addEventListener() {} }, window: {}, addEventListener() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, "../public/js/tx.js"), "utf8");
  // Load just the band check: TX_BANDS, TX_NOT_IN and txBandProblem, without the rest of the page.
  const start = src.indexOf("const TX_BANDS");
  const end = src.indexOf("/** Why Band Watch can't transmit right now");
  assert.ok(start >= 0 && end > start, "tx.js band check found");
  vm.runInContext(src.slice(start, end) + "\nthis.txBandProblem = txBandProblem;", ctx);
  return ctx;
}

test("TX: refuses 2 m and 70 cm, even though they're in the band plan", () => {
  const { txBandProblem } = txContext();
  assert.match(txBandProblem(144174, 144177, 50, "FT8"), /only transmits on HF and 6 m, not on 2 m/);
  assert.match(txBandProblem(432174, 432177, 50, "FT8"), /only transmits on HF and 6 m, not on 70 cm/);
  assert.match(txBandProblem(145500, 145512, 2500, "SSTV"), /not on 2 m/);
  assert.match(txBandProblem(7300, 7303, 50, "FT8"), /outside the amateur bands/);
});

test("TX: HF still allowed where it was before", () => {
  const { txBandProblem } = txContext();
  assert.strictEqual(txBandProblem(14074.5, 14077.5, 50, "FT8"), "");
});
