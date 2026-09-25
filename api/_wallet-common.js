"use strict";

const path = require("node:path");

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const DEFAULT_SITE_URL = "https://mucciproducts.com";

function requestToken(req) {
  const value = Array.isArray(req.query && req.query.token) ? req.query.token[0] : req.query && req.query.token;
  return TOKEN_PATTERN.test(String(value || "")) ? String(value) : "";
}

function siteUrl() {
  return String(process.env.PUBLIC_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
}

function cardUrl(token) {
  return `${siteUrl()}/card/${encodeURIComponent(token)}`;
}

function publicLogoUrl(profile) {
  return httpsUrl(profile && profile.logo_url) || `${siteUrl()}/assets/mucci-products-logo.png`;
}

function httpsUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "https:" ? parsed.href : "";
  } catch (_) {
    return "";
  }
}

function text(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

async function fetchPublicProfile(token) {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw setupError("SUPABASE_URL and SUPABASE_ANON_KEY");

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_public_card_profile`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ lookup_token: token }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Card lookup failed with status ${response.status}.`);
  const result = await response.json();
  const profile = Array.isArray(result) ? result[0] : result;
  if (!profile || !text(profile.name, 120)) {
    const error = new Error("This card is unavailable or inactive.");
    error.statusCode = 404;
    throw error;
  }
  return profile;
}

function setupError(names) {
  const error = new Error(`Wallet setup is incomplete. Add ${names} to the Vercel environment.`);
  error.statusCode = 503;
  return error;
}

function sendError(res, error) {
  const status = Number(error && error.statusCode) || 500;
  const publicMessage = status === 500 ? "The wallet pass could not be created. Please try again later." : error.message;
  res.setHeader("Cache-Control", "no-store");
  res.status(status).json({ error: publicMessage });
}

function localLogoPath() {
  return path.join(process.cwd(), "assets", "mucci-products-logo.png");
}

module.exports = { requestToken, siteUrl, cardUrl, publicLogoUrl, httpsUrl, text, fetchPublicProfile, setupError, sendError, localLogoPath };
