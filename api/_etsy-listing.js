"use strict";

const config = Object.freeze({
  statuses:["pending", "reviewed", "etsy_prepared", "completed", "declined"],
  defaultMaterial:"PLA",
  defaultListingQuantity:1,
  processingRules:[
    { maximumHours:4, label:"1–3 business days" },
    { maximumHours:20, label:"3–5 business days" },
    { maximumHours:60, label:"5–10 business days" }
  ],
  manualProcessingLabel:"Manual processing time selection recommended."
});

const titleCase = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const cad = (value) => `$${Number(value).toFixed(2)} CAD`;

function suggestProcessing(estimate) {
  const override = String(estimate.processing_time_override || "").trim();
  if (override) return override;
  const hours = Number(estimate.estimated_production_hours_max);
  if (estimate.assembly_required || !Number.isFinite(hours) || hours <= 0) return config.manualProcessingLabel;
  return config.processingRules.find((rule) => hours <= rule.maximumHours)?.label || config.manualProcessingLabel;
}

function buildTitle(estimate) {
  const prefix = estimate.file_status === "ready" && estimate.design_level === "none" ? "Custom 3D Printing Order" : "Custom 3D Design & Print";
  return `${prefix} — ${estimate.quote_code}`;
}

function buildDescription(estimate, finalPrice, physicalQuantity) {
  const details = [
    `- Quantity: ${physicalQuantity}`,
    estimate.material ? `- Material: ${estimate.material}` : "",
    estimate.colour_count ? `- Colours: ${estimate.colour_count}` : "",
    estimate.design_level && estimate.design_level !== "none" ? `- 3D Design: ${titleCase(estimate.design_level)}` : "",
    `- Assembly: ${estimate.assembly_required ? "Required" : "Not required"}`
  ].filter(Boolean);
  return [`Custom 3D printing project for quote ${estimate.quote_code}.`, "", "Project includes:", ...details, "", `Final agreed project price: ${cad(finalPrice)}.`, "", `This private listing corresponds to the specifications discussed through Etsy Messages and Mucci Products quote ${estimate.quote_code}.`, "", "Production begins after purchase and final confirmation."].join("\n");
}

function buildReply(estimate, finalPrice, clarificationNotes) {
  const clarification = String(clarificationNotes || "").trim();
  if (clarification) return ["Hi! Thanks for sending your quote code.", "", `I reviewed estimate ${estimate.quote_code}. Before I finalize the Etsy listing, I just need to confirm the following:`, "", clarification, "", "Thank you!"].join("\n");
  return ["Hi! Thanks for sending your quote code.", "", `I reviewed estimate ${estimate.quote_code} and your final project price is ${cad(finalPrice)}.`, "", "I’ll create a private Etsy listing for your project. Once the listing is sent, you can review it and complete the order directly through Etsy.", "", "Thank you!"].join("\n");
}

function buildPackage(estimate, values) {
  const finalPrice = Number(values.finalPrice);
  const physicalQuantity = Number(values.physicalQuantity);
  const listingQuantity = Number(values.listingQuantity || config.defaultListingQuantity);
  const title = buildTitle(estimate);
  const processing = values.processing || suggestProcessing(estimate);
  const description = buildDescription(estimate, finalPrice, physicalQuantity);
  const summary = ["ETSY PRIVATE LISTING", "", "Title:", title, "", "Price:", cad(finalPrice), "", "Listing Quantity:", String(listingQuantity), "", "Physical Quantity:", String(physicalQuantity), "", "Processing:", processing, "", "Description:", description].join("\n");
  return { title, price:cad(finalPrice), listingQuantity, physicalQuantity, processing, description, summary, reply:buildReply(estimate, finalPrice, values.clarificationNotes) };
}

module.exports = { buildDescription, buildPackage, buildReply, buildTitle, cad, config, suggestProcessing, titleCase };
