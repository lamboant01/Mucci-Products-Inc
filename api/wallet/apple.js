"use strict";

const fs = require("node:fs/promises");
const { PKPass } = require("passkit-generator");
const sharp = require("sharp");
const common = require("../_wallet-common");

function requiredAppleConfig() {
  const names = ["APPLE_PASS_TYPE_IDENTIFIER", "APPLE_TEAM_IDENTIFIER", "APPLE_PASS_CERTIFICATE_BASE64", "APPLE_PASS_PRIVATE_KEY_BASE64", "APPLE_WWDR_CERTIFICATE_BASE64"];
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw common.setupError(missing.join(", "));
  return {
    passTypeIdentifier: process.env.APPLE_PASS_TYPE_IDENTIFIER,
    teamIdentifier: process.env.APPLE_TEAM_IDENTIFIER,
    signerCert: Buffer.from(process.env.APPLE_PASS_CERTIFICATE_BASE64, "base64"),
    signerKey: Buffer.from(process.env.APPLE_PASS_PRIVATE_KEY_BASE64, "base64"),
    wwdr: Buffer.from(process.env.APPLE_WWDR_CERTIFICATE_BASE64, "base64"),
    signerKeyPassphrase: process.env.APPLE_PASS_PRIVATE_KEY_PASSPHRASE || undefined,
  };
}

function passFields(profile) {
  const back = [
    ["name", "Cardholder", profile.name], ["company", "Company", profile.company], ["title", "Title", profile.title],
    ["phone", "Phone", profile.phone], ["email", "Email", profile.email], ["website", "Website", profile.website],
    ["linkedin", "LinkedIn", profile.linkedin], ["instagram", "Instagram", profile.instagram], ["address", "Address", profile.address],
    ["bio", "About", profile.bio],
  ].filter((entry) => common.text(entry[2]));
  return back.map(([key, label, value]) => ({ key, label, value: common.text(value, 1000) }));
}

async function sourceLogo(profile) {
  const remote = common.httpsUrl(profile.logo_url);
  if (remote) {
    try {
      const response = await fetch(remote, { signal: AbortSignal.timeout(6000) });
      const length = Number(response.headers.get("content-length") || 0);
      if (response.ok && (!length || length <= 5_000_000)) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length <= 5_000_000) return buffer;
      }
    } catch (_) { /* Fall back to the Mucci logo. */ }
  }
  return fs.readFile(common.localLogoPath());
}

async function pngAsset(input, width, height) {
  return sharp(input).resize({ width, height, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });
  try {
    const token = common.requestToken(req);
    if (!token) return res.status(400).json({ error: "Invalid card token." });
    const config = requiredAppleConfig();
    const profile = await common.fetchPublicProfile(token);
    const logo = await sourceLogo(profile);
    const url = common.cardUrl(token);
    const name = common.text(profile.name, 120);
    const company = common.text(profile.company, 160) || "Mucci Products";
    const passJson = {
      formatVersion: 1,
      passTypeIdentifier: config.passTypeIdentifier,
      teamIdentifier: config.teamIdentifier,
      serialNumber: token,
      organizationName: company,
      description: `${name} digital business card`,
      logoText: company,
      foregroundColor: "rgb(255, 255, 255)",
      backgroundColor: "rgb(8, 42, 74)",
      labelColor: "rgb(185, 245, 241)",
      generic: {
        primaryFields: [{ key: "cardholder", label: "CARDHOLDER", value: name }],
        secondaryFields: [profile.title && { key: "title", label: "TITLE", value: common.text(profile.title, 160) }, profile.company && { key: "company", label: "COMPANY", value: company }].filter(Boolean),
        auxiliaryFields: [profile.phone && { key: "phone", label: "PHONE", value: common.text(profile.phone, 50) }, profile.email && { key: "email", label: "EMAIL", value: common.text(profile.email, 254) }].filter(Boolean),
        backFields: passFields(profile),
      },
      barcodes: [{ format: "PKBarcodeFormatQR", message: url, messageEncoding: "iso-8859-1", altText: "Open digital card" }],
      webServiceURL: undefined,
    };
    delete passJson.webServiceURL;
    const pass = new PKPass({
      "pass.json": Buffer.from(JSON.stringify(passJson)),
      "icon.png": await pngAsset(logo, 29, 29),
      "icon@2x.png": await pngAsset(logo, 58, 58),
      "icon@3x.png": await pngAsset(logo, 87, 87),
      "logo.png": await pngAsset(logo, 160, 50),
      "logo@2x.png": await pngAsset(logo, 320, 100),
    }, {
      wwdr: config.wwdr,
      signerCert: config.signerCert,
      signerKey: config.signerKey,
      signerKeyPassphrase: config.signerKeyPassphrase,
    });
    const buffer = pass.getAsBuffer();
    const filename = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mucci-contact";
    res.setHeader("Content-Type", "application/vnd.apple.pkpass");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.pkpass"`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Apple Wallet pass generation failed:", error && error.message);
    return common.sendError(res, error);
  }
};
