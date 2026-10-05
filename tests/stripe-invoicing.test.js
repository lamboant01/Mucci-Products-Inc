"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const invoicing = require("../api/_stripe-invoicing");
const webhook = require("../api/stripe-webhook");

const estimate = {
  id:"123e4567-e89b-42d3-a456-426614174000",
  quote_code:"MP-A42K7",
  name:"Test Customer",
  service_intent:"DESIGN_AND_PRINT",
  final_price:123.45
};

test("Stripe configuration only accepts an explicit test secret", () => {
  const original = { ...process.env };
  try {
    process.env.STRIPE_SECRET_KEY = "sk_live_not_allowed";
    assert.throws(() => invoicing.configuration(), /test-mode configuration/i);
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    process.env.STRIPE_INVOICE_DAYS_UNTIL_DUE = "14";
    assert.equal(invoicing.configuration().daysUntilDue, 14);
  } finally {
    process.env = original;
  }
});

test("invoice amounts are converted to integer CAD cents without floating point leakage", () => {
  assert.equal(invoicing.amountInCents("123.45"), 12345);
  assert.equal(invoicing.amountInCents("50"), 5000);
  assert.throws(() => invoicing.amountInCents("10.999"), /invalid/i);
});

test("new invoices use stable idempotency keys, metadata, and hosted invoice collection", async () => {
  const calls = [];
  const stripe = {
    customers:{ create:async (body, options) => { calls.push(["customer", body, options]); return { id:"cus_test123" }; } },
    invoices:{
      create:async (body, options) => { calls.push(["invoice", body, options]); return { id:"in_test123", customer:"cus_test123", status:"draft", created:1 }; },
      retrieve:async () => { throw new Error("not expected"); },
      sendInvoice:async () => { throw new Error("not expected"); }
    },
    invoiceItems:{ create:async (body, options) => { calls.push(["item", body, options]); return { id:"ii_test123" }; } }
  };
  const result = await invoicing.createOrSendInvoice(stripe, estimate, "customer@example.test", 14);
  assert.equal(result.draftInvoice.id, "in_test123");
  assert.equal(calls[1][1].collection_method, "send_invoice");
  assert.equal(calls[1][1].auto_advance, false);
  assert.equal(calls[2][1].amount, 12345);
  assert.equal(calls[2][1].currency, "cad");
  assert.equal(calls[2][1].metadata.mucci_quote_code, estimate.quote_code);
  assert.equal(calls[1][2].idempotencyKey, `mucci-invoice-${estimate.id}`);
});

test("an existing draft invoice is sent instead of duplicated", async () => {
  let sent = "";
  const stripe = {
    invoices:{
      retrieve:async () => ({ id:"in_existing", status:"draft" }),
      sendInvoice:async (id) => { sent = id; return { id, status:"open" }; }
    }
  };
  const result = await invoicing.createOrSendInvoice(stripe, { ...estimate, stripe_invoice_id:"in_existing" }, "customer@example.test", 14);
  assert.equal(sent, "in_existing");
  assert.equal(result.status, "open");
});

test("webhook helpers map invoice, refund, and credit note events", () => {
  assert.equal(webhook.invoiceReference({ type:"invoice.paid", data:{ object:{ id:"in_paid" } } }), "in_paid");
  assert.equal(webhook.invoiceReference({ type:"charge.refunded", data:{ object:{ invoice:"in_refund" } } }), "in_refund");
  assert.equal(webhook.invoiceReference({ type:"credit_note.created", data:{ object:{ invoice:{ id:"in_credit" } } } }), "in_credit");
  assert.equal(webhook.statusFor({ type:"invoice.paid", data:{ object:{} } }), "paid");
  assert.equal(webhook.statusFor({ type:"charge.refunded", data:{ object:{ refunded:false } } }), "partially_refunded");
});

test("migration links invoices privately and records webhook events atomically", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "migrations", "024_stripe_invoicing.sql"), "utf8");
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on public\.stripe_webhook_events from public, anon, authenticated/i);
  assert.match(sql, /create unique index[\s\S]*stripe_invoice_id/i);
  assert.match(sql, /record_stripe_invoice_event/i);
  assert.match(sql, /p_invoice_status = 'paid'[\s\S]*then 'accepted'/i);
});
