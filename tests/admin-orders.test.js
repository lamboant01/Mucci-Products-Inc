const test = require("node:test");
const assert = require("node:assert/strict");
const { attentionFlags, cachePatch, estimateCountParameters, listParameters, publicOrder } = require("../api/_admin-orders");

test("attention flags are derived from real workflow, file, Shopify, and service state", () => {
  assert.deepEqual(attentionFlags({
    service_intent:"DESIGN_AND_PRINT", internal_status:null,
    model_files:[{ path:"private/model.stl" }], reference_files:[],
    shopify_reconciliation_error:"lookup_failed"
  }), ["Workflow not started", "Files need review", "Needs design", "Shopify lookup failed"]);
  assert.deepEqual(attentionFlags({
    service_intent:"PRINT_ONLY", internal_status:"READY_TO_SHIP",
    model_files:[], reference_files:[], shopify_fulfillment_status:"UNFULFILLED"
  }), ["Missing files", "Ready to ship"]);
});

test("public order summaries contain counts and flags but no private object paths", () => {
  const result = publicOrder({
    id:"project", quote_code:"MP-4GDBH", service_intent:"PRINT_ONLY", internal_status:"NEW",
    file_path:"private/model.stl", model_files:[{ path:"private/model.stl" }],
    reference_files:[{ path:"private/front.png" }]
  });
  assert.equal(result.file_count, 2);
  assert.equal(Object.hasOwn(result, "file_path"), false);
  assert.equal(Object.hasOwn(result, "model_files"), false);
  assert.equal(Object.hasOwn(result, "reference_files"), false);
});

test("order list parameters use bounded server-side pagination and supported filters", () => {
  const result = listParameters({
    search:"MP-4GDBH", internalStatus:"READY_TO_PRINT", serviceIntent:"PRINT_ONLY",
    hasFiles:"yes", needsAttention:true, sort:"highest_value", page:2, pageSize:500
  });
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 50);
  assert.equal(result.parameters.limit, "50");
  assert.equal(result.parameters.offset, "50");
  assert.equal(result.parameters.order, "shopify_total_amount.desc.nullslast");
  assert.match(result.parameters.and, /quote_code\.ilike/);
  assert.match(result.parameters.and, /internal_status\.eq\.READY_TO_PRINT/);
  assert.match(result.parameters.and, /file_path\.not\.is\.null/);
});

test("Shopify cache patches store only normalized admin read fields and a generic error", () => {
  const result = cachePatch({
    shopify_order_id:"gid://shopify/Order/1001", shopify_order_number:"#1001",
    shopify_payment_status:"PAID", shopify_fulfillment_status:"UNFULFILLED",
    shopify_total_amount:"88.50", shopify_currency_code:"CAD"
  }, null);
  assert.equal(result.shopify_total_amount, 88.5);
  assert.equal(result.shopify_reconciliation_error, null);
  assert.ok(Date.parse(result.shopify_reconciled_at));
});

test("estimate dashboard queries exclude paid or converted Shopify orders", () => {
  const result = estimateCountParameters("status.eq.pending");
  assert.match(result.and, /shopify_order_id\.is\.null/);
  assert.match(result.and, /shopify_payment_status\.not\.in\.\(PAID,PARTIALLY_PAID,AUTHORIZED\)/);
  assert.match(result.and, /status\.eq\.pending/);
});
