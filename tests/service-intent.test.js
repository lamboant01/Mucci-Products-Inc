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
  const oversized = module.dimensionsToMm({ length:17, width:14, height:3, unit:"inches" });
  assert.equal(module.requiresPrintSplitting(oversized), true);
  const splitPlan = module.splitDimensionsForPrint(oversized);
  assert.equal(splitPlan.sectionCount, 4);
  assert.ok(Object.values(splitPlan.sectionDimensions).every((value) => value <= 250));
  assert.equal(module.unitMaximum("cm"), 250);
  assert.equal(module.unitMaximum("inches"), 98.425);
  assert.deepEqual(module.dimensionsToMm({ length:100, width:15, height:200, unit:"cm" }), { x:1000, y:150, z:2000 });
  assert.throws(() => module.dimensionsToMm({ length:2501, width:2, height:3, unit:"mm" }), /2500 mm or less/);
});

test("quote form presents required service and dimensions without changing existing file choices", () => {
  const html = read("estimator", "index.html");
  for (const phrase of [
    "Yes, ready to print", "Yes, but it needs modifications", "No, I need a 3D model created",
    "What do you need?", "3D Design Only", "3D Design + 3D Printing",
    "Maximum finished dimensions", "Length", "Width", "Height", "Choose unit",
    "I approve splitting and reassembly", "This approval does not select the significant assembly option below", "Material and colours", "PLA", "PETG", "Wanted colours",
    "closest available filament match based on current market availability",
    "Please choose honestly", "may change the selected design level and final price",
    "Be as specific as possible", "avoid delays caused by follow-up questions",
    "Reference images", "Up to 10 images", "10 MB each"
    , "What are you making, and how will it be used", "Project category", "Organizer / Tray", "Briefly describe the object"
  ]) assert.match(html, new RegExp(phrase.replace(/[+]/g, "\\+")));
  assert.match(html, /name="service_intent" value="DESIGN_ONLY"/);
  assert.match(html, /name="service_intent" value="DESIGN_AND_PRINT"/);
  assert.match(html, /id="reference-images"[^>]*multiple/);
  assert.match(html, /accept="[^"]*\.heic/);
});

test("customer estimator separates design, preliminary printing, and total pricing", () => {
  const source = read("estimator", "estimator.js");
  assert.match(source, /api\("\/api\/estimate-analysis"/);
  assert.match(source, /api\("\/api\/estimate-submit"/);
  assert.match(source, /createVirtualBoundingBoxModel/);
  assert.match(source, /printProfile:values\.file_status === "design" \? "preliminary"/);
  assert.match(source, /splitDimensionsForPrint/);
  assert.match(source, /splitAccepted/);
  assert.match(source, /assemblyRequired:physical && values\.assembly_required === "true"/);
  assert.doesNotMatch(source, /assemblyRequired:[^\n]*\|\|[^\n]*splitAccepted/);
  assert.match(source, /sectionCount:uploadMode\(\) === "individual"/);
  assert.match(source, /Split approval required/);
  assert.doesNotMatch(source, /must fit within 250 × 250 × 250 mm/);
  assert.match(source, /form\.elements\.desired_colours\.required = includesPhysicalPrinting/);
  assert.match(source, /desiredColours/);
  assert.match(source, /material:physical/);
  assert.match(source, /maxReferenceImages = 10/);
  assert.match(source, /maxReferenceImageBytes = 10 \* 1024 \* 1024/);
  assert.match(source, /referenceFiles/);
  assert.match(source, /modelFiles/);
  assert.match(source, /manufacturing_total/);
  assert.match(source, /applicationDescription/);
  assert.match(source, /manufacturingAssumptions/);
  assert.match(source, /Because no printable 3D file was provided/);
  assert.match(source, /Shipping is calculated separately/);
});

test("multi-file migration installs server pricing and submission RPCs", () => {
  const sql = read("supabase", "migrations", "021_multi_file_manufacturing_pricing.sql");
  assert.match(sql, /create or replace function public\.calculate_multi_file_estimate\(/);
  assert.match(sql, /create or replace function public\.submit_multi_file_estimate\(/);
  assert.match(sql, /jsonb_array_length\(model_files\) <= 8/);
  assert.match(sql, /hourly_production_factor = 5/);
  assert.match(sql, /material_rate_per_gram = 0\.28/);
  assert.match(sql, /manufacturing_setup_charge = 10/);
  assert.match(sql, /plate_charge = 4/);
  assert.match(sql, /greatest\(cfg\.base_price, subtotal_amount \* risk\)/);
  assert.match(sql, /grant execute on function public\.calculate_multi_file_estimate\(jsonb,jsonb\) to service_role/);
  assert.match(sql, /grant execute on function public\.submit_multi_file_estimate\(jsonb,jsonb,jsonb\) to service_role/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test("hourly-rate migration lowers machine time to three dollars", () => {
  const sql = read("supabase", "migrations", "022_manufacturing_hourly_rate.sql");
  assert.match(sql, /hourly_production_factor = 3/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test("intended-use migration stores assumptions and removes no-file plate and risk surcharges", () => {
  const sql = read("supabase", "migrations", "023_intended_use_preliminary_estimates.sql");
  for (const column of ["application_category", "application_description", "ai_geometry_classification", "geometry_utilization_factor", "recommended_infill_percent", "recommended_wall_loops", "recommended_top_bottom_layers", "estimation_method"]) assert.match(sql, new RegExp(column));
  assert.match(sql, /p_request ->> 'fileStatus' = 'design'/);
  assert.match(sql, /risk_multiplier := 1/);
  assert.match(sql, /plate_charge := 0/);
  assert.match(sql, /manufacturingAssumptions/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test("database migration stores separate service pricing and preserves quantity behavior", () => {
  const sql = read("supabase", "migrations", "017_separate_design_and_print_estimates.sql");
  for (const value of ["DESIGN_ONLY", "DESIGN_AND_PRINT", "PRINT_ONLY", "MODIFY_AND_PRINT"]) assert.match(sql, new RegExp(value));
  for (const column of ["submitted_length", "submitted_width", "submitted_height", "dimension_unit", "split_and_assembly_accepted", "estimated_section_count", "desired_colours", "design_estimate_min", "print_estimate_min", "estimated_total_min"]) assert.match(sql, new RegExp(column));
  assert.match(sql, /design_price \+ coalesce\(print_estimate_min, 0\)/i);
  assert.doesNotMatch(sql, /design_price\s*\*\s*p_quantity/i);
  assert.match(sql, /p_quantity <> 1[\s\S]*Design-only estimates cannot include physical printing/i);
  assert.match(sql, /compute_print_estimate\([\s\S]*'ready',p_quantity[\s\S]*'none'/i);
  assert.match(sql, /virtual_bounding_box/);
  assert.match(sql, /greatest\(p_model_length_mm,p_model_width_mm,p_model_height_mm\) > 250[\s\S]*p_split_and_assembly_accepted/i);
  assert.match(sql, /Enter the wanted colours using 200 characters or fewer/);
  assert.match(sql, /Choose PLA or PETG for printing/);
});

test("follow-up migration upgrades an already-applied estimator schema", () => {
  const sql = read("supabase", "migrations", "018_estimator_material_and_oversized_upgrade.sql");
  assert.match(sql, /create or replace function public\.calculate_service_estimate\([\s\S]*p_material text/);
  assert.match(sql, /create or replace function public\.submit_service_estimate\([\s\S]*p_desired_colours text/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test("reference-image migration enforces private attachment limits", () => {
  const sql = read("supabase", "migrations", "019_reference_images_and_a1_speed_update.sql");
  assert.match(sql, /reference_files jsonb/);
  assert.match(sql, /jsonb_array_length\(p_reference_files\) > 10/);
  assert.match(sql, /10485760/);
  assert.match(sql, /references\/\[0-9a-f-\]\{36\}/);
  assert.match(sql, /p_reference_files jsonb/);
  assert.match(sql, /to anon/);
  assert.match(sql, /to authenticated/);
});

test("larger-dimension migration accepts the pictured 200 cm request", () => {
  const sql = read("supabase", "migrations", "020_larger_finished_dimensions.sql");
  assert.match(sql, /p_model_length_mm > 2500/);
  assert.match(sql, /no larger than 2500 mm/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
});

test("email and admin review show separated estimate components", () => {
  const email = read("api", "_estimate-email.js");
  const admin = read("admin", "estimates", "estimates.js");
  for (const source of [email, admin]) {
    assert.match(source, /Service selected/);
    assert.match(source, /design estimate/i);
    assert.match(source, /Preliminary print estimate/i);
    assert.match(source, /Wanted colours/i);
    assert.match(source, /Reference images/i);
  }
});
