(function () {
  "use strict";
  const app = document.querySelector("#card-app");
  const config = window.MUCCI_CONFIG || {};
  const core = window.MucciCards;
  const canonicalSiteUrl = String(config.publicSiteUrl || "https://mucciproducts.com").replace(/\/$/, "");

  function siteBase() {
    if (location.hostname.endsWith("github.io")) return `/${location.pathname.split("/").filter(Boolean)[0]}`;
    return "";
  }

  function tokenFromLocation() {
    const match = location.pathname.match(/\/card\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : new URLSearchParams(location.search).get("token");
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function safeUrl(value) {
    try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; } catch (_) { return ""; }
  }

  async function fetchProfile(token) {
    if (!config.supabaseUrl || !config.supabaseAnonKey) throw new Error("not-configured");
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_public_card_profile`, {
      method: "POST",
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ lookup_token: token }),
    });
    if (!response.ok) throw new Error("network");
    const rows = await response.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  function actionLink(href, label, icon, extra) {
    if (!href) return "";
    return `<a class="quick-action" href="${escapeHtml(href)}" ${extra || ""}><span aria-hidden="true">${icon}</span>${escapeHtml(label)}</a>`;
  }

  function safeFilename(value) {
    return String(value || "mucci-contact").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mucci-contact";
  }

  function downloadVCard(profile) {
    const blob = new Blob([core.generateVCard(profile)], { type: "text/vcard;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(profile.name)}.vcf`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderProfile(profile, token, offline) {
    const name = escapeHtml(profile.name || "Digital card");
    const image = safeUrl(profile.profile_image_url || profile.logo_url);
    const logo = safeUrl(profile.logo_url);
    const website = safeUrl(profile.website);
    const linkedin = safeUrl(profile.linkedin);
    const instagram = safeUrl(profile.instagram);
    document.title = `${profile.name || "Digital Card"} | Mucci Products`;
    app.innerHTML = `
      <div class="card-shell showcase-shell">
        <header class="card-brand"><a href="${canonicalSiteUrl}" aria-label="Mucci Products home"><img src="${siteBase()}/assets/mucci-products-logo.png" alt="Mucci Products" /></a><nav class="card-account-links" aria-label="Digital card account"><a href="${canonicalSiteUrl}/my-cards/">My Cards</a><a href="${canonicalSiteUrl}/card-dashboard/">Admin Sign In</a></nav></header>
        ${offline ? '<p class="offline-banner" role="status">Offline copy from your last visit</p>' : ""}
        <section class="showcase-grid">
          <div class="showcase-intro"><p class="eyebrow">Simple · Modern · Connected</p><h2>Keep this digital card</h2><p>Tap once and keep ${escapeHtml((profile.name || "this contact").split(" ")[0])}’s details close at hand.</p><ul><li>Instantly share contact details</li><li>A more sustainable way to network</li><li>Works on any modern device</li></ul></div>
        <article class="digital-card compact-card">
          <div class="identity">
            ${image ? `<img class="profile-image" src="${escapeHtml(image)}" alt="${name}" />` : `<div class="profile-placeholder" aria-hidden="true">${name.charAt(0)}</div>`}
            ${logo && logo !== image ? `<img class="company-logo" src="${escapeHtml(logo)}" alt="${escapeHtml(profile.company || "Company")} logo" />` : ""}
            <p class="eyebrow">Digital business card</p><h1>${name}</h1>
            ${profile.title ? `<p class="title">${escapeHtml(profile.title)}</p>` : ""}
            ${profile.company ? `<p class="company">${escapeHtml(profile.company)}</p>` : ""}
            ${profile.bio ? `<p class="bio">${escapeHtml(profile.bio)}</p>` : ""}
          </div>
          <nav class="quick-actions" aria-label="Contact options">
            ${actionLink(profile.phone ? `tel:${profile.phone}` : "", "Call", "☎")}
            ${actionLink(profile.email ? `mailto:${profile.email}` : "", "Email", "✉")}
            ${actionLink(website, "Website", "↗", 'target="_blank" rel="noreferrer"')}
          </nav>
          <dl class="details">
            ${profile.phone ? `<div><dt>Phone</dt><dd><a href="tel:${escapeHtml(profile.phone)}">${escapeHtml(profile.phone)}</a></dd></div>` : ""}
            ${profile.email ? `<div><dt>Email</dt><dd><a href="mailto:${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</a></dd></div>` : ""}
            ${website ? `<div><dt>Website</dt><dd><a href="${escapeHtml(website)}" target="_blank" rel="noreferrer">${escapeHtml(profile.website)}</a></dd></div>` : ""}
            ${profile.address ? `<div><dt>Address</dt><dd>${escapeHtml(profile.address)}</dd></div>` : ""}
          </dl>
          ${(linkedin || instagram) ? `<div class="social-links">${actionLink(linkedin, "LinkedIn", "in", 'target="_blank" rel="noreferrer"')}${actionLink(instagram, "Instagram", "◎", 'target="_blank" rel="noreferrer"')}</div>` : ""}
        </article>
        <aside class="showcase-actions">
          <button class="button button-primary" id="save-contact" type="button">Save to Contacts</button>
          <a class="button button-primary" href="/api/wallet/apple?token=${encodeURIComponent(token)}">Add to Apple Wallet</a>
          <a class="button button-primary" href="/api/wallet/google?token=${encodeURIComponent(token)}">Add to Google Wallet</a>
          <button class="button button-secondary" id="save-image">Save Card Image</button>
          <div class="public-qr"><div id="public-card-qr" aria-label="QR code for this digital card"></div><p>Scan this QR code to open this card on your phone.</p></div>
          <p class="showcase-signoff">Mucci Products Inc.<br><small>People · Connections · Opportunities</small></p>
        </aside>
        </section>
        <section class="card-benefits"><div><span>▣</span><h3>Save Instantly</h3><p>Download the complete contact directly to your device.</p></div><div><span>▰</span><h3>Works Everywhere</h3><p>Keep the card in Apple Wallet, Google Wallet, or any modern browser.</p></div><div><span>♧</span><h3>A Greener Choice</h3><p>Share digitally and reduce paper waste.</p></div></section>
        <footer class="card-footer">Shared with Mucci Digital Cards</footer>
      </div>`;
    document.querySelector("#save-contact").addEventListener("click", () => downloadVCard(profile));
    document.querySelector("#save-image").addEventListener("click", () => saveCardImage(profile));
    if (window.qrcode) {
      const qr = window.qrcode(0, "M"); qr.addData(location.href); qr.make();
      document.querySelector("#public-card-qr").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1, scalable: true });
    }
  }

  function canvasBlob(canvas) {
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("image-creation-failed")), "image/png"));
  }

  async function saveCardImage(profile) {
    const button = document.querySelector("#save-image");
    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = "Preparing image…";
    const canvas = document.createElement("canvas"); canvas.width = 1200; canvas.height = 630;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f7fbfd"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#16b8b4"; ctx.fillRect(0, 0, 28, canvas.height);
    ctx.fillStyle = "#082a4a"; ctx.font = "700 76px Arial"; ctx.fillText(profile.name || "Digital card", 90, 230);
    ctx.font = "36px Arial"; if (profile.title) ctx.fillText(profile.title, 94, 310);
    ctx.font = "600 40px Arial"; if (profile.company) ctx.fillText(profile.company, 94, 380);
    ctx.font = "28px Arial"; ctx.fillText([profile.phone, profile.email].filter(Boolean).join("  •  "), 94, 500);
    ctx.font = "600 24px Arial"; ctx.fillStyle = "#0a557b"; ctx.fillText("MUCCI DIGITAL CARDS", 94, 90);
    try {
      const blob = await canvasBlob(canvas);
      const filename = `${safeFilename(profile.name)}-digital-card.png`;
      const file = new File([blob], filename, { type: "image/png" });
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        button.textContent = "Choose Save Image…";
        await navigator.share({ files: [file], title: `${profile.name || "Mucci"} digital card` });
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.download = filename;
        anchor.href = url;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (error) {
      if (error && error.name !== "AbortError") window.alert("The card image could not be saved. Please try again.");
    } finally {
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function renderError(message) {
    app.innerHTML = `<section class="error-state"><a class="error-logo" href="${canonicalSiteUrl}"><img src="${siteBase()}/assets/mucci-products-logo.png" alt="Mucci Products" /></a><p class="eyebrow">Mucci Digital Cards</p><h1>This digital card is currently unavailable.</h1><p>${escapeHtml(message)}</p><a class="button button-primary" href="${canonicalSiteUrl}">Return to Mucci Products</a></section>`;
  }

  async function init() {
    const token = tokenFromLocation();
    if (!core.validToken(token)) return renderError("The card link is invalid or incomplete.");
    if (new URLSearchParams(location.search).get("preview") === "1" && ["localhost", "127.0.0.1"].includes(location.hostname)) {
      return renderProfile({ name: "Sample Card", title: "Product Designer", company: "Mucci Products Inc.", phone: "(555) 010-2026", email: "hello@example.com", website: "https://mucciproducts.ca", linkedin: "https://linkedin.com", instagram: "https://instagram.com", bio: "A local-only preview used to review the digital card layout." }, token, false);
    }
    try {
      const profile = await fetchProfile(token);
      if (!profile) return renderError("The card may have been disabled or removed.");
      core.rememberScan(localStorage, token);
      core.cachePublicProfile(localStorage, token, profile);
      renderProfile(profile, token, false);
    } catch (error) {
      const cached = core.getCache(localStorage)[token];
      if (cached && cached.profile) {
        core.rememberScan(localStorage, token);
        return renderProfile(cached.profile, token, true);
      }
      renderError(error.message === "not-configured" ? "The card service has not been connected yet." : "Check your connection and try again.");
    }
  }
  init();
})();
