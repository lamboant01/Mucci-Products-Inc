const test = require("node:test");
const assert = require("node:assert/strict");
const drive = require("../api/_google-drive");

test("keeps safe customer filenames and supplies a quote fallback", () => {
  assert.equal(drive.fileName(" bracket.stl ", "MP-A42K7"), "bracket.stl");
  assert.equal(drive.fileName("\u0000\u0007", "MP-A42K7"), "MP-A42K7-model.stl");
});

test("maps supported model formats to Drive upload content types", () => {
  assert.equal(drive.contentType("part.STL"), "model/stl");
  assert.equal(drive.contentType("part.3mf"), "model/3mf");
  assert.equal(drive.contentType("part.step"), "application/step");
  assert.equal(drive.contentType("part.unknown"), "application/octet-stream");
});

test("uploads a private model into the configured Drive folder", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url:String(url), init });
    if (calls.length === 1) {
      return new Response(null, {
        status:200,
        headers:{ location:"https://www.googleapis.com/upload/drive/v3/files?upload_id=test" }
      });
    }
    return new Response(JSON.stringify({
      id:"drive-file-12345", name:"bracket.stl",
      webViewLink:"https://drive.google.com/file/d/drive-file-12345/view"
    }), { status:200, headers:{ "Content-Type":"application/json" } });
  };

  const result = await drive.uploadWithAccessToken("access-token", { folderId:"private-folder" }, {
    quoteCode:"MP-A42K7", originalFileName:"bracket.stl", bytes:Buffer.from("solid model")
  });

  assert.equal(result.id, "drive-file-12345");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "POST");
  assert.match(calls[0].url, /uploadType=resumable/);
  assert.deepEqual(JSON.parse(calls[0].init.body).parents, ["private-folder"]);
  assert.equal(calls[1].init.method, "PUT");
  assert.equal(calls[1].init.body.toString(), "solid model");
});
