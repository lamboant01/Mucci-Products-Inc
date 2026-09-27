"use strict";

const { OAuth2Client } = require("google-auth-library");

const MIME_TYPES = {
  stl:"model/stl", "3mf":"model/3mf", obj:"model/obj",
  step:"application/step", stp:"application/step"
};

function oauthConfiguration() {
  const values = {
    clientId:process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret:process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    redirectUri:process.env.GOOGLE_DRIVE_REDIRECT_URI
  };
  const missing = [
    ["GOOGLE_DRIVE_CLIENT_ID", values.clientId],
    ["GOOGLE_DRIVE_CLIENT_SECRET", values.clientSecret],
    ["GOOGLE_DRIVE_REDIRECT_URI", values.redirectUri]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    const error = new Error(`Google Drive is not configured: ${missing.join(", ")}.`);
    error.statusCode = 503;
    throw error;
  }
  return values;
}

function configuration(storedRefreshToken) {
  const values = {
    ...oauthConfiguration(),
    refreshToken:process.env.GOOGLE_DRIVE_REFRESH_TOKEN || storedRefreshToken,
    folderId:process.env.GOOGLE_DRIVE_FOLDER_ID
  };
  const missing = [];
  if (!values.refreshToken) missing.push("a connected Google Drive account");
  if (!values.folderId) missing.push("GOOGLE_DRIVE_FOLDER_ID");
  if (missing.length) {
    const error = new Error(`Google Drive is not configured: ${missing.join(", ")}.`);
    error.statusCode = 503;
    throw error;
  }
  return values;
}

function oauthClient(config) {
  return new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
}

function fileName(value, quoteCode) {
  const clean = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 220);
  return clean || `${quoteCode}-model.stl`;
}

function contentType(name) {
  const extension = String(name || "").split(".").pop().toLowerCase();
  return MIME_TYPES[extension] || "application/octet-stream";
}

async function accessToken(config) {
  const client = oauthClient(config);
  client.setCredentials({ refresh_token:config.refreshToken });
  const result = await client.getAccessToken();
  const token = typeof result === "string" ? result : result && result.token;
  if (!token) throw new Error("Google Drive authentication did not return an access token.");
  return token;
}

async function uploadWithAccessToken(token, config, model) {
  const name = fileName(model.originalFileName, model.quoteCode);
  const type = contentType(name);
  const metadata = {
    name,
    parents:[config.folderId],
    description:`Mucci Products 3D printing estimate ${model.quoteCode}`,
    appProperties:{ mucciQuoteCode:model.quoteCode }
  };
  const session = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink", {
    method:"POST",
    headers:{
      Authorization:`Bearer ${token}`,
      "Content-Type":"application/json; charset=UTF-8",
      "X-Upload-Content-Type":type,
      "X-Upload-Content-Length":String(model.bytes.length)
    },
    body:JSON.stringify(metadata),
    signal:AbortSignal.timeout(12000)
  });
  if (!session.ok) throw new Error(`Google Drive upload session failed with status ${session.status}.`);
  const uploadUrl = session.headers.get("location");
  if (!uploadUrl || new URL(uploadUrl).hostname !== "www.googleapis.com") throw new Error("Google Drive returned an invalid upload session.");

  const uploaded = await fetch(uploadUrl, {
    method:"PUT",
    headers:{ "Content-Type":type, "Content-Length":String(model.bytes.length) },
    body:model.bytes,
    signal:AbortSignal.timeout(45000)
  });
  if (!uploaded.ok) throw new Error(`Google Drive file upload failed with status ${uploaded.status}.`);
  const saved = await uploaded.json();
  if (!saved.id) throw new Error("Google Drive did not return a file identifier.");
  return {
    id:String(saved.id),
    name:String(saved.name || name),
    webViewLink:String(saved.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(saved.id)}/view`)
  };
}

async function uploadModel(config, model) {
  return uploadWithAccessToken(await accessToken(config), config, model);
}

module.exports = { configuration, oauthConfiguration, oauthClient, contentType, fileName, uploadModel, uploadWithAccessToken };
