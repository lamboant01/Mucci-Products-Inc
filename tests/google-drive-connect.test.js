const test = require("node:test");
const assert = require("node:assert/strict");
const handler = require("../api/google-drive-connect");

function responseRecorder() {
  return {
    statusCode:200, body:null, headers:{},
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
}

test("creates an offline Drive authorization URL only for the administrator", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const originalEnvironment = { ...process.env };
  context.after(() => { global.fetch = originalFetch; process.env = originalEnvironment; });
  Object.assign(process.env, {
    SUPABASE_URL:"https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:"service-role-test",
    GOOGLE_DRIVE_CLIENT_ID:"client.apps.googleusercontent.com",
    GOOGLE_DRIVE_CLIENT_SECRET:"client-secret",
    GOOGLE_DRIVE_REDIRECT_URI:"https://mucciproducts.com/api/google-drive-callback"
  });
  global.fetch = async () => new Response(JSON.stringify({ email:"anthony@mucciproducts.com" }), {
    status:200, headers:{ "Content-Type":"application/json" }
  });
  const res = responseRecorder();
  await handler({ method:"POST", headers:{ authorization:"Bearer admin-session" } }, res);
  assert.equal(res.statusCode, 200);
  const authorization = new URL(res.body.authorizationUrl);
  assert.equal(authorization.hostname, "accounts.google.com");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(authorization.searchParams.get("redirect_uri"), "https://mucciproducts.com/api/google-drive-callback");
  assert.match(res.headers["Set-Cookie"], /^mucci_drive_oauth_state=[0-9a-f]{64};/);
});
