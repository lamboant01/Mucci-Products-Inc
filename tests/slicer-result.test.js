const test = require("node:test");
const assert = require("node:assert/strict");
const analysis = require("../api/_estimate-analysis");

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

test("server analysis keeps full timing enabled and converts WASM aborts into a safe error", () => {
  let options;
  const result = analysis.sliceForStatistics({
    slice(_stl, _profile, received) { options = received; return { stats:{ time_estimate:60, filament_mm:100 } }; }
  }, new Uint8Array([1]), {}, "large.3mf");
  assert.equal(options, undefined);
  assert.equal(result.stats.time_estimate, 60);
  assert.throws(
    () => analysis.sliceForStatistics({ slice() { throw new Error("Aborted(). Build with -sASSERTIONS for more info."); } }, new Uint8Array([1]), {}, "49-parts.3mf"),
    /too complex for automatic slicing/
  );
});

test("over-bed toolpaths require explicit split approval", () => {
  const slicer = { slice() { return { warnings:["over_bed_model"], stats:{ time_estimate:600, filament_mm:500 } }; } };
  assert.throws(() => analysis.sliceForStatistics(slicer, new Uint8Array([1]), {}, "poster board.STL"), /does not fit/);
  const approved = analysis.sliceForStatistics(slicer, new Uint8Array([1]), {}, "poster board.STL", { allowOverBed:true });
  assert.equal(approved.stats.time_estimate, 600);
});

test("server analysis supports several generated bed paths for one 3MF project", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "api", "_estimate-analysis.js"), "utf8");
  assert.match(source, /input\.analysisPaths/);
  assert.match(source, /Duplicate print-bed analysis path/);
  assert.match(source, /analysis_paths:analysisFiles\.map/);
  assert.match(source, /max_single_plate_hours:splitAnalysis \? null : Number/);
});

test("advanced print settings preserve defaults until explicitly enabled", () => {
  const base = { infill_density:0.30, wall_loops:3, sparse_infill_pattern:"grid", layer_height:0.20 };
  const resolved = analysis.resolvePrintSettings({ advancedSettings:{ enabled:false, infillPercent:99, wallLoops:19, infillPattern:"gyroid" } }, base);
  assert.deepEqual(resolved.settings, { custom:false, infill_percent:30, wall_loops:3, infill_pattern:"grid" });
  assert.deepEqual(resolved.profile, base);
});

test("advanced print settings alter the authoritative server slicer profile", () => {
  const base = { infill_density:0.30, wall_loops:3, sparse_infill_pattern:"grid", layer_height:0.20 };
  const resolved = analysis.resolvePrintSettings({ advancedSettings:{ enabled:true, infillPercent:55, wallLoops:5, infillPattern:"gyroid" } }, base);
  assert.deepEqual(resolved.settings, { custom:true, infill_percent:55, wall_loops:5, infill_pattern:"gyroid" });
  assert.equal(resolved.profile.infill_density, 0.55);
  assert.equal(resolved.profile.wall_loops, 5);
  assert.equal(resolved.profile.sparse_infill_pattern, "gyroid");
  assert.equal(base.infill_density, 0.30);
});

test("advanced print settings reject unsafe or unsupported values", () => {
  const base = { infill_density:0.30, wall_loops:3, sparse_infill_pattern:"grid" };
  assert.throws(() => analysis.resolvePrintSettings({ advancedSettings:{ enabled:true, infillPercent:0, wallLoops:3, infillPattern:"grid" } }, base), /1 to 100/);
  assert.throws(() => analysis.resolvePrintSettings({ advancedSettings:{ enabled:true, infillPercent:30, wallLoops:1, infillPattern:"grid" } }, base), /2 to 20/);
  assert.throws(() => analysis.resolvePrintSettings({ advancedSettings:{ enabled:true, infillPercent:30, wallLoops:3, infillPattern:"honeycomb" } }, base), /Grid, Gyroid, or Triangles/);
});
