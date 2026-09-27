"use strict";

const OWNER_EMAIL = "anthony@mucciproducts.com";
const QUOTE_CODE_PATTERN = /^MP-[A-HJ-NP-Z2-9]{5}$/;

function text(value, maximum = 3000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function escapeHtml(value) {
  return text(value).replace(/[&<>'"]/g, (character) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;"
  })[character]);
}

function label(value) {
  const profile = { standard:"Standard Detail", draft:"Efficient Larger Prints" }[value];
  if (profile) return profile;
  return text(value || "Not provided", 160).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value) {
  return new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" }).format(Number(value || 0));
}

function priceRange(estimate) {
  const minimum = Number(estimate.estimated_price || 0);
  const maximum = Number(estimate.estimated_price_max ?? minimum);
  return minimum === maximum ? money(minimum) : `${money(minimum)}–${money(maximum)}`;
}

function number(value, digits = 1) {
  return value == null || !Number.isFinite(Number(value)) ? "Not available" : Number(value).toFixed(digits);
}

function estimateRows(estimate) {
  const printTime = estimate.size_category
    ? `${label(estimate.size_category)} size review`
    : `${Number(estimate.print_hours_per_item || 0)}h ${Number(estimate.print_minutes_per_item || 0)}m per item`;
  return [
    ["Quote code", text(estimate.quote_code, 20)],
    ["Estimated price", `${priceRange(estimate)} CAD`],
    ["Customer name", text(estimate.name, 120) || "Not provided"],
    ["Model file", text(estimate.original_file_name, 255) || (estimate.file_path ? "Uploaded model" : "No model uploaded")],
    ["File status", label(estimate.file_status)],
    ["Quantity", String(Number(estimate.quantity || 0))],
    ["Print profile", label(estimate.print_profile)],
    ["Print time", printTime],
    ["Filament", estimate.filament_grams_per_item == null ? "Not available" : `${number(estimate.filament_grams_per_item)} g per item`],
    ["Material total", estimate.estimated_material_grams == null ? "Not available" : `${number(estimate.estimated_material_grams)} g including purge`],
    ["Colours", text(estimate.colour_count, 4)],
    ["Purge allowance", `${number(estimate.purge_waste_percent || 0)}%`],
    ["Design", label(estimate.design_level)],
    ["Assembly", estimate.assembly_required ? "Yes" : "No"],
    ["Manual review", estimate.requires_manual_review ? "Required" : "Not currently required"]
  ];
}

function buildEstimateEmail(estimate, siteUrl) {
  const rows = estimateRows(estimate);
  const code = text(estimate.quote_code, 20);
  const notes = text(estimate.notes, 3000) || "No notes provided.";
  const baseUrl = String(siteUrl || "https://mucciproducts.com").replace(/\/$/, "");
  const portalUrl = `${baseUrl}/admin/estimates/?quote=${encodeURIComponent(code)}`;
  const htmlRows = rows.map(([name, value]) => `<tr><th style="padding:9px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #d9e4e9;color:#496479;font-size:13px;">${escapeHtml(name)}</th><td style="padding:9px 12px;border-bottom:1px solid #d9e4e9;color:#082a4a;font-weight:600;">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f7fbfd;font-family:Arial,sans-serif;color:#082a4a;"><main style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #bfd0d8;border-radius:12px;overflow:hidden;"><header style="padding:26px;background:#082a4a;color:#ffffff;"><p style="margin:0 0 8px;color:#73e0dc;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;">New 3D printing estimate</p><h1 style="margin:0;font-size:28px;">${escapeHtml(code)}</h1><p style="margin:10px 0 0;font-size:20px;font-weight:700;">${escapeHtml(priceRange(estimate))} CAD</p></header><section style="padding:22px;"><table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;">${htmlRows}</table><h2 style="margin:24px 0 8px;font-size:17px;">Customer notes</h2><p style="margin:0;padding:14px;background:#eef8fa;border-left:4px solid #16b8b4;white-space:pre-wrap;line-height:1.5;">${escapeHtml(notes)}</p><p style="margin:24px 0 0;"><a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:13px 18px;border-radius:6px;background:#082a4a;color:#ffffff;text-decoration:none;font-weight:700;">Open estimate and model file</a></p><p style="margin:12px 0 0;color:#496479;font-size:13px;">Admin sign-in is required. The model opens through a short-lived secure link.</p></section></main></body></html>`;
  const plainRows = rows.map(([name, value]) => `${name}: ${value}`).join("\n");
  const plain = `NEW 3D PRINTING ESTIMATE\n\n${plainRows}\n\nCustomer notes:\n${notes}\n\nOpen estimate and model file (admin sign-in required):\n${portalUrl}`;
  return { subject:`New 3D estimate ${code} — ${priceRange(estimate)} CAD`, html, text:plain, portalUrl };
}

function normalizeQuoteCode(value) {
  const code = text(value, 20).toUpperCase();
  return QUOTE_CODE_PATTERN.test(code) ? code : "";
}

module.exports = { OWNER_EMAIL, buildEstimateEmail, estimateRows, normalizeQuoteCode, escapeHtml };
