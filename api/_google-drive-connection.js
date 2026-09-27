"use strict";

const ADMIN_EMAIL = "anthony@mucciproducts.com";

function supabaseConfiguration() {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    const error = new Error("Supabase server configuration is missing.");
    error.statusCode = 503;
    throw error;
  }
  return { supabaseUrl, serviceKey };
}

function serviceHeaders(config, extra = {}) {
  return { apikey:config.serviceKey, Authorization:`Bearer ${config.serviceKey}`, ...extra };
}

async function verifyAdmin(req, config) {
  const authorization = String(req.headers?.authorization || "");
  if (!authorization.startsWith("Bearer ")) return false;
  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    headers:{ apikey:config.serviceKey, Authorization:authorization },
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) return false;
  const user = await response.json();
  return String(user.email || "").toLowerCase() === ADMIN_EMAIL;
}

async function storedRefreshToken(config) {
  if (process.env.GOOGLE_DRIVE_REFRESH_TOKEN) return process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const url = new URL(`${config.supabaseUrl}/rest/v1/estimate_private_integrations`);
  url.searchParams.set("singleton", "eq.true");
  url.searchParams.set("select", "google_drive_refresh_token");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers:serviceHeaders(config), signal:AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Drive connection lookup failed with status ${response.status}.`);
  const rows = await response.json();
  return rows[0]?.google_drive_refresh_token || "";
}

async function storeRefreshToken(config, refreshToken) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/estimate_private_integrations`);
  url.searchParams.set("on_conflict", "singleton");
  const response = await fetch(url, {
    method:"POST",
    headers:serviceHeaders(config, {
      "Content-Type":"application/json",
      Prefer:"resolution=merge-duplicates,return=minimal"
    }),
    body:JSON.stringify({
      singleton:true,
      google_drive_refresh_token:refreshToken,
      updated_at:new Date().toISOString()
    }),
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Drive connection storage failed with status ${response.status}.`);
}

module.exports = { supabaseConfiguration, serviceHeaders, verifyAdmin, storedRefreshToken, storeRefreshToken };
