const test = require("node:test");
const assert = require("node:assert/strict");

test("converts slicer filament length to PLA grams", async () => {
  const { filamentGrams } = await import("../estimator/filament-math.mjs");
  assert.equal(Number(filamentGrams(1000).toFixed(3)), 2.983);
});

test("rejects invalid slicer filament usage", async () => {
  const { filamentGrams } = await import("../estimator/filament-math.mjs");
  assert.throws(() => filamentGrams(-1), /invalid filament usage/);
});

test("larger slicer usage produces proportionally higher material weight", async () => {
  const { filamentGrams } = await import("../estimator/filament-math.mjs");
  assert.equal(filamentGrams(4000), filamentGrams(1000) * 4);
});

test("uses the selected PLA or PETG filament density", async () => {
  const { filamentDensity, filamentGrams } = await import("../estimator/filament-math.mjs");
  const pla = filamentGrams(1000, undefined, filamentDensity("PLA"));
  const petg = filamentGrams(1000, undefined, filamentDensity("PETG"));
  assert.ok(petg > pla);
  assert.throws(() => filamentDensity("ABS"), /Choose PLA or PETG/);
});
