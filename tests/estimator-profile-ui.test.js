const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("print profile section does not expose slicer time or material statistics", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "estimator", "estimator.js"), "utf8");
  assert.doesNotMatch(source, /Estimated print time:/);
  assert.doesNotMatch(source, /Estimated filament:/);
  assert.match(source, /Preparing your estimate/);
});
