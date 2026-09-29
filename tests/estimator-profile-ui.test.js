const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("print profile analysis stays server-authoritative", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "estimator", "estimator.js"), "utf8");
  assert.doesNotMatch(source, /Estimated print time:/);
  assert.doesNotMatch(source, /Estimated filament:/);
  assert.match(source, /Analyzing models securely/);
  assert.match(source, /api\/estimate-analysis/);
  assert.match(source, /api\/estimate-submit/);
});

test("customer estimate hides internal pricing logic and requests a final quote", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "estimator", "estimator.js"), "utf8");
  assert.match(source, /Estimated print time/);
  assert.match(source, /Estimated material/);
  assert.match(source, /Manufacturing estimate/);
  assert.match(source, /About this estimate/);
  assert.match(source, /REQUEST FINAL QUOTE/);
  assert.match(source, /Shipping is calculated separately/);
  assert.doesNotMatch(source, /Large-job factor/);
  assert.doesNotMatch(source, /Print jobs/);
  assert.doesNotMatch(source, /Print plates \/ jobs/);
  assert.doesNotMatch(source, /toFixed\(1\).* g/);
});
