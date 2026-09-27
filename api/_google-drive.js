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

function driveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function folderResult(value, quoteCode) {
  if (!value || !value.id) throw new Error(`Google Drive did not return a folder for ${quoteCode}.`);
  return {
    id:String(value.id),
    webViewLink:String(value.webViewLink || `https://drive.google.com/drive/folders/${encodeURIComponent(value.id)}`)
  };
}

async function quoteFolder(token, config, quoteCode) {
  const listUrl = new URL("https://www.googleapis.com/drive/v3/files");
  listUrl.searchParams.set("q", `'${driveQueryValue(config.folderId)}' in parents and name = '${driveQueryValue(quoteCode)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  listUrl.searchParams.set("spaces", "drive");
  listUrl.searchParams.set("pageSize", "1");
  listUrl.searchParams.set("fields", "files(id,name,webViewLink)");
  listUrl.searchParams.set("supportsAllDrives", "true");
  listUrl.searchParams.set("includeItemsFromAllDrives", "true");
  const existing = await fetch(listUrl, {
    headers:{ Authorization:`Bearer ${token}` },
    signal:AbortSignal.timeout(12000)
  });
  if (!existing.ok) throw new Error(`Google Drive quote folder lookup failed with status ${existing.status}.`);
  const matches = await existing.json();
  if (matches.files?.[0]) return folderResult(matches.files[0], quoteCode);

  const createUrl = new URL("https://www.googleapis.com/drive/v3/files");
  createUrl.searchParams.set("supportsAllDrives", "true");
  createUrl.searchParams.set("fields", "id,name,webViewLink");
  const created = await fetch(createUrl, {
    method:"POST",
    headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json; charset=UTF-8" },
    body:JSON.stringify({
      name:quoteCode,
      mimeType:"application/vnd.google-apps.folder",
      parents:[config.folderId],
      description:`Mucci Products 3D printing estimate ${quoteCode}`,
      appProperties:{ mucciQuoteCode:quoteCode, mucciItemType:"estimate-folder" }
    }),
    signal:AbortSignal.timeout(12000)
  });
  if (!created.ok) throw new Error(`Google Drive quote folder creation failed with status ${created.status}.`);
  return folderResult(await created.json(), quoteCode);
}

async function uploadWithAccessToken(token, config, model) {
  const name = fileName(model.originalFileName, model.quoteCode);
  const type = contentType(name);
  const folder = await quoteFolder(token, config, model.quoteCode);
  const metadata = {
    name,
    parents:[folder.id],
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
    webViewLink:folder.webViewLink
  };
}

async function organizeWithAccessToken(token, config, model) {
  const folder = await quoteFolder(token, config, model.quoteCode);
  const fileUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(model.fileId)}`);
  fileUrl.searchParams.set("fields", "id,parents");
  fileUrl.searchParams.set("supportsAllDrives", "true");
  const current = await fetch(fileUrl, {
    headers:{ Authorization:`Bearer ${token}` },
    signal:AbortSignal.timeout(12000)
  });
  if (!current.ok) throw new Error(`Google Drive file lookup failed with status ${current.status}.`);
  const file = await current.json();
  const parents = Array.isArray(file.parents) ? file.parents.map(String) : [];
  if (!parents.includes(folder.id)) {
    const moveUrl = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(model.fileId)}`);
    moveUrl.searchParams.set("addParents", folder.id);
    if (parents.length) moveUrl.searchParams.set("removeParents", parents.join(","));
    moveUrl.searchParams.set("supportsAllDrives", "true");
    moveUrl.searchParams.set("fields", "id");
    const moved = await fetch(moveUrl, {
      method:"PATCH",
      headers:{ Authorization:`Bearer ${token}`, "Content-Type":"application/json" },
      body:"{}",
      signal:AbortSignal.timeout(12000)
    });
    if (!moved.ok) throw new Error(`Google Drive file move failed with status ${moved.status}.`);
  }
  return { id:String(model.fileId), webViewLink:folder.webViewLink };
}

async function uploadModel(config, model) {
  return uploadWithAccessToken(await accessToken(config), config, model);
}

async function organizeModel(config, model) {
  return organizeWithAccessToken(await accessToken(config), config, model);
}

module.exports = { configuration, oauthConfiguration, oauthClient, contentType, fileName, quoteFolder, organizeModel, organizeWithAccessToken, uploadModel, uploadWithAccessToken };
