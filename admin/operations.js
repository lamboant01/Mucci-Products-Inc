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
    root.innerHTML = `${controls("Search by file, quote code, or customer", '<select id="status-filter" aria-label="Filter by Drive status"><option value="all">All file states</option><option value="mirrored">Mirrored to Drive</option><option value="not_mirrored">Not mirrored</option></select>')}<div id="operations-results"></div>`;
    bindFilter(data.files, (item, query, selected) => (selected === "all" || item.drive_status === selected) && [item.original_file_name, item.quote_code, item.name].join(" ").toLowerCase().includes(query), (items) => items.length ? `<div class="responsive-table"><table><thead><tr><th>File</th><th>Request</th><th>Customer</th><th>Supabase</th><th>Google Drive</th><th></th></tr></thead><tbody>${items.map((file) => `<tr><td><strong>${escapeHtml(file.original_file_name || "Uploaded model")}</strong><small>${escapeHtml(date(file.created_at))}</small></td><td>${escapeHtml(file.quote_code)}</td><td>${escapeHtml(file.name || "Name not provided")}</td><td><span class="file-state ok">Available</span></td><td><span class="file-state ${file.drive_status === "mirrored" ? "ok" : "neutral"}">${escapeHtml(file.drive_status === "mirrored" ? "Mirrored" : "Not mirrored")}</span></td><td><button class="table-link file-open" type="button" data-id="${escapeHtml(file.id)}">Open securely</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="empty-state">No files match this search.</div>', bindFileButtons);
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

  function bindFileButtons() {
    document.querySelectorAll(".file-open").forEach((button) => button.addEventListener("click", async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = "Creating link…";
      try {
        const payload = await api("/api/admin-estimates", { action:"signed_file", estimateId:button.dataset.id });
        window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }));
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
