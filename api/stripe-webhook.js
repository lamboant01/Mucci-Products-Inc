"use strict";

const db = require("./_admin-supabase");
const adminAuth = require("./_admin-auth");
const stripeInvoicing = require("./_stripe-invoicing");

function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body));
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function invoiceReference(event) {
  const object = event?.data?.object || {};
  if (event.type.startsWith("invoice.")) return object.id;
  if (event.type === "charge.refunded") return typeof object.invoice === "string" ? object.invoice : object.invoice?.id;
  if (event.type === "credit_note.created") return typeof object.invoice === "string" ? object.invoice : object.invoice?.id;
  return "";
}

function statusFor(event) {
  const object = event?.data?.object || {};
  if (event.type === "invoice.paid") return "paid";
  if (event.type === "invoice.payment_failed") return "payment_failed";
  if (event.type === "charge.refunded") return object.refunded ? "refunded" : "partially_refunded";
  if (event.type === "credit_note.created") return "credited";
  return String(object.status || event.type.replace("invoice.", ""));
}

const HANDLED_EVENTS = new Set([
  "invoice.finalized", "invoice.sent", "invoice.paid", "invoice.payment_failed",
  "invoice.voided", "invoice.marked_uncollectible", "charge.refunded", "credit_note.created"
]);

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).setHeader("Allow", "POST").json({ error:"Method not allowed." });
  try {
    const stripeConfig = stripeInvoicing.configuration();
    if (!stripeConfig.webhookSecret.startsWith("whsec_")) throw Object.assign(new Error("Stripe webhook configuration is missing."), { statusCode:503 });
    const stripe = stripeInvoicing.client(stripeConfig);
    const signature = String(req.headers?.["stripe-signature"] || "");
    const event = stripe.webhooks.constructEvent(await rawBody(req), signature, stripeConfig.webhookSecret);
    if (!HANDLED_EVENTS.has(event.type)) return res.status(200).json({ received:true, handled:false });

    const stripeInvoiceId = invoiceReference(event);
    if (!stripeInvoicing.STRIPE_ID.invoice.test(stripeInvoiceId)) return res.status(200).json({ received:true, handled:false });
    const config = adminAuth.configuration();
    const rows = await db.rpc(config, "record_stripe_invoice_event", {
      p_event_id:event.id,
      p_event_type:event.type,
      p_stripe_invoice_id:stripeInvoiceId,
      p_invoice_status:statusFor(event),
      p_hosted_invoice_url:event.type.startsWith("invoice.") ? event.data.object.hosted_invoice_url || null : null,
      p_invoice_pdf:event.type.startsWith("invoice.") ? event.data.object.invoice_pdf || null : null,
      p_paid_at:event.type === "invoice.paid" ? new Date((event.data.object.status_transitions?.paid_at || event.created) * 1000).toISOString() : null
    });
    if (rows?.[0]?.matched === false) return res.status(500).json({ error:"Invoice is not linked yet; retry requested." });
    return res.status(200).json({ received:true, handled:true });
  } catch (error) {
    console.warn("Stripe webhook rejected", { type:error?.type || "webhook_error", statusCode:error?.statusCode || 400 });
    return res.status(error?.statusCode || 400).json({ error:"Stripe webhook could not be processed." });
  }
};

module.exports.config = { api:{ bodyParser:false } };
module.exports.rawBody = rawBody;
module.exports.invoiceReference = invoiceReference;
module.exports.statusFor = statusFor;
