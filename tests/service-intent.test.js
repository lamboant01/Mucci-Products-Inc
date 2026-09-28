const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");

test("no-file services require an explicit design intent and convert dimensions", async () => {
  const module = await import("../estimator/service-intent.mjs");
  assert.equal(module.resolveServiceIntent("design", ""), "");
  assert.equal(module.resolveServiceIntent("design", "DESIGN_ONLY"), "DESIGN_ONLY");
  assert.equal(module.resolveServiceIntent("design", "DESIGN_AND_PRINT"), "DESIGN_AND_PRINT");
  assert.equal(module.resolveServiceIntent("ready"), "PRINT_ONLY");
  assert.equal(module.resolveServiceIntent("modify"), "MODIFY_AND_PRINT");
  assert.deepEqual(module.dimensionsToMm({ length:2, width:3, height:4, unit:"cm" }), { x:20, y:30, z:40 });
  assert.deepEqual(module.dimensionsToMm({ length:1, width:2, height:3, unit:"inches" }), { x:25.4, y:50.8, z:76.19999999999999 });
  assert.throws(() => module.dimensionsToMm({ length:0, width:2, height:3, unit:"mm" }), /greater than zero/);
  assert.throws(() => module.dimensionsToMm({ length:251, width:2, height:3, unit:"mm" }), /250 mm or less/);
});

test("quote form presents required service and dimensions without changing existing file choices", () => {
  const html = read("estimator", "index.html");
  for (const phrase of [
    "Yes, ready to print", "Yes, but it needs modifications", "No, I need a 3D model created",
    "What do you need?", "3D Design Only", "3D Design + 3D Printing",
    "Maximum finished dimensions", "Length", "Width", "Height", "Choose unit"
  ]) assert.match(html, new RegExp(phrase.replace(/[+]/g, "\\+")));
  assert.match(html, /name="service_intent" value="DESIGN_ONLY"/);
  assert.match(html, /name="service_intent" value="DESIGN_AND_PRINT"/);
});

test("customer estimator separates design, preliminary printing, and total pricing", () => {
  const source = read("estimator", "estimator.js");
  assert.match(source, /calculate_service_estimate/);
  assert.match(source, /submit_service_estimate/);
  assert.match(source, /createVirtualBoundingBoxModel/);
  assert.match(source, /sliceModel\(virtualModel, "preliminary"/);
  assert.match(source, /\["ready", "modify"\]\.includes\(fileStatus\)/);
  assert.match(source, /sliceModel\(loadedModel, printProfile/);
  assert.match(source, /Physical 3D Printing/);
  assert.match(source, /Preliminary 3D Print Estimate/);
  assert.match(source, /Physical printing is not included/);
  assert.match(source, /Final printing cost may change once the finished 3D model is available/);
});

test("database migration stores separate service pricing and preserves quantity behavior", () => {
  const sql = read("supabase", "migrations", "017_separate_design_and_print_estimates.sql");
  for (const value of ["DESIGN_ONLY", "DESIGN_AND_PRINT", "PRINT_ONLY", "MODIFY_AND_PRINT"]) assert.match(sql, new RegExp(value));
  for (const column of ["submitted_length", "submitted_width", "submitted_height", "dimension_unit", "design_estimate_min", "print_estimate_min", "estimated_total_min"]) assert.match(sql, new RegExp(column));
  assert.match(sql, /design_price \+ coalesce\(print_estimate_min, 0\)/i);
  assert.doesNotMatch(sql, /design_price\s*\*\s*p_quantity/i);
  assert.match(sql, /p_quantity <> 1[\s\S]*Design-only estimates cannot include physical printing/i);
  assert.match(sql, /compute_print_estimate\([\s\S]*'ready',p_quantity[\s\S]*'none'/i);
  assert.match(sql, /virtual_bounding_box/);
});

test("email and admin review show separated estimate components", () => {
  const email = read("api", "_estimate-email.js");
  const admin = read("admin", "estimates", "estimates.js");
  for (const source of [email, admin]) {
    assert.match(source, /Service selected/);
    assert.match(source, /design estimate/i);
    assert.match(source, /Preliminary print estimate/i);
  }
});
