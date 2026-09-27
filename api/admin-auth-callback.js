"use strict";

const auth = require("./_admin-auth");

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "GET") return auth.notFound(res);
  try {
    const config = auth.configuration();
    const values = auth.requestQuery(req);
    const cookies = auth.cookieMap(req);
    const verifier = cookies[auth.PKCE_COOKIE];
    if (!values.code) {
      console.warn("Admin authentication failed:", "missing_oauth_code");
      return auth.notFound(res);
    }
    if (!verifier) {
      console.warn("Admin authentication failed:", "missing_pkce_cookie");
      return auth.notFound(res);
    }

    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method:"POST",
      headers:{ apikey:config.anonKey, "Content-Type":"application/json" },
      body:JSON.stringify({ auth_code:String(values.code), code_verifier:verifier }),
      signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      console.warn("Admin authentication failed:", "token_exchange_failed");
      return auth.notFound(res);
    }
    const session = await response.json();
    if (!auth.authorizeUser(session.user, config)) {
      console.warn("Admin authentication failed:", auth.authorizationFailureReason(session.user, config));
      auth.clearSession(res);
      auth.clearOAuthCookies(res);
      return auth.notFound(res);
    }
    auth.setSession(res, session);
    auth.clearOAuthCookies(res);
    return res.redirect(303, `${config.siteUrl}/admin`);
  } catch {
    console.warn("Admin authentication failed:", "oauth_callback_failed");
    return auth.notFound(res);
  }
};
