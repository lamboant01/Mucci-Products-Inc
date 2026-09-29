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
  assert.doesNotMatch(source, /Estimated print time/);
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

test("advanced slicing controls are optional and start with current defaults", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "estimator", "index.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "estimator", "estimator.js"), "utf8");
  assert.match(html, /role="switch"/);
  assert.match(html, /name="infill_percent" value="30" min="1" max="100"/);
  assert.match(html, /name="wall_loops" value="3" min="2" max="20"/);
  assert.match(html, /option value="grid" selected/);
  assert.match(html, /option value="gyroid"/);
  assert.match(html, /option value="triangles"/);
  assert.match(script, /advancedSettings:advancedSettingsEnabled/);
  assert.match(script, /updateAdvancedSettings/);
});
