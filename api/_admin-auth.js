"use strict";

const ACCESS_COOKIE = "mucci_sb_admin_access";
const REFRESH_COOKIE = "mucci_sb_admin_refresh";
const PKCE_COOKIE = "mucci_admin_pkce";
const LOGIN_COOKIE = "mucci_admin_login";
const ALLOWED_SECTIONS = new Set(["dashboard", "estimates", "orders", "customers", "cards", "files", "activity", "security"]);

function configuration() {
  const values = {
    supabaseUrl:String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    anonKey:process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
    siteUrl:String(process.env.PUBLIC_SITE_URL || "https://mucciproducts.com").replace(/\/$/, ""),
    adminEmail:String(process.env.ADMIN_EMAIL || "").trim().toLowerCase(),
    adminUserId:String(process.env.ADMIN_USER_ID || "").trim().toLowerCase()
  };
  if (!values.supabaseUrl || !values.anonKey || !values.serviceKey) throw configurationError("Supabase server configuration is missing.");
  if (values.adminUserId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(values.adminUserId)) throw configurationError("ADMIN_USER_ID is invalid.");
  if (!values.adminUserId && !values.adminEmail) throw configurationError("ADMIN_EMAIL is required until ADMIN_USER_ID is configured.");
  return values;
}

function configurationError(message) {
  const error = new Error(message);
  error.statusCode = 503;
  return error;
}

function securityHeaders(res) {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://*.supabase.co; script-src 'self' https://cdn.jsdelivr.net; style-src 'self'; font-src 'self'; connect-src 'self' https://*.supabase.co; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://*.supabase.co https://accounts.google.com");
}

function cookieMap(req) {
  const result = {};
  for (const part of String(req.headers?.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    try { result[key] = decodeURIComponent(part.slice(separator + 1).trim()); }
    catch { result[key] = ""; }
  }
  return result;
}

function appendCookies(res, values) {
  const existing = res.getHeader?.("Set-Cookie");
  const current = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  res.setHeader("Set-Cookie", [...current, ...values]);
}

function cookie(name, value, maxAge, path = "/") {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=${path}; Max-Age=${maxAge}`;
}

function clearSession(res) {
  appendCookies(res, [cookie(ACCESS_COOKIE, "", 0), cookie(REFRESH_COOKIE, "", 0)]);
}

function clearOAuthCookies(res) {
  appendCookies(res, [cookie(PKCE_COOKIE, "", 0), cookie(LOGIN_COOKIE, "", 0, "/api/admin-auth-start")]);
}

function setSession(res, session) {
  const accessMaxAge = Math.max(60, Math.min(Number(session.expires_in || 3600), 3600));
  appendCookies(res, [
    cookie(ACCESS_COOKIE, String(session.access_token), accessMaxAge),
    cookie(REFRESH_COOKIE, String(session.refresh_token), 60 * 60 * 24 * 30)
  ]);
}

function providerIsGoogle(user) {
  const primary = String(user?.app_metadata?.provider || "");
  const providers = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers.map(String) : [];
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  return primary === "google" && providers.includes("google") && identities.some((identity) => identity?.provider === "google");
}

function emailIsVerified(user) {
  return Boolean(user?.email_confirmed_at || user?.user_metadata?.email_verified === true);
}

function authorizeUser(user, config) {
  if (!user?.id || !providerIsGoogle(user)) return false;
  if (config.adminUserId) return String(user.id).toLowerCase() === config.adminUserId;
  return emailIsVerified(user) && String(user.email || "").trim().toLowerCase() === config.adminEmail;
}

function authorizationFailureReason(user, config) {
  if (!user?.id || !providerIsGoogle(user)) return "google_provider_invalid";
  if (config.adminUserId && String(user.id).toLowerCase() !== config.adminUserId) return "admin_user_id_mismatch";
  if (!config.adminUserId && (!emailIsVerified(user) || String(user.email || "").trim().toLowerCase() !== config.adminEmail)) return "admin_email_mismatch";
  return "authorization_failed";
}

async function fetchUser(config, accessToken) {
  if (!accessToken) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers:{ apikey:config.anonKey, Authorization:`Bearer ${accessToken}` },
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  return response.json();
}

async function refreshSession(config, refreshToken) {
  if (!refreshToken) return null;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method:"POST",
    headers:{ apikey:config.anonKey, "Content-Type":"application/json" },
    body:JSON.stringify({ refresh_token:refreshToken }),
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) return null;
  return response.json();
}

async function authenticateAdmin(req, res, suppliedConfig) {
  const config = suppliedConfig || configuration();
  const cookies = cookieMap(req);
  let accessToken = cookies[ACCESS_COOKIE] || "";
  let refreshToken = cookies[REFRESH_COOKIE] || "";
  let user = await fetchUser(config, accessToken);
  if (!user && refreshToken) {
    const refreshed = await refreshSession(config, refreshToken);
    if (refreshed?.access_token && refreshed?.refresh_token) {
      setSession(res, refreshed);
      accessToken = refreshed.access_token;
      refreshToken = refreshed.refresh_token;
      user = refreshed.user || await fetchUser(config, accessToken);
    }
  }
  if (!user) return { status:"unauthenticated", config };
  if (!authorizeUser(user, config)) {
    clearSession(res);
    return { status:"unauthorized", config, user, reason:authorizationFailureReason(user, config) };
  }
  return { status:"authorized", config, user, accessToken, refreshToken, bootstrap:!config.adminUserId };
}

function requestQuery(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, "https://mucciproducts.com").searchParams);
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); }
    catch { return {}; }
  }
  return {};
}

function requestIsSameOrigin(req, config) {
  const expected = new URL(config.siteUrl).origin;
  const origin = String(req.headers?.origin || "");
  if (origin && origin !== "null") return origin === expected;
  const referer = String(req.headers?.referer || "");
  try {
    if (referer) return new URL(referer).origin === expected;
  } catch { return false; }

  // Safari may omit Origin on a same-origin HTML form POST. The admin pages
  // deliberately send no Referer, so use browser Fetch Metadata next.
  const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite) return fetchSite === "same-origin";

  // Compatibility fallback for older browsers. Cross-site POSTs cannot choose
  // the request Host header and SameSite=Lax keeps admin cookies off the request.
  const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers?.host || "").trim();
  const forwardedProtocol = String(req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProtocol || "https";
  try { return Boolean(host) && new URL(`${protocol}://${host}`).origin === expected; }
  catch { return false; }
}

function section(value) {
  const clean = String(value || "").toLowerCase();
  return ALLOWED_SECTIONS.has(clean) ? clean : "dashboard";
}

function notFound(res) {
  securityHeaders(res);
  return res.status(404).send("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow,noarchive,nosnippet\"><title>404 Not Found</title></head><body><main><h1>404 Not Found</h1><p>This page does not exist.</p></main></body></html>");
}

function apiNotFound(res) {
  securityHeaders(res);
  return res.status(404).json({ error:"Not found." });
}

module.exports = {
  ACCESS_COOKIE, REFRESH_COOKIE, PKCE_COOKIE, LOGIN_COOKIE,
  ALLOWED_SECTIONS, appendCookies, authenticateAdmin, authorizationFailureReason, authorizeUser, clearOAuthCookies,
  clearSession, configuration, cookie, cookieMap, emailIsVerified, notFound,
  apiNotFound, providerIsGoogle, requestBody, requestQuery,
  requestIsSameOrigin, section, securityHeaders, setSession
};
