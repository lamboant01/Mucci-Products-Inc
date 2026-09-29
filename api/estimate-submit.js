"use strict";

const auth = require("./_admin-auth");
const db = require("./_admin-supabase");
const service = require("./_estimate-analysis");

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed." });
  try {
    const config = service.configuration();
    if (!auth.requestIsSameOrigin(req, config)) return res.status(404).json({ error:"Not found." });
    const body = service.requestBody(req);
    const authorized = service.verify(config, body.token);
    const rows = await db.rpc(config, "submit_multi_file_estimate", {
      p_request:authorized.request, p_analysis:authorized.analysis, p_customer:body.customer || {}
    });
    const submission = Array.isArray(rows) ? rows[0] : rows;
    return res.status(200).json(submission);
  } catch (error) {
    console.error("Estimate submission failed", { message:error?.message });
    return res.status(error.statusCode || 400).json({ error:error?.message || "The estimate could not be submitted." });
  }
};
