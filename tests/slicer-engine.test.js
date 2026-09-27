const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("built-in slicer returns time and material for a printable model", { timeout:30000 }, async () => {
  const { createSlicer } = await import("three-slicer");
  const { SLICER_PROFILES } = await import("../estimator/slicer-config.js");
  const slicer = await createSlicer();
  try {
    const model = fs.readFileSync(path.join(__dirname, "fixtures", "test-cube.stl"));
    const result = slicer.slice(model, SLICER_PROFILES.standard);
    assert.ok(Number(result?.stats?.time_estimate) > 0);
    assert.ok(Number(result?.stats?.filament_mm) > 0);
    assert.ok(result?.gcode?.length > 0);
  } finally {
    slicer.dispose();
  }
});
