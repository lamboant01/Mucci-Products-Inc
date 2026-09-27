"use strict";

const auth = require("./_admin-auth");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);

function page({ title, body, scripts = [], authenticated = false, basePath = "" }) {
  const links = [
    ["dashboard", "Dashboard"], ["estimates", "Requests / Estimates"], ["orders", "Orders / Projects"],
    ["customers", "Customers"], ["cards", "Digital Cards"], ["files", "Files"],
    ["activity", "Activity"], ["security", "Settings & Security"]
  ];
  const navigation = authenticated ? `<aside class="admin-sidebar"><a class="admin-brand" href="${escapeHtml(basePath)}"><img src="/assets/mucci-products-logo.png" alt="Mucci Products"><span>Operations</span></a><nav class="management-nav" aria-label="Administration">${links.map(([key, label]) => `<a href="${escapeHtml(basePath)}/${key}" data-section="${key}">${label}</a>`).join("")}<form method="post" action="/api/admin-logout"><button class="button button-secondary" type="submit">Sign out</button></form></nav></aside>` : "";
  const scriptTags = scripts.map((script) => `<script src="${escapeHtml(script)}" defer></script>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>${escapeHtml(title)} | Mucci Products</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/cards.css"><link rel="stylesheet" href="/assets/management.css"></head><body class="cards-page"><main class="dashboard-shell${authenticated ? " admin-layout" : ""}">${navigation}<div class="admin-main">${body}</div></main>${scriptTags}</body></html>`;
}

function loginPage() {
  return page({
    title:"Sign in",
    body:'<section class="management-login"><img src="/assets/mucci-products-logo.png" alt="Mucci Products"><p class="eyebrow">Restricted administration</p><h1>Admin sign in</h1><p>Use the authorized Google account to continue.</p><form method="post" action="/api/admin-auth-start"><button class="button button-primary google-sign-in" type="submit">Sign in with Google</button></form></section>'
  });
}

function adminBody(section, user, bootstrap) {
  const bootstrapNotice = bootstrap ? `<div class="dashboard-notice bootstrap-notice"><strong>Initial security setup</strong><p>Authenticated Supabase user UUID:</p><code>${escapeHtml(user.id)}</code><p>Set this value as the server-only <code>ADMIN_USER_ID</code> environment variable. Once configured, UUID authorization becomes authoritative.</p></div>` : "";
  if (section === "security") return `${bootstrapNotice}<section class="page-title"><p class="eyebrow">Private owner area</p><h1>Security</h1><p>Protect the authorized Google account with Google 2-Step Verification or a passkey.</p></section><section class="saved-card security-card"><h2>Authenticated administrator</h2><dl class="estimate-grid"><div><dt>Supabase user UUID</dt><dd><code>${escapeHtml(user.id)}</code></dd></div><div><dt>Authentication provider</dt><dd>Google</dd></div><div><dt>Authorization mode</dt><dd>${bootstrap ? "Email bootstrap" : "Exact user UUID"}</dd></div></dl></section>`;
  if (section === "cards") return `${bootstrapNotice}<section class="page-title"><p class="eyebrow">Private owner area</p><h1>Card Dashboard</h1><p>Manage the public details connected to your physical cards.</p></section><div id="dashboard" aria-live="polite"><p>Loading…</p></div>`;
  if (section === "estimates") return `${bootstrapNotice}<section class="page-title"><p class="eyebrow">Requests and estimates</p><h1>3D Print Requests</h1><p>Search submissions, review production details, update status, and prepare customer quotes.</p></section><div id="estimates-admin" aria-live="polite"><p>Loading…</p></div>`;
  const titles = {
    dashboard:["Operations overview", "Dashboard", "Current requests, production work, customers, files, and recent administrative activity."],
    orders:["Production", "Orders / Projects", "Accepted, in-production, and completed estimate records. No separate ERP records are created."],
    customers:["Contacts", "Customers", "Customer contacts derived from estimate submissions and their request history."],
    files:["Private files", "Files", "Uploaded model availability and private Google Drive mirror status."],
    activity:["Audit trail", "Admin Activity", "Important administrator changes. Secrets and authentication tokens are never recorded."]
  };
  const [eyebrow, heading, intro] = titles[section] || titles.dashboard;
  return `${bootstrapNotice}<section class="page-title"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p>${intro}</p></section><div id="operations-admin" data-section="${section}" aria-live="polite"><p>Loading…</p></div>`;
}

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "GET") return auth.notFound(res);
  try {
    const config = auth.configuration();
    const values = auth.requestQuery(req);
    const requestedSection = auth.section(values.section);
    const result = await auth.authenticateAdmin(req, res, config);
    if (result.status === "unauthorized") {
      console.warn("Admin authentication failed:", result.reason);
      return auth.notFound(res);
    }
    if (result.status === "unauthenticated") {
      auth.appendCookies(res, [auth.cookie(auth.LOGIN_COOKIE, "1", 600, "/api/admin-auth-start")]);
      return res.status(200).send(loginPage());
    }
    const scripts = requestedSection === "cards"
      ? ["/config.js", "/card-core.js", "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js", "/assets/management-cards.js"]
      : requestedSection === "estimates" ? ["/config.js", "/assets/management-estimates.js"]
      : requestedSection === "security" ? [] : ["/assets/management-operations.js"];
    const title = requestedSection === "cards" ? "Digital Cards" : requestedSection === "security" ? "Settings & Security" : requestedSection === "estimates" ? "Requests / Estimates" : requestedSection[0].toUpperCase() + requestedSection.slice(1);
    return res.status(200).send(page({ title, body:adminBody(requestedSection, result.user, result.bootstrap), scripts, authenticated:true, basePath:"/admin" }));
  } catch (error) {
    console.warn("Admin authentication failed:", error?.statusCode === 503 ? "configuration_invalid" : "admin_page_failed");
    return auth.notFound(res);
  }
};
