"use strict";

const auth = require("./_admin-auth");

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return auth.notFound(res);
  try {
    const config = auth.configuration();
    if (!auth.requestIsSameOrigin(req, config)) return auth.notFound(res);
    const cookies = auth.cookieMap(req);
    const token = cookies[auth.ACCESS_COOKIE];
    if (token) {
      await fetch(`${config.supabaseUrl}/auth/v1/logout`, {
        method:"POST",
        headers:{ apikey:config.anonKey, Authorization:`Bearer ${token}` },
        signal:AbortSignal.timeout(5000)
      }).catch(() => null);
    }
  } catch {}
  auth.clearSession(res);
  return res.redirect(303, "/");
};
