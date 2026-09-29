"use strict";

const auth = require("./_admin-auth");
const service = require("./_estimate-analysis");

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed." });
  try {
    const config = service.configuration();
    if (!auth.requestIsSameOrigin(req, config)) return res.status(404).json({ error:"Not found." });
    const request = service.validateRequest(service.requestBody(req).request);
    const analysis = await service.analyze(config, request);
    const estimate = await service.price(config, request, analysis);
    const token = service.sign(config, { version:1, expiresAt:Date.now() + 60 * 60 * 1000, request, analysis });
    return res.status(200).json({ estimate, analysis, token });
  } catch (error) {
    console.error("Estimate analysis failed", { message:error?.message });
    return res.status(error.statusCode || 400).json({ error:error?.message || "The uploaded models could not be analyzed." });
  }
};
