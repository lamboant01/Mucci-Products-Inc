(function () {
  "use strict";

  const root = document.querySelector("#estimates-admin");
  const config = window.MUCCI_CONFIG || {};
  const statuses = ["pending", "reviewed", "etsy_prepared", "awaiting_customer", "accepted", "in_production", "completed", "declined"];
  const quotePattern = /^MP-[A-HJ-NP-Z2-9]{5}$/;
  let activeEstimate = null;
  let activeHistory = [];
  let activeFilter = "all";

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const money = (value) => new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" }).format(Number(value));
  const label = (value) => ({ standard:"Standard Detail", draft:"Efficient Larger Prints", pending:"New", reviewed:"Reviewing", etsy_prepared:"Quoted", awaiting_customer:"Awaiting Customer", accepted:"Accepted", in_production:"In Production", declined:"Cancelled", ready:"Ready to Print", modify:"Needs Modifications", design:"Design Required", DESIGN_ONLY:"3D Design Only", DESIGN_AND_PRINT:"3D Design + 3D Printing", PRINT_ONLY:"3D Printing", MODIFY_AND_PRINT:"3D Model Modification + 3D Printing" })[value]
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

  async function apiRequest(action, values = {}) {
    const response = await fetch("/api/admin-estimates", {
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

  async function init() {
    const quote = quoteFromUrl();
    if (quote && quotePattern.test(quote)) await findEstimate(quote); else await loadRecent();
  }

  function adminShell(content, notice = "") {
    const driveNotice = driveStatus() === "connected" ? "Google Drive is connected." : driveStatus() === "error" ? "Google Drive could not be connected. Check the OAuth redirect URI and try again." : "";
    root.innerHTML = `<div class="admin-tools">
      <div class="dashboard-user"><p>Protected estimate administration</p><div class="card-actions"><a class="button button-secondary" href="${escapeHtml(config.etsyMessagesUrl || "https://www.etsy.com/messages?ref=seller-platform-mcnav")}" target="_blank" rel="noopener noreferrer">Open Etsy Messages</a><button id="connect-drive" class="button button-secondary" type="button">Connect Google Drive</button></div></div>
      <p id="drive-connection-status" class="dashboard-notice" role="status"${driveNotice ? "" : " hidden"}>${escapeHtml(driveNotice)}</p>
      <section class="find-estimate" aria-labelledby="find-estimate-title"><p class="eyebrow">Find Estimate</p><h2 id="find-estimate-title">Paste a customer quote code</h2><form id="search-form" class="admin-search"><input name="code" value="${escapeHtml(activeEstimate?.quote_code || quoteFromUrl())}" maxlength="32" placeholder="MP-A42K7" aria-label="Quote code" autocapitalize="characters" autocomplete="off"><button class="button button-primary" type="submit">Find Quote</button><button class="button button-secondary" id="show-recent" type="button">Show Recent</button></form><p id="search-status" class="form-status" role="status">${escapeHtml(notice)}</p></section>
      ${content}
    </div>`;
    bindShell();
  }

  function bindShell() {
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
    try {
      const payload = await apiRequest("find", { quoteCode:quote });
      if (!payload.estimate) { adminShell('<section class="empty-state">Quote code not found.</section>', "Quote code not found."); return; }
      activeEstimate = payload.estimate;
      activeHistory = payload.history || [];
      renderEstimateReview();
    } catch (error) {
      adminShell('<section class="empty-state">The estimate could not be loaded.</section>', errorMessage(error, "The estimate could not be loaded."));
    }
  }

  async function loadRecent(filter = activeFilter) {
    activeEstimate = null;
    activeHistory = [];
    activeFilter = filter;
    setQuoteUrl("");
    adminShell('<p class="loading-state" role="status">Loading recent estimates…</p>');
    try {
      const payload = await apiRequest("recent", { filter });
      renderRecent(payload.estimates || []);
    } catch (error) {
      adminShell('<section class="empty-state">Recent estimates could not be loaded.</section>', errorMessage(error, "Recent estimates could not be loaded."));
    }
  }

  function renderRecent(estimates) {
    const filters = ["all", ...statuses, "manual_review"];
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
    const processing = estimate.processing_time_override || estimate.suggested_processing || "Manual processing time selection recommended.";
    const history = activeHistory.length ? `<div class="history-list">${activeHistory.map((entry) => `<div><span><strong>${new Date(entry.generated_at).toLocaleString("en-CA")}</strong>${entry.generated_title ? `<small>${escapeHtml(entry.generated_title)}</small>` : ""}</span><span>${escapeHtml(money(entry.final_price))} · Etsy quantity ${escapeHtml(entry.listing_quantity || 1)} · Physical quantity ${escapeHtml(entry.physical_quantity || activeEstimate.quantity)} · ${escapeHtml(entry.processing_time)}</span></div>`).join("")}</div>` : '<p>No Etsy listing packages prepared yet.</p>';
    const content = `<article class="estimate-review">
      <header class="review-header"><div><p class="eyebrow">Quote review</p><h2>${escapeHtml(estimate.quote_code)}</h2><small>Submitted ${new Date(estimate.created_at).toLocaleString("en-CA")}</small></div><span class="status-badge status-${escapeHtml(estimate.status)}">${escapeHtml(label(estimate.status))}</span></header>
      ${estimate.requires_manual_review ? '<p class="manual-flag">Manual review required</p>' : ""}
      <section class="review-section"><h3>Project summary</h3>${estimateDetailsMarkup(estimate)}</section>
      <section class="review-section"><h3>Customer notes</h3><p class="notes">${escapeHtml(estimate.notes || "No customer notes provided.")}</p></section>
      <form id="review-form" class="review-form">
        <section class="review-section"><h3>Final Etsy order</h3><div class="form-grid"><label>Final Etsy Price (CAD)<input required name="final_price" inputmode="decimal" value="${finalPrice(estimate).toFixed(2)}" pattern="[0-9]+(?:\\.[0-9]{1,2})?" aria-describedby="price-help"></label><label>Final Quantity<input required name="final_quantity" type="number" min="1" max="999" value="${finalQuantity(estimate)}"></label><label>Etsy Listing Quantity<input required name="listing_quantity" type="number" min="1" max="999" value="1"><small>This Etsy listing represents the complete custom project.</small></label><label>Processing time override<input name="processing_time_override" maxlength="120" value="${escapeHtml(estimate.processing_time_override || "")}" placeholder="${escapeHtml(processing)}"><small>Leave blank to use the suggested window.</small></label></div><p id="price-help" class="help-text">Positive amount with a maximum of two decimal places.</p></section>
        <section class="review-section"><h3>Private review notes</h3><label>Admin notes<textarea name="admin_notes" rows="3" maxlength="5000">${escapeHtml(estimate.admin_notes || "")}</textarea></label><label>Clarification needed before listing<textarea name="clarification_notes" rows="3" maxlength="3000" placeholder="Leave blank when no clarification is needed.">${escapeHtml(estimate.clarification_notes || "")}</textarea></label><button class="button button-secondary" id="save-review" type="button">Save Review Details</button><p id="save-status" class="form-status" role="status"></p></section>
        <section class="review-section"><h3>Estimate review checklist</h3><div id="review-checklist" class="checklist">${checklistMarkup(estimate)}</div><label class="override-check"><input type="checkbox" name="admin_override"> Admin override: prepare despite unchecked items</label></section>
        <div class="primary-actions"><button class="button button-primary prepare-button" id="prepare-listing" type="submit" disabled>Prepare Etsy Listing</button><button class="button button-secondary" type="button" data-status-action="reviewed">Mark Reviewed</button><button class="button button-secondary" type="button" data-status-action="completed">Mark Completed</button><button class="button button-danger" type="button" data-status-action="declined">Decline</button></div>
        <div class="status-control"><label>Internal status<select id="internal-status">${statuses.map((item) => `<option value="${item}"${estimate.status === item ? " selected" : ""}>${escapeHtml(label(item))}</option>`).join("")}</select></label><button class="button button-secondary" id="update-status" type="button">Update Status</button></div><p id="review-status" class="form-status" role="status">${escapeHtml(successMessage)}</p>
      </form>
      ${generatedPackage ? generatedPackageMarkup(generatedPackage) : ""}
      <section class="review-section"><h3>Etsy listing history</h3>${history}</section>
    </article>`;
    adminShell(content);
    bindReview(generatedPackage);
  }

  function estimateDetailsMarkup(estimate) {
    const printSettings = Array.isArray(estimate.model_files) ? estimate.model_files.find((file) => file?.print_settings)?.print_settings : null;
    const submittedDimensions = [estimate.submitted_length, estimate.submitted_width, estimate.submitted_height].every((value) => Number(value) > 0)
      ? `${Number(estimate.submitted_length)} × ${Number(estimate.submitted_width)} × ${Number(estimate.submitted_height)} ${estimate.dimension_unit}` : "";
    const dimensions = submittedDimensions || ([estimate.model_width_mm, estimate.model_depth_mm, estimate.model_height_mm].every((value) => Number(value) > 0)
      ? `${Number(estimate.model_width_mm).toFixed(1)} × ${Number(estimate.model_depth_mm).toFixed(1)} × ${Number(estimate.model_height_mm).toFixed(1)} mm`
      : "Not recorded");
    const time = Number(estimate.estimated_production_hours) === Number(estimate.estimated_production_hours_max)
      ? `${Number(estimate.estimated_production_hours).toFixed(2)} hours total`
      : `${Number(estimate.estimated_production_hours).toFixed(2)}–${Number(estimate.estimated_production_hours_max).toFixed(2)} hours total`;
    const rows = [
      ["Customer name", estimate.name || "Not provided"], ["Customer email", estimate.email || "Not provided (Etsy contact)"],
      ["Service selected", label(estimate.service_intent)], ["3D design estimate", `${displayPrice({ estimated_price:estimate.design_estimate_min, estimated_price_max:estimate.design_estimate_max })} CAD`],
      [estimate.service_intent === "DESIGN_AND_PRINT" ? "Preliminary print estimate" : "Physical print estimate", estimate.print_estimate_min == null ? "Not included" : `${displayPrice({ estimated_price:estimate.print_estimate_min, estimated_price_max:estimate.print_estimate_max })} CAD`],
      ["Estimated project total", `${displayPrice({ estimated_price:estimate.estimated_total_min ?? estimate.estimated_price, estimated_price_max:estimate.estimated_total_max ?? estimate.estimated_price_max })} CAD`],
      ["File status", label(estimate.file_status)], ["Uploaded file", estimate.original_file_name || (estimate.file_path ? "Uploaded model" : "Not provided")],
      ["Reference images", `${Array.isArray(estimate.reference_files) ? estimate.reference_files.length : 0} attached`],
      ["Dimensions", dimensions],
      ...(estimate.file_status === "design" ? [
        ["Project category", label(estimate.application_category || "other")],
        ["Intended use", estimate.application_description || "Not recorded"],
        ["Estimated construction", label(estimate.ai_geometry_classification || "unknown")],
        ["Geometry utilization factor", estimate.geometry_utilization_factor == null ? "Not recorded" : `${(Number(estimate.geometry_utilization_factor) * 100).toFixed(1)}%`],
        ["Recommended infill", estimate.recommended_infill_percent == null ? "Not recorded" : `${Number(estimate.recommended_infill_percent)}%`],
        ["Recommended wall loops", estimate.recommended_wall_loops ?? "Not recorded"],
        ["Recommended top/bottom layers", estimate.recommended_top_bottom_layers ?? "Not recorded"],
        ["Estimate method", estimate.estimation_method === "ai" ? "AI classified" : estimate.estimation_method === "fallback" ? "Deterministic fallback" : "Not recorded"]
      ] : []),
      ["Split and assembly approved", estimate.split_and_assembly_accepted ? `Yes — approximately ${Number(estimate.estimated_section_count || 1)} printable sections` : "Not required"],
      ["Design level", label(estimate.design_level)]
    ];
    if (estimate.service_intent !== "DESIGN_ONLY") rows.push(
      ["Quantity", estimate.quantity], ["Size category", label(estimate.size_category)], ["Material", estimate.material || "PLA"],
      ["Colours", estimate.colour_count], ["Wanted colours", estimate.desired_colours || "Not provided"],
      ["Assembly", estimate.assembly_required ? "Required" : "Not required"],
      ["Production time", time], ["Print profile", label(estimate.print_profile)],
      ...(printSettings ? [["Infill", `${Number(printSettings.infill_percent)}%`], ["Wall loops", Number(printSettings.wall_loops)], ["Infill pattern", label(printSettings.infill_pattern)]] : []),
      ["Filament per item", estimate.filament_grams_per_item == null ? "Not available" : `${Number(estimate.filament_grams_per_item).toFixed(1)} g`],
      ["Total material", estimate.estimated_material_grams == null ? "Not available" : `${Number(estimate.estimated_material_grams).toFixed(1)} g including purge`],
      ["Purge allowance", `${Number(estimate.purge_waste_percent || 0)}%`]
    );
    rows.push(["Manual review", estimate.requires_manual_review ? "Required" : "Not required"], ["Current status", label(estimate.status)]);
    const hasDriveFolder = /^https:\/\/drive\.google\.com\/drive\/folders\//.test(estimate.drive_web_view_link || "");
    const hasAttachments = Boolean(estimate.file_path || estimate.reference_files?.length);
    return `<dl class="estimate-grid">${rows.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl><div class="card-actions"><button class="button button-secondary" type="button" data-copy-value="${escapeHtml(estimate.quote_code)}">Copy Quote Code</button>${estimate.email ? `<button class="button button-secondary" type="button" data-copy-value="${escapeHtml(estimate.email)}">Copy Customer Email</button>` : ""}${estimate.file_path ? '<button class="button button-secondary" id="open-file" type="button">Download Uploaded File</button>' : ""}${hasAttachments && !hasDriveFolder ? '<button class="button button-secondary" id="organize-drive" type="button">Create Drive Quote Folder</button>' : ""}${hasDriveFolder ? `<a class="button button-secondary" href="${escapeHtml(estimate.drive_web_view_link)}" target="_blank" rel="noopener noreferrer">Open Drive Folder</a>` : ""}</div>`;
  }

  function checklistMarkup(estimate) {
    const items = [];
    if (estimate.file_path) items.push("File reviewed", "Dimensions confirmed");
    if (estimate.reference_files?.length) items.push("Reference images reviewed");
    if (estimate.service_intent !== "DESIGN_ONLY") items.push("Material confirmed", "Colour confirmed", "Quantity confirmed");
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
    const payload = await apiRequest("save", { estimateId:activeEstimate.id, ...values });
    if (!payload.estimate) throw new Error("The review details could not be saved.");
    activeEstimate = payload.estimate;
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
    document.querySelector("#update-status").addEventListener("click", (event) => setStatus(document.querySelector("#internal-status").value, event.currentTarget));
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
      const values = valuesFromReviewForm();
      const payload = await apiRequest("prepare", { estimateId:activeEstimate.id, ...values });
      if (!payload.estimate || !payload.prepared || !payload.snapshot) throw new Error("The Etsy listing package could not be saved.");
      activeEstimate = payload.estimate;
      activeHistory = [payload.snapshot, ...activeHistory];
      renderEstimateReview(payload.prepared, "Etsy listing package prepared and saved.");
    } catch (error) {
      status.textContent = error.message || "The Etsy listing package could not be prepared.";
      button.disabled = false;
    }
  }

  function generatedPackageMarkup(prepared) {
    return `<section id="etsy-package" class="etsy-package"><p class="eyebrow">Etsy private listing</p><h3>Prepared listing details</h3><div class="package-field"><span>Title</span><strong id="etsy-title">${escapeHtml(prepared.title)}</strong><button class="copy-button" type="button" data-copy-target="etsy-title">Copy Title</button></div><div class="package-field"><span>Price</span><strong id="etsy-price">${escapeHtml(prepared.price)}</strong><button class="copy-button" type="button" data-copy-target="etsy-price">Copy Price</button></div><div class="package-field"><span>Listing quantity</span><strong>${escapeHtml(prepared.listingQuantity)}</strong><small>This listing represents the complete custom project. Physical quantity: ${escapeHtml(prepared.physicalQuantity)}.</small></div><div class="package-field"><span>Processing time</span><strong id="etsy-processing">${escapeHtml(prepared.processing)}</strong><button class="copy-button" type="button" data-copy-target="etsy-processing">Copy Processing Time</button></div><div class="package-field wide"><span>Description</span><textarea id="etsy-description" readonly rows="12">${escapeHtml(prepared.description)}</textarea><button class="copy-button" type="button" data-copy-target="etsy-description">Copy Description</button></div><div class="package-field wide"><span>Customer Etsy reply</span><textarea id="etsy-reply" readonly rows="8">${escapeHtml(prepared.reply)}</textarea><button class="copy-button" type="button" data-copy-target="etsy-reply">Copy Etsy Reply</button></div><div class="package-actions"><button class="button button-primary" type="button" data-copy-target="etsy-all">Copy All Etsy Details</button><a class="button button-secondary" href="${escapeHtml(config.etsyMessagesUrl || "https://www.etsy.com/messages?ref=seller-platform-mcnav")}" target="_blank" rel="noopener noreferrer">Open Etsy Messages</a></div><textarea id="etsy-all" class="visually-hidden" readonly>${escapeHtml(prepared.summary)}</textarea><p id="copy-status" class="form-status" role="status"></p></section>`;
  }

  async function setStatus(statusValue, button) {
    button.disabled = true;
    try {
      const payload = await apiRequest("status", { estimateId:activeEstimate.id, status:statusValue });
      if (!payload.estimate) throw new Error("The estimate status could not be changed.");
      activeEstimate = payload.estimate;
      renderEstimateReview(null, `Status changed to ${label(statusValue)}.`);
    } catch (error) {
      document.querySelector("#review-status").textContent = errorMessage(error, "The estimate status could not be changed.");
      button.disabled = false;
    }
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
    try {
      const response = await fetch("/api/google-drive-connect", { method:"POST", credentials:"same-origin" });
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
    status.textContent = "Creating the private quote folder and copying the uploaded files…";
    try {
      const payload = await apiRequest("mirror_drive", { estimateId:activeEstimate.id });
      if (!payload.mirrored && !payload.organized && !payload.accepted) {
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
    try {
      const payload = await apiRequest("signed_file", { estimateId:activeEstimate.id });
      if (!payload.signedUrl) throw new Error("Missing signed URL.");
      window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      document.querySelector("#review-status").textContent = "The private file link could not be created. It may have expired or the file may be missing.";
    }
    button.disabled = false; button.textContent = original;
  }

  init();
})();
