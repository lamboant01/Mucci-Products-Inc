"use strict";

const auth = require("./_admin-auth");
const db = require("./_admin-supabase");
const listing = require("./_etsy-listing");

const QUOTE_PATTERN = /^MP-[A-HJ-NP-Z2-9]{5}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function quote(value) { return String(value || "").trim().toUpperCase(); }
function uuid(value) { const clean = String(value || "").toLowerCase(); return UUID_PATTERN.test(clean) ? clean : ""; }

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
      return { estimate:estimate?.[0] || null };
    }
    case "status": {
      const estimateId = uuid(body.estimateId);
      const status = String(body.status || "");
      if (!estimateId || !["reviewed", "completed", "declined"].includes(status)) throw new Error("Invalid status change.");
      const estimate = await db.rpc(config, "admin_set_print_estimate_status", { p_estimate_id:estimateId, p_status:status });
      return { estimate:estimate?.[0] || null };
    }
    case "prepare": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const values = reviewValues(body);
      const estimate = await findById(config, estimateId);
      if (!estimate) throw new Error("Estimate not found.");
      const prepared = listing.buildPackage(estimate, { ...values, processing:values.processingOverride || listing.suggestProcessing(estimate) });
      const snapshots = await db.rpc(config, "admin_prepare_etsy_listing", {
        p_estimate_id:estimateId, p_generated_title:prepared.title, p_generated_description:prepared.description,
        p_final_price:values.finalPrice, p_listing_quantity:values.listingQuantity,
        p_physical_quantity:values.physicalQuantity, p_processing_time:prepared.processing,
        p_generated_by:user.id
      });
      return { prepared, snapshot:snapshots?.[0] || null, estimate:{ ...estimate, final_price:values.finalPrice, final_quantity:values.physicalQuantity, admin_notes:values.adminNotes || null, clarification_notes:values.clarificationNotes || null, processing_time_override:values.processingOverride || null, status:"etsy_prepared" } };
    }
    case "signed_file": {
      const estimateId = uuid(body.estimateId);
      if (!estimateId) throw new Error("Invalid estimate.");
      const estimate = await findById(config, estimateId);
      if (!estimate?.file_path) throw new Error("Uploaded file not found.");
      return { signedUrl:await db.signedStorageUrl(config, "print-estimate-files", estimate.file_path, 60), expiresIn:60 };
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
