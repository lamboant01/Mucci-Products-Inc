"use strict";

const db = require("./_admin-supabase");
const shopify = require("./_shopify-admin");

const INTERNAL_STATUSES = Object.freeze([
  "NEW", "REVIEWING", "AWAITING_CUSTOMER", "DESIGNING", "READY_TO_PRINT",
  "PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "READY_TO_SHIP", "COMPLETED", "CANCELLED"
]);
const ORDER_PAYMENT_STATUSES = Object.freeze(["PAID", "PARTIALLY_PAID", "AUTHORIZED"]);
const ACTUAL_ORDER = "or(shopify_order_id.not.is.null,shopify_payment_status.in.(PAID,PARTIALLY_PAID,AUTHORIZED))";
const LIST_FIELDS = [
  "id", "quote_code", "name", "email", "status", "created_at", "updated_at", "service_intent", "file_status",
  "quantity", "final_quantity", "material", "desired_colours", "final_price", "estimated_total_max",
  "file_path", "model_files", "reference_files", "requires_manual_review", "internal_status", "internal_status_updated_at",
  "shopify_draft_order_id", "shopify_order_id", "shopify_order_number", "shopify_payment_status",
  "shopify_fulfillment_status", "shopify_total_amount", "shopify_currency_code", "shopify_reconciled_at",
  "shopify_reconciliation_error"
].join(",");

function fileCount(item) {
  const models = Math.max(
    Number(item?.uploaded_file_count || 0),
    Array.isArray(item?.model_files) ? item.model_files.filter((file) => file?.path).length : 0,
    item?.file_path ? 1 : 0
  );
  return models + (Array.isArray(item?.reference_files) ? item.reference_files.filter((file) => file?.path).length : 0);
}

function attentionFlags(item) {
  const flags = [];
  const internal = item.internal_status || null;
  const files = fileCount(item);
  if (!internal) flags.push("Workflow not started");
  if (files > 0 && (!internal || internal === "NEW")) flags.push("Files need review");
  if (item.service_intent === "PRINT_ONLY" && files === 0) flags.push("Missing files");
  if (["DESIGN_ONLY", "DESIGN_AND_PRINT"].includes(item.service_intent) && (!internal || ["NEW", "REVIEWING"].includes(internal))) flags.push("Needs design");
  if (internal === "AWAITING_CUSTOMER") flags.push("Awaiting customer");
  if (internal === "READY_TO_PRINT") flags.push("Ready to print");
  if (internal === "READY_TO_SHIP" && item.shopify_fulfillment_status !== "FULFILLED") flags.push("Ready to ship");
  if (item.shopify_reconciliation_error) flags.push("Shopify lookup failed");
  if (["VOIDED", "REFUNDED", "PARTIALLY_REFUNDED", "EXPIRED"].includes(item.shopify_payment_status)) flags.push("Payment issue");
  return [...new Set(flags)];
}

function publicOrder(item) {
  const copy = { ...item, file_count:fileCount(item), attention_flags:attentionFlags(item) };
  delete copy.file_path;
  delete copy.model_files;
  delete copy.reference_files;
  return copy;
}

function cachePatch(state, error = null) {
  return {
    shopify_order_id:state?.shopify_order_id || null,
    shopify_order_number:state?.shopify_order_number || null,
    shopify_payment_status:state?.shopify_payment_status || null,
    shopify_fulfillment_status:state?.shopify_fulfillment_status || null,
    shopify_total_amount:state?.shopify_total_amount == null ? null : Number(state.shopify_total_amount),
    shopify_currency_code:state?.shopify_currency_code || null,
    shopify_reconciled_at:new Date().toISOString(),
    shopify_reconciliation_error:error
  };
}

async function persistState(config, estimateId, state, error = null) {
  const rows = await db.patch(config, "print_estimates", { id:`eq.${estimateId}` }, cachePatch(state, error));
  return rows?.[0] || null;
}

async function reconcileRows(config, estimates, { force = false } = {}) {
  const staleBefore = Date.now() - 5 * 60 * 1000;
  const candidates = estimates.filter((item) => item.shopify_draft_order_id && (
    force || !item.shopify_reconciled_at || new Date(item.shopify_reconciled_at).getTime() < staleBefore
  ));
  if (!candidates.length) {
    try {
      const configured = Boolean(shopify.configuration());
      return { configured, orderAccess:configured ? "cached" : "not_configured", updated:[] };
    } catch {
      return { configured:true, orderAccess:"unavailable", updated:[] };
    }
  }
  try {
    const result = await shopify.projectStates(candidates.map((item) => item.shopify_draft_order_id));
    const updated = await Promise.all(candidates.map(async (item) => {
      const state = result.projects.get(item.shopify_draft_order_id) || null;
      return persistState(config, item.id, state, state ? null : "order_not_returned");
    }));
    return { configured:result.configured, orderAccess:result.orderAccess, updated:updated.filter(Boolean) };
  } catch (error) {
    console.warn("Shopify order cache refresh unavailable", { message:error?.message });
    await Promise.all(candidates.map((item) => persistState(config, item.id, null, "lookup_failed").catch(() => null)));
    return { configured:true, orderAccess:"unavailable", updated:[] };
  }
}

async function refreshStaleCandidates(config) {
  const candidates = await db.select(config, "print_estimates", {
    select:"id,shopify_draft_order_id,shopify_reconciled_at",
    shopify_draft_order_id:"not.is.null",
    order:"shopify_reconciled_at.asc.nullsfirst",
    limit:"25"
  });
  return reconcileRows(config, candidates);
}

function cleanSearch(value) {
  return String(value || "").trim().slice(0, 80).replace(/[^a-zA-Z0-9@._+#\- ]/g, "");
}

function quoted(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function listParameters(filters = {}) {
  const clauses = [ACTUAL_ORDER];
  const search = cleanSearch(filters.search);
  if (search) {
    const pattern = quoted(`*${search}*`);
    const searchParts = ["quote_code", "name", "email", "shopify_order_number"].map((field) => `${field}.ilike.${pattern}`);
    if (/^[0-9a-f-]{36}$/i.test(search)) searchParts.push(`id.eq.${search.toLowerCase()}`);
    clauses.push(`or(${searchParts.join(",")})`);
  }
  if (filters.internalStatus && INTERNAL_STATUSES.includes(filters.internalStatus)) {
    clauses.push(filters.internalStatus === "NEW" ? "or(internal_status.is.null,internal_status.eq.NEW)" : `internal_status.eq.${filters.internalStatus}`);
  }
  if (filters.paymentStatus) clauses.push(`shopify_payment_status.eq.${cleanSearch(filters.paymentStatus).toUpperCase()}`);
  if (filters.fulfillmentStatus) clauses.push(`shopify_fulfillment_status.eq.${cleanSearch(filters.fulfillmentStatus).toUpperCase()}`);
  if (["PRINT_ONLY", "DESIGN_ONLY", "DESIGN_AND_PRINT"].includes(filters.serviceIntent)) clauses.push(`service_intent.eq.${filters.serviceIntent}`);
  if (filters.hasFiles === "yes") clauses.push("or(file_path.not.is.null,model_files.neq.[],reference_files.neq.[])");
  if (filters.hasFiles === "no") clauses.push("and(file_path.is.null,model_files.eq.[],reference_files.eq.[])");
  if (filters.needsAttention === true || filters.needsAttention === "true") {
    clauses.push("or(internal_status.is.null,internal_status.eq.AWAITING_CUSTOMER,internal_status.eq.READY_TO_PRINT,internal_status.eq.READY_TO_SHIP,shopify_reconciliation_error.not.is.null)");
  }

  const parameters = { select:LIST_FIELDS };
  if (clauses.length === 1) parameters.or = clauses[0].slice(3, -1);
  else parameters.and = `(${clauses.join(",")})`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateFrom || "")) parameters.created_at = `gte.${filters.dateFrom}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo || "")) {
    const end = new Date(`${filters.dateTo}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    parameters.created_at = parameters.created_at ? undefined : `lt.${end.toISOString()}`;
    if (parameters.created_at === undefined) {
      delete parameters.created_at;
      clauses.push(`created_at.gte.${filters.dateFrom}T00:00:00Z`, `created_at.lt.${end.toISOString()}`);
    }
  }
  if (clauses.length > 1) {
    delete parameters.or;
    parameters.and = `(${clauses.join(",")})`;
  }

  const orders = {
    oldest:"created_at.asc", order_number:"shopify_order_number.asc.nullslast",
    highest_value:"shopify_total_amount.desc.nullslast", status:"internal_status.asc.nullsfirst", newest:"created_at.desc"
  };
  parameters.order = orders[filters.sort] || orders.newest;
  const pageSize = Math.min(50, Math.max(10, Number(filters.pageSize) || 25));
  const page = Math.max(1, Number(filters.page) || 1);
  parameters.limit = String(pageSize);
  parameters.offset = String((page - 1) * pageSize);
  return { parameters, page, pageSize };
}

async function listOrders(config, filters) {
  const shopifyStatus = await refreshStaleCandidates(config);
  const { parameters, page, pageSize } = listParameters(filters);
  const result = await db.selectWithCount(config, "print_estimates", parameters);
  return {
    orders:result.rows.map(publicOrder), count:result.count ?? result.rows.length,
    page, pageSize, shopify:{ configured:shopifyStatus.configured, orderAccess:shopifyStatus.orderAccess }
  };
}

function countParameters(extraClause) {
  const clauses = [ACTUAL_ORDER];
  if (extraClause) clauses.push(extraClause);
  return { select:"id", and:`(${clauses.join(",")})`, limit:"1" };
}

async function dashboard(config) {
  const shopifyStatus = await refreshStaleCandidates(config);
  const recentCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const metrics = {
    newOrders:"or(internal_status.is.null,internal_status.eq.NEW)",
    awaitingReview:"or(internal_status.is.null,internal_status.in.(NEW,REVIEWING))",
    designRequired:"internal_status.eq.DESIGNING",
    readyToPrint:"internal_status.eq.READY_TO_PRINT",
    printing:"internal_status.eq.PRINTING",
    readyToShip:"internal_status.eq.READY_TO_SHIP",
    openOrders:"or(internal_status.is.null,internal_status.not.in.(COMPLETED,CANCELLED))",
    recentlyCompleted:`and(internal_status.eq.COMPLETED,internal_status_updated_at.gte.${recentCutoff})`
  };
  const countEntries = await Promise.all(Object.entries(metrics).map(async ([key, clause]) => {
    const result = await db.selectWithCount(config, "print_estimates", countParameters(clause));
    return [key, result.count ?? 0];
  }));
  const [recent, attention] = await Promise.all([
    db.select(config, "print_estimates", { ...countParameters(), select:LIST_FIELDS, order:"created_at.desc", limit:"10" }),
    db.select(config, "print_estimates", {
      select:LIST_FIELDS,
      and:`(${ACTUAL_ORDER},or(internal_status.is.null,internal_status.in.(NEW,AWAITING_CUSTOMER,READY_TO_PRINT,READY_TO_SHIP),shopify_reconciliation_error.not.is.null))`,
      order:"created_at.asc", limit:"30"
    })
  ]);
  return {
    metrics:Object.fromEntries(countEntries),
    needsAttention:attention.map(publicOrder).filter((item) => item.attention_flags.length).slice(0, 8),
    recentOrders:recent.map(publicOrder),
    shopify:{ configured:shopifyStatus.configured, orderAccess:shopifyStatus.orderAccess }
  };
}

module.exports = {
  ACTUAL_ORDER, INTERNAL_STATUSES, attentionFlags, cachePatch, dashboard, fileCount,
  listOrders, listParameters, persistState, publicOrder, reconcileRows, refreshStaleCandidates
};
