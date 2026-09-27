"use strict";

const crypto = require("node:crypto");
const auth = require("./_admin-auth");
const drive = require("./_google-drive");

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "POST") return auth.apiNotFound(res);
  try {
    const serverConfig = auth.configuration();
    if (!auth.requestIsSameOrigin(req, serverConfig)) return auth.apiNotFound(res);
    const administrator = await auth.authenticateAdmin(req, res, serverConfig);
    if (administrator.status !== "authorized") return auth.apiNotFound(res);
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
    return res.status(502).json({ error:"Google Drive connection could not be started." });
  }
};
