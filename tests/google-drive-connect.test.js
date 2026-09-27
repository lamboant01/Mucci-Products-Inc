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
    SUPABASE_ANON_KEY:"anon-test",
    SUPABASE_SERVICE_ROLE_KEY:"service-role-test",
    PUBLIC_SITE_URL:"https://mucciproducts.com",
    ADMIN_EMAIL:"owner@example.test",
    GOOGLE_DRIVE_CLIENT_ID:"client.apps.googleusercontent.com",
    GOOGLE_DRIVE_CLIENT_SECRET:"client-secret",
    GOOGLE_DRIVE_REDIRECT_URI:"https://mucciproducts.com/api/google-drive-callback"
  });
  global.fetch = async () => new Response(JSON.stringify({
    id:"123e4567-e89b-42d3-a456-426614174000",
    email:"owner@example.test",
    email_confirmed_at:"2026-01-01T00:00:00Z",
    app_metadata:{ provider:"google", providers:["google"] },
    identities:[{ provider:"google" }]
  }), {
    status:200, headers:{ "Content-Type":"application/json" }
  });
  const res = responseRecorder();
  await handler({ method:"POST", headers:{ origin:"https://mucciproducts.com", cookie:"mucci_sb_admin_access=admin-session" } }, res);
  assert.equal(res.statusCode, 200);
  const authorization = new URL(res.body.authorizationUrl);
  assert.equal(authorization.hostname, "accounts.google.com");
  assert.equal(authorization.searchParams.get("access_type"), "offline");
  assert.equal(authorization.searchParams.get("scope"), "https://www.googleapis.com/auth/drive.file");
  assert.equal(authorization.searchParams.get("redirect_uri"), "https://mucciproducts.com/api/google-drive-callback");
  assert.match(res.headers["Set-Cookie"], /^mucci_drive_oauth_state=[0-9a-f]{64};/);
});
