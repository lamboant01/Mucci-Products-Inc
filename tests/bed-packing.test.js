const test = require("node:test");
const assert = require("node:assert/strict");

test("auto-arranges project objects across actual A1 beds without overlap", async () => {
  const { packPrintBeds } = await import("../estimator/bed-packing.mjs");
  const plates = packPrintBeds([
    { name:"A", width:140, depth:140, height:20 },
    { name:"B", width:140, depth:140, height:30 },
    { name:"C", width:100, depth:100, height:40 }
  ]);
  assert.equal(plates.length, 2);
  for (const plate of plates) {
    for (const placement of plate.placements) {
      assert.ok(placement.x >= 0 && placement.y >= 0);
      assert.ok(placement.x + placement.width <= 250.000001);
      assert.ok(placement.y + placement.depth <= 250.000001);
    }
    for (let left = 0; left < plate.placements.length; left += 1) for (let right = left + 1; right < plate.placements.length; right += 1) {
      const a = plate.placements[left], b = plate.placements[right];
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.depth <= b.y || b.y + b.depth <= a.y);
    }
  }
});

test("rotates objects when that allows them to fit and rejects an oversized object", async () => {
  const { packPrintBeds } = await import("../estimator/bed-packing.mjs");
  const plates = packPrintBeds([{ name:"wide", width:240, depth:100, height:20 }, { name:"turn me", width:140, depth:100, height:20 }]);
  assert.equal(plates.length, 1);
  assert.equal(plates[0].placements.some((placement) => placement.rotated), true);
  assert.throws(() => packPrintBeds([{ name:"too large", width:300, depth:260, height:20 }]), /does not fit/);
});
