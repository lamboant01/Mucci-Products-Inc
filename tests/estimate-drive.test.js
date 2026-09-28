const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/estimate-drive");
const drive = require("../api/_google-drive");
const connection = require("../api/_google-drive-connection");

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

test("Drive mirror copies every reference image into the quote-code folder", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const originalStoredToken = connection.storedRefreshToken;
  const originalConfiguration = drive.configuration;
  const originalUpload = drive.uploadModel;
  context.after(() => {
    global.fetch = originalFetch;
    connection.storedRefreshToken = originalStoredToken;
    drive.configuration = originalConfiguration;
    drive.uploadModel = originalUpload;
  });

  connection.storedRefreshToken = async () => "refresh-token";
  drive.configuration = () => ({ folderId:"private-folder" });
  const uploads = [];
  drive.uploadModel = async (_config, file) => {
    uploads.push(file);
    return {
      id:`drive-${uploads.length}`,
      name:file.originalFileName,
      webViewLink:"https://drive.google.com/drive/folders/MP-A42K7"
    };
  };
  const patches = [];
  global.fetch = async (url, init = {}) => {
    if (init.method === "PATCH") {
      patches.push(JSON.parse(init.body));
      return new Response(null, { status:204 });
    }
    return new Response(Buffer.from("image"), { status:200 });
  };

  const result = await handler.mirrorEstimate({
    supabaseUrl:"https://project.supabase.co", serviceKey:"service-key"
  }, {
    quote_code:"MP-A42K7",
    reference_files:[
      { path:"root/references/one.jpg", name:"front.jpg", size_bytes:5 },
      { path:"root/references/two.heic", name:"side.heic", size_bytes:5 }
    ],
    drive_reference_files:[]
  });

  assert.equal(result.mirrored, true);
  assert.equal(result.referenceImages, 2);
  assert.deepEqual(uploads.map((file) => file.quoteCode), ["MP-A42K7", "MP-A42K7"]);
  assert.deepEqual(uploads.map((file) => file.itemType), ["reference-image", "reference-image"]);
  assert.equal(patches.length, 2);
  assert.equal(patches[1].drive_reference_files.length, 2);
  assert.equal(patches[1].drive_web_view_link, "https://drive.google.com/drive/folders/MP-A42K7");
});
