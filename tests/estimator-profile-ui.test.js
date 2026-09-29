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
