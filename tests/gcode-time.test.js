const test = require("node:test");
const assert = require("node:assert/strict");
const gcodeTime = require("../estimator/gcode-time.js");

test("reads Cura TIME seconds", () => {
  assert.deepEqual(gcodeTime.parse(";FLAVOR:Marlin\n;TIME:45030\n;Layer height: 0.2"), { seconds:45030, source:"Cura" });
});

test("reads PrusaSlicer human-readable estimate", () => {
  assert.deepEqual(gcodeTime.parse("; estimated printing time (normal mode) = 12h 30m 5s"), { seconds:45005, source:"slicer" });
});

test("reads a colon-formatted embedded estimate", () => {
  assert.deepEqual(gcodeTime.parse("; total estimated time: 01:02:03"), { seconds:3723, source:"slicer" });
});

test("rejects G-code without an embedded estimate", () => {
  assert.equal(gcodeTime.parse("G28\nG1 X10 Y10 F3000"), null);
});

test("rounds partial minutes up for pricing", () => {
  assert.deepEqual(gcodeTime.toHoursMinutes(45005), { hours:12, minutes:31 });
});
