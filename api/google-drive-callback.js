"use strict";

const crypto = require("node:crypto");
const drive = require("./_google-drive");
const connection = require("./_google-drive-connection");

function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, "https://mucciproducts.com").searchParams);
}

function cookie(req, name) {
  const entries = String(req.headers?.cookie || "").split(";").map((part) => part.trim().split("="));
  return entries.find(([key]) => key === name)?.slice(1).join("=") || "";
}

function sameState(received, expected) {
  const left = Buffer.from(String(received || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function destination(status) {
  const site = String(process.env.PUBLIC_SITE_URL || "https://mucciproducts.com").replace(/\/$/, "");
  return `${site}/admin/estimates/?drive=${status}`;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Set-Cookie", "mucci_drive_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/google-drive-callback; Max-Age=0");
  if (req.method !== "GET") return res.status(405).json({ error:"Method not allowed." });
  try {
    const values = query(req);
    if (values.error) throw new Error(`Google authorization returned ${String(values.error).slice(0, 80)}.`);
    if (!values.code || !sameState(values.state, cookie(req, "mucci_drive_oauth_state"))) throw new Error("Google authorization state is invalid.");
    const config = drive.oauthConfiguration();
    const { tokens } = await drive.oauthClient(config).getToken(String(values.code));
    if (!tokens.refresh_token) throw new Error("Google did not return an offline refresh token.");
    await connection.storeRefreshToken(connection.supabaseConfiguration(), tokens.refresh_token);
    return res.redirect(302, destination("connected"));
  } catch (error) {
    console.error("Google Drive connection callback failed:", error && error.message);
    return res.redirect(302, destination("error"));
  }
};
