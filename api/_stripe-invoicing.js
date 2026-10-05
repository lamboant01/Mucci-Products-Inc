"use strict";

const Stripe = require("stripe");

const STRIPE_ID = {
  customer:/^cus_[A-Za-z0-9]+$/,
  invoice:/^in_[A-Za-z0-9]+$/
};

function configuration() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || "");
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "");
  const daysUntilDue = Number(process.env.STRIPE_INVOICE_DAYS_UNTIL_DUE || 14);
  if (!secretKey.startsWith("sk_test_")) {
    const error = new Error("Stripe test-mode configuration is missing.");
    error.statusCode = 503;
    throw error;
  }
  if (!Number.isInteger(daysUntilDue) || daysUntilDue < 1 || daysUntilDue > 90) {
    const error = new Error("STRIPE_INVOICE_DAYS_UNTIL_DUE must be between 1 and 90.");
    error.statusCode = 503;
    throw error;
  }
  return { secretKey, webhookSecret, daysUntilDue };
}

function client(config = configuration()) {
  return new Stripe(config.secretKey, { maxNetworkRetries:2, timeout:10_000 });
}

function email(value) {
  const clean = String(value || "").trim().toLowerCase();
  if (clean.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error("A valid customer email is required to send a Stripe invoice.");
  return clean;
}

function amountInCents(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("The final invoice amount is invalid.");
  const amount = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(amount) || amount < 50 || amount > 99_999_999) throw new Error("The final invoice amount is outside the supported range.");
  return amount;
}

function invoiceDescription(estimate) {
  const service = estimate.service_intent === "DESIGN_ONLY"
    ? "Custom 3D design services"
    : estimate.service_intent === "DESIGN_AND_PRINT"
      ? "Custom 3D design and manufacturing"
      : "Custom 3D manufacturing";
  return `${service} - quote ${estimate.quote_code}`;
}

async function createOrSendInvoice(stripe, estimate, customerEmail, daysUntilDue) {
  if (estimate.stripe_invoice_id) {
    if (!STRIPE_ID.invoice.test(estimate.stripe_invoice_id)) throw new Error("The stored Stripe invoice reference is invalid.");
    const existing = await stripe.invoices.retrieve(estimate.stripe_invoice_id);
    return existing.status === "draft"
      ? stripe.invoices.sendInvoice(existing.id, {}, { idempotencyKey:`mucci-send-${estimate.id}` })
      : existing;
  }

  let customerId = String(estimate.stripe_customer_id || "");
  if (customerId && !STRIPE_ID.customer.test(customerId)) throw new Error("The stored Stripe customer reference is invalid.");
  if (!customerId) {
    const customer = await stripe.customers.create({
      email:customerEmail,
      name:String(estimate.name || "").trim() || undefined,
      description:`Mucci Products customer for quote ${estimate.quote_code}`,
      metadata:{ mucci_estimate_id:estimate.id, mucci_quote_code:estimate.quote_code }
    }, { idempotencyKey:`mucci-customer-${estimate.id}` });
    customerId = customer.id;
  }

  const metadata = { mucci_estimate_id:estimate.id, mucci_quote_code:estimate.quote_code };
  const invoice = await stripe.invoices.create({
    customer:customerId,
    collection_method:"send_invoice",
    days_until_due:daysUntilDue,
    auto_advance:false,
    description:`Mucci Products quote ${estimate.quote_code}`,
    metadata
  }, { idempotencyKey:`mucci-invoice-${estimate.id}` });

  await stripe.invoiceItems.create({
    customer:customerId,
    invoice:invoice.id,
    amount:amountInCents(estimate.final_price),
    currency:"cad",
    description:invoiceDescription(estimate),
    metadata
  }, { idempotencyKey:`mucci-invoice-item-${estimate.id}` });

  return { draftInvoice:invoice, customerId };
}

function invoiceSnapshot(invoice, customerId) {
  return {
    stripe_customer_id:customerId || (typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id) || null,
    stripe_invoice_id:invoice.id,
    stripe_invoice_status:invoice.status,
    stripe_hosted_invoice_url:invoice.hosted_invoice_url || null,
    stripe_invoice_pdf:invoice.invoice_pdf || null,
    stripe_invoice_created_at:new Date(Number(invoice.created) * 1000).toISOString()
  };
}

module.exports = { STRIPE_ID, amountInCents, client, configuration, createOrSendInvoice, email, invoiceDescription, invoiceSnapshot };
