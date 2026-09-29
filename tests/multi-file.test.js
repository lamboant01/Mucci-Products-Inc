const test = require("node:test");
const assert = require("node:assert/strict");

const file = (name, size = 1024) => ({ name, size });

test("accepts 20 individual uploads and rejects 21", async () => {
  const { validateUploadSelection } = await import("../estimator/multi-file.mjs");
  assert.equal(validateUploadSelection(Array.from({ length:20 }, (_, index) => file(`${index}.stl`)), "individual").length, 20);
  assert.throws(() => validateUploadSelection(Array.from({ length:21 }, (_, index) => file(`${index}.stl`)), "individual"), /between 1 and 20/);
});

test("accepts one 3MF project and rejects two or mixed model uploads", async () => {
  const { validateUploadSelection } = await import("../estimator/multi-file.mjs");
  assert.equal(validateUploadSelection([file("project.3mf")], "project").length, 1);
  assert.throws(() => validateUploadSelection([file("one.3mf"), file("two.3mf")], "project"), /one 3MF/);
  assert.throws(() => validateUploadSelection([file("part.stl"), file("project.3mf")], "individual"), /3MF Project/);
});

test("removing a file changes aggregate totals and failed analysis cannot price", async () => {
  const { aggregateReadyAnalyses, removeUpload } = await import("../estimator/multi-file.mjs");
  const files = [
    { id:"a", status:"ready", hours:2, grams:50, plates:1, quantity:2 },
    { id:"b", status:"ready", hours:3, grams:80, plates:1, quantity:1 }
  ];
  assert.deepEqual(aggregateReadyAnalyses(files), { hours:7, grams:180, plates:3, maxSinglePlateHours:3 });
  assert.deepEqual(aggregateReadyAnalyses(removeUpload(files, "b")), { hours:4, grams:100, plates:2, maxSinglePlateHours:2 });
  assert.throws(() => aggregateReadyAnalyses([{ status:"failed" }]), /Every model/);
});
