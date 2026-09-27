(function (root, factory) {
  const config = factory();
  if (typeof module === "object" && module.exports) module.exports = config;
  if (root) root.MUCCI_ESTIMATE_ADMIN_CONFIG = config;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  return Object.freeze({
    statuses:["pending", "reviewed", "etsy_prepared", "completed", "declined"],
    defaultMaterial:"PLA",
    defaultListingQuantity:1,
    processingRules:Object.freeze([
      Object.freeze({ maximumHours:4, label:"1–3 business days" }),
      Object.freeze({ maximumHours:20, label:"3–5 business days" }),
      Object.freeze({ maximumHours:60, label:"5–10 business days" })
    ]),
    manualProcessingLabel:"Manual processing time selection recommended."
  });
});
