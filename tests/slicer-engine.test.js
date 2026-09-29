const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("built-in slicer returns time and material for a printable model", { timeout:30000 }, async () => {
  const { createSlicer } = await import("three-slicer");
  const { SLICER_PROFILES, A1_SPEED_REFERENCE } = await import("../estimator/slicer-config.js");
  assert.deepEqual(Object.keys(SLICER_PROFILES), ["standard", "draft", "preliminary"]);
  assert.equal(SLICER_PROFILES.standard.layer_height, 0.20);
  assert.equal(SLICER_PROFILES.standard.infill_density, 0.30);
  assert.equal(SLICER_PROFILES.standard.wall_loops, 3);
  assert.equal(SLICER_PROFILES.standard.sparse_infill_pattern, "grid");
  assert.equal(SLICER_PROFILES.draft.layer_height, 0.24);
  assert.equal(SLICER_PROFILES.preliminary.wall_loops, 4);
  assert.equal(SLICER_PROFILES.preliminary.infill_density, 0.30);
  assert.equal(SLICER_PROFILES.preliminary.layer_height, 0.20);
  assert.equal(SLICER_PROFILES.standard.first_layer_speed, 50);
  assert.equal(SLICER_PROFILES.standard.print_speed, 200);
  assert.equal(SLICER_PROFILES.preliminary.print_speed, 200);
  assert.deepEqual(A1_SPEED_REFERENCE, {
    initial_layer:50, initial_layer_infill:105, outer_wall:200, inner_wall:230,
    small_perimeters_percent:50, small_perimeter_threshold_mm:0,
    sparse_infill:230, internal_solid_infill:230, vertical_shell_percent:80
  });
  const slicer = await createSlicer();
  try {
    const model = fs.readFileSync(path.join(__dirname, "fixtures", "test-cube.stl"));
    for (const profile of Object.values(SLICER_PROFILES)) {
      const result = slicer.slice(model, profile);
      assert.ok(Number(result?.stats?.time_estimate) > 0);
      assert.ok(Number(result?.stats?.filament_mm) > 0);
      assert.ok(result?.gcode?.length > 0);
    }
    for (const sparse_infill_pattern of ["grid", "gyroid", "triangles"]) {
      const result = slicer.slice(model, { ...SLICER_PROFILES.standard, sparse_infill_pattern });
      assert.ok(Number(result?.stats?.time_estimate) > 0, `${sparse_infill_pattern} should produce a time estimate`);
      assert.ok(Number(result?.stats?.filament_mm) > 0, `${sparse_infill_pattern} should produce material usage`);
    }
  } finally {
    slicer.dispose();
  }
});
