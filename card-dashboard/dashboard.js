(function () {
  "use strict";
  const root = document.querySelector("#dashboard");
  const config = window.MUCCI_CONFIG || {};
  const core = window.MucciCards;
  const canonicalSiteUrl = String(config.publicSiteUrl || "https://mucciproducts.com").replace(/\/$/, "");
  const fields = ["name", "company", "title", "phone", "email", "website", "linkedin", "instagram", "address", "bio", "logo_url", "profile_image_url"];
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const label = (field) => field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  async function apiRequest(action, values = {}) {
    const response = await fetch("/api/admin-cards", {
      method:"POST",
      credentials:"same-origin",
      headers:{ "Content-Type":"application/json" },
      body:JSON.stringify({ action, ...values })
    });
    if (response.status === 404) {
      window.location.reload();
      throw new Error("Your administrator session is no longer available.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The administrative request could not be completed.");
    return payload;
  }

  async function loadDashboard() {
    root.innerHTML = '<p role="status">Loading your cards…</p>';
    try {
      const payload = await apiRequest("list");
      const profiles = payload.profiles || [];
      if (!profiles.length) return renderFirstProfileSetup();
      renderDashboard(profiles, payload.cards || []);
    } catch (error) {
      root.innerHTML = `<div class="dashboard-notice"><strong>We couldn’t load your dashboard.</strong><br>${escapeHtml(error.message)}</div>`;
    }
  }

  function setupField(name, type, required) {
    if (type === "textarea") return `<label class="full-width">${label(name)}<textarea name="${name}" ${required ? "required" : ""}></textarea></label>`;
    return `<label>${label(name)}<input type="${type || "text"}" name="${name}" ${required ? "required" : ""}></label>`;
  }

  function createProfileForm(id, heading, intro, buttonLabel) {
    return `<form id="${id}" class="saved-card owner-form setup-card create-profile-form"><p class="eyebrow">Card profile setup</p><h2>${heading}</h2><p>${intro}</p><div class="form-grid">${setupField("name", "text", true)}${setupField("company", "text")}${setupField("title", "text")}${setupField("phone", "tel")}${setupField("email", "email")}${setupField("website", "url")}${setupField("linkedin", "url")}${setupField("instagram", "url")}${setupField("address", "text")}${setupField("bio", "textarea")}</div><button class="button button-primary" type="submit">${buttonLabel}</button><p role="status"></p></form>`;
  }

  function renderFirstProfileSetup() {
    root.innerHTML = `<div class="dashboard-stack">${userBar()}${createProfileForm("setup-form", "Create your first digital card", "Add only the details you want visitors to see. You can change or disable the profile later.", "Create profile and card")}</div>`;
    bindCreateProfileForms();
  }

  async function createProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    message.textContent = "Creating the profile and secure card URL…";
    try {
      await apiRequest("create", { profile:values });
      await loadDashboard();
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
    }
  }

  function userBar() {
    return '<div class="dashboard-user"><p>Protected card administration</p></div>';
  }

  function profileField(profile, field) {
    if (field === "bio") return `<label class="full-width">${label(field)}<textarea name="${field}">${escapeHtml(profile[field])}</textarea></label>`;
    const type = field === "email" ? "email" : ["website", "linkedin", "instagram", "logo_url", "profile_image_url"].includes(field) ? "url" : field === "phone" ? "tel" : "text";
    return `<label class="${["logo_url", "profile_image_url"].includes(field) ? "full-width" : ""}">${label(field)}<input type="${type}" name="${field}" value="${escapeHtml(profile[field])}"></label>`;
  }

  function renderDashboard(profiles, cards) {
    root.innerHTML = `<div class="dashboard-stack">${userBar()}<details class="new-card-panel"><summary class="button button-primary">Create another card profile</summary>${createProfileForm("new-card-form", "Create another digital card", "Each profile receives a separate random public URL and QR code.", "Create new profile and card")}</details><section class="dashboard-section"><div class="dashboard-section-heading"><div><p class="eyebrow">Public information</p><h2>Card profiles</h2></div></div><div class="saved-grid">${profiles.map((profile) => `<form class="saved-card owner-form profile-form" data-id="${profile.id}"><div class="form-grid">${fields.map((field) => profileField(profile, field)).join("")}</div><label class="checkbox-label"><input type="checkbox" name="is_active" ${profile.is_active ? "checked" : ""}> Make this profile publicly available</label><div class="upload-row"><label>Upload profile photo<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="profile_image_url"></label><span></span></div><div class="upload-row"><label>Upload company logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-upload="logo_url"></label><span></span></div><button class="button button-primary" type="submit">Save profile</button><p role="status"></p></form>`).join("")}</div></section><section class="dashboard-section"><div class="dashboard-section-heading"><div><p class="eyebrow">NFC and QR</p><h2>Physical cards</h2></div></div><div class="saved-grid">${cards.map(cardMarkup).join("")}</div></section></div>`;
    bindCreateProfileForms();
    document.querySelectorAll(".profile-form").forEach((form) => form.addEventListener("submit", saveProfile));
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "Copied"; }));
    document.querySelectorAll("[data-qr]").forEach(drawQrCode);
    document.querySelectorAll("[data-download]").forEach((button) => button.addEventListener("click", () => { const canvas = button.closest("article").querySelector("canvas"); const link = document.createElement("a"); link.download = "mucci-card-qr.png"; link.href = canvas.toDataURL("image/png"); link.click(); }));
  }

  function cardMarkup(card) {
    const url = core.cardUrl(canonicalSiteUrl, card.public_token);
    return `<article class="saved-card"><h3>${escapeHtml(card.card_label || "Physical card")}</h3><p><strong>NFC URL</strong><br><code class="card-url">${escapeHtml(url)}</code></p><canvas data-qr="${escapeHtml(url)}"></canvas><div class="saved-card-actions"><button class="button button-secondary" type="button" data-copy="${escapeHtml(url)}">Copy URL</button><a class="button button-primary" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">Preview profile</a></div><button class="button button-secondary" type="button" data-download>Download QR</button><p>${card.is_active ? "Card active" : "Card disabled"}</p></article>`;
  }

  function drawQrCode(canvas) {
    const qr = window.qrcode(0, "M"); qr.addData(canvas.dataset.qr); qr.make();
    const image = new Image();
    image.onload = () => { canvas.width = 210; canvas.height = 210; canvas.getContext("2d").drawImage(image, 0, 0, 210, 210); };
    image.src = qr.createDataURL(6, 2);
  }

  async function uploadSelectedAssets(form, data) {
    for (const input of form.querySelectorAll("[data-upload]")) {
      if (!input.files.length) continue;
      const file = input.files[0];
      const ticket = await apiRequest("asset_ticket", { field:input.dataset.upload, contentType:file.type, size:file.size });
      if (!ticket.signedUrl || !ticket.publicUrl) throw new Error("The secure upload could not be prepared.");
      const body = new FormData();
      body.append("cacheControl", "3600");
      body.append("", file);
      const upload = await fetch(ticket.signedUrl, { method:"PUT", headers:{ "x-upsert":"false" }, body });
      if (!upload.ok) throw new Error("The selected image could not be uploaded.");
      data[input.dataset.upload] = ticket.publicUrl;
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));
    fields.forEach((field) => { data[field] = data[field] || null; });
    data.is_active = form.elements.is_active.checked;
    button.disabled = true;
    message.textContent = "Saving…";
    try {
      await uploadSelectedAssets(form, data);
      await apiRequest("update", { profileId:form.dataset.id, profile:data });
      message.textContent = "Profile saved.";
      window.setTimeout(loadDashboard, 600);
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  }

  function bindCreateProfileForms() {
    document.querySelectorAll(".create-profile-form").forEach((form) => form.addEventListener("submit", createProfile));
  }

  loadDashboard();
})();
