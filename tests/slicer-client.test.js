const test = require("node:test");
const assert = require("node:assert/strict");

test("sliceStats requests an unstreamed statistics-only slice", async () => {
  const { createSlicerClient } = await import("../estimator/vendor/three-slicer/engine/src/client.js");
  let sent;
  const worker = new EventTarget();
  worker.postMessage = (message) => {
    sent = message;
    queueMicrotask(() => worker.dispatchEvent(new MessageEvent("message", {
      data:{
        type:"done",
        result:{ stats:{ time_estimate:120, filament_mm:45 }, warnings:[] }
      }
    })));
  };
  worker.terminate = () => {};

  const client = createSlicerClient(worker);
  const result = await client.sliceStats(new Uint8Array([1, 2, 3]), { layer_height:0.2 });

  assert.equal(sent.cmd, "sliceStats");
  assert.equal(JSON.parse(sent.params).layer_height, 0.2);
  assert.equal(result.stats.time_estimate, 120);
  assert.equal(result.stats.filament_mm, 45);
  client.terminate();
});
