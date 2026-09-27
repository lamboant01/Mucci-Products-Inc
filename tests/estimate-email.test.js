const test = require("node:test");
const assert = require("node:assert/strict");
const email = require("../api/_estimate-email");

const estimate = {
  quote_code:"MP-A42K7", name:"Anthony <Owner>", original_file_name:"bracket.stl",
  file_status:"ready", quantity:2, print_hours_per_item:1, print_minutes_per_item:15,
  colour_count:"2", design_level:"none", assembly_required:false,
  notes:"Blue & strong", estimated_material_grams:22, estimated_price:72.4,
  estimated_price_max:72.4, requires_manual_review:false, print_time_source:"slicer",
  print_profile:"standard", purge_waste_percent:10, filament_grams_per_item:10
};

test("builds an easy-to-read owner estimate email without leaking the private route", () => {
  const built = email.buildEstimateEmail(estimate, "https://mucciproducts.com/");
  assert.match(built.subject, /MP-A42K7/);
  assert.match(built.text, /Estimated price: \$72\.40 CAD/);
  assert.match(built.text, /Filament: 10\.0 g per item/);
  assert.match(built.text, /Blue & strong/);
  assert.match(built.text, /Print profile: Standard Detail/);
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
