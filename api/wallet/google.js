"use strict";

const { GoogleAuth } = require("google-auth-library");
const jwt = require("jsonwebtoken");
const common = require("../_wallet-common");

const API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1";

function googleConfig() {
  const missing = ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64"].filter((name) => !process.env[name]);
  if (missing.length) throw common.setupError(missing.join(", "));
  let credentials;
  try { credentials = JSON.parse(Buffer.from(process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8")); }
  catch (_) { throw common.setupError("a valid GOOGLE_WALLET_SERVICE_ACCOUNT_BASE64 value"); }
  if (!credentials.client_email || !credentials.private_key) throw common.setupError("a valid Google service-account JSON key");
  return { issuerId: process.env.GOOGLE_WALLET_ISSUER_ID, credentials };
}

function localized(value) {
  return { defaultValue: { language: "en-US", value: common.text(value, 1000) } };
}

async function walletRequest(accessToken, path, method = "GET", body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const error = new Error(`Google Wallet API failed with status ${response.status}.`);
    error.statusCode = response.status >= 400 && response.status < 500 ? 503 : 502;
    throw error;
  }
  return response.status === 204 ? {} : response.json();
}

function textModules(profile) {
  return [
    ["phone", "Phone", profile.phone], ["email", "Email", profile.email], ["website", "Website", profile.website],
    ["linkedin", "LinkedIn", profile.linkedin], ["instagram", "Instagram", profile.instagram], ["address", "Address", profile.address],
    ["about", "About", profile.bio],
  ].filter((entry) => common.text(entry[2])).map(([id, header, body]) => ({ id, header, body: common.text(body, 1000) }));
}

function linkUris(profile, profileUrl) {
  const values = [
    [profile.phone && `tel:${profile.phone}`, "Call"], [profile.email && `mailto:${profile.email}`, "Email"],
    [common.httpsUrl(profile.website), "Website"], [common.httpsUrl(profile.linkedin), "LinkedIn"],
    [common.httpsUrl(profile.instagram), "Instagram"], [profileUrl, "Open digital card"],
  ];
  return values.filter(([uri]) => uri).map(([uri, description]) => ({ uri, description }));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    const token = common.requestToken(req);
    if (!token) return res.status(400).json({ error: "Invalid card token." });
    const { issuerId, credentials } = googleConfig();
    const profile = await common.fetchPublicProfile(token);
    const auth = new GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/wallet_object.issuer"] });
    const client = await auth.getClient();
    const tokenResult = await client.getAccessToken();
    const accessToken = typeof tokenResult === "string" ? tokenResult : tokenResult && tokenResult.token;
    if (!accessToken) throw new Error("Google Wallet authentication failed.");

    const classId = `${issuerId}.mucci_digital_cards`;
    const objectId = `${issuerId}.card_${token.replace(/[^A-Za-z0-9_-]/g, "_")}`;
    const profileUrl = common.cardUrl(token);
    const logo = common.publicLogoUrl(profile);
    const name = common.text(profile.name, 120);
    const company = common.text(profile.company, 160) || "Mucci Products";
    const image = { sourceUri: { uri: logo }, contentDescription: localized(`${company} logo`) };

    const existingClass = await walletRequest(accessToken, `/genericClass/${encodeURIComponent(classId)}`);
    if (!existingClass) {
      await walletRequest(accessToken, "/genericClass", "POST", { id: classId, issuerName: "Mucci Products", reviewStatus: "UNDER_REVIEW" });
    }

    const object = {
      id: objectId,
      classId,
      state: "ACTIVE",
      genericType: "GENERIC_TYPE_UNSPECIFIED",
      cardTitle: localized(company),
      header: localized(name),
      subheader: localized(common.text(profile.title, 160) || "Digital business card"),
      logo: image,
      hexBackgroundColor: "#082A4A",
      textModulesData: textModules(profile),
      linksModuleData: { uris: linkUris(profile, profileUrl) },
      barcode: { type: "QR_CODE", value: profileUrl, alternateText: "Open digital card" },
    };
    const existingObject = await walletRequest(accessToken, `/genericObject/${encodeURIComponent(objectId)}`);
    if (existingObject) await walletRequest(accessToken, `/genericObject/${encodeURIComponent(objectId)}`, "PUT", object);
    else await walletRequest(accessToken, "/genericObject", "POST", object);

    const claims = {
      iss: credentials.client_email,
      aud: "google",
      typ: "savetowallet",
      origins: [common.siteUrl()],
      payload: { genericObjects: [{ id: objectId, classId }] },
    };
    const signedJwt = jwt.sign(claims, credentials.private_key, { algorithm: "RS256" });
    res.setHeader("Cache-Control", "private, no-store");
    return res.redirect(302, `https://pay.google.com/gp/v/save/${signedJwt}`);
  } catch (error) {
    console.error("Google Wallet pass generation failed:", error && error.message);
    return common.sendError(res, error);
  }
};
