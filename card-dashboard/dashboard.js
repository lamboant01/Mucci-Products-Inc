(function () {
  "use strict";
  const root = document.querySelector("#dashboard");
  const config = window.MUCCI_CONFIG || {};
  const core = window.MucciCards;
  const canonicalSiteUrl = String(config.publicSiteUrl || "https://mucciproducts.com").replace(/\/$/, "");
  const fields = ["name", "company", "title", "phone", "email", "website", "linkedin", "instagram", "address", "bio", "logo_url", "profile_image_url"];
  let currentUser = null;
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const label = (field) => field.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    root.innerHTML = '<div class="dashboard-notice"><strong>Supabase setup required.</strong> Add the public Supabase URL and anon key to <code>config.js</code>, then run migrations 001 and 002. The owner sign-in and profile setup will become active after that configuration is deployed.</div>';
    return;
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  async function init() {
    const { data: { session } } = await client.auth.getSession();
    if (!session) return renderLogin();
    currentUser = session.user;
    await loadDashboard();
  }

  function renderLogin() {
    root.innerHTML = `<form id="login-form" class="saved-card owner-form setup-card"><p class="eyebrow">Passwordless access</p><h2>Owner sign in</h2><p>Enter the invited email connected to your card. We’ll send a secure one-time link with no password required.</p><label>Email address<input required type="email" name="email" autocomplete="email" placeholder="you@example.com"></label><button class="button button-primary" type="submit">Email my secure sign-in link</button><p id="login-message" role="status"></p></form>`;
    document.querySelector("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const message = form.querySelector("#login-message");
      const button = form.querySelector("button");
      button.disabled = true;
      message.textContent = "Sending your secure link…";
      const email = new FormData(form).get("email");
      const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: `${canonicalSiteUrl}/card-dashboard/`, shouldCreateUser: false } });
      message.textContent = error ? error.message : "Check your inbox. Your secure sign-in link is on its way.";
      button.disabled = false;
    });
  }

  async function loadDashboard() {
    root.innerHTML = '<p role="status">Loading your cards…</p>';
    const [{ data: profiles, error: profilesError }, { data: cards, error: cardsError }] = await Promise.all([
      client.from("profiles").select("*").order("created_at"),
      client.from("physical_cards").select("id,profile_id,public_token,card_label,is_active,created_at").order("created_at"),
    ]);
    if (profilesError || cardsError) {
      root.innerHTML = `<div class="dashboard-notice"><strong>We couldn’t load your dashboard.</strong><br>${escapeHtml((profilesError || cardsError).message)}</div>`;
      return;
    }
    if (!profiles.length) return renderFirstProfileSetup();
    renderDashboard(profiles, cards || []);
  }

  function setupField(name, type, required) {
    if (type === "textarea") return `<label class="full-width">${label(name)}<textarea name="${name}" ${required ? "required" : ""}></textarea></label>`;
    return `<label>${label(name)}<input type="${type || "text"}" name="${name}" ${required ? "required" : ""}></label>`;
  }

  function renderFirstProfileSetup() {
    root.innerHTML = `<div class="dashboard-stack">${userBar()}<form id="setup-form" class="saved-card owner-form setup-card"><p class="eyebrow">First card setup</p><h2>Create your digital card</h2><p>Add only the details you want visitors to see. You can change or disable the profile later.</p><div class="form-grid">${setupField("name", "text", true)}${setupField("company", "text")}${setupField("title", "text")}${setupField("phone", "tel")}${setupField("email", "email")}${setupField("website", "url")}${setupField("linkedin", "url")}${setupField("instagram", "url")}${setupField("address", "text")}${setupField("bio", "textarea")}</div><button class="button button-primary" type="submit">Create my profile and card</button><p role="status"></p></form></div>`;
    bindAccountActions();
    document.querySelector("#setup-form").addEventListener("submit", createFirstProfile);
  }

  async function createFirstProfile(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector('[role="status"]');
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    const args = {};
    ["name", "company", "title", "phone", "email", "website", "linkedin", "instagram", "address", "bio"].forEach((field) => { args[`p_${field}`] = values[field] || null; });
    button.disabled = true;
    message.textContent = "Creating your secure card URL…";
    const { error } = await client.rpc("create_my_digital_card", args);
    if (error) { message.textContent = error.message; button.disabled = false; return; }
    await loadDashboard();
  }

  function userBar() {
    return `<div class="dashboard-user"><p>Signed in as <strong>${escapeHtml(currentUser.email)}</strong></p><button class="button button-secondary" id="sign-out" type="button">Sign out</button></div>`;
  }

  function profileField(profile, field) {
    if (field === "bio") return `<label class="full-width">${label(field)}<textarea name="${field}">${escapeHtml(profile[field])}</textarea></label>`;
    const type = field === "email" ? "email" : ["website", "linkedin", "instagram", "logo_url", "profile_image_url"].includes(field) ? "url" : field === "phone" ? "tel" : "text";
    return `<label class="${["logo_url", "profile_image_url"].includes(field) ? "full-width" : ""}">${label(field)}<input type="${type}" name="${field}" value="${escapeHtml(profile[field])}"></label>`;
  }

  function renderDashboard(profiles, cards) {
    root.innerHTML = `<div class="dashboard-stack">${userBar()}<section class="dashboard-section"><div class="dashboard-section-heading"><div><p class="eyebrow">Public information</p><h2>Your profile</h2></div></div><div class="saved-grid">${profiles.map((profile) => `<form class="saved-card owner-form profile-form" data-id="${profile.id}"><div class="form-grid">${fields.map((field) => profileField(profile, field)).join("")}</div><label class="checkbox-label"><input type="checkbox" name="is_active" ${profile.is_active ? "checked" : ""}> Make this profile publicly available</label><div class="upload-row"><label>Upload profile photo<input type="file" accept="image/png,image/jpeg,image/webp" data-upload="profile_image_url"></label><span></span></div><div class="upload-row"><label>Upload company logo<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-upload="logo_url"></label><span></span></div><button class="button button-primary" type="submit">Save profile</button><p role="status"></p></form>`).join("")}</div></section><section class="dashboard-section"><div class="dashboard-section-heading"><div><p class="eyebrow">NFC and QR</p><h2>Your physical cards</h2></div></div><div class="saved-grid">${cards.map(cardMarkup).join("")}</div></section></div>`;
    bindAccountActions();
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
      const extension = file.name.split(".").pop().replace(/[^a-z0-9]/gi, "").toLowerCase();
      const objectPath = `${currentUser.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from("card-assets").upload(objectPath, file, { upsert: false });
      if (error) throw error;
      data[input.dataset.upload] = client.storage.from("card-assets").getPublicUrl(objectPath).data.publicUrl;
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
      const { error } = await client.from("profiles").update(data).eq("id", form.dataset.id);
      if (error) throw error;
      message.textContent = "Profile saved.";
      setTimeout(loadDashboard, 600);
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  }

  function bindAccountActions() {
    document.querySelector("#sign-out")?.addEventListener("click", async () => { await client.auth.signOut(); currentUser = null; renderLogin(); });
  }

  init();
})();
