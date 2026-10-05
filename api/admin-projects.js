"use strict";

const path = require("node:path");
const auth = require("./_admin-auth");
const db = require("./_admin-supabase");
const shopify = require("./_shopify-admin");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const PRIVATE_FIELDS = new Set([
  "notification_token", "shopify_draft_order_claim_token", "shopify_draft_order_error", "shopify_invoice_url"
]);

function uuid(value) {
  const clean = String(value || "").trim().toLowerCase();
  return UUID_PATTERN.test(clean) ? clean : "";
}

function safeName(value, fallback) {
  const clean = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean.slice(0, 255) || fallback;
}

function extension(value) {
  return path.extname(String(value || "")).slice(1).toLowerCase();
}

function projectFiles(estimate) {
  const files = new Map();
  const add = (value, fallbackName, kind) => {
    const objectPath = String(typeof value === "string" ? value : value?.path || "").trim();
    if (!objectPath || files.has(objectPath)) return;
    const name = safeName(value?.name || fallbackName || path.basename(objectPath), "Customer file");
    files.set(objectPath, {
      path:objectPath,
      name,
      kind,
      extension:extension(name || objectPath),
      contentType:value?.content_type || null,
      sizeBytes:Number(value?.size_bytes) > 0 ? Number(value.size_bytes) : null,
      uploadedAt:estimate.created_at || null,
      viewable:IMAGE_EXTENSIONS.has(extension(name || objectPath)) || extension(name || objectPath) === "pdf"
    });
  };
  for (const item of Array.isArray(estimate.model_files) ? estimate.model_files : []) add(item, item?.name, "model");
  add(estimate.file_path, estimate.original_file_name, "model");
  for (const item of Array.isArray(estimate.reference_files) ? estimate.reference_files : []) add(item, item?.name, "reference");
  return [...files.values()];
}

function publicEstimate(estimate) {
  return Object.fromEntries(Object.entries(estimate || {}).filter(([key]) => !PRIVATE_FIELDS.has(key) && !key.endsWith("_token")));
}

async function findById(config, estimateId) {
  const rows = await db.select(config, "print_estimates", { id:`eq.${estimateId}`, select:"*", limit:"1" });
  return rows?.[0] || null;
}

async function loadProject(config, estimateId) {
  const estimate = await findById(config, estimateId);
  if (!estimate) return null;
  let commerce = null;
  let shopifyStatus = { configured:false, orderAccess:"not_configured" };
  if (estimate.shopify_draft_order_id) {
    try {
      const result = await shopify.projectStates([estimate.shopify_draft_order_id]);
      shopifyStatus = { configured:result.configured, orderAccess:result.orderAccess };
      commerce = result.projects.get(estimate.shopify_draft_order_id) || null;
    } catch (error) {
      console.warn("Shopify project reconciliation unavailable", { message:error?.message });
      shopifyStatus = { configured:true, orderAccess:"unavailable" };
    }
  }
  return {
    estimate:{ ...publicEstimate(estimate), ...(commerce || {}) },
    files:projectFiles(estimate),
    shopify:shopifyStatus
  };
}

async function signedFile(config, estimateId, objectPath, download) {
  const estimate = await findById(config, estimateId);
  if (!estimate) throw new Error("Project not found.");
  const file = projectFiles(estimate).find((item) => item.path === String(objectPath || ""));
  if (!file) throw new Error("Customer file not found for this project.");
  const signedUrl = await db.signedStorageUrl(config, "print-estimate-files", file.path, 60);
  if (!download) return { signedUrl, expiresIn:60 };
  const url = new URL(signedUrl);
  url.searchParams.set("download", file.name);
  return { signedUrl:url.toString(), expiresIn:60 };
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
    const estimateId = uuid(body.estimateId);
    if (!estimateId) return res.status(400).json({ error:"Invalid project." });
    if (body.action === "load") {
      const project = await loadProject(config, estimateId);
      return project ? res.status(200).json(project) : res.status(404).json({ error:"Project not found." });
    }
    if (body.action === "file") return res.status(200).json(await signedFile(config, estimateId, body.path, body.download === true));
    return res.status(400).json({ error:"Invalid action." });
  } catch (error) {
    console.error("Admin project action failed", { message:error?.message });
    return res.status(400).json({ error:"The project request could not be completed." });
  }
};

module.exports.loadProject = loadProject;
module.exports.projectFiles = projectFiles;
module.exports.publicEstimate = publicEstimate;
module.exports.signedFile = signedFile;
