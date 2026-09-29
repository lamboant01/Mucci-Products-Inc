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

test("server analysis streams layers and converts WASM aborts into a safe error", () => {
  let options;
  const result = analysis.sliceForStatistics({
    slice(_stl, _profile, received) { options = received; return { stats:{ time_estimate:60, filament_mm:100 } }; }
  }, new Uint8Array([1]), {}, "large.3mf");
  assert.equal(typeof options.onLayer, "function");
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
