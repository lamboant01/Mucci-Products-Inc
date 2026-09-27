"use strict";

const auth = require("./_admin-auth");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);

function page({ title, body, scripts = [], authenticated = false, basePath = "" }) {
  const navigation = authenticated ? `<header class="page-header"><a href="/"><img src="/assets/mucci-products-logo.png" alt="Mucci Products"></a><nav class="management-nav" aria-label="Administration"><a href="${escapeHtml(basePath)}/estimates">Estimates</a><a href="${escapeHtml(basePath)}/cards">Digital Cards</a><a href="${escapeHtml(basePath)}/security">Security</a><form method="post" action="/api/admin-logout"><button class="button button-secondary" type="submit">Sign out</button></form></nav></header>` : "";
  const scriptTags = scripts.map((script) => `<script src="${escapeHtml(script)}" defer></script>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>${escapeHtml(title)} | Mucci Products</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/cards.css"><link rel="stylesheet" href="/assets/management.css"></head><body class="cards-page"><main class="dashboard-shell">${navigation}${body}</main>${scriptTags}</body></html>`;
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
  return `${bootstrapNotice}<section class="page-title"><p class="eyebrow">Private owner area</p><h1>3D Print Estimates</h1><p>Look up customer quote codes and prepare private Etsy listings.</p></section><div id="estimates-admin" aria-live="polite"><p>Loading…</p></div>`;
}

module.exports = async function handler(req, res) {
  auth.securityHeaders(res);
  if (req.method !== "GET") return auth.notFound(res);
  try {
    const config = auth.configuration();
    const values = auth.requestQuery(req);
    const slug = String(values.slug || "");
    if (!auth.routeMatches(slug, config)) return auth.notFound(res);
    const requestedSection = auth.section(values.section);
    const result = await auth.authenticateAdmin(req, res, config);
    if (result.status === "unauthorized") return auth.notFound(res);
    if (result.status === "unauthenticated") {
      auth.appendCookies(res, [auth.cookie(auth.RETURN_COOKIE, `${config.routeSlug}/${requestedSection}`, 600, "/api")]);
      return res.status(200).send(loginPage());
    }
    const scripts = requestedSection === "cards"
      ? ["/config.js", "/card-core.js", "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js", "/assets/management-cards.js"]
      : requestedSection === "estimates" ? ["/config.js", "/assets/management-estimates.js"] : [];
    return res.status(200).send(page({ title:requestedSection === "cards" ? "Card Dashboard" : requestedSection === "security" ? "Security" : "Print Estimates", body:adminBody(requestedSection, result.user, result.bootstrap), scripts, authenticated:true, basePath:`/${slug}` }));
  } catch {
    return auth.notFound(res);
  }
};
