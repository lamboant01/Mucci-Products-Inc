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
    if (!auth.requestIsSameOrigin(req, config)) {
      console.warn("Admin authentication failed:", "cross_origin_request");
      return auth.notFound(res);
    }
    const cookies = auth.cookieMap(req);
    if (cookies[auth.LOGIN_COOKIE] !== "1") {
      console.warn("Admin authentication failed:", "missing_login_cookie");
      return auth.notFound(res);
    }

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
    console.warn("Admin authentication failed:", "oauth_start_failed");
    return auth.notFound(res);
  }
};
