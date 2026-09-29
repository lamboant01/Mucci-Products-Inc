const test = require("node:test");
const assert = require("node:assert/strict");
const { manufacturingPrice, riskMultiplier } = require("../api/_print-pricing");

test("applies deterministic manufacturing risk tiers", () => {
  assert.equal(riskMultiplier({ hours:5, plates:1 }), 1);
  assert.equal(riskMultiplier({ hours:20, plates:3 }), 1.05);
  assert.equal(riskMultiplier({ hours:40, plates:5 }), 1.10);
  assert.equal(riskMultiplier({ hours:78.55, plates:9 }), 1.15);
  assert.equal(riskMultiplier({ hours:15, plates:2, maxSinglePlateHours:21 }), 1.10);
});

test("calculates the requested setup, time, material, plate and risk price", () => {
  const result = manufacturingPrice({ hours:78.55, grams:1676.56, plates:9 });
  assert.equal(result.setupCharge, 10);
  assert.equal(result.timeCharge, 235.65);
  assert.equal(result.subtotal, 751.09);
  assert.equal(result.riskMultiplier, 1.15);
  assert.equal(result.total, 863.75);
});

test("enforces the 40 CAD manufacturing minimum", () => {
  assert.equal(manufacturingPrice({ hours:1, grams:10, plates:1 }).total, 40);
});
