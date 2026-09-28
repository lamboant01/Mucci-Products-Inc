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
  assert.equal(drive.contentType("reference.PNG"), "image/png");
  assert.equal(drive.contentType("reference.jpeg"), "image/jpeg");
  assert.equal(drive.contentType("reference.HEIC"), "image/heic");
  assert.equal(drive.contentType("part.unknown"), "application/octet-stream");
});

test("creates a quote-code subfolder and uploads the private model into it", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url:String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ files:[] }), {
        status:200, headers:{ "Content-Type":"application/json" }
      });
    }
    if (calls.length === 2) {
      return new Response(JSON.stringify({
        id:"quote-folder-12345", name:"MP-A42K7",
        webViewLink:"https://drive.google.com/drive/folders/quote-folder-12345"
      }), { status:200, headers:{ "Content-Type":"application/json" } });
    }
    if (calls.length === 3) {
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
  assert.equal(result.webViewLink, "https://drive.google.com/drive/folders/quote-folder-12345");
  assert.equal(calls.length, 4);
  assert.match(calls[0].url, /drive\/v3\/files\?/);
  assert.match(new URL(calls[0].url).searchParams.get("q"), /name = 'MP-A42K7'/);
  assert.equal(calls[1].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].init.body).parents, ["private-folder"]);
  assert.equal(JSON.parse(calls[1].init.body).name, "MP-A42K7");
  assert.equal(JSON.parse(calls[1].init.body).mimeType, "application/vnd.google-apps.folder");
  assert.equal(calls[2].init.method, "POST");
  assert.match(calls[2].url, /uploadType=resumable/);
  assert.deepEqual(JSON.parse(calls[2].init.body).parents, ["quote-folder-12345"]);
  assert.equal(JSON.parse(calls[2].init.body).appProperties.mucciItemType, "model");
  assert.equal(calls[3].init.method, "PUT");
  assert.equal(calls[3].init.body.toString(), "solid model");
});

test("reuses an existing quote-code subfolder on retry", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url:String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ files:[{
        id:"existing-quote-folder", name:"MP-XZ9Y2",
        webViewLink:"https://drive.google.com/drive/folders/existing-quote-folder"
      }] }), { status:200, headers:{ "Content-Type":"application/json" } });
    }
    if (calls.length === 2) {
      return new Response(null, {
        status:200,
        headers:{ location:"https://www.googleapis.com/upload/drive/v3/files?upload_id=retry" }
      });
    }
    return new Response(JSON.stringify({ id:"retry-file", name:"part.3mf" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  };

  const result = await drive.uploadWithAccessToken("access-token", { folderId:"private-folder" }, {
    quoteCode:"MP-XZ9Y2", originalFileName:"part.3mf", bytes:Buffer.from("3mf model")
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[1].init.body).parents, ["existing-quote-folder"]);
  assert.equal(result.webViewLink, "https://drive.google.com/drive/folders/existing-quote-folder");
});

test("moves an existing mirrored file into its quote-code subfolder", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  context.after(() => { global.fetch = originalFetch; });
  const calls = [];
  global.fetch = async (url, init = {}) => {
    calls.push({ url:String(url), init });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ files:[{
        id:"quote-folder", name:"MP-XY3KC",
        webViewLink:"https://drive.google.com/drive/folders/quote-folder"
      }] }), { status:200, headers:{ "Content-Type":"application/json" } });
    }
    if (calls.length === 2) {
      return new Response(JSON.stringify({ id:"existing-file", parents:["private-folder"] }), {
        status:200, headers:{ "Content-Type":"application/json" }
      });
    }
    return new Response(JSON.stringify({ id:"existing-file" }), {
      status:200, headers:{ "Content-Type":"application/json" }
    });
  };

  const result = await drive.organizeWithAccessToken("access-token", { folderId:"private-folder" }, {
    quoteCode:"MP-XY3KC", fileId:"existing-file"
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[2].init.method, "PATCH");
  const moveUrl = new URL(calls[2].url);
  assert.equal(moveUrl.searchParams.get("addParents"), "quote-folder");
  assert.equal(moveUrl.searchParams.get("removeParents"), "private-folder");
  assert.equal(result.webViewLink, "https://drive.google.com/drive/folders/quote-folder");
});
