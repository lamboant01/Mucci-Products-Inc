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
const SLUG = "AbcdefghJKMNPQrs";
const ADMIN_ID = "123e4567-e89b-42d3-a456-426614174000";

function environment(overrides = {}) {
  return {
    SUPABASE_URL:"https://project.supabase.co",
    SUPABASE_ANON_KEY:"anon-test",
    SUPABASE_SERVICE_ROLE_KEY:"service-test",
    PUBLIC_SITE_URL:"https://mucciproducts.com",
    ADMIN_ROUTE_SLUG:SLUG,
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

test("server configuration requires a non-ambiguous sixteen-character private route", { concurrency:false }, () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, environment());
    assert.equal(auth.configuration().routeSlug, SLUG);
    process.env.ADMIN_ROUTE_SLUG = "contains0zeroXXX";
    assert.throws(() => auth.configuration(), /ADMIN_ROUTE_SLUG is invalid/);
    process.env.ADMIN_ROUTE_SLUG = "too-short";
    assert.throws(() => auth.configuration(), /ADMIN_ROUTE_SLUG is invalid/);
  } finally {
    process.env = original;
  }
});

test("authorization requires Google as primary provider and the exact configured UUID", () => {
  const config = { adminUserId:ADMIN_ID, adminEmail:"owner@example.test" };
  assert.equal(auth.authorizeUser(googleUser(), config), true);
  assert.equal(auth.authorizeUser(googleUser({ id:"223e4567-e89b-42d3-a456-426614174000" }), config), false);
  assert.equal(auth.authorizeUser(googleUser({ app_metadata:{ provider:"email", providers:["email", "google"] } }), config), false);
  assert.equal(auth.authorizeUser(googleUser({ identities:[{ provider:"email" }] }), config), false);
});

test("email bootstrap works only for a verified Google identity and stops when UUID is set", () => {
  const bootstrap = { adminUserId:"", adminEmail:"owner@example.test" };
  assert.equal(auth.authorizeUser(googleUser(), bootstrap), true);
  assert.equal(auth.authorizeUser(googleUser({ email_confirmed_at:null, user_metadata:{} }), bootstrap), false);
  assert.equal(auth.authorizeUser(googleUser({ email:"other@example.test" }), bootstrap), false);
  assert.equal(auth.authorizeUser(googleUser({ email:"other@example.test" }), { adminUserId:ADMIN_ID, adminEmail:"owner@example.test" }), true);
});

test("wrong private route returns a generic 404 while the correct unauthenticated route offers Google sign-in", { concurrency:false }, async (context) => {
  const original = { ...process.env };
  context.after(() => { process.env = original; });
  Object.assign(process.env, environment());

  const wrong = responseRecorder();
  await adminPage({ method:"GET", query:{ slug:"WrongSlugABCDEFGH", section:"estimates" }, headers:{} }, wrong);
  assert.equal(wrong.statusCode, 404);
  assert.doesNotMatch(String(wrong.body), /Google|administrator|estimate/i);

  const correct = responseRecorder();
  await adminPage({ method:"GET", query:{ slug:SLUG, section:"estimates" }, headers:{} }, correct);
  assert.equal(correct.statusCode, 200);
  assert.match(correct.body, /Sign in with Google/);
  assert.match(correct.body, /noindex,nofollow,noarchive,nosnippet/);
  assert.match(String(correct.headers["Set-Cookie"]), /HttpOnly; Secure; SameSite=Lax; Path=\/api/);
});

test("authorized Google UUID receives the private page and an unauthorized Google UUID receives 404", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const original = { ...process.env };
  context.after(() => { global.fetch = originalFetch; process.env = original; });
  Object.assign(process.env, environment());

  global.fetch = async () => new Response(JSON.stringify(googleUser()), { status:200, headers:{ "Content-Type":"application/json" } });
  const allowed = responseRecorder();
  await adminPage({ method:"GET", query:{ slug:SLUG, section:"security" }, headers:{ cookie:"mucci_sb_admin_access=valid-session" } }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.match(allowed.body, /Google 2-Step Verification or a passkey/);
  assert.equal(allowed.headers["X-Robots-Tag"], "noindex, nofollow, noarchive, nosnippet");

  global.fetch = async () => new Response(JSON.stringify(googleUser({ id:"223e4567-e89b-42d3-a456-426614174000" })), { status:200, headers:{ "Content-Type":"application/json" } });
  const denied = responseRecorder();
  await adminPage({ method:"GET", query:{ slug:SLUG, section:"security" }, headers:{ cookie:"mucci_sb_admin_access=other-session" } }, denied);
  assert.equal(denied.statusCode, 404);
  assert.doesNotMatch(String(denied.body), /Google|administrator|security/i);
  assert.match(String(denied.headers["Set-Cookie"]), /mucci_sb_admin_access=;.*Max-Age=0/);
});

test("OAuth uses a generic callback and returns only an authorized session to the private route", { concurrency:false }, async (context) => {
  const originalFetch = global.fetch;
  const original = { ...process.env };
  context.after(() => { global.fetch = originalFetch; process.env = original; });
  Object.assign(process.env, environment());

  const start = responseRecorder();
  await authStart({ method:"POST", headers:{ origin:"https://mucciproducts.com", cookie:`mucci_admin_return=${SLUG}%2Festimates` } }, start);
  assert.equal(start.statusCode, 303);
  const providerUrl = new URL(start.headers.Location);
  assert.equal(providerUrl.pathname, "/auth/v1/authorize");
  assert.equal(providerUrl.searchParams.get("provider"), "google");
  assert.equal(providerUrl.searchParams.get("redirect_to"), "https://mucciproducts.com/api/admin-auth-callback");
  assert.doesNotMatch(providerUrl.searchParams.get("redirect_to"), new RegExp(SLUG));
  const pkceCookie = start.headers["Set-Cookie"].find((value) => value.startsWith("mucci_admin_pkce="));
  const verifier = decodeURIComponent(pkceCookie.match(/^mucci_admin_pkce=([^;]+)/)[1]);

  global.fetch = async (input) => {
    assert.match(String(input), /\/auth\/v1\/token\?grant_type=pkce$/);
    return new Response(JSON.stringify({ access_token:"access", refresh_token:"refresh", expires_in:3600, user:googleUser() }), { status:200, headers:{ "Content-Type":"application/json" } });
  };
  const callback = responseRecorder();
  await authCallback({ method:"GET", query:{ code:"oauth-code" }, headers:{ cookie:`mucci_admin_pkce=${encodeURIComponent(verifier)}; mucci_admin_return=${SLUG}%2Festimates` } }, callback);
  assert.equal(callback.statusCode, 303);
  assert.equal(callback.headers.Location, `https://mucciproducts.com/${SLUG}/estimates`);
  assert.match(String(callback.headers["Set-Cookie"]), /mucci_sb_admin_access=access/);
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

test("legacy admin routes are denied and public pages contain no owner-area link", () => {
  const routes = JSON.parse(read("vercel.json")).routes;
  assert.ok(routes.some((route) => route.src === "/admin(?:/.*)?" && route.dest === "/api/not-found"));
  assert.ok(routes.some((route) => route.src === "/card-dashboard(?:/.*)?" && route.dest === "/api/not-found"));
  for (const file of ["index.html", "estimator/index.html", "card-app.js", "my-cards/index.html"]) {
    assert.doesNotMatch(read(file), /card-dashboard|\/admin\/estimates|Admin Sign In/i, file);
  }
  assert.equal(fs.existsSync(path.join(root, "sitemap.xml")), false);
  assert.equal(fs.existsSync(path.join(root, "robots.txt")), false);
  assert.doesNotMatch(read("config.js"), /ADMIN_ROUTE_SLUG|ADMIN_EMAIL|ADMIN_USER_ID|NEXT_PUBLIC/i);
});

test("browser management clients contain no Supabase administrator identity or direct database access", () => {
  const clients = `${read("admin/estimates/estimates.js")}\n${read("card-dashboard/dashboard.js")}`;
  assert.doesNotMatch(clients, /createClient|signInWithPassword|allowedAdminEmail|service_role|anthony@/i);
  assert.match(clients, /\/api\/admin-estimates/);
  assert.match(clients, /\/api\/admin-cards/);
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
