(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MucciCards = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "mucci_scanned_cards";
  const CACHE_KEY = "mucci_public_card_cache";
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

  function validToken(token) {
    return TOKEN_PATTERN.test(String(token || ""));
  }

  function safeJson(value, fallback) {
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function getScans(storage) {
    const parsed = safeJson(storage.getItem(STORAGE_KEY), []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => validToken(item && item.publicToken));
  }

  function rememberScan(storage, token, now) {
    if (!validToken(token)) return getScans(storage);
    const timestamp = now || new Date().toISOString();
    const scans = getScans(storage);
    const existing = scans.find((item) => item.publicToken === token);
    if (existing) existing.lastViewedAt = timestamp;
    else scans.push({ publicToken: token, firstScannedAt: timestamp, lastViewedAt: timestamp });
    storage.setItem(STORAGE_KEY, JSON.stringify(scans));
    return scans;
  }

  function removeScan(storage, token) {
    const scans = getScans(storage).filter((item) => item.publicToken !== token);
    storage.setItem(STORAGE_KEY, JSON.stringify(scans));
    const cache = getCache(storage);
    delete cache[token];
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
    return scans;
  }

  function getCache(storage) {
    const parsed = safeJson(storage.getItem(CACHE_KEY), {});
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  }

  function cachePublicProfile(storage, token, profile) {
    if (!validToken(token)) return;
    const allowed = ["name", "company", "title", "phone", "email", "website", "linkedin", "instagram", "address", "bio", "logo_url", "profile_image_url"];
    const clean = {};
    allowed.forEach((key) => { if (profile[key]) clean[key] = String(profile[key]); });
    const cache = getCache(storage);
    cache[token] = { profile: clean, cachedAt: new Date().toISOString() };
    storage.setItem(CACHE_KEY, JSON.stringify(cache));
  }

  function escapeVCard(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  }

  function foldLine(line) {
    const chunks = [];
    let remaining = line;
    while (remaining.length > 75) {
      chunks.push(remaining.slice(0, 75));
      remaining = " " + remaining.slice(75);
    }
    chunks.push(remaining);
    return chunks.join("\r\n");
  }

  function generateVCard(profile) {
    const nameParts = String(profile.name || "").trim().split(/\s+/).filter(Boolean);
    const familyName = nameParts.length > 1 ? nameParts.pop() : "";
    const givenNames = nameParts.join(" ") || (familyName ? "" : String(profile.name || "").trim());
    const lines = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "PRODID:-//Mucci Products//Digital Card//EN",
      `N:${escapeVCard(familyName)};${escapeVCard(givenNames)};;;`,
      `FN:${escapeVCard(profile.name)}`,
    ];
    if (profile.company) lines.push(`ORG:${escapeVCard(profile.company)}`);
    if (profile.title) lines.push(`TITLE:${escapeVCard(profile.title)}`);
    if (profile.phone) lines.push(`TEL;TYPE=CELL:${escapeVCard(profile.phone)}`);
    if (profile.email) lines.push(`EMAIL;TYPE=INTERNET:${escapeVCard(profile.email)}`);
    if (profile.website) lines.push(`URL:${escapeVCard(profile.website)}`);
    if (profile.address) lines.push(`ADR;TYPE=WORK:;;${escapeVCard(profile.address)};;;;`);
    if (profile.linkedin) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${escapeVCard(profile.linkedin)}`);
    if (profile.instagram) lines.push(`X-SOCIALPROFILE;TYPE=instagram:${escapeVCard(profile.instagram)}`);
    if (profile.bio) lines.push(`NOTE:${escapeVCard(profile.bio)}`);
    if (profile.profile_image_url) lines.push(`PHOTO;VALUE=URI:${escapeVCard(profile.profile_image_url)}`);
    if (profile.logo_url) lines.push(`LOGO;VALUE=URI:${escapeVCard(profile.logo_url)}`);
    lines.push("END:VCARD");
    return lines.map(foldLine).join("\r\n") + "\r\n";
  }

  function cardUrl(baseUrl, token) {
    return `${String(baseUrl || "").replace(/\/$/, "")}/card/${encodeURIComponent(token)}`;
  }

  return { STORAGE_KEY, CACHE_KEY, validToken, getScans, rememberScan, removeScan, getCache, cachePublicProfile, generateVCard, cardUrl };
});
