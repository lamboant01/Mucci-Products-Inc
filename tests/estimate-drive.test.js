const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/estimate-drive");

function responseRecorder() {
  return {
    statusCode:200, body:null, headers:{},
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("Drive mirror rejects requests without the private notification token", async () => {
  const res = responseRecorder();
  await handler({ method:"POST", body:{ quoteCode:"MP-A42K7" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error:"Invalid Drive mirror request." });
});
