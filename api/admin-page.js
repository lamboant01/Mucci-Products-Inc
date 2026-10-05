"use strict";

const auth = require("./_admin-auth");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);

function page({ title, body, scripts = [], authenticated = false, basePath = "" }) {
  const links = [
    ["dashboard", "Dashboard"], ["orders", "Orders"], ["estimates", "Quotes / Estimates"],
    ["files", "Files"], ["customers", "Customers"], ["security", "Settings"]
  ];
  const navLinks = links.map(([key, label]) => `<a href="${escapeHtml(basePath)}/${key}" data-section="${key}">${label}</a>`).join("");
  const external = '<div class="admin-nav-group"><span>External</span><a href="https://admin.shopify.com/" target="_blank" rel="noopener noreferrer">Open Shopify Admin</a><a href="https://mucciproducts.com" target="_blank" rel="noopener noreferrer">Open Shopify Store</a></div>';
  const identity = '<div class="admin-identity"><strong>Anthony</strong><span>anthony@mucciproducts.com</span><form method="post" action="/api/admin-logout"><button type="submit">Sign Out</button></form></div>';
  const navigation = authenticated ? `<header class="admin-mobile-bar"><a href="${escapeHtml(basePath)}"><img src="/assets/mucci-products-logo.png" alt="Mucci Products"><span>Admin</span></a><details><summary>Menu</summary><nav aria-label="Mobile administration">${navLinks}${external}${identity}</nav></details></header><aside class="admin-sidebar"><a class="admin-brand" href="${escapeHtml(basePath)}"><img src="/assets/mucci-products-logo.png" alt="Mucci Products"><span>Admin</span></a><nav class="management-nav" aria-label="Administration">${navLinks}<div class="admin-nav-group"><span>Tools</span><a href="${escapeHtml(basePath)}/cards">Digital Cards</a></div>${external}</nav>${identity}</aside>` : "";
  const scriptTags = scripts.map((script) => `<script src="${escapeHtml(script)}" defer></script>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>${escapeHtml(title)} | Mucci Products</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/cards.css"><link rel="stylesheet" href="/assets/management.css"></head><body class="cards-page"><main class="dashboard-shell${authenticated ? " admin-layout" : ""}">${navigation}<div class="admin-main">${body}</div></main>${scriptTags}</body></html>`;
}

function loginPage(authResult = "") {
  const authNotice = authResult === "retry"
    ? '<div class="dashboard-notice auth-retry" role="alert"><strong>Sign-in could not be completed.</strong><p>Start again from this page in the same browser. Authorization links expire quickly and cannot be reused.</p></div>'
    : authResult === "denied"
      ? '<div class="dashboard-notice auth-retry" role="alert"><strong>This Google account is not authorized.</strong><p>Use the verified Google account configured as <code>ADMIN_EMAIL</code>, or update the server-only administrator configuration.</p></div>'
      : "";
  return page({
    title:"Sign in",
    body:`<section class="management-login"><img src="/assets/mucci-products-logo.png" alt="Mucci Products"><p class="eyebrow">Restricted administration</p><h1>Admin sign in</h1>${authNotice}<p>Use the authorized Google account to continue.</p><form method="post" action="/api/admin-auth-start"><button class="button button-primary google-sign-in" type="submit">Sign in with Google</button></form></section>`
  });
}

function adminBody(section, user) {
  if (section === "security") return `<section class="page-title"><p class="eyebrow">Administration</p><h1>Settings</h1><p>Authentication and production integration requirements.</p></section><section class="saved-card security-card"><h2>Authenticated administrator</h2><dl class="estimate-grid"><div><dt>Authorized Google email</dt><dd>${escapeHtml(user.email)}</dd></div><div><dt>Authentication provider</dt><dd>Google only</dd></div><div><dt>Authorization mode</dt><dd>Exact verified ADMIN_EMAIL</dd></div></dl><p>Protect the authorized Google account with Google 2-Step Verification or a passkey. Supabase service-role and Shopify credentials remain server-only.</p></section>`;
  if (section === "cards") return `<section class="page-title"><p class="eyebrow">Private owner area</p><h1>Card Dashboard</h1><p>Manage the public details connected to your physical cards.</p></section><div id="dashboard" aria-live="polite"><p>Loading…</p></div>`;
  if (section === "estimates") return `<section class="page-title"><p class="eyebrow">Requests and estimates</p><h1>3D Print Requests</h1><p>Search submissions, review production details, update status, and prepare customer quotes.</p></section><div id="estimates-admin" aria-live="polite"><p>Loading…</p></div>`;
  const titles = {
    dashboard:["Mucci Products", "Operations Dashboard", "What needs attention across estimates, paid orders, design, printing, quality control, and shipping."],
    orders:["Production", "Orders", "Search and manage paid Shopify orders without mixing them with unconverted estimates."],
    customers:["Contacts", "Customers", "Customer contacts derived from estimate submissions and their request history."],
    files:["Private files", "Quote Files", "Open each private quote folder, view or download its files, and add late customer files without allowing deletion."],
    activity:["Audit trail", "Admin Activity", "Important administrator changes. Secrets and authentication tokens are never recorded."]
  };
  const [eyebrow, heading, intro] = titles[section] || titles.dashboard;
  return `<section class="page-title"><p class="eyebrow">${eyebrow}</p><h1>${heading}</h1><p>${intro}</p></section><div id="operations-admin" data-section="${section}" aria-live="polite"><p>Loading…</p></div>`;
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
      return res.status(200).send(loginPage(values.auth));
    }
    const scripts = requestedSection === "cards"
      ? ["/config.js", "/card-core.js", "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js", "/assets/management-cards.js"]
      : requestedSection === "estimates" ? ["/config.js", "/assets/management-estimates.js"]
      : requestedSection === "security" ? [] : ["/assets/management-operations.js"];
    const title = requestedSection === "cards" ? "Digital Cards" : requestedSection === "security" ? "Settings & Security" : requestedSection === "estimates" ? "Requests / Estimates" : requestedSection[0].toUpperCase() + requestedSection.slice(1);
    return res.status(200).send(page({ title, body:adminBody(requestedSection, result.user), scripts, authenticated:true, basePath:"/admin" }));
  } catch (error) {
    console.warn("Admin authentication failed:", error?.statusCode === 503 ? "configuration_invalid" : "admin_page_failed");
    return auth.notFound(res);
  }
};
