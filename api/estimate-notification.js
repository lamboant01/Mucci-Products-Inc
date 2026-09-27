"use strict";

const { OWNER_EMAIL, buildEstimateEmail, normalizeQuoteCode } = require("./_estimate-email");

const SELECT_COLUMNS = [
  "quote_code", "name", "original_file_name", "file_path", "file_status", "quantity",
  "print_hours_per_item", "print_minutes_per_item", "size_category", "colour_count",
  "design_level", "assembly_required", "notes", "estimated_material_grams",
  "estimated_price", "estimated_price_max", "estimated_price_per_item",
  "estimated_price_per_item_max", "requires_manual_review", "print_time_source",
  "print_profile", "purge_waste_percent", "filament_grams_per_item",
  "email_notification_sent_at", "created_at"
].join(",");

function configuration() {
  const values = {
    supabaseUrl:String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
    resendKey:process.env.RESEND_API_KEY,
    from:process.env.ESTIMATE_EMAIL_FROM,
    to:process.env.ESTIMATE_EMAIL_TO || OWNER_EMAIL,
    siteUrl:String(process.env.PUBLIC_SITE_URL || "https://mucciproducts.com").replace(/\/$/, "")
  };
  const missing = Object.entries(values).filter(([key, value]) => !value && key !== "siteUrl").map(([key]) => key);
  if (missing.length) {
    const error = new Error(`Estimate email is not configured: ${missing.join(", ")}.`);
    error.statusCode = 503;
    throw error;
  }
  return values;
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); }
    catch (_) { return {}; }
  }
  return {};
}

function supabaseHeaders(serviceKey, extra = {}) {
  return { apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, ...extra };
}

async function findEstimate(config, quoteCode, notificationToken) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/print_estimates`);
  url.searchParams.set("quote_code", `eq.${quoteCode}`);
  url.searchParams.set("notification_token", `eq.${notificationToken}`);
  url.searchParams.set("select", SELECT_COLUMNS);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers:supabaseHeaders(config.serviceKey), signal:AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Estimate lookup failed with status ${response.status}.`);
  const rows = await response.json();
  return rows[0] || null;
}

async function markSent(config, quoteCode) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/print_estimates`);
  url.searchParams.set("quote_code", `eq.${quoteCode}`);
  url.searchParams.set("email_notification_sent_at", "is.null");
  const response = await fetch(url, {
    method:"PATCH",
    headers:supabaseHeaders(config.serviceKey, { "Content-Type":"application/json", Prefer:"return=minimal" }),
    body:JSON.stringify({ email_notification_sent_at:new Date().toISOString() }),
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Notification status update failed with status ${response.status}.`);
}

async function sendEmail(config, estimate) {
  const email = buildEstimateEmail(estimate, config.siteUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${config.resendKey}`,
      "Content-Type":"application/json",
      "Idempotency-Key":`estimate-submitted/${estimate.quote_code}`
    },
    body:JSON.stringify({ from:config.from, to:[config.to], subject:email.subject, html:email.html, text:email.text }),
    signal:AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider failed with status ${response.status}: ${detail.slice(0, 300)}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed." });
  try {
    const body = requestBody(req);
    const quoteCode = normalizeQuoteCode(body.quoteCode);
    const notificationToken = String(body.notificationToken || "").toLowerCase();
    if (!quoteCode || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(notificationToken)) return res.status(400).json({ error:"Invalid notification request." });
    const config = configuration();
    const estimate = await findEstimate(config, quoteCode, notificationToken);
    if (!estimate || estimate.email_notification_sent_at) return res.status(202).json({ accepted:true });
    await sendEmail(config, estimate);
    await markSent(config, quoteCode);
    return res.status(200).json({ sent:true });
  } catch (error) {
    console.error("Estimate notification failed:", error && error.message);
    return res.status(error.statusCode || 502).json({ error:"The estimate was saved, but its owner notification could not be sent." });
  }
};
