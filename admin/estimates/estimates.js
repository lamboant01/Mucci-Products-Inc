(function () {
  "use strict";
  const root = document.querySelector("#estimates-admin");
  const config = window.MUCCI_CONFIG || {};
  const allowedAdminEmail = "anthony@mucciproducts.com";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const money = (value) => new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" }).format(Number(value));
  const price = (estimate) => Number(estimate.estimated_price) === Number(estimate.estimated_price_max) ? money(estimate.estimated_price) : `${money(estimate.estimated_price)}–${money(estimate.estimated_price_max)}`;
  const label = (value) => String(value || "None").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const quoteFromUrl = () => {
    const value = new URLSearchParams(window.location.search).get("quote")?.trim().toUpperCase() || "";
    return /^MP-[A-HJ-NP-Z2-9]{5}$/.test(value) ? value : "";
  };
  const driveStatus = () => new URLSearchParams(window.location.search).get("drive") || "";

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) { root.innerHTML = '<div class="dashboard-notice">Supabase setup is required.</div>'; return; }
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  async function init() {
    const { data:{ session } } = await client.auth.getSession();
    if (!session) return renderLogin();
    if (String(session.user.email || "").toLowerCase() !== allowedAdminEmail) { await client.auth.signOut(); return renderLogin("This account is not authorized."); }
    await loadEstimates(quoteFromUrl());
  }

  function renderLogin(initialMessage) {
    root.innerHTML = `<form id="login-form" class="saved-card owner-form setup-card" autocomplete="off"><p class="eyebrow">Restricted administration</p><h2>Admin sign in</h2><label>Email address<input required type="email" name="email" autocomplete="username"></label><label>Password<input required type="password" name="password" autocomplete="current-password"></label><button class="button button-primary" type="submit">Sign in</button><p role="status">${escapeHtml(initialMessage || "")}</p></form>`;
    document.querySelector("#login-form").addEventListener("submit", async (event) => {
      event.preventDefault(); const form = event.currentTarget; const status = form.querySelector('[role="status"]'); const button = form.querySelector("button");
      const values = Object.fromEntries(new FormData(form)); const email = String(values.email || "").trim().toLowerCase();
      button.disabled = true; status.textContent = "Signing in…";
      if (email !== allowedAdminEmail) { status.textContent = "The email or password is incorrect."; button.disabled = false; return; }
      const { error } = await client.auth.signInWithPassword({ email, password:values.password });
      if (error) { status.textContent = "The email or password is incorrect."; button.disabled = false; return; }
      await loadEstimates(quoteFromUrl());
    });
  }

  async function loadEstimates(query = "") {
    const url = new URL(window.location.href);
    if (query) url.searchParams.set("quote", query.trim().toUpperCase());
    else url.searchParams.delete("quote");
    window.history.replaceState({}, "", url);
    root.innerHTML = '<p role="status">Loading estimates…</p>';
    let request = client.from("print_estimates").select("*").order("created_at", { ascending:false }).limit(100);
    if (query) request = request.eq("quote_code", query.trim().toUpperCase());
    const { data, error } = await request;
    if (error) { root.innerHTML = `<div class="dashboard-notice"><strong>Estimates could not be loaded.</strong><br>${escapeHtml(error.message)}</div>`; return; }
    renderAdmin(data || [], query);
  }

  function renderAdmin(estimates, query) {
    const driveNotice = driveStatus() === "connected" ? "Google Drive is connected." : driveStatus() === "error" ? "Google Drive could not be connected. Check the OAuth redirect URI and try again." : "";
    root.innerHTML = `<div class="admin-tools"><div class="dashboard-user"><p>Protected estimate administration</p><div class="card-actions"><button id="connect-drive" class="button button-secondary" type="button">Connect Google Drive</button><button id="sign-out" class="button button-secondary" type="button">Sign out</button></div></div><p id="drive-connection-status" class="dashboard-notice" role="status"${driveNotice ? "" : " hidden"}>${escapeHtml(driveNotice)}</p><form id="search-form" class="admin-search"><input name="code" value="${escapeHtml(query)}" pattern="MP-[A-HJ-NP-Z2-9]{5}" placeholder="MP-A42K7" aria-label="Quote code"><button class="button button-primary" type="submit">Find quote</button>${query ? '<button class="button button-secondary" id="show-all" type="button">Show newest</button>' : ""}</form><section class="estimate-list">${estimates.length ? estimates.map(estimateMarkup).join("") : '<div class="empty-state">No matching estimates found.</div>'}</section></div>`;
    document.querySelector("#sign-out").addEventListener("click", async () => { await client.auth.signOut(); renderLogin(); });
    document.querySelector("#connect-drive").addEventListener("click", connectDrive);
    document.querySelector("#search-form").addEventListener("submit", (event) => { event.preventDefault(); loadEstimates(new FormData(event.currentTarget).get("code")); });
    document.querySelector("#show-all")?.addEventListener("click", () => loadEstimates());
    document.querySelectorAll("[data-copy]").forEach((button) => button.addEventListener("click", async () => { await navigator.clipboard.writeText(button.dataset.copy); button.textContent = "Copied"; }));
    document.querySelectorAll("[data-status]").forEach((button) => button.addEventListener("click", () => updateStatus(button.dataset.id, button.dataset.status, button)));
    document.querySelectorAll("[data-file]").forEach((button) => button.addEventListener("click", () => openFile(button.dataset.file, button)));
  }

  async function connectDrive(event) {
    const button = event.currentTarget;
    const status = document.querySelector("#drive-connection-status");
    button.disabled = true; status.hidden = false; status.textContent = "Opening Google authorization…";
    const { data:{ session } } = await client.auth.getSession();
    if (!session) { status.textContent = "Sign in again before connecting Google Drive."; button.disabled = false; return; }
    try {
      const response = await fetch("/api/google-drive-connect", {
        method:"POST", headers:{ Authorization:`Bearer ${session.access_token}` }
      });
      const payload = await response.json();
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error || "Google Drive connection could not be started.");
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      status.textContent = error.message || "Google Drive connection could not be started.";
      button.disabled = false;
    }
  }

  function estimateMarkup(estimate) {
    const printTime = estimate.size_category ? `${label(estimate.size_category)} size estimate` : `${estimate.print_hours_per_item || 0}h ${estimate.print_minutes_per_item || 0}m per item`;
    const material = estimate.filament_grams_per_item == null ? "Not available" : `${Number(estimate.filament_grams_per_item).toFixed(1)} g per item`;
    const materialTotal = estimate.estimated_material_grams == null ? "Not available" : `${Number(estimate.estimated_material_grams).toFixed(1)} g including purge`;
    return `<article class="estimate-card"><header><div><h2>${escapeHtml(estimate.quote_code)}</h2><small>${new Date(estimate.created_at).toLocaleString("en-CA")}</small></div><span class="status-badge">${escapeHtml(estimate.status)}</span></header>${estimate.requires_manual_review ? '<p class="manual-flag">Manual review required</p>' : ""}<dl class="estimate-grid"><div><dt>Name</dt><dd>${escapeHtml(estimate.name || "Not provided")}</dd></div><div><dt>Estimated price</dt><dd>${price(estimate)} CAD</dd></div><div><dt>Model file</dt><dd>${escapeHtml(estimate.original_file_name || (estimate.file_path ? "Uploaded model" : "Not provided"))}</dd></div><div><dt>Drive copy</dt><dd>${estimate.drive_mirrored_at ? "Saved privately" : "Pending or not configured"}</dd></div><div><dt>Quantity</dt><dd>${escapeHtml(estimate.quantity)}</dd></div><div><dt>Print time</dt><dd>${escapeHtml(printTime)}</dd></div><div><dt>Filament</dt><dd>${escapeHtml(material)}</dd></div><div><dt>Material total</dt><dd>${escapeHtml(materialTotal)}</dd></div><div><dt>Time source</dt><dd>${label(estimate.print_time_source || (estimate.size_category ? "unknown" : "manual"))}</dd></div><div><dt>Print profile</dt><dd>${label(estimate.print_profile)}</dd></div><div><dt>Colours</dt><dd>${escapeHtml(estimate.colour_count)}</dd></div><div><dt>Purge allowance</dt><dd>${escapeHtml(estimate.purge_waste_percent || 0)}%</dd></div><div><dt>File status</dt><dd>${label(estimate.file_status)}</dd></div><div><dt>Design</dt><dd>${label(estimate.design_level)}</dd></div><div><dt>Assembly</dt><dd>${estimate.assembly_required ? "Yes" : "No"}</dd></div></dl><p class="notes"><strong>Customer notes</strong><br>${escapeHtml(estimate.notes || "No notes provided.")}</p><div class="card-actions"><button class="button button-secondary" type="button" data-copy="${escapeHtml(estimate.quote_code)}">Copy Quote Code</button>${estimate.file_path ? `<button class="button button-secondary" type="button" data-file="${escapeHtml(estimate.file_path)}">Open Uploaded File</button>` : ""}${estimate.drive_web_view_link ? `<a class="button button-secondary" href="${escapeHtml(estimate.drive_web_view_link)}" target="_blank" rel="noopener noreferrer">Open in Google Drive</a>` : ""}${estimate.status === "pending" ? `<button class="button button-primary" type="button" data-id="${estimate.id}" data-status="reviewed">Mark Reviewed</button>` : ""}${estimate.status !== "completed" ? `<button class="button button-primary" type="button" data-id="${estimate.id}" data-status="completed">Mark Completed</button>` : ""}</div></article>`;
  }

  async function updateStatus(id, status, button) {
    button.disabled = true;
    const { error } = await client.from("print_estimates").update({ status }).eq("id", id);
    if (error) { button.disabled = false; button.textContent = error.message; return; }
    await loadEstimates();
  }

  async function openFile(path, button) {
    button.disabled = true;
    const { data, error } = await client.storage.from("print-estimate-files").createSignedUrl(path, 60);
    button.disabled = false;
    if (error) { button.textContent = error.message; return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }
  init();
})();
