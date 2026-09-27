"use strict";

const crypto = require("node:crypto");
const drive = require("./_google-drive");
const connection = require("./_google-drive-connection");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error:"Method not allowed." });
  try {
    const supabase = connection.supabaseConfiguration();
    if (!await connection.verifyAdmin(req, supabase)) return res.status(403).json({ error:"Administrator sign-in is required." });
    const config = drive.oauthConfiguration();
    const state = crypto.randomBytes(32).toString("hex");
    res.setHeader("Set-Cookie", `mucci_drive_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Path=/api/google-drive-callback; Max-Age=600`);
    const authorizationUrl = drive.oauthClient(config).generateAuthUrl({
      access_type:"offline",
      scope:["https://www.googleapis.com/auth/drive.file"],
      include_granted_scopes:true,
      prompt:"consent",
      state
    });
    return res.status(200).json({ authorizationUrl });
  } catch (error) {
    console.error("Google Drive connection start failed:", error && error.message);
    return res.status(error.statusCode || 502).json({ error:"Google Drive connection could not be started." });
  }
};
