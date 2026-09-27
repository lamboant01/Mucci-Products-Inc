const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const auth = require("../api/_admin-auth");
const authStart = require("../api/admin-auth-start");
const authCallback = require("../api/admin-auth-callback");
const adminPage = require("../api/admin-page");
const adminCards = require("../api/admin-cards");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const ADMIN_ID = "123e4567-e89b-42d3-a456-426614174000";

function environment(overrides = {}) {
  return {
    SUPABASE_URL:"https://project.supabase.co",
    SUPABASE_ANON_KEY:"anon-test",
    SUPABASE_SERVICE_ROLE_KEY:"service-test",
    PUBLIC_SITE_URL:"https://mucciproducts.com",
    ADMIN_USER_ID:ADMIN_ID,
    ADMIN_EMAIL:"owner@example.test",
    ...overrides
  };
}

function googleUser(overrides = {}) {
  return {
    id:ADMIN_ID,
    email:"owner@example.test",
    email_confirmed_at:"2026-01-01T00:00:00Z",
    app_metadata:{ provider:"google", providers:["google"] },
    identities:[{ provider:"google" }],
    ...overrides
  };
}

function responseRecorder() {
  return {
    statusCode:200, body:null, headers:{},
    setHeader(name, value) { this.headers[name] = value; },
    getHeader(name) { return this.headers[name]; },
    status(value) { this.statusCode = value; return this; },
    send(value) { this.body = value; return this; },
    json(value) { this.body = value; return this; },
    redirect(status, value) { this.statusCode = status; this.headers.Location = value; return this; }
  };
}

test("server configuration no longer depends on a hidden admin route", { concurrency:false }, () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, environment());
    delete process.env.ADMIN_ROUTE_SLUG;
    assert.equal(auth.configuration().siteUrl, "https://mucciproducts.com");
    assert.equal(auth.configuration().routeSlug, undefined);
  } finally {
    process.env = original;
  }
});

test("same-origin validation supports browsers with unavailable Origin headers without weakening cross-site checks", () => {
  const config = { siteUrl:"https://mucciproducts.com" };
  assert.equal(auth.requestIsSameOrigin({ headers:{ "sec-fetch-site":"same-origin" } }, config), true);
  assert.equal(auth.requestIsSameOrigin({ headers:{ origin:"null", "sec-fetch-site":"same-origin" } }, config), true);
  assert.equal(auth.requestIsSameOrigin({ headers:{ "sec-fetch-site":"cross-site", host:"mucciproducts.com" } }, config), false);
  assert.equal(auth.requestIsSameOrigin({ headers:{ host:"mucciproducts.com", "x-forwarded-proto":"https" } }, config), true);
  assert.equal(auth.requestIsSameOrigin({ headers:{ host:"attacker.example", "x-forwarded-proto":"https" } }, config), false);
});

test("authorization requires Google as primary provider and the exact configured UUID", () => {
  const config = { adminUserId:ADMIN_ID, adminEmail:"owner@example.test" };
  assert.equal(auth.authorizeUser(googleUser(), config), true);
  assert.equal(auth.authorizeUser(googleUser({ id:"223e4567-e89b-42d3-a456-426614174000" }), config), false);
  assert.equal(auth.authorizeUser(googleUser({ app_metadata:{ provider:"email", providers:["email", "google"] } }), config), false);
  assert.equal(auth.authorizeUser(googleUser({ identities:[{ provider:"email" }] }), config), false);
  assert.equal(auth.authorizationFailureReason(googleUser({ identities:[{ provider:"email" }] }), config), "google_provider_invalid");
  assert.equal(auth.authorizationFailureReason(googleUser({ id:"223e4567-e89b-42d3-a456-426614174000" }), config), "admin_user_id_mismatch");
});

test("email bootstrap works only for a verified Google identity and stops when UUID is set", () => {
  const bootstrap = { adminUserId:"", adminEmail:"owner@example.test" };
  assert.equal(auth.authorizeUser(googleUser(), bootstrap), true);
  assert.equal(auth.authorizeUser(googleUser({ email_confirmed_at:null, user_metadata:{} }), bootstrap), false);
  assert.equal(auth.authorizeUser(googleUser({ email:"other@example.test" }), bootstrap), false);
  assert.equal(auth.authorizationFailureReason(googleUser({ email:"other@example.test" }), bootstrap), "admin_email_mismatch");
  assert.equal(auth.authorizeUser(googleUser({ email:"other@example.test" }), { adminUserId:ADMIN_ID, adminEmail:"owner@example.test" }), true);
});

test("the unauthenticated admin page offers Google sign-in without granting dashboard access", { concurrency:false }, async (context) => {
  const original = { ...process.env };
  context.after(() => { process.env = original; });
  Object.assign(process.env, environment());

  const correct = responseRecorder();
  await adminPage({ method:"GET", query:{ section:"estimates" }, headers:{} }, correct);
  assert.equal(correct.statusCode, 200);
  assert.match(correct.body, /Sign in with Google/);
  assert.match(correct.body, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(String(correct.headers["Set-Cookie"]), /mucci_admin_login=1; HttpOnly; Secure; SameSite=Lax; Path=\/api\/admin-auth-start/);
  assert.match(String(correct.headers["Content-Security-Policy"]), /form-action 'self' https:\/\/\*\.supabase\.co https:\/\/accounts\.google\.com/);
});

test("OAuth start requires the SameSite login marker even when browser origin headers are unavailable", { concurrency:false }, async (context) => {
  const original = { ...process.env };
  context.after(() => { process.env = original; });
  Object.assign(process.env, environment());

  const allowed = responseRecorder();
  await authStart({ method:"POST", headers:{ origin:"null", "sec-fetch-site":"same-origin", cookie:"mucci_admin_login=1" } }, allowed);
  assert.equal(allowed.statusCode, 303);
  assert.match(String(allowed.headers.Location), /\/auth\/v1\/authorize\?/);

  const missingCookie = responseRecorder();
  await authStart({ method:"POST", headers:{ "sec-fetch-site":"same-origin" } }, missingCookie);
  assert.equal(missingCookie.statusCode, 404);
});

test("authorized Google UUID receives the private page and an unauthorized Google UUID receives 404", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const original = { ...process.env };
  context.after(() => { global.fetch = originalFetch; process.env = original; });
  Object.assign(process.env, environment());

  global.fetch = async () => new Response(JSON.stringify(googleUser()), { status:200, headers:{ "Content-Type":"application/json" } });
  const allowed = responseRecorder();
  await adminPage({ method:"GET", query:{ section:"security" }, headers:{ cookie:"mucci_sb_admin_access=valid-session" } }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.match(allowed.body, /Google 2-Step Verification or a passkey/);
  assert.equal(allowed.headers["X-Robots-Tag"], "noindex, nofollow, noarchive, nosnippet");

  global.fetch = async () => new Response(JSON.stringify(googleUser({ id:"223e4567-e89b-42d3-a456-426614174000" })), { status:200, headers:{ "Content-Type":"application/json" } });
  const denied = responseRecorder();
  await adminPage({ method:"GET", query:{ section:"security" }, headers:{ cookie:"mucci_sb_admin_access=other-session" } }, denied);
  assert.equal(denied.statusCode, 404);
  assert.doesNotMatch(String(denied.body), /Google|administrator|security/i);
  assert.match(String(denied.headers["Set-Cookie"]), /mucci_sb_admin_access=;.*Max-Age=0/);
});

test("OAuth uses a generic callback and returns only an authorized session to admin", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const original = { ...process.env };
  context.after(() => { global.fetch = originalFetch; process.env = original; });
  Object.assign(process.env, environment());

  const start = responseRecorder();
  await authStart({ method:"POST", headers:{ origin:"https://mucciproducts.com", cookie:"mucci_admin_login=1" } }, start);
  assert.equal(start.statusCode, 303);
  const providerUrl = new URL(start.headers.Location);
  assert.equal(providerUrl.pathname, "/auth/v1/authorize");
  assert.equal(providerUrl.searchParams.get("provider"), "google");
  assert.equal(providerUrl.searchParams.get("redirect_to"), "https://mucciproducts.com/api/admin-auth-callback");
  const pkceCookie = start.headers["Set-Cookie"].find((value) => value.startsWith("mucci_admin_pkce="));
  const verifier = decodeURIComponent(pkceCookie.match(/^mucci_admin_pkce=([^;]+)/)[1]);

  global.fetch = async (input) => {
    assert.match(String(input), /\/auth\/v1\/token\?grant_type=pkce$/);
    return new Response(JSON.stringify({ access_token:"access", refresh_token:"refresh", expires_in:3600, user:googleUser() }), { status:200, headers:{ "Content-Type":"application/json" } });
  };
  const callback = responseRecorder();
  await authCallback({ method:"GET", query:{ code:"oauth-code" }, headers:{ cookie:`mucci_admin_pkce=${encodeURIComponent(verifier)}` } }, callback);
  assert.equal(callback.statusCode, 303);
  assert.equal(callback.headers.Location, "https://mucciproducts.com/admin");
  assert.match(String(callback.headers["Set-Cookie"]), /mucci_sb_admin_access=access/);
});

test("OAuth callback logs only a safe token-exchange failure reason", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const original = { ...process.env };
  const warnings = [];
  context.after(() => { global.fetch = originalFetch; console.warn = originalWarn; process.env = original; });
  Object.assign(process.env, environment());
  global.fetch = async () => new Response("denied", { status:400 });
  console.warn = (...values) => warnings.push(values);

  const response = responseRecorder();
  await authCallback({ method:"GET", query:{ code:"sensitive-code" }, headers:{ cookie:"mucci_admin_pkce=sensitive-verifier" } }, response);

  assert.equal(response.statusCode, 404);
  assert.deepEqual(warnings, [["Admin authentication failed:", "token_exchange_failed"]]);
  assert.doesNotMatch(JSON.stringify(warnings), /sensitive-code|sensitive-verifier/);
});

test("unauthenticated management APIs return 404 instead of revealing authorization state", { concurrency:false }, async (context) => {
  const original = { ...process.env };
  context.after(() => { process.env = original; });
  Object.assign(process.env, environment());
  const res = responseRecorder();
  await adminCards({ method:"POST", headers:{ origin:"https://mucciproducts.com" }, body:{ action:"list" } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error:"Not found." });
});

test("authenticated but unauthorized management API calls also return 404", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const original = { ...process.env };
  context.after(() => { global.fetch = originalFetch; process.env = original; });
  Object.assign(process.env, environment());
  global.fetch = async () => new Response(JSON.stringify(googleUser({ id:"223e4567-e89b-42d3-a456-426614174000" })), { status:200, headers:{ "Content-Type":"application/json" } });
  const res = responseRecorder();
  await adminCards({ method:"POST", headers:{ origin:"https://mucciproducts.com", cookie:"mucci_sb_admin_access=wrong-user-session" }, body:{ action:"list" } }, res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error:"Not found." });
});

test("admin routes are protected server pages and remain absent from public navigation", () => {
  const routes = JSON.parse(read("vercel.json")).routes;
  assert.ok(routes.some((route) => route.src === "/admin/?" && route.dest === "/api/admin-page?section=dashboard"));
  assert.ok(routes.some((route) => route.src === "/admin/(dashboard|estimates|orders|customers|cards|files|activity|security)/?" && route.dest === "/api/admin-page?section=$1"));
  assert.ok(routes.some((route) => route.src === "/admin(?:/.*)?" && route.dest === "/api/not-found"));
  assert.ok(!routes.some((route) => route.src === "/([A-Za-z0-9]{16})/?"));
  assert.ok(routes.some((route) => route.src === "/card-dashboard(?:/.*)?" && route.dest === "/api/not-found"));
  for (const file of ["index.html", "estimator/index.html", "card-app.js", "my-cards/index.html"]) {
    assert.doesNotMatch(read(file), /card-dashboard|\/admin\/estimates|Admin Sign In/i, file);
  }
  assert.equal(fs.existsSync(path.join(root, "sitemap.xml")), false);
  assert.equal(fs.existsSync(path.join(root, "robots.txt")), false);
  assert.doesNotMatch(read("config.js"), /ADMIN_ROUTE_SLUG|ADMIN_EMAIL|ADMIN_USER_ID|NEXT_PUBLIC/i);
});

test("browser management clients contain no Supabase administrator identity or direct database access", () => {
  const clients = `${read("admin/estimates/estimates.js")}\n${read("admin/operations.js")}\n${read("card-dashboard/dashboard.js")}`;
  assert.doesNotMatch(clients, /createClient|signInWithPassword|allowedAdminEmail|service_role|anthony@/i);
  assert.match(clients, /\/api\/admin-estimates/);
  assert.match(clients, /\/api\/admin-cards/);
  assert.match(clients, /\/api\/admin-operations/);
});

test("operations API and pages remain behind server authorization and search blocking", () => {
  const api = read("api/admin-operations.js");
  const page = read("api/admin-page.js");
  assert.match(api, /authenticateAdmin/);
  assert.match(api, /requestIsSameOrigin/);
  assert.match(api, /apiNotFound/);
  assert.match(page, /noindex,nofollow,noarchive,nosnippet/i);
  assert.doesNotMatch(api, /process\.env\.(?:SUPABASE_SERVICE_ROLE_KEY|GOOGLE_DRIVE_CLIENT_SECRET)/);
});

test("migration 015 revokes browser admin access and grants server-only RPC execution", () => {
  const sql = read("supabase/migrations/015_server_only_google_admin.sql");
  assert.match(sql, /revoke select, update on public\.profiles from authenticated/i);
  assert.match(sql, /revoke all on function public\.admin_find_print_estimate\(text\) from authenticated/i);
  assert.match(sql, /grant execute on function public\.admin_find_print_estimate\(text\) to service_role/i);
  assert.match(sql, /coalesce\(auth\.role\(\), ''\) = 'service_role'/i);
  assert.doesNotMatch(sql, /public reads print estimate files|to public[\s\S]*print-estimate-files/i);
  assert.doesNotMatch(sql, /@[a-z0-9.-]+/i);
});
