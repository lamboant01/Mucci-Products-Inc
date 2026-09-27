const test = require("node:test");
const assert = require("node:assert/strict");

test("accepts slicer timing statistics even when assembled G-code is absent", async () => {
  const { slicerTimeSeconds } = await import("../estimator/slicer-result.mjs");
  assert.equal(slicerTimeSeconds({ stats:{ time_estimate:1864.86 } }), 1864.86);
});

test("falls back to the slicer's per-layer timing statistics", async () => {
  const { slicerTimeSeconds } = await import("../estimator/slicer-result.mjs");
  assert.equal(slicerTimeSeconds({ stats:{ layer_times:[10.5, 20, 30.25] } }), 60.75);
});

test("falls back to an embedded G-code time when aggregate statistics are absent", async () => {
  const { slicerTimeSeconds } = await import("../estimator/slicer-result.mjs");
  const parse = (gcode) => gcode.includes(";TIME:90") ? { seconds:90 } : null;
  assert.equal(slicerTimeSeconds({ stats:{}, gcode:";TIME:90" }, parse), 90);
});

test("distinguishes a model with no printable material", async () => {
  const { slicerFilamentLength, slicerTimeSeconds } = await import("../estimator/slicer-result.mjs");
  const result = { stats:{ time_estimate:0, filament_mm:0, layer_times:[] }, gcode:"" };
  assert.equal(slicerFilamentLength(result), null);
  assert.equal(slicerTimeSeconds(result), null);
});
