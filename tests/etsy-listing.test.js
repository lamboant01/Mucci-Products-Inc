const test = require("node:test");
const assert = require("node:assert/strict");

const listing = require("../api/_etsy-listing");
const config = listing.config;

const estimate = {
  id:"123e4567-e89b-42d3-a456-426614174000",
  quote_code:"MP-A42K7",
  email:"customer@example.com",
  file_status:"ready",
  design_level:"none",
  material:"PLA",
  colour_count:"2",
  assembly_required:false,
  estimated_production_hours_max:12,
  admin_notes:"Never expose this internal note"
};

test("builds a concise customer-safe Etsy package", () => {
  const prepared = listing.buildPackage(estimate, {
    finalPrice:115,
    physicalQuantity:5,
    listingQuantity:1
  });

  assert.equal(prepared.title, "Custom 3D Printing Order - MP-A42K7");
  assert.doesNotMatch(prepared.title, /[^A-Za-z0-9 /.,()\-"%:&]/);
  assert.equal(prepared.price, "$115.00 CAD");
  assert.equal(prepared.listingQuantity, 1);
  assert.equal(prepared.physicalQuantity, 5);
  assert.equal(prepared.processing, "3–5 business days");
  assert.match(prepared.description, /Quantity: 5/);
  assert.match(prepared.description, /Material: PLA/);
  assert.match(prepared.description, /Colours: 2/);
  assert.doesNotMatch(prepared.description, /customer@example\.com|Never expose|123e4567|hourly|per[- ]gram/i);
  assert.match(prepared.summary, /Listing Quantity:\n1/);
  assert.match(prepared.summary, /Physical Quantity:\n5/);
});

test("generated listing titles use only Etsy-accepted punctuation", () => {
  assert.equal(
    listing.buildTitle({ ...estimate, file_status:"design", design_level:"simple" }),
    "Custom 3D Design & Print - MP-A42K7"
  );
});

test("uses central conservative processing rules and manual fallback", () => {
  assert.equal(listing.suggestProcessing({ estimated_production_hours_max:4 }, config), "1–3 business days");
  assert.equal(listing.suggestProcessing({ estimated_production_hours_max:20 }, config), "3–5 business days");
  assert.equal(listing.suggestProcessing({ estimated_production_hours_max:60 }, config), "5–10 business days");
  assert.equal(listing.suggestProcessing({ estimated_production_hours_max:61 }, config), config.manualProcessingLabel);
  assert.equal(listing.suggestProcessing({ estimated_production_hours_max:2, assembly_required:true }, config), config.manualProcessingLabel);
  assert.equal(listing.suggestProcessing({ processing_time_override:"7–12 business days" }, config), "7–12 business days");
});

test("builds distinct ready and clarification replies", () => {
  const ready = listing.buildReply(estimate, 115, "");
  const clarification = listing.buildReply(estimate, 115, "Please confirm the mounting-hole diameter.");

  assert.match(ready, /final project price is \$115\.00 CAD/);
  assert.match(ready, /private Etsy listing/);
  assert.match(clarification, /Before I finalize/);
  assert.match(clarification, /mounting-hole diameter/);
  assert.doesNotMatch(clarification, /customer@example\.com|admin/i);
});

test("includes design only when the estimate requires it", () => {
  const designed = listing.buildDescription({ ...estimate, file_status:"design", design_level:"simple" }, 80, 1);
  const ready = listing.buildDescription(estimate, 80, 1);
  assert.match(designed, /3D Design: Simple/);
  assert.doesNotMatch(ready, /3D Design:/);
});
