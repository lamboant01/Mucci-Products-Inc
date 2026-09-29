const test = require("node:test");
const assert = require("node:assert/strict");
const email = require("../api/_estimate-email");

const estimate = {
  quote_code:"MP-A42K7", name:"Anthony <Owner>", original_file_name:"bracket.stl",
  file_status:"ready", quantity:2, print_hours_per_item:1, print_minutes_per_item:15,
  colour_count:"2", desired_colours:"Matte black and teal", material:"PLA", design_level:"none", assembly_required:false,
  notes:"Blue & strong", estimated_material_grams:22, estimated_price:72.4,
  reference_files:[{ path:"submission/references/one.jpg", name:"front.jpg" }],
  estimated_price_max:72.4, requires_manual_review:false, print_time_source:"slicer",
  print_profile:"standard", purge_waste_percent:10, filament_grams_per_item:10,
  model_files:[{ name:"bracket.stl", print_settings:{ custom:true, infill_percent:45, wall_loops:4, infill_pattern:"gyroid" } }]
};

test("builds an easy-to-read owner estimate email without leaking the private route", () => {
  const built = email.buildEstimateEmail(estimate, "https://mucciproducts.com/");
  assert.match(built.subject, /MP-A42K7/);
  assert.match(built.text, /Service selected: 3D Printing/);
  assert.match(built.text, /Physical print estimate: \$72\.40 CAD/);
  assert.match(built.text, /Estimated total: \$72\.40 CAD/);
  assert.match(built.text, /Filament: 10\.0 g per item/);
  assert.match(built.text, /Wanted colours: Matte black and teal/);
  assert.match(built.text, /Material: PLA/);
  assert.match(built.text, /Reference images: 1 attached/);
  assert.match(built.text, /Blue & strong/);
  assert.match(built.text, /Print profile: Standard Detail/);
  assert.match(built.text, /Infill: 45%/);
  assert.match(built.text, /Wall loops: 4/);
  assert.match(built.text, /Infill pattern: Gyroid/);
  assert.equal(built.portalUrl, undefined);
  assert.doesNotMatch(built.text, /https?:\/\/|\/admin|card-dashboard/i);
  assert.match(built.text, /search for quote MP-A42K7/i);
  assert.match(built.html, /Anthony &lt;Owner&gt;/);
  assert.doesNotMatch(built.html, /Anthony <Owner>/);
});

test("accepts only estimator quote codes", () => {
  assert.equal(email.normalizeQuoteCode("mp-a42k7"), "MP-A42K7");
  assert.equal(email.normalizeQuoteCode("MP-11111"), "");
});

test("design-only email excludes physical printing details", () => {
  const rows = email.estimateRows({
    ...estimate,
    service_intent:"DESIGN_ONLY",
    file_status:"design",
    submitted_length:17,
    submitted_width:14,
    submitted_height:3,
    dimension_unit:"inches",
    split_and_assembly_accepted:true,
    estimated_section_count:4,
    design_estimate_min:120,
    design_estimate_max:120,
    print_estimate_min:null,
    print_estimate_max:null,
    estimated_total_min:120,
    estimated_total_max:120
  });
  const labels = rows.map(([name]) => name);
  const values = Object.fromEntries(rows);
  assert.equal(values["Service selected"], "3D Design Only");
  assert.equal(values["Physical print estimate"], "Not included");
  assert.equal(values["Estimated total"], "$120.00 CAD");
  assert.equal(values["Finished dimensions"], "17 × 14 × 3 inches");
  assert.equal(values["Split and assembly approved"], "Yes — approximately 4 printable sections");
  assert.doesNotMatch(labels.join(" "), /Print time|Filament|Material total|Colours|Purge allowance/);
});
