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
    const [slug, requestedSection] = String(cookies[auth.RETURN_COOKIE] || "").split("/");
    if (!values.code || !verifier || !auth.routeMatches(slug, config)) return auth.notFound(res);

    const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=pkce`, {
      method:"POST",
      headers:{ apikey:config.anonKey, "Content-Type":"application/json" },
      body:JSON.stringify({ auth_code:String(values.code), code_verifier:verifier }),
      signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) return auth.notFound(res);
    const session = await response.json();
    if (!auth.authorizeUser(session.user, config)) {
      auth.clearSession(res);
      auth.clearOAuthCookies(res);
      return auth.notFound(res);
    }
    auth.setSession(res, session);
    auth.clearOAuthCookies(res);
    return res.redirect(303, `${config.siteUrl}/${config.routeSlug}/${auth.section(requestedSection)}`);
  } catch {
    return auth.notFound(res);
  }
};
