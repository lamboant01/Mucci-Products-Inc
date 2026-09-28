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
    return `<div class="responsive-table"><table><thead><tr><th>Reference</th><th>Customer</th><th>Status</th><th>Submitted</th><th>Quantity</th><th>Value</th><th></th></tr></thead><tbody>${items.map((item) => `<tr><td><strong>${escapeHtml(item.quote_code)}</strong></td><td>${escapeHtml(item.name || "Name not provided")}<small>${escapeHtml(item.email || "No email provided")}</small></td><td>${badge(item.status)}</td><td>${escapeHtml(date(item.created_at))}</td><td>${escapeHtml(item.final_quantity || item.quantity)}</td><td>${escapeHtml(money(item.final_price || item.estimated_price_max || item.estimated_price))}</td><td><a class="table-link" href="${estimateUrl(item.quote_code)}">Open</a></td></tr>`).join("")}</tbody></table></div>`;
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
    root.innerHTML = `${controls("Search by quote code, customer, email, or material", '<select id="status-filter" aria-label="Filter by status"><option value="all">All order statuses</option><option value="accepted">Accepted</option><option value="in_production">In production</option><option value="completed">Completed</option></select>')}<div id="operations-results"></div>`;
    bindFilter(data.orders, (item, query, selected) => (selected === "all" || item.status === selected) && [item.quote_code, item.name, item.email, item.material].join(" ").toLowerCase().includes(query), requestRows);
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

  function bindFilter(items, predicate, renderer, afterRender) {
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
