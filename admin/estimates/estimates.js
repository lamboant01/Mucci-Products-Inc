(function () {
  "use strict";

  const root = document.querySelector("#estimates-admin");
  const config = window.MUCCI_CONFIG || {};
  const adminConfig = window.MUCCI_ESTIMATE_ADMIN_CONFIG;
  const listing = window.MucciEtsyListing;
  const allowedAdminEmail = "anthony@mucciproducts.com";
  const quotePattern = /^MP-[A-HJ-NP-Z2-9]{5}$/;
  let client;
  let activeEstimate = null;
  let activeHistory = [];
  let activeFilter = "all";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const money = (value) => new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" }).format(Number(value));
  const label = (value) => ({ standard:"Standard Detail", draft:"Efficient Larger Prints", etsy_prepared:"Etsy Prepared", ready:"Ready to Print", modify:"Needs Modifications", design:"Design Required" })[value]
    || String(value || "Not provided").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const cleanQuote = (value) => String(value || "").trim().toUpperCase();
  const quoteFromUrl = () => cleanQuote(new URLSearchParams(window.location.search).get("quote"));
  const driveStatus = () => new URLSearchParams(window.location.search).get("drive") || "";
  const setQuoteUrl = (quote) => {
    const url = new URL(window.location.href);
    if (quote) url.searchParams.set("quote", quote); else url.searchParams.delete("quote");
    url.searchParams.delete("drive");
    window.history.replaceState({}, "", url);
  };
  const displayPrice = (estimate) => Number(estimate.estimated_price) === Number(estimate.estimated_price_max)
    ? money(estimate.estimated_price) : `${money(estimate.estimated_price)}–${money(estimate.estimated_price_max)}`;
  const finalPrice = (estimate) => Number(estimate.final_price || estimate.estimated_price_max || estimate.estimated_price);
  const finalQuantity = (estimate) => Number(estimate.final_quantity || estimate.quantity || 1);
  const errorMessage = (error, fallback) => {
    if (/jwt|session|auth|permission|administrator/i.test(error?.message || "")) return "Your administrator session expired. Please sign in again.";
    if (/network|fetch/i.test(error?.message || "")) return "The network request failed. Check your connection and try again.";
    return fallback;
  };

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase || !adminConfig || !listing) {
    root.innerHTML = '<div class="dashboard-notice">The estimate administration configuration is incomplete.</div>';
    return;
  }
  client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  async function init() {
    const { data:{ session } } = await client.auth.getSession();
    if (!session) return renderLogin();
    if (String(session.user.email || "").toLowerCase() !== allowedAdminEmail) {
      await client.auth.signOut();
      return renderLogin("This account is not authorized.");
    }
    const quote = quoteFromUrl();
    if (quote && quotePattern.test(quote)) await findEstimate(quote); else await loadRecent();
  }

  function renderLogin(initialMessage) {
    root.innerHTML = `<form id="login-form" class="saved-card owner-form setup-card" autocomplete="off"><p class="eyebrow">Restricted administration</p><h2>Admin sign in</h2><label>Email address<input required type="email" name="email" autocomplete="username"></label><label>Password<input required type="password" name="password" autocomplete="current-password"></label><button class="button button-primary" type="submit">Sign in</button><p role="status">${escapeHtml(initialMessage || "")}</p></form>`;
    document.querySelector("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const status = form.querySelector('[role="status"]');
      const button = form.querySelector("button");
      const values = Object.fromEntries(new FormData(form));
      const email = String(values.email || "").trim().toLowerCase();
      button.disabled = true; status.textContent = "Signing in…";
      if (email !== allowedAdminEmail) { status.textContent = "The email or password is incorrect."; button.disabled = false; return; }
      const { error } = await client.auth.signInWithPassword({ email, password:values.password });
      if (error) { status.textContent = "The email or password is incorrect."; button.disabled = false; return; }
      const quote = quoteFromUrl();
      if (quote && quotePattern.test(quote)) await findEstimate(quote); else await loadRecent();
    });
  }

  function adminShell(content, notice = "") {
    const driveNotice = driveStatus() === "connected" ? "Google Drive is connected." : driveStatus() === "error" ? "Google Drive could not be connected. Check the OAuth redirect URI and try again." : "";
    root.innerHTML = `<div class="admin-tools">
      <div class="dashboard-user"><p>Protected estimate administration</p><div class="card-actions"><a class="button button-secondary" href="${escapeHtml(config.etsyUrl || "https://www.etsy.com/shop/MucciProducts")}" target="_blank" rel="noopener noreferrer">Open Etsy Messages</a><button id="connect-drive" class="button button-secondary" type="button">Connect Google Drive</button><button id="sign-out" class="button button-secondary" type="button">Sign out</button></div></div>
      <p id="drive-connection-status" class="dashboard-notice" role="status"${driveNotice ? "" : " hidden"}>${escapeHtml(driveNotice)}</p>
      <section class="find-estimate" aria-labelledby="find-estimate-title"><p class="eyebrow">Find Estimate</p><h2 id="find-estimate-title">Paste a customer quote code</h2><form id="search-form" class="admin-search"><input name="code" value="${escapeHtml(activeEstimate?.quote_code || quoteFromUrl())}" maxlength="32" placeholder="MP-A42K7" aria-label="Quote code" autocapitalize="characters" autocomplete="off"><button class="button button-primary" type="submit">Find Quote</button><button class="button button-secondary" id="show-recent" type="button">Show Recent</button></form><p id="search-status" class="form-status" role="status">${escapeHtml(notice)}</p></section>
      ${content}
    </div>`;
    bindShell();
  }

  function bindShell() {
    document.querySelector("#sign-out").addEventListener("click", async () => { await client.auth.signOut(); renderLogin(); });
    document.querySelector("#connect-drive").addEventListener("click", connectDrive);
    document.querySelector("#search-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.code;
      input.value = cleanQuote(input.value);
      findEstimate(input.value);
    });
    document.querySelector('#search-form [name="code"]').addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase(); });
    document.querySelector("#show-recent").addEventListener("click", () => loadRecent());
  }

  async function findEstimate(value) {
    const quote = cleanQuote(value);
    activeEstimate = null;
    activeHistory = [];
    if (!quotePattern.test(quote)) {
      setQuoteUrl("");
      adminShell('<section class="empty-state">Enter a valid quote code such as MP-A42K7.</section>', "Invalid quote code.");
      return;
    }
    setQuoteUrl(quote);
    adminShell('<p class="loading-state" role="status">Finding estimate…</p>');
    const { data, error } = await client.rpc("admin_find_print_estimate", { p_quote_code:quote });
    if (error) { adminShell('<section class="empty-state">The estimate could not be loaded.</section>', errorMessage(error, "The estimate could not be loaded.")); return; }
    if (!data?.length) { adminShell('<section class="empty-state">Quote code not found.</section>', "Quote code not found."); return; }
    activeEstimate = data[0];
    const historyResult = await client.from("etsy_listing_preparations").select("*").eq("estimate_id", activeEstimate.id).order("generated_at", { ascending:false }).limit(10);
    activeHistory = historyResult.error ? [] : (historyResult.data || []);
    renderEstimateReview();
  }

  async function loadRecent(filter = activeFilter) {
    activeEstimate = null;
    activeHistory = [];
    activeFilter = filter;
    setQuoteUrl("");
    adminShell('<p class="loading-state" role="status">Loading recent estimates…</p>');
    const manualOnly = filter === "manual_review";
    const status = manualOnly || filter === "all" ? null : filter;
    const { data, error } = await client.rpc("admin_recent_print_estimates", { p_status:status, p_manual_review:manualOnly });
    if (error) { adminShell('<section class="empty-state">Recent estimates could not be loaded.</section>', errorMessage(error, "Recent estimates could not be loaded.")); return; }
    renderRecent(data || []);
  }

  function renderRecent(estimates) {
    const filters = ["all", ...adminConfig.statuses, "manual_review"];
    const content = `<section class="recent-estimates"><div class="section-heading"><div><p class="eyebrow">Recent estimates</p><h2>Newest first</h2></div><div class="filter-row" aria-label="Estimate filters">${filters.map((filter) => `<button class="filter-button${activeFilter === filter ? " active" : ""}" type="button" data-filter="${filter}">${label(filter)}</button>`).join("")}</div></div><div class="estimate-list">${estimates.length ? estimates.map(recentEstimateMarkup).join("") : '<div class="empty-state">No estimates match this filter.</div>'}</div></section>`;
    adminShell(content);
    document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => loadRecent(button.dataset.filter)));
    document.querySelectorAll("[data-review-quote]").forEach((button) => button.addEventListener("click", () => findEstimate(button.dataset.reviewQuote)));
  }

  function recentEstimateMarkup(estimate) {
    return `<article class="estimate-card compact"><header><div><h3>${escapeHtml(estimate.quote_code)}</h3><small>${new Date(estimate.created_at).toLocaleString("en-CA")}</small></div><span class="status-badge status-${escapeHtml(estimate.status)}">${escapeHtml(label(estimate.status))}</span></header><dl class="recent-grid"><div><dt>Customer</dt><dd>${escapeHtml(estimate.name || "Name not provided")}</dd></div><div><dt>Estimated</dt><dd>${escapeHtml(displayPrice(estimate))} CAD</dd></div><div><dt>Final</dt><dd>${escapeHtml(money(finalPrice(estimate)))} CAD</dd></div><div><dt>Quantity</dt><dd>${escapeHtml(finalQuantity(estimate))}</dd></div></dl>${estimate.requires_manual_review ? '<p class="manual-flag">Manual review required</p>' : ""}<button class="button button-primary" type="button" data-review-quote="${escapeHtml(estimate.quote_code)}">Review Estimate</button></article>`;
  }

  function renderEstimateReview(generatedPackage = null, successMessage = "") {
    const estimate = activeEstimate;
    const processing = listing.suggestProcessing(estimate, adminConfig);
    const history = activeHistory.length ? `<div class="history-list">${activeHistory.map((entry) => `<div><span><strong>${new Date(entry.generated_at).toLocaleString("en-CA")}</strong>${entry.generated_title ? `<small>${escapeHtml(entry.generated_title)}</small>` : ""}</span><span>${escapeHtml(money(entry.final_price))} · Etsy quantity ${escapeHtml(entry.listing_quantity || 1)} · Physical quantity ${escapeHtml(entry.physical_quantity || activeEstimate.quantity)} · ${escapeHtml(entry.processing_time)}</span></div>`).join("")}</div>` : '<p>No Etsy listing packages prepared yet.</p>';
    const content = `<article class="estimate-review">
      <header class="review-header"><div><p class="eyebrow">Quote review</p><h2>${escapeHtml(estimate.quote_code)}</h2><small>Submitted ${new Date(estimate.created_at).toLocaleString("en-CA")}</small></div><span class="status-badge status-${escapeHtml(estimate.status)}">${escapeHtml(label(estimate.status))}</span></header>
      ${estimate.requires_manual_review ? '<p class="manual-flag">Manual review required</p>' : ""}
      <section class="review-section"><h3>Project summary</h3>${estimateDetailsMarkup(estimate)}</section>
      <section class="review-section"><h3>Customer notes</h3><p class="notes">${escapeHtml(estimate.notes || "No customer notes provided.")}</p></section>
      <form id="review-form" class="review-form">
        <section class="review-section"><h3>Final Etsy order</h3><div class="form-grid"><label>Final Etsy Price (CAD)<input required name="final_price" inputmode="decimal" value="${finalPrice(estimate).toFixed(2)}" pattern="[0-9]+(?:\\.[0-9]{1,2})?" aria-describedby="price-help"></label><label>Final Quantity<input required name="final_quantity" type="number" min="1" max="999" value="${finalQuantity(estimate)}"></label><label>Etsy Listing Quantity<input required name="listing_quantity" type="number" min="1" max="999" value="${adminConfig.defaultListingQuantity}"><small>This Etsy listing represents the complete custom project.</small></label><label>Processing time override<input name="processing_time_override" maxlength="120" value="${escapeHtml(estimate.processing_time_override || "")}" placeholder="${escapeHtml(processing)}"><small>Leave blank to use the suggested window.</small></label></div><p id="price-help" class="help-text">Positive amount with a maximum of two decimal places.</p></section>
        <section class="review-section"><h3>Private review notes</h3><label>Admin notes<textarea name="admin_notes" rows="3" maxlength="5000">${escapeHtml(estimate.admin_notes || "")}</textarea></label><label>Clarification needed before listing<textarea name="clarification_notes" rows="3" maxlength="3000" placeholder="Leave blank when no clarification is needed.">${escapeHtml(estimate.clarification_notes || "")}</textarea></label><button class="button button-secondary" id="save-review" type="button">Save Review Details</button><p id="save-status" class="form-status" role="status"></p></section>
        <section class="review-section"><h3>Estimate review checklist</h3><div id="review-checklist" class="checklist">${checklistMarkup(estimate)}</div><label class="override-check"><input type="checkbox" name="admin_override"> Admin override: prepare despite unchecked items</label></section>
        <div class="primary-actions"><button class="button button-primary prepare-button" id="prepare-listing" type="submit" disabled>Prepare Etsy Listing</button><button class="button button-secondary" type="button" data-status-action="reviewed">Mark Reviewed</button><button class="button button-secondary" type="button" data-status-action="completed">Mark Completed</button><button class="button button-danger" type="button" data-status-action="declined">Decline</button></div><p id="review-status" class="form-status" role="status">${escapeHtml(successMessage)}</p>
      </form>
      ${generatedPackage ? generatedPackageMarkup(generatedPackage) : ""}
      <section class="review-section"><h3>Etsy listing history</h3>${history}</section>
    </article>`;
    adminShell(content);
    bindReview(generatedPackage);
  }

  function estimateDetailsMarkup(estimate) {
    const dimensions = [estimate.model_width_mm, estimate.model_depth_mm, estimate.model_height_mm].every((value) => Number(value) > 0)
      ? `${Number(estimate.model_width_mm).toFixed(1)} × ${Number(estimate.model_depth_mm).toFixed(1)} × ${Number(estimate.model_height_mm).toFixed(1)} mm`
      : "Not recorded";
    const time = Number(estimate.estimated_production_hours) === Number(estimate.estimated_production_hours_max)
      ? `${Number(estimate.estimated_production_hours).toFixed(2)} hours total`
      : `${Number(estimate.estimated_production_hours).toFixed(2)}–${Number(estimate.estimated_production_hours_max).toFixed(2)} hours total`;
    const rows = [
      ["Customer name", estimate.name || "Not provided"], ["Customer email", estimate.email || "Not provided (Etsy contact)"],
      ["Estimated project price", `${displayPrice(estimate)} CAD`], ["Estimated price per item", `${money(estimate.estimated_price_per_item)} CAD`],
      ["Quantity", estimate.quantity], ["File status", label(estimate.file_status)], ["Uploaded file", estimate.original_file_name || (estimate.file_path ? "Uploaded model" : "Not provided")],
      ["Dimensions", dimensions], ["Size category", label(estimate.size_category)], ["Material", estimate.material || adminConfig.defaultMaterial],
      ["Colours", estimate.colour_count], ["Design level", label(estimate.design_level)], ["Assembly", estimate.assembly_required ? "Required" : "Not required"],
      ["Production time", time], ["Print profile", label(estimate.print_profile)], ["Filament per item", estimate.filament_grams_per_item == null ? "Not available" : `${Number(estimate.filament_grams_per_item).toFixed(1)} g`],
      ["Total material", estimate.estimated_material_grams == null ? "Not available" : `${Number(estimate.estimated_material_grams).toFixed(1)} g including purge`],
      ["Purge allowance", `${Number(estimate.purge_waste_percent || 0)}%`], ["Manual review", estimate.requires_manual_review ? "Required" : "Not required"], ["Current status", label(estimate.status)]
    ];
    const hasDriveFolder = /^https:\/\/drive\.google\.com\/drive\/folders\//.test(estimate.drive_web_view_link || "");
    return `<dl class="estimate-grid">${rows.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><div class="card-actions"><button class="button button-secondary" type="button" data-copy-value="${escapeHtml(estimate.quote_code)}">Copy Quote Code</button>${estimate.email ? `<button class="button button-secondary" type="button" data-copy-value="${escapeHtml(estimate.email)}">Copy Customer Email</button>` : ""}${estimate.file_path ? '<button class="button button-secondary" id="open-file" type="button">Download Uploaded File</button>' : ""}${estimate.file_path && !hasDriveFolder ? '<button class="button button-secondary" id="organize-drive" type="button">Create Drive Quote Folder</button>' : ""}${hasDriveFolder ? `<a class="button button-secondary" href="${escapeHtml(estimate.drive_web_view_link)}" target="_blank" rel="noopener noreferrer">Open Drive Folder</a>` : ""}</div>`;
  }

  function checklistMarkup(estimate) {
    const items = [];
    if (estimate.file_path) items.push("File reviewed", "Dimensions confirmed");
    items.push("Material confirmed", "Colour confirmed", "Quantity confirmed");
    if (estimate.design_level && estimate.design_level !== "none") items.push("Design requirement confirmed");
    items.push("Final price confirmed");
    return items.map((item, index) => `<label><input type="checkbox" name="check_${index}"> ${escapeHtml(item)}</label>`).join("");
  }

  function valuesFromReviewForm() {
    const form = document.querySelector("#review-form");
    const data = Object.fromEntries(new FormData(form));
    const priceText = String(data.final_price || "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText) || Number(priceText) <= 0) throw new Error("Enter a positive final price with no more than two decimal places.");
    const physicalQuantity = Number(data.final_quantity);
    const listingQuantity = Number(data.listing_quantity);
    if (!Number.isInteger(physicalQuantity) || physicalQuantity < 1 || physicalQuantity > 999) throw new Error("Final quantity must be between 1 and 999.");
    if (!Number.isInteger(listingQuantity) || listingQuantity < 1 || listingQuantity > 999) throw new Error("Etsy listing quantity must be between 1 and 999.");
    return {
      finalPrice:Number(priceText), physicalQuantity, listingQuantity,
      adminNotes:String(data.admin_notes || "").trim(), clarificationNotes:String(data.clarification_notes || "").trim(),
      processingOverride:String(data.processing_time_override || "").trim()
    };
  }

  async function saveReviewDetails(showConfirmation = true) {
    const values = valuesFromReviewForm();
    const { data, error } = await client.rpc("admin_save_print_estimate_review", {
      p_estimate_id:activeEstimate.id, p_final_price:values.finalPrice,
      p_final_quantity:values.physicalQuantity, p_admin_notes:values.adminNotes || null,
      p_clarification_notes:values.clarificationNotes || null,
      p_processing_time_override:values.processingOverride || null
    });
    if (error || !data?.length) throw new Error(errorMessage(error, "The review details could not be saved."));
    activeEstimate = data[0];
    if (showConfirmation) document.querySelector("#save-status").textContent = "Review details saved.";
    return values;
  }

  function bindReview(generatedPackage) {
    const form = document.querySelector("#review-form");
    const prepare = document.querySelector("#prepare-listing");
    const updatePrepareState = () => {
      const checks = [...document.querySelectorAll('#review-checklist input[type="checkbox"]')];
      prepare.disabled = !(form.elements.admin_override.checked || checks.every((check) => check.checked));
    };
    form.addEventListener("change", updatePrepareState);
    updatePrepareState();
    document.querySelector("#save-review").addEventListener("click", async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { await saveReviewDetails(); } catch (error) { document.querySelector("#save-status").textContent = error.message; }
      button.disabled = false;
    });
    form.addEventListener("submit", prepareListing);
    document.querySelectorAll("[data-status-action]").forEach((button) => button.addEventListener("click", () => setStatus(button.dataset.statusAction, button)));
    document.querySelector("#open-file")?.addEventListener("click", (event) => openFile(activeEstimate.file_path, event.currentTarget));
    document.querySelector("#organize-drive")?.addEventListener("click", organizeDrive);
    bindCopyButtons();
    if (generatedPackage) document.querySelector("#etsy-package")?.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  async function prepareListing(event) {
    event.preventDefault();
    const status = document.querySelector("#review-status");
    const button = document.querySelector("#prepare-listing");
    button.disabled = true; status.textContent = "Preparing Etsy listing details…";
    try {
      const values = await saveReviewDetails(false);
      const processing = values.processingOverride || listing.suggestProcessing(activeEstimate, adminConfig);
      const prepared = listing.buildPackage(activeEstimate, { ...values, processing }, adminConfig);
      const { data, error } = await client.rpc("admin_prepare_etsy_listing", {
        p_estimate_id:activeEstimate.id, p_generated_title:prepared.title,
        p_generated_description:prepared.description, p_final_price:values.finalPrice,
        p_listing_quantity:values.listingQuantity, p_physical_quantity:values.physicalQuantity,
        p_processing_time:prepared.processing
      });
      if (error || !data?.length) throw new Error(errorMessage(error, "The Etsy listing package could not be saved."));
      activeEstimate = { ...activeEstimate, final_price:values.finalPrice, final_quantity:values.physicalQuantity, status:"etsy_prepared", etsy_prepared_at:new Date().toISOString(), clarification_notes:values.clarificationNotes, processing_time_override:values.processingOverride || null };
      activeHistory = [data[0], ...activeHistory];
      renderEstimateReview({ ...prepared, reply:listing.buildReply(activeEstimate, values.finalPrice, values.clarificationNotes) }, "Etsy listing package prepared and saved.");
    } catch (error) {
      status.textContent = error.message || "The Etsy listing package could not be prepared.";
      button.disabled = false;
    }
  }

  function generatedPackageMarkup(prepared) {
    return `<section id="etsy-package" class="etsy-package"><p class="eyebrow">Etsy private listing</p><h3>Prepared listing details</h3><div class="package-field"><span>Title</span><strong id="etsy-title">${escapeHtml(prepared.title)}</strong><button class="copy-button" type="button" data-copy-target="etsy-title">Copy Title</button></div><div class="package-field"><span>Price</span><strong id="etsy-price">${escapeHtml(prepared.price)}</strong><button class="copy-button" type="button" data-copy-target="etsy-price">Copy Price</button></div><div class="package-field"><span>Listing quantity</span><strong>${escapeHtml(prepared.listingQuantity)}</strong><small>This listing represents the complete custom project. Physical quantity: ${escapeHtml(prepared.physicalQuantity)}.</small></div><div class="package-field"><span>Processing time</span><strong id="etsy-processing">${escapeHtml(prepared.processing)}</strong><button class="copy-button" type="button" data-copy-target="etsy-processing">Copy Processing Time</button></div><div class="package-field wide"><span>Description</span><textarea id="etsy-description" readonly rows="12">${escapeHtml(prepared.description)}</textarea><button class="copy-button" type="button" data-copy-target="etsy-description">Copy Description</button></div><div class="package-field wide"><span>Customer Etsy reply</span><textarea id="etsy-reply" readonly rows="8">${escapeHtml(prepared.reply)}</textarea><button class="copy-button" type="button" data-copy-target="etsy-reply">Copy Etsy Reply</button></div><div class="package-actions"><button class="button button-primary" type="button" data-copy-target="etsy-all">Copy All Etsy Details</button><a class="button button-secondary" href="${escapeHtml(config.etsyUrl || "https://www.etsy.com/shop/MucciProducts")}" target="_blank" rel="noopener noreferrer">Open Etsy Messages</a></div><textarea id="etsy-all" class="visually-hidden" readonly>${escapeHtml(prepared.summary)}</textarea><p id="copy-status" class="form-status" role="status"></p></section>`;
  }

  async function setStatus(statusValue, button) {
    button.disabled = true;
    const { data, error } = await client.rpc("admin_set_print_estimate_status", { p_estimate_id:activeEstimate.id, p_status:statusValue });
    if (error || !data?.length) { document.querySelector("#review-status").textContent = errorMessage(error, "The estimate status could not be changed."); button.disabled = false; return; }
    activeEstimate = data[0];
    renderEstimateReview(null, `Status changed to ${label(statusValue)}.`);
  }

  async function copyText(text, button) {
    const original = button.textContent;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else {
        const area = document.createElement("textarea"); area.value = text; area.style.position = "fixed"; area.style.opacity = "0"; document.body.appendChild(area); area.select();
        if (!document.execCommand("copy")) throw new Error("Copy failed");
        area.remove();
      }
      button.textContent = "Copied";
      document.querySelector("#copy-status")?.replaceChildren(document.createTextNode("Copied"));
    } catch {
      document.querySelector("#copy-status")?.replaceChildren(document.createTextNode("Copy failed. Select the text and copy it manually."));
    }
    window.setTimeout(() => { button.textContent = original; }, 1400);
  }

  function bindCopyButtons() {
    document.querySelectorAll("[data-copy-target]").forEach((button) => button.addEventListener("click", () => {
      const target = document.getElementById(button.dataset.copyTarget);
      copyText(target?.value ?? target?.textContent ?? "", button);
    }));
    document.querySelectorAll("[data-copy-value]").forEach((button) => button.addEventListener("click", () => copyText(button.dataset.copyValue, button)));
  }

  async function connectDrive(event) {
    const button = event.currentTarget;
    const status = document.querySelector("#drive-connection-status");
    button.disabled = true; status.hidden = false; status.textContent = "Opening Google authorization…";
    const { data:{ session } } = await client.auth.getSession();
    if (!session) { status.textContent = "Sign in again before connecting Google Drive."; button.disabled = false; return; }
    try {
      const response = await fetch("/api/google-drive-connect", { method:"POST", headers:{ Authorization:`Bearer ${session.access_token}` } });
      const payload = await response.json();
      if (!response.ok || !payload.authorizationUrl) throw new Error("Google Drive connection could not be started.");
      window.location.assign(payload.authorizationUrl);
    } catch {
      status.textContent = "Google Drive connection could not be started.";
      button.disabled = false;
    }
  }

  async function organizeDrive(event) {
    const button = event.currentTarget;
    const status = document.querySelector("#review-status");
    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Creating Drive folder…";
    status.textContent = "Creating the private quote folder and copying the uploaded model…";
    try {
      const response = await fetch("/api/estimate-drive", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ quoteCode:activeEstimate.quote_code, notificationToken:activeEstimate.notification_token })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || (!payload.mirrored && !payload.organized && !payload.accepted)) {
        throw new Error("The private Drive copy could not be created.");
      }
      await findEstimate(activeEstimate.quote_code);
    } catch {
      status.textContent = "The private Drive copy could not be created. Confirm Google Drive is connected and try again.";
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function openFile(path, button) {
    const original = button.textContent;
    button.disabled = true; button.textContent = "Creating secure link…";
    const { data, error } = await client.storage.from("print-estimate-files").createSignedUrl(path, 60);
    button.disabled = false; button.textContent = original;
    if (error || !data?.signedUrl) { document.querySelector("#review-status").textContent = "The private file link could not be created. It may have expired or the file may be missing."; return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  init();
})();
