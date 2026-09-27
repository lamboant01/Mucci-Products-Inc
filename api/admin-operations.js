"use strict";

const auth = require("./_admin-auth");
const db = require("./_admin-supabase");

const ESTIMATE_SELECT = [
  "id", "quote_code", "name", "email", "status", "created_at", "updated_at",
  "quantity", "final_quantity", "material", "final_price", "estimated_price", "estimated_price_max",
  "estimated_production_hours", "estimated_production_hours_max", "requires_manual_review",
  "file_path", "original_file_name", "drive_web_view_link", "drive_mirrored_at",
  "email_notification_sent_at", "admin_notes", "clarification_notes", "completed_at"
].join(",");

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function customerKey(estimate) {
  const email = normalizeEmail(estimate.email);
  return email || `quote:${estimate.quote_code}`;
}

function customersFrom(estimates) {
  const customers = new Map();
  for (const estimate of estimates) {
    const key = customerKey(estimate);
    const current = customers.get(key) || {
      key, name:estimate.name || "Name not provided", email:normalizeEmail(estimate.email),
      requestCount:0, totalQuoted:0, firstSeen:estimate.created_at, lastSeen:estimate.created_at, requests:[]
    };
    current.requestCount += 1;
    current.totalQuoted += Number(estimate.final_price || 0);
    if (new Date(estimate.created_at) > new Date(current.lastSeen)) {
      current.lastSeen = estimate.created_at;
      current.name = estimate.name || current.name;
    }
    if (new Date(estimate.created_at) < new Date(current.firstSeen)) current.firstSeen = estimate.created_at;
    current.requests.push({ quote_code:estimate.quote_code, status:estimate.status, created_at:estimate.created_at });
    customers.set(key, current);
  }
  return [...customers.values()].sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
}

async function loadOperations(config) {
  const estimates = await db.select(config, "print_estimates", {
    select:ESTIMATE_SELECT, order:"created_at.desc", limit:"500"
  });
  const profiles = await db.select(config, "profiles", {
    select:"id,name,company,email,is_active,created_at,updated_at", order:"updated_at.desc", limit:"200"
  });
  const cards = await db.select(config, "physical_cards", {
    select:"id,profile_id,card_label,is_active,created_at", order:"created_at.desc", limit:"200"
  });
  let activity = [];
  let auditAvailable = true;
  try {
    activity = await db.select(config, "admin_activity", {
      select:"id,action,subject_type,subject_id,summary,metadata,created_at", order:"created_at.desc", limit:"100"
    });
  } catch (error) {
    auditAvailable = false;
    console.warn("Admin activity table unavailable", { statusCode:error?.statusCode });
  }

  const customers = customersFrom(estimates);
  const activeStatuses = new Set(["accepted", "in_production"]);
  const awaitingStatuses = new Set(["pending", "reviewed", "etsy_prepared", "awaiting_customer"]);
  const orders = estimates.filter((item) => activeStatuses.has(item.status) || item.status === "completed");
  const files = estimates.filter((item) => item.file_path).map((item) => ({
    id:item.id, quote_code:item.quote_code, name:item.name, created_at:item.created_at,
    original_file_name:item.original_file_name, has_storage_file:Boolean(item.file_path),
    drive_status:item.drive_mirrored_at ? "mirrored" : item.drive_web_view_link ? "linked" : "not_mirrored"
  }));
  const actionRequired = estimates.filter((item) => awaitingStatuses.has(item.status) || item.requires_manual_review);

  return {
    totals:{
      newRequests:estimates.filter((item) => item.status === "pending").length,
      awaitingAction:actionRequired.length,
      activeOrders:estimates.filter((item) => activeStatuses.has(item.status)).length,
      completedOrders:estimates.filter((item) => item.status === "completed").length,
      customers:customers.length,
      activeCards:cards.filter((item) => item.is_active).length,
      manualReview:estimates.filter((item) => item.requires_manual_review).length
    },
    recentRequests:estimates.slice(0, 8),
    actionRequired:actionRequired.slice(0, 8),
    recentCompleted:estimates.filter((item) => item.status === "completed").slice(0, 8),
    customers,
    orders,
    files,
    activity,
    auditAvailable,
    cards:{ profiles, cards }
  };
}

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return auth.apiNotFound(res);
  try {
    const config = auth.configuration();
    if (!auth.requestIsSameOrigin(req, config)) return auth.apiNotFound(res);
    const administrator = await auth.authenticateAdmin(req, res, config);
    if (administrator.status !== "authorized") return auth.apiNotFound(res);
    const body = auth.requestBody(req);
    if (body.action !== "load") return res.status(400).json({ error:"Invalid action." });
    return res.status(200).json(await loadOperations(config));
  } catch (error) {
    console.error("Admin operations load failed", { message:error?.message });
    return res.status(500).json({ error:"The operations data could not be loaded." });
  }
};

module.exports.customersFrom = customersFrom;
module.exports.loadOperations = loadOperations;
