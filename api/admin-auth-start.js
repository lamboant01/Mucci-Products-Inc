"use strict";

const crypto = require("node:crypto");
const auth = require("./_admin-auth");

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return auth.notFound(res);
  try {
    const config = auth.configuration();
    if (!auth.requestIsSameOrigin(req, config)) return auth.notFound(res);
    const cookies = auth.cookieMap(req);
    const returnValue = String(cookies[auth.RETURN_COOKIE] || "");
    const [slug, requestedSection] = returnValue.split("/");
    if (!auth.routeMatches(slug, config)) return auth.notFound(res);

    const verifier = base64url(crypto.randomBytes(48));
    const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
    auth.appendCookies(res, [auth.cookie(auth.PKCE_COOKIE, verifier, 600, "/api/admin-auth-callback")]);

    const authorize = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
    authorize.searchParams.set("provider", "google");
    authorize.searchParams.set("redirect_to", `${config.siteUrl}/api/admin-auth-callback`);
    authorize.searchParams.set("code_challenge", challenge);
    authorize.searchParams.set("code_challenge_method", "s256");
    authorize.searchParams.set("prompt", "select_account");
    authorize.searchParams.set("skip_http_redirect", "false");
    return res.redirect(303, authorize.toString());
  } catch {
    return auth.notFound(res);
  }
};
