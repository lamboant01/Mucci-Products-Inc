const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("built-in slicer returns time and material for a printable model", { timeout:30000 }, async () => {
  const { createSlicer } = await import("three-slicer");
  const { SLICER_PROFILES } = await import("../estimator/slicer-config.js");
  assert.deepEqual(Object.keys(SLICER_PROFILES), ["standard", "draft", "preliminary"]);
  assert.equal(SLICER_PROFILES.standard.layer_height, 0.20);
  assert.equal(SLICER_PROFILES.draft.layer_height, 0.24);
  assert.equal(SLICER_PROFILES.preliminary.wall_loops, 4);
  assert.equal(SLICER_PROFILES.preliminary.infill_density, 0.30);
  assert.equal(SLICER_PROFILES.preliminary.layer_height, 0.20);
  const slicer = await createSlicer();
  try {
    const model = fs.readFileSync(path.join(__dirname, "fixtures", "test-cube.stl"));
    for (const profile of Object.values(SLICER_PROFILES)) {
      const result = slicer.slice(model, profile);
      assert.ok(Number(result?.stats?.time_estimate) > 0);
      assert.ok(Number(result?.stats?.filament_mm) > 0);
      assert.ok(result?.gcode?.length > 0);
    }
  } finally {
    slicer.dispose();
  }
});
