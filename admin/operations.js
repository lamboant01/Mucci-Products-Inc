(function () {
  "use strict";

  const root = document.querySelector("#operations-admin");
  if (!root) return;
  const section = root.dataset.section || "dashboard";
  const labels = {
    pending:"New", reviewed:"Reviewing", etsy_prepared:"Quoted", awaiting_customer:"Awaiting customer",
    accepted:"Accepted", in_production:"In production", completed:"Completed", declined:"Cancelled",
    NEW:"New", REVIEWING:"Reviewing", AWAITING_CUSTOMER:"Awaiting customer", DESIGNING:"Designing",
    READY_TO_PRINT:"Ready to print", PRINTING:"Printing", POST_PROCESSING:"Post-processing",
    QUALITY_CHECK:"Quality check", READY_TO_SHIP:"Ready to ship", COMPLETED:"Completed", CANCELLED:"Cancelled"
  };
  const internalStatuses = ["NEW", "REVIEWING", "AWAITING_CUSTOMER", "DESIGNING", "READY_TO_PRINT", "PRINTING", "POST_PROCESSING", "QUALITY_CHECK", "READY_TO_SHIP", "COMPLETED", "CANCELLED"];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const date = (value) => value ? new Date(value).toLocaleString("en-CA", { dateStyle:"medium", timeStyle:"short" }) : "Not available";
  const money = (value) => value == null || value === "" ? "Not available" : Number(value).toLocaleString("en-CA", { style:"currency", currency:"CAD" });
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
    return `<span class="status-badge status-${escapeHtml(String(value || "unknown").toLowerCase())}">${escapeHtml(status(value))}</span>`;
  }

  function requestRows(items, empty = "No records found.") {
    if (!items.length) return `<div class="empty-state">${escapeHtml(empty)}</div>`;
    return `<div class="responsive-table order-table"><table><thead><tr><th>Order</th><th>Quote</th><th>Customer</th><th>Service</th><th>Internal Status</th><th>Shopify Status</th><th>Total</th><th>Files</th><th>Date</th><th>Action</th></tr></thead><tbody>${items.map((item) => `<tr><td data-label="Order"><strong>${escapeHtml(item.shopify_order_number || "Pending conversion")}</strong></td><td data-label="Quote">${escapeHtml(item.quote_code)}</td><td data-label="Customer">${escapeHtml(item.name || "Name not provided")}<small>${escapeHtml(item.email || "No email provided")}</small></td><td data-label="Service">${escapeHtml(service(item.service_intent || item.file_status))}</td><td data-label="Internal status">${badge(item.internal_status || "NEW")}</td><td data-label="Shopify status">${item.shopify_payment_status ? badge(item.shopify_payment_status) : "Not available"}<small>${escapeHtml(item.shopify_fulfillment_status ? status(item.shopify_fulfillment_status) : "")}</small></td><td data-label="Total">${escapeHtml(money(item.shopify_total_amount ?? item.final_price ?? item.estimated_total_max))}</td><td data-label="Files">${escapeHtml(item.file_count ?? fileCount(item))}</td><td data-label="Date">${escapeHtml(date(item.created_at))}</td><td data-label="Action"><a class="table-link" href="${projectUrl(item.id)}">Open order</a></td></tr>`).join("")}</tbody></table></div>`;
  }

  function estimateRows(items, empty = "No estimates found.") {
    if (!items.length) return `<div class="empty-state">${escapeHtml(empty)}</div>`;
    return `<div class="responsive-table order-table estimate-summary-table"><table><thead><tr><th>Quote</th><th>Customer</th><th>Status</th><th>Review</th><th>Shopify</th><th>Estimated Total</th><th>Date</th><th>Action</th></tr></thead><tbody>${items.map((item) => `<tr><td data-label="Quote"><strong>${escapeHtml(item.quote_code)}</strong></td><td data-label="Customer">${escapeHtml(item.name || "Name not provided")}<small>${escapeHtml(item.email || "No email provided")}</small></td><td data-label="Status">${badge(item.status || "pending")}</td><td data-label="Review">${item.requires_manual_review ? '<span class="status-badge status-warning">Manual review</span>' : "Standard"}</td><td data-label="Shopify">${escapeHtml(item.shopify_order_number || (item.shopify_draft_order_id ? "Draft linked" : "Not linked"))}</td><td data-label="Estimated total">${escapeHtml(money(item.final_price ?? item.estimated_total_max))}</td><td data-label="Date">${escapeHtml(date(item.created_at))}</td><td data-label="Action"><a class="table-link" href="${estimateUrl(item.quote_code)}">Review estimate</a></td></tr>`).join("")}</tbody></table></div>`;
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
    const estimateCards = [
      ["New Estimates", data.estimateMetrics.newEstimates, "/admin/estimates"],
      ["Manual Review", data.estimateMetrics.manualReview, "/admin/estimates"],
      ["Open Estimates", data.estimateMetrics.openEstimates, "/admin/estimates"],
      ["Awaiting Customer", data.estimateMetrics.awaitingCustomer, "/admin/estimates"]
    ];
    const orderCards = [
      ["New Orders", data.metrics.newOrders, "/admin/orders?status=NEW"],
      ["Awaiting Review", data.metrics.awaitingReview, "/admin/orders?status=REVIEWING"],
      ["Design Required", data.metrics.designRequired, "/admin/orders?status=DESIGNING"],
      ["Ready to Print", data.metrics.readyToPrint, "/admin/orders?status=READY_TO_PRINT"],
      ["Printing", data.metrics.printing, "/admin/orders?status=PRINTING"],
      ["Ready to Ship", data.metrics.readyToShip, "/admin/orders?status=READY_TO_SHIP"],
      ["Open Orders", data.metrics.openOrders, "/admin/orders"],
      ["Recently Completed", data.metrics.recentlyCompleted, "/admin/orders?status=COMPLETED"]
    ];
    const notice = data.shopify?.configured === false ? '<div class="operations-alert"><strong>Shopify reconciliation is not configured.</strong><span>Stored Supabase project information remains available.</span></div>' : data.shopify?.orderAccess === "read_orders_required" ? '<div class="operations-alert"><strong>Shopify access needs reauthorization.</strong><span>Grant <code>read_orders</code> to classify converted orders and show payment and fulfillment.</span></div>' : data.shopify?.orderAccess === "unavailable" ? '<div class="operations-alert"><strong>Shopify data unavailable.</strong><span>Cached order data remains available.</span></div>' : "";
    root.innerHTML = `${notice}<section class="dashboard-group"><div class="section-heading"><div><p class="eyebrow">Quote pipeline</p><h2>Estimate Pipeline</h2></div><a href="/admin/estimates">All estimates</a></div><div class="metric-grid">${estimateCards.map(([label, value, href]) => `<a class="metric-card" href="${href}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>View estimates</small></a>`).join("")}</div>
      <div class="operations-grid">${data.estimateAttention.length ? `<section class="operations-panel wide"><div class="section-heading"><div><p class="eyebrow">Estimate attention</p><h2>Manual Review Required</h2></div><a href="/admin/estimates">Review estimates</a></div><div class="attention-list">${data.estimateAttention.map((item) => `<article><div><strong>${escapeHtml(item.quote_code)}</strong><small>${escapeHtml(item.name || "Name not provided")} · ${escapeHtml(money(item.final_price ?? item.estimated_total_max))}</small></div><a class="table-link" href="${estimateUrl(item.quote_code)}">Review estimate</a></article>`).join("")}</div></section>` : ""}
      <section class="operations-panel wide"><div class="section-heading"><div><p class="eyebrow">Latest submissions</p><h2>Recent Estimates</h2></div><a href="/admin/estimates">All estimates</a></div>${estimateRows(data.recentEstimates, "No estimates are available yet.")}</section></div></section>
      <section class="dashboard-group"><div class="section-heading"><div><p class="eyebrow">Production pipeline</p><h2>Paid Orders</h2></div><a href="/admin/orders">All orders</a></div><div class="metric-grid">${orderCards.map(([label, value, href]) => `<a class="metric-card" href="${href}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>View details</small></a>`).join("")}</div>
      <div class="operations-grid"><section class="operations-panel wide"><div class="section-heading"><div><p class="eyebrow">Action queue</p><h2>Needs Attention</h2></div><a href="/admin/orders?attention=true">Filtered orders</a></div>${data.needsAttention.length ? `<div class="attention-list">${data.needsAttention.map((item) => `<article><div><strong>${escapeHtml(item.shopify_order_number || item.quote_code)}</strong><small>${escapeHtml(item.name || "Name not provided")} · ${escapeHtml((item.attention_flags || []).join(" · "))}</small></div><a class="table-link" href="${projectUrl(item.id)}">Open order</a></article>`).join("")}</div>` : '<div class="empty-state">No orders currently meet the defined attention rules.</div>'}</section>
      <section class="operations-panel wide"><div class="section-heading"><div><p class="eyebrow">Latest</p><h2>Recent Orders</h2></div><a href="/admin/orders">All orders</a></div>${requestRows(data.recentOrders, "No paid orders are available yet.")}</section></div></section>`;
  }

  function customerCards(items) {
    if (!items.length) return '<div class="empty-state">No customer submissions yet.</div>';
    return `<div class="compact-list">${items.map((customer) => `<article><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.email || "Etsy contact only")}</small></div><span>${escapeHtml(customer.requestCount)} request${customer.requestCount === 1 ? "" : "s"}</span></article>`).join("")}</div>`;
  }

  function controls(placeholder, filters = "") {
    return `<div class="list-controls"><label class="search-control"><span class="visually-hidden">Search</span><input id="operations-search" type="search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label>${filters}</div><p id="result-count" class="result-count" role="status"></p>`;
  }

  function renderOrders() {
    const selectedProject = new URLSearchParams(window.location.search).get("project");
    if (selectedProject) return renderProject(selectedProject);
    const query = new URLSearchParams(window.location.search);
    root.innerHTML = `<div id="orders-notice"></div><form id="orders-filter-form" class="order-filters"><label><span>Search</span><input name="search" type="search" placeholder="Order, quote, customer, email, or UUID"></label><label><span>Internal status</span><select name="internalStatus"><option value="">All statuses</option>${internalStatuses.map((value) => `<option value="${value}" ${query.get("status") === value ? "selected" : ""}>${escapeHtml(status(value))}</option>`).join("")}</select></label><label><span>Payment</span><select name="paymentStatus"><option value="">All payment states</option><option>PAID</option><option>AUTHORIZED</option><option>PARTIALLY_PAID</option><option>REFUNDED</option><option>VOIDED</option></select></label><label><span>Fulfillment</span><select name="fulfillmentStatus"><option value="">All fulfillment states</option><option>UNFULFILLED</option><option>PARTIALLY_FULFILLED</option><option>FULFILLED</option></select></label><label><span>Service</span><select name="serviceIntent"><option value="">All services</option><option value="PRINT_ONLY">Print only</option><option value="DESIGN_ONLY">Design only</option><option value="DESIGN_AND_PRINT">Design and print</option></select></label><label><span>Files</span><select name="hasFiles"><option value="">With or without files</option><option value="yes">Has files</option><option value="no">No files</option></select></label><label><span>From</span><input name="dateFrom" type="date"></label><label><span>To</span><input name="dateTo" type="date"></label><label><span>Sort</span><select name="sort"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="order_number">Order number</option><option value="highest_value">Highest value</option><option value="status">Status</option></select></label><label class="checkbox-filter"><input name="needsAttention" type="checkbox" value="true" ${query.get("attention") === "true" ? "checked" : ""}><span>Needs attention only</span></label><button class="button button-primary" type="submit">Apply filters</button><a class="button button-secondary" href="/admin/orders">Clear</a></form><p id="result-count" class="result-count" role="status"></p><div id="operations-results"></div><div id="orders-pagination" class="pagination"></div>`;
    const form = root.querySelector("#orders-filter-form");
    const load = async (page = 1) => {
      root.querySelector("#operations-results").innerHTML = '<div class="loading-state">Loading orders…</div>';
      try {
        const filters = Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => value !== ""));
        const data = await api("/api/admin-orders", { action:"list", ...filters, page });
        root.querySelector("#orders-notice").innerHTML = data.shopify?.configured === false ? '<div class="operations-alert"><strong>Shopify reconciliation is not configured.</strong><span>Add the server-only Shopify variables.</span></div>' : data.shopify?.orderAccess === "read_orders_required" ? '<div class="operations-alert"><strong>Shopify access needs reauthorization.</strong><span>Grant <code>read_orders</code>; Supabase projects remain available.</span></div>' : data.shopify?.orderAccess === "unavailable" ? '<div class="operations-alert"><strong>Shopify data unavailable.</strong><span>Stored data remains available. Retry from an order detail page.</span></div>' : "";
        root.querySelector("#result-count").textContent = `${data.count} order${data.count === 1 ? "" : "s"}`;
        root.querySelector("#operations-results").innerHTML = requestRows(data.orders, "No paid or converted Shopify orders match these filters.");
        const pages = Math.max(1, Math.ceil(data.count / data.pageSize));
        root.querySelector("#orders-pagination").innerHTML = `<button class="button button-secondary" type="button" ${data.page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${data.page} of ${pages}</span><button class="button button-secondary" type="button" ${data.page >= pages ? "disabled" : ""}>Next</button>`;
        const buttons = root.querySelectorAll("#orders-pagination button");
        buttons[0].addEventListener("click", () => load(data.page - 1)); buttons[1].addEventListener("click", () => load(data.page + 1));
      } catch (error) { root.querySelector("#operations-results").innerHTML = `<div class="empty-state error-state"><strong>Could not load orders.</strong><p>${escapeHtml(error.message)}</p></div>`; }
    };
    form.addEventListener("submit", (event) => { event.preventDefault(); load(1); });
    load();
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
    return `<div class="project-files">${project.files.map((file) => `<article><div><strong>${escapeHtml(file.name)}</strong><small>${escapeHtml(file.category)} · ${escapeHtml(file.extension.toUpperCase() || "FILE")} · ${escapeHtml(fileSize(file.sizeBytes))} · ${escapeHtml(date(file.uploadedAt))}</small></div><div class="table-actions">${file.viewable ? `<button class="table-link project-file" type="button" data-file-id="${escapeHtml(file.id)}" data-download="false">${file.extension === "pdf" ? "Open" : "View"}</button>` : ""}<button class="table-link project-file" type="button" data-file-id="${escapeHtml(file.id)}" data-download="true">Download</button></div></article>`).join("")}</div>`;
  }

  async function renderProject(estimateId) {
    root.innerHTML = '<div class="loading-state" role="status">Loading project…</div>';
    try {
      const project = await api("/api/admin-projects", { action:"load", estimateId });
      const estimate = project.estimate;
      const orderLabel = estimate.shopify_order_number || estimate.shopify_draft_order_name || "No Shopify order";
      const settings = Array.isArray(estimate.model_files) ? estimate.model_files.find((item) => item?.print_settings)?.print_settings : null;
      const detail = project.shopify?.detail || {};
      const customer = detail.customer || {};
      const shipping = detail.shippingAddress || {};
      const events = [{ label:"Project created", at:estimate.created_at }, ...(project.files.length ? [{ label:`${project.files.length} customer file${project.files.length === 1 ? "" : "s"} recorded`, at:project.files[0].uploadedAt }] : []), ...(project.events || []).map((event) => ({ label:`Workflow: ${status(event.old_value || "not set")} → ${status(event.new_value)}`, at:event.created_at }))];
      root.innerHTML = `<a class="project-back" href="/admin/orders">← All orders</a>
        ${project.shopify?.orderAccess === "read_orders_required" ? '<div class="operations-alert"><strong>Shopify access needs reauthorization.</strong><span>Grant <code>read_orders</code>. Project and file access remains available.</span></div>' : project.shopify?.orderAccess === "unavailable" ? '<div class="operations-alert"><strong>Shopify data unavailable.</strong><span>Stored project information remains available.</span></div>' : ""}
        <header class="project-detail-header order-detail-header"><div><p class="eyebrow">${escapeHtml(service(estimate.service_intent))}</p><h2>${escapeHtml(orderLabel)}</h2><p>${escapeHtml(estimate.quote_code)}</p></div><div class="project-header-status">${badge(estimate.internal_status || "NEW")}${estimate.shopify_payment_status ? badge(estimate.shopify_payment_status) : ""}${estimate.shopify_fulfillment_status ? badge(estimate.shopify_fulfillment_status) : ""}</div></header>
        <div class="project-actions"><a class="button button-secondary" href="${estimateUrl(estimate.quote_code)}">Open estimate</a>${estimate.shopify_admin_url ? `<a class="button button-primary" href="${escapeHtml(estimate.shopify_admin_url)}" target="_blank" rel="noopener noreferrer">Open Shopify Order</a>` : ""}<button id="refresh-shopify" class="button button-secondary" type="button">Refresh Shopify Data</button><button id="download-all" class="button button-secondary" type="button" ${project.files.length ? "" : "disabled"}>Download All</button><button class="button button-secondary copy-action" type="button" data-copy="${escapeHtml(estimate.quote_code)}">Copy quote code</button>${estimate.email ? `<button class="button button-secondary copy-action" type="button" data-copy="${escapeHtml(estimate.email)}">Copy customer email</button>` : ""}</div>
        <div class="order-workspace"><article class="project-detail"><section><h3>Customer</h3>${detailRows([["Name", customer.name || estimate.name], ["Email", customer.email || estimate.email], ["Phone", customer.phone || shipping.phone], ["Shipping area", shipping.area], ["Shipping address", [shipping.address1, shipping.address2, shipping.postalCode].filter(Boolean).join(", ")], ["Customer notes", detail.note || estimate.notes]])}</section>
        <section><h3>Project</h3>${detailRows([["Project ID", estimate.id], ["Service", service(estimate.service_intent)], ["Project description", estimate.application_description || estimate.intended_use], ["Quantity", estimate.final_quantity || estimate.quantity], ["Dimensions", dimensions(estimate)], ["Material", estimate.material], ["Colours", estimate.desired_colours || estimate.colour_count], ["Application / use", estimate.application_category || estimate.intended_use], ["Print hours", estimate.total_print_hours ?? estimate.estimated_production_hours], ["Filament grams", estimate.total_filament_grams ?? estimate.estimated_material_grams], ["Infill", settings?.infill_percent == null ? estimate.recommended_infill_percent : `${settings.infill_percent}%`], ["Wall loops", settings?.wall_loops ?? estimate.recommended_wall_loops]])}</section>
        <section><h3>Pricing</h3>${detailRows([["Quoted total", money(estimate.final_price ?? estimate.estimated_total_max)], ["Design cost", money(estimate.design_fee)], ["Print cost", money(estimate.manufacturing_total)], ["Shipping", money(estimate.shipping_amount)], ["Shopify total", money(estimate.shopify_total_amount)], ["Payment status", status(estimate.shopify_payment_status)]])}</section>
        <section><h3>Customer Files</h3><p class="project-limitation">Secure links expire after 60 seconds. Raw private object paths are not exposed.</p>${renderProjectFiles(project)}</section>
        ${(project.previousProjects || []).length ? `<section><h3>Previous Mucci Projects</h3><div class="compact-list">${project.previousProjects.map((item) => `<article><div><strong>${escapeHtml(item.shopify_order_number || item.quote_code)}</strong><small>${escapeHtml(item.name || service(item.service_intent))}</small></div><a class="table-link" href="${projectUrl(item.id)}">${escapeHtml(status(item.internal_status || item.status))}</a></article>`).join("")}</div></section>` : ""}</article>
        <aside class="order-sidebar"><section><h3>Order workflow</h3><label><span>Internal Mucci status</span><select id="internal-status">${internalStatuses.map((value) => `<option value="${value}" ${(estimate.internal_status || "NEW") === value ? "selected" : ""}>${escapeHtml(status(value))}</option>`).join("")}</select></label><button id="save-status" class="button button-primary" type="button">Change Status</button><div class="quick-statuses"><button type="button" data-status="READY_TO_PRINT">Ready to Print</button><button type="button" data-status="PRINTING">Printing</button><button type="button" data-status="QUALITY_CHECK">Quality Check</button><button type="button" data-status="READY_TO_SHIP">Ready to Ship</button><button type="button" data-status="COMPLETED">Completed</button></div><p id="status-message" class="form-status" role="status"></p></section><section><h3>Shopify</h3>${!estimate.shopify_order_number && estimate.shopify_draft_order_id ? '<p class="project-limitation">Order has not yet converted from Draft Order, or <code>read_orders</code> is unavailable.</p>' : ""}${detailRows([["Order", estimate.shopify_order_number], ["Payment", status(estimate.shopify_payment_status)], ["Fulfillment", status(estimate.shopify_fulfillment_status)], ["Last refreshed", date(estimate.shopify_reconciled_at)]])}</section><section><h3>Timeline / activity</h3><ol class="activity-list">${events.sort((a,b) => new Date(b.at) - new Date(a.at)).map((event) => `<li><span class="activity-icon" aria-hidden="true"></span><div><strong>${escapeHtml(event.label)}</strong><small>${escapeHtml(date(event.at))}</small></div></li>`).join("")}</ol></section></aside></div>`;
      document.querySelectorAll(".project-file").forEach((button) => button.addEventListener("click", () => openProjectFile(estimate.id, button)));
      document.querySelectorAll(".copy-action").forEach((button) => button.addEventListener("click", async () => { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "Copied"; }));
      document.querySelector("#refresh-shopify").addEventListener("click", () => renderProject(estimate.id));
      document.querySelector("#download-all").addEventListener("click", () => downloadAllFiles(estimate.id));
      const saveStatus = async (value) => {
        const message = document.querySelector("#status-message"); message.textContent = "Saving…";
        try { await api("/api/admin-projects", { action:"status", estimateId:estimate.id, status:value }); await renderProject(estimate.id); }
        catch (error) { message.textContent = error.message || "The status could not be changed."; }
      };
      document.querySelector("#save-status").addEventListener("click", () => saveStatus(document.querySelector("#internal-status").value));
      document.querySelectorAll(".quick-statuses button").forEach((button) => button.addEventListener("click", () => saveStatus(button.dataset.status)));
    } catch (error) {
      root.innerHTML = `<div class="empty-state error-state"><strong>Could not load this project.</strong><p>${escapeHtml(error.message)}</p><a class="button button-secondary" href="/admin/orders">Back to projects</a></div>`;
    }
  }

  async function openProjectFile(estimateId, button) {
    const popup = window.open("about:blank", "_blank");
    button.disabled = true;
    try {
      const payload = await api("/api/admin-projects", { action:"file", estimateId, fileId:button.dataset.fileId, download:button.dataset.download === "true" });
      if (popup) popup.location = payload.signedUrl; else window.location.assign(payload.signedUrl);
    } catch (error) {
      popup?.close();
      window.alert(error.message || "The private file could not be opened.");
    } finally {
      button.disabled = false;
    }
  }

  async function downloadAllFiles(estimateId) {
    const button = document.querySelector("#download-all");
    button.disabled = true;
    try {
      const payload = await api("/api/admin-projects", { action:"download_all", estimateId });
      for (const file of payload.files) {
        const link = document.createElement("a");
        link.href = file.signedUrl; link.download = file.name; link.rel = "noopener";
        document.body.append(link); link.click(); link.remove();
      }
    } catch (error) { window.alert(error.message || "Could not generate secure download links."); }
    finally { button.disabled = false; }
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
      if (section === "dashboard") return renderDashboard(await api("/api/admin-orders", { action:"dashboard" }));
      if (section === "orders") return renderOrders();
      const data = await api("/api/admin-operations", { action:"load", section });
      if (section === "orders") renderOrders();
      else if (section === "customers") renderCustomers(data);
      else if (section === "files") renderFiles(data);
      else if (section === "activity") renderActivity(data);
      else root.innerHTML = '<div class="empty-state">This admin section is not available.</div>';
    } catch (error) {
      root.innerHTML = `<div class="empty-state error-state"><strong>We could not load this admin section.</strong><p>${escapeHtml(error.message)}</p><button class="button button-secondary" id="operations-retry" type="button">Try again</button></div>`;
      document.querySelector("#operations-retry").addEventListener("click", () => window.location.reload());
    }
  }

  init();
})();
