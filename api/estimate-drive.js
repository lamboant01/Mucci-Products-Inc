"use strict";

const { normalizeQuoteCode } = require("./_estimate-email");
const drive = require("./_google-drive");
const connection = require("./_google-drive-connection");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SELECT_COLUMNS = "quote_code,notification_token,original_file_name,file_path,drive_file_id,drive_web_view_link";

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); }
    catch (_) { return {}; }
  }
  return {};
}

function headers(serviceKey, extra = {}) {
  return { apikey:serviceKey, Authorization:`Bearer ${serviceKey}`, ...extra };
}

async function findEstimate(config, quoteCode, notificationToken) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/print_estimates`);
  url.searchParams.set("quote_code", `eq.${quoteCode}`);
  url.searchParams.set("notification_token", `eq.${notificationToken}`);
  url.searchParams.set("select", SELECT_COLUMNS);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers:headers(config.serviceKey), signal:AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Estimate lookup failed with status ${response.status}.`);
  const rows = await response.json();
  return rows[0] || null;
}

async function downloadModel(config, filePath) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/authenticated/print-estimate-files/${encodedPath}`, {
    headers:headers(config.serviceKey),
    signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Private model download failed with status ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function markMirrored(config, quoteCode, saved) {
  const url = new URL(`${config.supabaseUrl}/rest/v1/print_estimates`);
  url.searchParams.set("quote_code", `eq.${quoteCode}`);
  const response = await fetch(url, {
    method:"PATCH",
    headers:headers(config.serviceKey, { "Content-Type":"application/json", Prefer:"return=minimal" }),
    body:JSON.stringify({
      drive_file_id:saved.id,
      drive_web_view_link:saved.webViewLink,
      drive_mirrored_at:new Date().toISOString()
    }),
    signal:AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Drive status update failed with status ${response.status}.`);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed." });
  try {
    const body = requestBody(req);
    const quoteCode = normalizeQuoteCode(body.quoteCode);
    const notificationToken = String(body.notificationToken || "").toLowerCase();
    if (!quoteCode || !UUID_PATTERN.test(notificationToken)) return res.status(400).json({ error:"Invalid Drive mirror request." });
    const supabase = connection.supabaseConfiguration();
    const driveConfig = drive.configuration(await connection.storedRefreshToken(supabase));
    const estimate = await findEstimate(supabase, quoteCode, notificationToken);
    if (!estimate || !estimate.file_path) return res.status(202).json({ accepted:true });
    if (estimate.drive_file_id) {
      if (/^https:\/\/drive\.google\.com\/drive\/folders\//.test(estimate.drive_web_view_link || "")) {
        return res.status(202).json({ accepted:true });
      }
      const organized = await drive.organizeModel(driveConfig, {
        quoteCode:estimate.quote_code,
        fileId:estimate.drive_file_id
      });
      await markMirrored(supabase, quoteCode, organized);
      return res.status(200).json({ mirrored:true, organized:true });
    }
    const bytes = await downloadModel(supabase, estimate.file_path);
    const saved = await drive.uploadModel(driveConfig, {
      bytes,
      quoteCode:estimate.quote_code,
      originalFileName:estimate.original_file_name
    });
    await markMirrored(supabase, quoteCode, saved);
    return res.status(200).json({ mirrored:true });
  } catch (error) {
    console.error("Estimate Drive mirror failed:", error && error.message);
    return res.status(error.statusCode || 502).json({ error:"The estimate was saved, but its Drive copy could not be created." });
  }
};
