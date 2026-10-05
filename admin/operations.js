(function () {
  "use strict";

  const root = document.querySelector("#operations-admin");
  if (!root) return;
  const section = root.dataset.section || "dashboard";
  const labels = {
    pending:"New", reviewed:"Reviewing", etsy_prepared:"Quoted", awaiting_customer:"Awaiting customer",
    accepted:"Accepted", in_production:"In production", completed:"Completed", declined:"Cancelled"
  };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const date = (value) => value ? new Date(value).toLocaleString("en-CA", { dateStyle:"medium", timeStyle:"short" }) : "Not available";
  const money = (value) => Number(value || 0).toLocaleString("en-CA", { style:"currency", currency:"CAD" });
  const fileSize = (value) => {
    const bytes = Number(value || 0);
    if (!bytes) return "Size unavailable";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };
  const status = (value) => labels[value] || String(value || "Unknown").replaceAll("_", " ");
  const estimateUrl = (code) => `/admin/estimates?quote=${encodeURIComponent(code)}`;
  const projectUrl = (id) => `/admin/orders?project=${encodeURIComponent(id)}`;
  const service = (value) => ({ PRINT_ONLY:"Print only", DESIGN_ONLY:"Design only", DESIGN_AND_PRINT:"Design and print" })[value] || status(value);

  async function api(endpoint, body) {
    const response = await fetch(endpoint, {
      method:"POST", credentials:"same-origin", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body)
    });
    if (response.status === 404) {
      window.location.reload();
      throw new Error("Your administrator session is no longer available.");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The administrative request could not be completed.");
    return payload;
  }

  function badge(value) {
    return `<span class="status-badge status-${escapeHtml(value)}">${escapeHtml(status(value))}</span>`;
  }

  function requestRows(items, empty = "No records found.") {
    if (!items.length) return `<div class="empty-state">${escapeHtml(empty)}</div>`;
    return `<div class="responsive-table"><table><thead><tr><th>Shopify / Quote</th><th>Customer</th><th>Service</th><th>Project</th><th>Payment / fulfillment</th><th>Files</th><th>Submitted</th><th>Total</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.shopify_order_number || item.shopify_draft_order_name || "No Shopify order")}</strong><small>${escapeHtml(item.quote_code)}</small></td><td>${escapeHtml(item.name || "Name not provided")}<small>${escapeHtml(item.email || "No email provided")}</small></td><td>${escapeHtml(service(item.service_intent || item.file_status))}</td><td>${badge(item.status)}</td><td>${escapeHtml(status(item.shopify_payment_status || item.shopify_draft_order_live_status || item.shopify_draft_order_status || "Not linked"))}<small>${escapeHtml(item.shopify_fulfillment_status ? status(item.shopify_fulfillment_status) : "")}</small></td><td>${escapeHtml(fileCount(item))}</td><td>${escapeHtml(date(item.created_at))}</td><td>${escapeHtml(money(item.final_price || item.estimated_total_max || item.estimated_price_max || item.estimated_price))}</td><td><a class="table-link" href="${projectUrl(item.id)}">Open project</a></td></tr>`).join("")}</tbody></table></div>`;
  }

  function fileCount(item) {
    const models = Math.max(Number(item.uploaded_file_count || 0), Array.isArray(item.model_files) ? item.model_files.filter((file) => file?.path).length : 0, item.file_path ? 1 : 0);
    return models + (Array.isArray(item.reference_files) ? item.reference_files.length : 0);
  }

  function activityList(items, empty = "No administrative activity has been recorded yet.") {
    if (!items.length) return `<div class="empty-state">${escapeHtml(empty)}</div>`;
    return `<ol class="activity-list">${items.map((item) => `<li><span class="activity-icon" aria-hidden="true"></span><div><strong>${escapeHtml(item.summary)}</strong><small>${escapeHtml(item.subject_type.replaceAll("_", " "))} · ${escapeHtml(date(item.created_at))}</small></div></li>`).join("")}</ol>`;
  }

  function renderDashboard(data) {
    const cards = [
      ["New requests", data.totals.newRequests, "/admin/estimates"],
      ["Awaiting action", data.totals.awaitingAction, "/admin/estimates"],
      ["Active orders", data.totals.activeOrders, "/admin/orders"],
      ["Completed orders", data.totals.completedOrders, "/admin/orders"],
      ["Customers", data.totals.customers, "/admin/customers"],
      ["Active digital cards", data.totals.activeCards, "/admin/cards"]
    ];
    root.innerHTML = `<div class="metric-grid">${cards.map(([label, value, href]) => `<a class="metric-card" href="${href}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>View details</small></a>`).join("")}</div>
      ${data.totals.manualReview ? `<div class="operations-alert"><strong>${escapeHtml(data.totals.manualReview)} request${data.totals.manualReview === 1 ? "" : "s"} require manual review.</strong><a href="/admin/estimates">Review requests</a></div>` : ""}
      <div class="operations-grid"><section class="operations-panel wide"><div class="section-heading"><div><p class="eyebrow">Inbox</p><h2>Requests awaiting action</h2></div><a href="/admin/estimates">All requests</a></div>${requestRows(data.actionRequired, "Nothing is waiting for action.")}</section>
      <section class="operations-panel"><div class="section-heading"><div><p class="eyebrow">Latest</p><h2>Recent customers</h2></div><a href="/admin/customers">All customers</a></div>${customerCards(data.customers.slice(0, 5))}</section>
      <section class="operations-panel"><div class="section-heading"><div><p class="eyebrow">Audit</p><h2>Recent activity</h2></div><a href="/admin/activity">Full activity</a></div>${data.auditAvailable ? activityList(data.activity.slice(0, 6)) : migrationNotice()}</section></div>`;
  }

  function customerCards(items) {
    if (!items.length) return '<div class="empty-state">No customer submissions yet.</div>';
    return `<div class="compact-list">${items.map((customer) => `<article><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email || "Etsy contact only")}</small></div><span>${escapeHtml(customer.requestCount)} request${customer.requestCount === 1 ? "" : "s"}</span></article>`).join("")}</div>`;
  }

  function controls(placeholder, filters = "") {
    return `<div class="list-controls"><label class="search-control"><span class="visually-hidden">Search</span><input id="operations-search" type="search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label>${filters}</div><p id="result-count" class="result-count" role="status"></p>`;
  }

  function renderOrders(data) {
    const selectedProject = new URLSearchParams(window.location.search).get("project");
    if (selectedProject) return renderProject(selectedProject);
    const shopifyNotice = data.shopify?.orderAccess === "read_orders_required"
      ? '<div class="operations-alert"><strong>Shopify order status needs read_orders.</strong><span>Draft Orders are linked, but completed order numbers, payment, and fulfillment need the Shopify app to be granted read_orders.</span></div>'
      : data.shopify?.orderAccess === "unavailable"
        ? '<div class="operations-alert"><strong>Shopify status is temporarily unavailable.</strong><span>Stored projects and private files remain available; live order status could not be refreshed.</span></div>'
        : data.shopify?.configured === false
          ? '<div class="operations-alert"><strong>Shopify reconciliation is not configured.</strong><span>Add the server-only Shopify variables to show live order numbers, payment, and fulfillment.</span></div>'
          : "";
    root.innerHTML = `${shopifyNotice}${controls("Search quote, Shopify order, customer, email, or project ID", '<select id="status-filter" aria-label="Filter by project status"><option value="all">All project statuses</option><option value="pending">New</option><option value="reviewed">Reviewing</option><option value="accepted">Accepted</option><option value="in_production">In production</option><option value="completed">Completed</option><option value="declined">Cancelled</option></select><select id="service-filter" aria-label="Filter by service"><option value="all">All services</option><option value="PRINT_ONLY">Print only</option><option value="DESIGN_ONLY">Design only</option><option value="DESIGN_AND_PRINT">Design and print</option></select>')}<div id="operations-results"></div>`;
    bindFilter(data.orders, (item, query, selected) => {
      const serviceFilter = document.querySelector("#service-filter")?.value || "all";
      return (selected === "all" || item.status === selected)
        && (serviceFilter === "all" || item.service_intent === serviceFilter)
        && [item.id, item.quote_code, item.shopify_order_number, item.shopify_draft_order_name, item.name, item.email, item.material, item.status, item.service_intent, item.shopify_payment_status, item.shopify_fulfillment_status, item.shopify_draft_order_live_status].join(" ").toLowerCase().includes(query);
    }, requestRows, null, ["#service-filter"]);
  }

  function detailRows(rows) {
    return `<dl class="project-detail-grid">${rows.map(([term, value]) => `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value == null || value === "" ? "Not recorded" : value)}</dd></div>`).join("")}</dl>`;
  }

  function additionalRows(estimate) {
    const alreadyShown = new Set([
      "id", "quote_code", "service_intent", "file_status", "quantity", "submitted_length", "submitted_width", "submitted_height", "dimension_unit",
      "material", "desired_colours", "colour_count", "total_print_hours", "estimated_production_hours", "total_filament_grams", "estimated_material_grams",
      "created_at", "updated_at", "estimated_total_max", "estimated_price_max", "final_price", "manufacturing_total", "design_fee", "assembly_fee", "shipping_amount",
      "name", "email", "application_description", "notes", "admin_notes", "clarification_notes", "shopify_draft_order_id", "shopify_draft_order_name",
      "shopify_order_id", "shopify_order_number", "shopify_payment_status", "shopify_fulfillment_status", "shopify_draft_order_live_status",
      "shopify_draft_order_status", "shopify_admin_url", "shopify_order_access", "model_files", "reference_files", "file_path", "original_file_name",
      "drive_model_files", "drive_reference_files", "drive_file_id", "drive_web_view_link"
    ]);
    return Object.entries(estimate)
      .filter(([key, value]) => !alreadyShown.has(key) && value != null && value !== "" && typeof value !== "object")
      .map(([key, value]) => [key.replaceAll("_", " "), typeof value === "boolean" ? (value ? "Yes" : "No") : value]);
  }

  function dimensions(estimate) {
    if (![estimate.submitted_length, estimate.submitted_width, estimate.submitted_height].every((value) => Number(value) > 0)) return "Not recorded";
    return `${estimate.submitted_length} × ${estimate.submitted_width} × ${estimate.submitted_height} ${estimate.dimension_unit || ""}`.trim();
  }

  function renderProjectFiles(project) {
    if (!project.files.length) return '<div class="empty-state">No uploaded customer files are recorded for this project.</div>';
    return `<div class="project-files">${project.files.map((file) => `<article><div><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.extension.toUpperCase() || "FILE")} · ${escapeHtml(fileSize(file.sizeBytes))} · ${escapeHtml(date(file.uploadedAt))}</small></div><div class="table-actions">${file.viewable ? `<button class="table-link project-file" type="button" data-path="${escapeHtml(file.path)}" data-download="false">View</button>` : ""}<button class="table-link project-file" type="button" data-path="${escapeHtml(file.path)}" data-download="true">Download</button></div></article>`).join("")}</div>`;
  }

  async function renderProject(estimateId) {
    root.innerHTML = '<div class="loading-state" role="status">Loading project…</div>';
    try {
      const project = await api("/api/admin-projects", { action:"load", estimateId });
      const estimate = project.estimate;
      const orderLabel = estimate.shopify_order_number || estimate.shopify_draft_order_name || "No Shopify order";
      const settings = Array.isArray(estimate.model_files) ? estimate.model_files.find((item) => item?.print_settings)?.print_settings : null;
      root.innerHTML = `<a class="project-back" href="/admin/orders">← All projects</a>
        <article class="project-detail"><header class="project-detail-header"><div><p class="eyebrow">Order / project</p><h2>${escapeHtml(orderLabel)} · ${escapeHtml(estimate.quote_code)}</h2><p>${escapeHtml(estimate.name || "Name not provided")} · ${escapeHtml(estimate.email || "Email not provided")}</p></div><div class="project-header-status">${badge(estimate.status)}<span>${escapeHtml(status(estimate.shopify_payment_status || estimate.shopify_draft_order_live_status || estimate.shopify_draft_order_status || "Not linked"))}</span>${estimate.shopify_fulfillment_status ? `<span>${escapeHtml(status(estimate.shopify_fulfillment_status))}</span>` : ""}</div></header>
        <div class="project-actions"><a class="button button-secondary" href="${estimateUrl(estimate.quote_code)}">Open estimate review</a>${estimate.shopify_admin_url ? `<a class="button button-primary" href="${escapeHtml(estimate.shopify_admin_url)}" target="_blank" rel="noopener noreferrer">Open Shopify Order</a>` : ""}</div>
        <section><h3>Project details</h3>${detailRows([["Project ID", estimate.id], ["Quote code", estimate.quote_code], ["Service", service(estimate.service_intent)], ["File / modification status", status(estimate.file_status)], ["Quantity", estimate.quantity], ["Dimensions", dimensions(estimate)], ["Material", estimate.material], ["Colours", estimate.desired_colours || estimate.colour_count], ["Estimated print hours", estimate.total_print_hours ?? estimate.estimated_production_hours], ["Filament weight", estimate.total_filament_grams ?? estimate.estimated_material_grams], ["Infill", settings?.infill_percent == null ? null : `${settings.infill_percent}%`], ["Wall count", settings?.wall_loops], ["Created", date(estimate.created_at)], ["Updated", date(estimate.updated_at)]])}</section>
        <section><h3>Pricing / estimate</h3>${detailRows([["Estimated total", money(estimate.estimated_total_max ?? estimate.estimated_price_max)], ["Final price", estimate.final_price == null ? "Not set" : money(estimate.final_price)], ["Manufacturing", estimate.manufacturing_total == null ? null : money(estimate.manufacturing_total)], ["Design fee", estimate.design_fee == null ? null : money(estimate.design_fee)], ["Assembly fee", estimate.assembly_fee == null ? null : money(estimate.assembly_fee)], ["Shipping estimate", estimate.shipping_amount == null ? null : money(estimate.shipping_amount)]])}</section>
        <section><h3>Customer information and notes</h3>${detailRows([["Customer", estimate.name], ["Email", estimate.email], ["Customer description", estimate.application_description], ["Customer notes", estimate.notes], ["Admin notes", estimate.admin_notes], ["Clarification notes", estimate.clarification_notes]])}</section>
        <section><h3>Estimator inputs</h3>${detailRows([["Application category", estimate.application_category], ["Geometry classification", estimate.ai_geometry_classification], ["Utilization factor", estimate.geometry_utilization_factor], ["Recommended infill", estimate.recommended_infill_percent == null ? null : `${estimate.recommended_infill_percent}%`], ["Recommended walls", estimate.recommended_wall_loops], ["Recommended top / bottom layers", estimate.recommended_top_bottom_layers], ["Print profile", estimate.print_profile], ["Print-time source", estimate.print_time_source], ["Estimate method", estimate.estimation_method], ["Assembly required", estimate.assembly_required ? "Yes" : "No"], ["Manual review", estimate.requires_manual_review ? "Required" : "Not required"]])}</section>
        <section><h3>Shopify</h3>${detailRows([["Draft Order", estimate.shopify_draft_order_name || estimate.shopify_draft_order_id], ["Order number", estimate.shopify_order_number], ["Payment", status(estimate.shopify_payment_status)], ["Fulfillment", status(estimate.shopify_fulfillment_status)], ["Draft status", status(estimate.shopify_draft_order_live_status || estimate.shopify_draft_order_status)]])}${project.shopify?.orderAccess === "read_orders_required" ? '<p class="project-limitation">Grant <code>read_orders</code> to the Shopify app to retrieve completed order numbers, payment status, and fulfillment status.</p>' : ""}</section>
        <section><h3>Customer files</h3>${renderProjectFiles(project)}</section>
        ${additionalRows(estimate).length ? `<details class="project-additional"><summary>Additional stored project fields</summary>${detailRows(additionalRows(estimate))}</details>` : ""}</article>`;
      document.querySelectorAll(".project-file").forEach((button) => button.addEventListener("click", () => openProjectFile(estimate.id, button)));
    } catch (error) {
      root.innerHTML = `<div class="empty-state error-state"><strong>Could not load this project.</strong><p>${escapeHtml(error.message)}</p><a class="button button-secondary" href="/admin/orders">Back to projects</a></div>`;
    }
  }

  async function openProjectFile(estimateId, button) {
    const popup = window.open("about:blank", "_blank");
    button.disabled = true;
    try {
      const payload = await api("/api/admin-projects", { action:"file", estimateId, path:button.dataset.path, download:button.dataset.download === "true" });
      if (popup) popup.location = payload.signedUrl; else window.location.assign(payload.signedUrl);
    } catch (error) {
      popup?.close();
      window.alert(error.message || "The private file could not be opened.");
    } finally {
      button.disabled = false;
    }
  }

  function renderCustomers(data) {
    root.innerHTML = `${controls("Search by customer name, email, or quote code")}<div id="operations-results"></div>`;
    bindFilter(data.customers, (item, query) => [item.name, item.email, ...item.requests.map((request) => request.quote_code)].join(" ").toLowerCase().includes(query), (items) => items.length ? `<div class="customer-grid">${items.map((customer) => `<article class="operations-panel customer-card"><div class="customer-card-heading"><div><h2>${escapeHtml(customer.name)}</h2><p>${customer.email ? `<a href="mailto:${escapeHtml(customer.email)}">${escapeHtml(customer.email)}</a>` : "Etsy contact only"}</p></div><span>${escapeHtml(customer.requestCount)} request${customer.requestCount === 1 ? "" : "s"}</span></div><dl><div><dt>First request</dt><dd>${escapeHtml(date(customer.firstSeen))}</dd></div><div><dt>Most recent</dt><dd>${escapeHtml(date(customer.lastSeen))}</dd></div><div><dt>Saved final quotes</dt><dd>${escapeHtml(money(customer.totalQuoted))}</dd></div></dl><div class="quote-links">${customer.requests.map((request) => `<a href="${estimateUrl(request.quote_code)}">${escapeHtml(request.quote_code)} ${badge(request.status)}</a>`).join("")}</div></article>`).join("")}</div>` : '<div class="empty-state">No customers match this search.</div>');
  }

  function renderFiles(data) {
    root.innerHTML = `<div class="operations-alert"><strong>One private folder per quote.</strong><span>View and download existing files or add a late customer file. Files cannot be deleted here.</span></div>${controls("Search by quote code or customer", '<select id="status-filter" aria-label="Filter by Drive status"><option value="all">All folder states</option><option value="mirrored">Contains mirrored files</option><option value="linked">Drive folder created</option><option value="not_mirrored">Folder not created</option></select>')}<div id="operations-results"></div><section id="quote-file-manager" class="quote-file-manager" hidden aria-live="polite"></section>`;
    bindFilter(data.files, (item, query, selected) => (selected === "all" || item.drive_status === selected) && [item.quote_code, item.name, item.original_file_name].join(" ").toLowerCase().includes(query), (items) => items.length ? `<div class="responsive-table"><table><thead><tr><th>Quote folder</th><th>Customer</th><th>Submitted files</th><th>Google Drive</th><th></th></tr></thead><tbody>${items.map((folder) => `<tr><td><strong>${escapeHtml(folder.quote_code)}</strong><small>${escapeHtml(date(folder.created_at))}</small></td><td>${escapeHtml(folder.name || "Name not provided")}</td><td>${escapeHtml(folder.source_file_count)} received</td><td><span class="file-state ${folder.drive_status === "mirrored" ? "ok" : "neutral"}">${escapeHtml(folder.drive_status === "mirrored" ? "Files mirrored" : folder.drive_status === "linked" ? "Folder ready" : "Not created")}</span>${folder.drive_file_count ? `<small>${escapeHtml(folder.drive_file_count)} submission file${folder.drive_file_count === 1 ? "" : "s"} mirrored</small>` : ""}</td><td><div class="table-actions">${folder.drive_web_view_link ? `<a class="table-link" href="${escapeHtml(folder.drive_web_view_link)}" target="_blank" rel="noopener noreferrer">Open Drive</a>` : ""}<button class="table-link folder-manage" type="button" data-id="${escapeHtml(folder.id)}" data-code="${escapeHtml(folder.quote_code)}">Manage files</button></div></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">No quote folders match this search.</div>', bindFolderButtons);
  }

  function renderActivity(data) {
    root.innerHTML = data.auditAvailable ? `${controls("Search activity by action or subject")}<div id="operations-results"></div>` : migrationNotice();
    if (data.auditAvailable) bindFilter(data.activity, (item, query) => [item.action, item.subject_type, item.summary].join(" ").toLowerCase().includes(query), activityList);
  }

  function migrationNotice() {
    return '<div class="operations-alert"><strong>Activity logging is not active yet.</strong><span>Apply Supabase migration 016 to enable the audit trail and expanded order statuses.</span></div>';
  }

  function bindFilter(items, predicate, renderer, afterRender, extraSelectors = []) {
    const input = document.querySelector("#operations-search");
    const select = document.querySelector("#status-filter");
    const update = () => {
      const query = input.value.trim().toLowerCase();
      const filtered = items.filter((item) => predicate(item, query, select?.value || "all"));
      document.querySelector("#result-count").textContent = `${filtered.length} result${filtered.length === 1 ? "" : "s"}`;
      document.querySelector("#operations-results").innerHTML = renderer(filtered);
      afterRender?.();
    };
    input.addEventListener("input", update);
    select?.addEventListener("change", update);
    extraSelectors.forEach((selector) => document.querySelector(selector)?.addEventListener("change", update));
    update();
  }

  function bindFolderButtons() {
    document.querySelectorAll(".folder-manage").forEach((button) => button.addEventListener("click", () => openQuoteFolder(button.dataset.id, button.dataset.code)));
  }

  async function openQuoteFolder(estimateId, quoteCode) {
    const manager = document.querySelector("#quote-file-manager");
    manager.hidden = false;
    manager.innerHTML = `<div class="loading-state" role="status">Loading ${escapeHtml(quoteCode)} files…</div>`;
    manager.scrollIntoView({ behavior:"smooth", block:"start" });
    try {
      const payload = await api("/api/admin-estimates", { action:"drive_files", estimateId });
      const files = payload.files || [];
      manager.innerHTML = `<div class="quote-file-heading"><div><p class="eyebrow">Private quote folder</p><h2>${escapeHtml(payload.quoteCode)}</h2></div><a class="button button-secondary" href="${escapeHtml(payload.folder.webViewLink)}" target="_blank" rel="noopener noreferrer">Open in Google Drive</a></div>
        <div class="quote-folder-files">${files.length ? files.map((file) => `<article><div><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(fileSize(file.size))} · Updated ${escapeHtml(date(file.modifiedTime))}</small></div><div class="table-actions"><a class="table-link" href="${escapeHtml(file.webViewLink)}" target="_blank" rel="noopener noreferrer">View</a>${file.webContentLink ? `<a class="table-link" href="${escapeHtml(file.webContentLink)}" target="_blank" rel="noopener noreferrer">Download</a>` : ""}</div></article>`).join("") : '<div class="empty-state">This quote folder is empty.</div>'}</div>
        <form class="quote-file-upload"><label>Upload a late customer file<input id="quote-file-upload" type="file" accept=".stl,.3mf,.obj,.step,.stp,.dxf,.png,.jpg,.jpeg,.webp,.heic,.heif,.gif,.svg,.pdf,.zip,.txt" required><small>Models, images, PDF, ZIP, DXF, SVG, or text. Maximum 25 MB. Uploads go directly into this private Drive folder.</small></label><button class="button button-primary" type="submit">Upload file</button><p class="form-status" role="status"></p></form>`;
      manager.querySelector("form").addEventListener("submit", (event) => uploadQuoteFile(event, estimateId, quoteCode));
    } catch (error) {
      manager.innerHTML = `<div class="empty-state error-state"><strong>Could not open this quote folder.</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary folder-retry" type="button">Try again</button></div>`;
      manager.querySelector(".folder-retry").addEventListener("click", () => openQuoteFolder(estimateId, quoteCode));
    }
  }

  async function uploadQuoteFile(event, estimateId, quoteCode) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.querySelector('input[type="file"]');
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('[role="status"]');
    const file = input.files[0];
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) { status.textContent = "Choose a file no larger than 25 MB."; return; }
    button.disabled = true;
    button.textContent = "Uploading…";
    status.textContent = "Creating a secure Google Drive upload…";
    try {
      const session = await api("/api/admin-estimates", { action:"drive_upload_start", estimateId, fileName:file.name, fileSize:file.size });
      const upload = await fetch(session.uploadUrl, { method:"PUT", headers:{ "Content-Type":session.contentType }, body:file });
      if (!upload.ok) throw new Error(`Google Drive upload failed with status ${upload.status}.`);
      const saved = await upload.json();
      if (!saved.id) throw new Error("Google Drive did not return the uploaded file.");
      await api("/api/admin-estimates", { action:"drive_upload_complete", estimateId, fileId:saved.id });
      await openQuoteFolder(estimateId, quoteCode);
    } catch (error) {
      status.textContent = error.message || "The file could not be uploaded.";
      button.disabled = false;
      button.textContent = "Upload file";
    }
  }

  async function init() {
    root.innerHTML = '<div class="loading-state" role="status">Loading operations data…</div>';
    try {
      const data = await api("/api/admin-operations", { action:"load" });
      if (section === "orders") renderOrders(data);
      else if (section === "customers") renderCustomers(data);
      else if (section === "files") renderFiles(data);
      else if (section === "activity") renderActivity(data);
      else renderDashboard(data);
    } catch (error) {
      root.innerHTML = `<div class="empty-state error-state"><strong>We could not load this admin section.</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary" id="operations-retry" type="button">Try again</button></div>`;
      document.querySelector("#operations-retry").addEventListener("click", () => window.location.reload());
    }
  }

  init();
})();
