"use strict";

const auth = require("./_admin-auth");
const orders = require("./_admin-orders");

function migrationMissing(error) {
  return /internal_status|shopify_reconciled_at|shopify_order_number/i.test(JSON.stringify(error?.detail || ""));
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
    if (body.action === "dashboard") return res.status(200).json(await orders.dashboard(config));
    if (body.action === "list") return res.status(200).json(await orders.listOrders(config, body));
    return res.status(400).json({ error:"Invalid action." });
  } catch (error) {
    console.error("Admin orders request failed", { message:error?.message, statusCode:error?.statusCode });
    if (migrationMissing(error)) {
      return res.status(503).json({ error:"Order workflow setup is not complete.", code:"MIGRATION_REQUIRED" });
    }
    return res.status(500).json({ error:"Order data is temporarily unavailable." });
  }
};

module.exports.migrationMissing = migrationMissing;
