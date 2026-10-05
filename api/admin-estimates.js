"use strict";

const auth = require("./_admin-auth");
const db = require("./_admin-supabase");
const listing = require("./_etsy-listing");
const estimateDrive = require("./estimate-drive");
const drive = require("./_google-drive");
const driveConnection = require("./_google-drive-connection");

const QUOTE_PATTERN = /^MP-[A-HJ-NP-Z2-9]{5}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DRIVE_FILE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const QUOTE_FILE_EXTENSIONS = new Set(["stl","3mf","obj","step","stp","dxf","png","jpg","jpeg","webp","heic","heif","gif","svg","pdf","zip","txt"]);
const MAX_QUOTE_FILE_BYTES = 25 * 1024 * 1024;

function quote(value) { return String(value || "").trim().toUpperCase(); }
function uuid(value) { const clean = String(value || "").toLowerCase(); return UUID_PATTERN.test(clean) ? clean : ""; }

async function logActivity(config, user, event) {
  try {
    await db.insert(config, "admin_activity", {
      actor_user_id:user.id,
      action:event.action,
      subject_type:"print_estimate",
      subject_id:event.estimateId,
      summary:event.summary,
      metadata:event.metadata || {}
    });
  } catch (error) {
    console.warn("Admin activity could not be recorded", { action:event.action, statusCode:error?.statusCode });
  }
}

function reviewValues(body) {
  const priceText = String(body.finalPrice ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0) throw new Error("Invalid final price.");
  const physicalQuantity = Number(body.physicalQuantity);
  const listingQuantity = Number(body.listingQuantity ?? 1);
  if (!Number.isInteger(physicalQuantity) || physicalQuantity < 1 || physicalQuantity > 999) throw new Error("Invalid physical quantity.");
  if (!Number.isInteger(listingQuantity) || listingQuantity < 1 || listingQuantity > 999) throw new Error("Invalid listing quantity.");
  const adminNotes = String(body.adminNotes || "").trim();
  const clarificationNotes = String(body.clarificationNotes || "").trim();
  const processingOverride = String(body.processingOverride || "").trim();
  if (adminNotes.length > 5000 || clarificationNotes.length > 3000 || processingOverride.length > 120) throw new Error("Review text is too long.");
  return { finalPrice:Number(priceText), physicalQuantity, listingQuantity, adminNotes, clarificationNotes, processingOverride };
}

async function findById(config, estimateId) {
  const rows = await db.select(config, "print_estimates", { id:`eq.${estimateId}`, select:"*", limit:"1" });
  return rows?.[0] || null;
}

async function connectedDrive(config) {
  return drive.configuration(await driveConnection.storedRefreshToken(config));
}

function quoteUpload(body) {
  const originalName = String(body.fileName || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  const extension = originalName.split(".").pop().toLowerCase();
  const size = Number(body.fileSize);
  if (!originalName || originalName.length > 220 || !QUOTE_FILE_EXTENSIONS.has(extension)) throw new Error("Unsupported quote file.");
  if (!Number.isInteger(size) || size < 1 || size > MAX_QUOTE_FILE_BYTES) throw new Error("Quote files must be 25 MB or smaller.");
  return { originalName, size, contentType:drive.contentType(originalName) };
}

async function handleAction(config, user, body) {
  switch (body.action) {
    case "recent": {
      const filter = String(body.filter || "all");
      const manual = filter === "manual_review";
      const status = manual || filter === "all" ? null : filter;
      if (status && !listing.config.statuses.includes(status)) throw new Error("Invalid filter.");
      return { estimates:await db.rpc(config, "admin_recent_print_estimates", { p_status:status, p_manual_review:manual }) };
    }
    case "find": {
      const clean = quote(body.quoteCode);
      if (!QUOTE_PATTERN.test(clean)) throw new Error("Invalid quote code.");
      const estimates = await db.rpc(config, "admin_find_print_estimate", { p_quote_code:clean });
      if (!estimates?.length) return { estimate:null, history:[] };
      const estimate = estimates[0];
      const history = await db.select(config, "etsy_listing_preparations", { estimate_id:`eq.${estimate.id}`, select:"*", order:"generated_at.desc", limit:"10" });
      return { estimate:{ ...estimate, suggested_processing:listing.suggestProcessing(estimate) }, history };
    }
    case "save": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const values = reviewValues(body);
      const estimate = await db.rpc(config, "admin_save_print_estimate_review", {
        p_estimate_id:estimateId, p_final_price:values.finalPrice, p_final_quantity:values.physicalQuantity,
        p_admin_notes:values.adminNotes || null, p_clarification_notes:values.clarificationNotes || null,
        p_processing_time_override:values.processingOverride || null
      });
      const savedEstimate = estimate?.[0] || null;
      if (savedEstimate) await logActivity(config, user, { action:"estimate_review_updated", estimateId, summary:`Review details updated for ${savedEstimate.quote_code}.` });
      return { estimate:savedEstimate };
    }
    case "status": {
      const estimateId = uuid(body.estimateId);
      const status = String(body.status || "");
      if (!estimateId || !listing.config.statuses.includes(status)) throw new Error("Invalid status change.");
      const estimate = await db.rpc(config, "admin_set_print_estimate_status", { p_estimate_id:estimateId, p_status:status });
      const changedEstimate = estimate?.[0] || null;
      if (changedEstimate) await logActivity(config, user, { action:"estimate_status_changed", estimateId, summary:`${changedEstimate.quote_code} status changed to ${status.replaceAll("_", " ")}.`, metadata:{ status } });
      return { estimate:changedEstimate };
    }
    case "prepare": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const values = reviewValues(body);
      const saved = await db.rpc(config, "admin_save_print_estimate_review", {
        p_estimate_id:estimateId, p_final_price:values.finalPrice, p_final_quantity:values.physicalQuantity,
        p_admin_notes:values.adminNotes || null, p_clarification_notes:values.clarificationNotes || null,
        p_processing_time_override:values.processingOverride || null
      });
      const estimate = saved?.[0] || null;
      if (!estimate) throw new Error("Estimate not found.");
      const prepared = listing.buildPackage(estimate, { ...values, processing:values.processingOverride || listing.suggestProcessing(estimate) });
      const snapshots = await db.rpc(config, "admin_prepare_etsy_listing", {
        p_estimate_id:estimateId, p_generated_title:prepared.title, p_generated_description:prepared.description,
        p_final_price:values.finalPrice, p_listing_quantity:values.listingQuantity,
        p_physical_quantity:values.physicalQuantity, p_processing_time:prepared.processing,
        p_generated_by:user.id
      });
      await logActivity(config, user, { action:"quote_prepared", estimateId, summary:`Customer quote prepared for ${estimate.quote_code}.` });
      return { prepared, snapshot:snapshots?.[0] || null, estimate:{ ...estimate, status:"etsy_prepared" } };
    }
    case "mirror_drive": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const estimate = await findById(config, estimateId);
      if (!estimate?.file_path && !estimate?.reference_files?.length) throw new Error("Uploaded files not found.");
      const result = await estimateDrive.mirrorEstimate(config, estimate);
      await logActivity(config, user, { action:"file_mirrored", estimateId, summary:`Private file organized in Google Drive for ${estimate.quote_code}.` });
      return result;
    }
    case "drive_files": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const estimate = await findById(config, estimateId);
      if (!estimate) throw new Error("Estimate not found.");
      const result = await drive.listQuoteFiles(await connectedDrive(config), estimate.quote_code);
      if (estimate.drive_web_view_link !== result.folder.webViewLink) {
        await db.patch(config, "print_estimates", { id:`eq.${estimateId}` }, { drive_web_view_link:result.folder.webViewLink });
      }
      return { quoteCode:estimate.quote_code, folder:result.folder, files:result.files };
    }
    case "drive_upload_start": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const estimate = await findById(config, estimateId);
      if (!estimate) throw new Error("Estimate not found.");
      const upload = quoteUpload(body);
      const result = await drive.startQuoteUpload(await connectedDrive(config), {
        quoteCode:estimate.quote_code,
        originalFileName:upload.originalName,
        contentType:upload.contentType,
        size:upload.size
      });
      await db.patch(config, "print_estimates", { id:`eq.${estimateId}` }, { drive_web_view_link:result.folder.webViewLink });
      return { uploadUrl:result.uploadUrl, contentType:result.contentType, folder:result.folder };
    }
    case "drive_upload_complete": {
      const estimateId = uuid(body.estimateId);
      const fileId = String(body.fileId || "");
      if (!estimateId || !DRIVE_FILE_ID_PATTERN.test(fileId)) throw new Error("Invalid uploaded file.");
      const estimate = await findById(config, estimateId);
      if (!estimate) throw new Error("Estimate not found.");
      const result = await drive.listQuoteFiles(await connectedDrive(config), estimate.quote_code);
      const uploaded = result.files.find((file) => file.id === fileId);
      if (!uploaded) throw new Error("Uploaded file was not found in the quote folder.");
      await db.patch(config, "print_estimates", { id:`eq.${estimateId}` }, {
        drive_web_view_link:result.folder.webViewLink,
        drive_mirrored_at:new Date().toISOString()
      });
      await logActivity(config, user, { action:"quote_file_uploaded", estimateId, summary:`${uploaded.name} uploaded to Drive for ${estimate.quote_code}.`, metadata:{ drive_file_id:fileId } });
      return { file:uploaded, folder:result.folder };
    }
    case "signed_file": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const estimate = await findById(config, estimateId);
      if (!estimate?.file_path) throw new Error("Uploaded file not found.");
      const signedUrl = await db.signedStorageUrl(config, "print-estimate-files", estimate.file_path, 60);
      await logActivity(config, user, { action:"file_accessed", estimateId, summary:`Private file link created for ${estimate.quote_code}.` });
      return { signedUrl, expiresIn:60 };
    }
    default: throw new Error("Invalid action.");
  }
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
    const payload = await handleAction(config, administrator.user, body);
    console.info("Authorized estimate administration action", { action:String(body.action || ""), userId:administrator.user.id });
    return res.status(200).json(payload);
  } catch (error) {
    console.error("Estimate administration action failed", { message:error?.message });
    return res.status(400).json({ error:"The administrative request could not be completed." });
  }
};

module.exports.handleAction = handleAction;
module.exports.reviewValues = reviewValues;
