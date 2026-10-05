"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const auth = require("./_admin-auth");
const db = require("./_admin-supabase");
const shopify = require("./_shopify-admin");
const orders = require("./_admin-orders");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg"]);
const PRIVATE_FIELDS = new Set([
  "notification_token", "shopify_draft_order_claim_token", "shopify_draft_order_error", "shopify_invoice_url",
  "file_path", "drive_model_files", "drive_reference_files"
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

function fileIdentifier(objectPath) {
  return crypto.createHash("sha256").update(String(objectPath)).digest("hex").slice(0, 24);
}

function projectFiles(estimate) {
  const files = new Map();
  const add = (value, fallbackName, kind) => {
    const objectPath = String(typeof value === "string" ? value : value?.path || "").trim();
    if (!objectPath || files.has(objectPath)) return;
    const name = safeName(value?.name || fallbackName || path.basename(objectPath), "Customer file");
    files.set(objectPath, {
      path:objectPath,
      id:fileIdentifier(objectPath),
      name,
      kind,
      category:kind === "reference" ? "Reference Images" : "Customer Models",
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

function publicFiles(estimate) {
  return projectFiles(estimate).map(({ path:objectPath, ...file }) => file);
}

function publicEstimate(estimate) {
  const result = Object.fromEntries(Object.entries(estimate || {}).filter(([key]) => !PRIVATE_FIELDS.has(key) && !key.endsWith("_token")));
  for (const key of ["model_files", "reference_files"]) {
    if (!Array.isArray(result[key])) continue;
    result[key] = result[key].map((file) => ({
      name:file?.name || null,
      size_bytes:Number(file?.size_bytes) > 0 ? Number(file.size_bytes) : null,
      content_type:file?.content_type || null,
      print_settings:file?.print_settings || null
    }));
  }
  return result;
}

async function findById(config, estimateId) {
  const rows = await db.select(config, "print_estimates", { id:`eq.${estimateId}`, select:"*", limit:"1" });
  return rows?.[0] || null;
}

async function previousProjects(config, estimate) {
  const email = String(estimate.email || "").trim().toLowerCase();
  if (!email) return [];
  const rows = await db.select(config, "print_estimates", {
    select:"id,quote_code,name,status,internal_status,service_intent,created_at,shopify_order_number",
    email:`eq.${email}`,
    order:"created_at.desc",
    limit:"7"
  });
  return rows.filter((item) => item.id !== estimate.id).slice(0, 6);
}

async function orderEvents(config, estimateId) {
  try {
    return await db.select(config, "admin_order_events", {
      select:"id,event_type,old_value,new_value,actor_email,created_at",
      project_id:`eq.${estimateId}`,
      order:"created_at.desc",
      limit:"50"
    });
  } catch (error) {
    console.warn("Order event history unavailable", { statusCode:error?.statusCode });
    return [];
  }
}

async function reconcileProject(config, estimate) {
  if (!estimate.shopify_draft_order_id) return { commerce:null, detail:null, status:{ configured:false, orderAccess:"not_linked" } };
  try {
    const result = await shopify.projectStates([estimate.shopify_draft_order_id]);
    const commerce = result.projects.get(estimate.shopify_draft_order_id) || null;
    await orders.persistState(config, estimate.id, commerce, commerce ? null : "order_not_returned").catch((error) => {
      console.warn("Shopify cache could not be persisted", { statusCode:error?.statusCode });
    });
    let detail = null;
    if (commerce?.shopify_order_id) {
      try { detail = await shopify.orderDetails(commerce.shopify_order_id); }
      catch (error) { console.warn("Shopify customer detail unavailable", { message:error?.message }); }
    }
    return { commerce, detail, status:{ configured:result.configured, orderAccess:result.orderAccess } };
  } catch (error) {
    console.warn("Shopify project reconciliation unavailable", { message:error?.message });
    await orders.persistState(config, estimate.id, null, "lookup_failed").catch(() => null);
    return { commerce:null, detail:null, status:{ configured:true, orderAccess:"unavailable" } };
  }
}

async function loadProject(config, estimateId) {
  const estimate = await findById(config, estimateId);
  if (!estimate) return null;
  const reconciliation = await reconcileProject(config, estimate);
  const [events, related] = await Promise.all([orderEvents(config, estimateId), previousProjects(config, estimate)]);
  return {
    estimate:{ ...publicEstimate(estimate), ...(reconciliation.commerce || {}) },
    files:publicFiles(estimate),
    events,
    previousProjects:related,
    shopify:{ ...reconciliation.status, detail:reconciliation.detail }
  };
}

async function signedFile(config, estimateId, fileId, download) {
  const estimate = await findById(config, estimateId);
  if (!estimate) throw new Error("Project not found.");
  const file = projectFiles(estimate).find((item) => item.id === String(fileId || ""));
  if (!file) throw new Error("Customer file not found for this project.");
  const signedUrl = await db.signedStorageUrl(config, "print-estimate-files", file.path, 60);
  if (!download) return { signedUrl, expiresIn:60 };
  const url = new URL(signedUrl);
  url.searchParams.set("download", file.name);
  return { signedUrl:url.toString(), expiresIn:60 };
}

async function signedFiles(config, estimateId) {
  const estimate = await findById(config, estimateId);
  if (!estimate) throw new Error("Project not found.");
  const files = projectFiles(estimate);
  if (!files.length) throw new Error("No customer files are available for this project.");
  if (files.length > 20) throw new Error("Download All supports up to 20 files at once.");
  return Promise.all(files.map(async (file) => {
    const signedUrl = await db.signedStorageUrl(config, "print-estimate-files", file.path, 60);
    const url = new URL(signedUrl);
    url.searchParams.set("download", file.name);
    return { id:file.id, name:file.name, signedUrl:url.toString(), expiresIn:60 };
  }));
}

async function setInternalStatus(config, user, estimateId, value) {
  const status = String(value || "").trim().toUpperCase();
  if (!orders.INTERNAL_STATUSES.includes(status)) throw new Error("Invalid internal status.");
  const rows = await db.rpc(config, "admin_set_order_internal_status", {
    p_project_id:estimateId, p_status:status, p_actor_email:user.email || null
  });
  const estimate = rows?.[0];
  if (!estimate) throw new Error("Project not found.");
  try {
    await db.insert(config, "admin_activity", {
      actor_user_id:user.id,
      action:"order_internal_status_changed",
      subject_type:"print_estimate",
      subject_id:estimateId,
      summary:`${estimate.quote_code} workflow changed to ${status.toLowerCase().replaceAll("_", " ")}.`,
      metadata:{ internal_status:status }
    });
  } catch (error) {
    console.warn("Admin activity could not be recorded", { statusCode:error?.statusCode });
  }
  return publicEstimate(estimate);
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
    if (body.action === "refresh_shopify") {
      const project = await loadProject(config, estimateId);
      return project ? res.status(200).json(project) : res.status(404).json({ error:"Project not found." });
    }
    if (body.action === "status") return res.status(200).json({ estimate:await setInternalStatus(config, administrator.user, estimateId, body.status) });
    if (body.action === "file") return res.status(200).json(await signedFile(config, estimateId, body.fileId, body.download === true));
    if (body.action === "download_all") return res.status(200).json({ files:await signedFiles(config, estimateId) });
    return res.status(400).json({ error:"Invalid action." });
  } catch (error) {
    console.error("Admin project action failed", { message:error?.message });
    const message = String(error?.message || "");
    if (/Customer file not found|No customer files/i.test(message)) return res.status(404).json({ error:"File no longer exists." });
    if (/Storage did not return a signed URL/i.test(message)) return res.status(502).json({ error:"Could not generate secure download link." });
    if (/Invalid internal status/i.test(message)) return res.status(400).json({ error:"That production status is not supported." });
    if (/admin_set_order_internal_status|internal_status/i.test(JSON.stringify(error?.detail || ""))) return res.status(503).json({ error:"Order workflow setup is not complete." });
    return res.status(400).json({ error:"The project request could not be completed." });
  }
};

module.exports.loadProject = loadProject;
module.exports.projectFiles = projectFiles;
module.exports.publicFiles = publicFiles;
module.exports.publicEstimate = publicEstimate;
module.exports.signedFile = signedFile;
module.exports.signedFiles = signedFiles;
module.exports.setInternalStatus = setInternalStatus;
