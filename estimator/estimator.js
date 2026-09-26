(function () {
  "use strict";

  const form = document.querySelector("#estimate-form");
  const result = document.querySelector("#estimate-result");
  const message = document.querySelector("#form-message");
  const config = window.MUCCI_CONFIG || {};
  const maxFileBytes = 25 * 1024 * 1024;
  const supportedExtensions = ["stl", "3mf", "obj", "step", "stp"];
  const gcodeTime = window.MucciGcodeTime;
  let calculatedPayload = null;
  let calculatedResult = null;
  let publicOptions = null;
  let importedPrintTime = null;

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    form.innerHTML = '<p class="notice">The estimator is temporarily unavailable. Please contact Mucci Products through Etsy.</p>';
    return;
  }
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value));
  const range = (minimum, maximum) => Number(minimum) === Number(maximum) ? money(minimum) : `${money(minimum)}–${money(maximum)}`;
  const selected = (name) => form.querySelector(`[name="${name}"]:checked`)?.value || "";
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);

  function renderDesignOptions() {
    if (!publicOptions) return;
    const ready = selected("file_status") === "ready";
    const options = ready
      ? [["none", "No design required", "$0"]]
      : [["simple", "Simple Design", `+${money(publicOptions.design_simple)} CAD`], ["medium", "Medium Design", `+${money(publicOptions.design_medium)} CAD`], ["complex", "Complex Design", `+${money(publicOptions.design_complex)} CAD`]];
    document.querySelector("#design-options").innerHTML = options.map(([value, label, price], index) => `<label class="choice"><input ${index === 0 ? "checked" : ""} required type="radio" name="design_level" value="${value}"><span><b>${label}</b><small>${price}</small></span></label>`).join("");
  }

  function updateConditionalFields() {
    const fileStatus = selected("file_status");
    document.querySelector("#file-upload-row").classList.toggle("hidden", !["ready", "modify"].includes(fileStatus));
    const timeMethod = selected("time_method");
    document.querySelector("#gcode-time-field").classList.toggle("hidden", timeMethod !== "gcode");
    document.querySelector("#known-time-fields").classList.toggle("hidden", timeMethod !== "manual");
    document.querySelector("#unknown-time-note").classList.toggle("hidden", timeMethod !== "unknown");
    document.querySelector("#gcode-file").required = timeMethod === "gcode";
    form.elements.print_hours.required = timeMethod === "manual";
    form.elements.print_minutes.required = timeMethod === "manual";
  }

  function payloadFromForm() {
    const values = Object.fromEntries(new FormData(form));
    const timeMethod = values.time_method;
    const imported = timeMethod === "gcode" ? importedPrintTime : null;
    return {
      p_file_status: values.file_status,
      p_quantity: Number(values.quantity),
      p_print_hours_per_item: imported ? imported.hours : timeMethod === "manual" ? Number(values.print_hours) : null,
      p_print_minutes_per_item: imported ? imported.minutes : timeMethod === "manual" ? Number(values.print_minutes) : null,
      p_size_category: timeMethod === "unknown" ? "not_sure" : null,
      p_colour_count: values.colour_count,
      p_design_level: values.design_level,
      p_assembly_required: values.assembly_required === "true"
    };
  }

  async function readGcodeEstimate(file) {
    if (!gcodeTime) throw new Error("The G-code time importer did not load. Please enter the time manually.");
    const chunkBytes = 2 * 1024 * 1024;
    const first = await file.slice(0, chunkBytes).text();
    const last = file.size > chunkBytes ? await file.slice(Math.max(chunkBytes, file.size - chunkBytes)).text() : "";
    const parsed = gcodeTime.parse(`${first}\n${last}`);
    if (!parsed) throw new Error("No embedded print-time estimate was found. Export the file from your slicer again or enter the time manually.");
    return { ...gcodeTime.toHoursMinutes(parsed.seconds), source:parsed.source };
  }

  async function importGcode(event) {
    const status = document.querySelector("#gcode-time-status");
    importedPrintTime = null;
    status.textContent = "";
    const file = event.target.files[0];
    if (!file) return;
    status.textContent = "Reading the slicer estimate…";
    try {
      importedPrintTime = await readGcodeEstimate(file);
      status.textContent = `Detected ${importedPrintTime.hours} hours ${importedPrintTime.minutes} minutes per item.`;
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function validateFile() {
    const file = document.querySelector("#model-file").files[0];
    if (!file) return null;
    const extension = file.name.split(".").pop().toLowerCase();
    if (!supportedExtensions.includes(extension)) throw new Error("Choose an STL, 3MF, OBJ, STEP, or STP file.");
    if (file.size > maxFileBytes) throw new Error("The 3D file must be 25 MB or smaller.");
    return { file, extension };
  }

  async function calculate(event) {
    event.preventDefault();
    message.textContent = "";
    if (!form.reportValidity()) return;
    try {
      validateFile();
      const payload = payloadFromForm();
      if (selected("time_method") === "gcode" && !importedPrintTime) throw new Error("Import G-code containing a slicer print-time estimate, or choose another time option.");
      if (payload.p_print_hours_per_item === 0 && payload.p_print_minutes_per_item === 0 && !payload.p_size_category) throw new Error("Enter a print time greater than zero for one item.");
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Calculating…";
      const { data, error } = await client.rpc("calculate_print_estimate", payload);
      if (error) throw error;
      calculatedPayload = payload;
      calculatedResult = Array.isArray(data) ? data[0] : data;
      renderEstimate(calculatedResult);
      button.disabled = false;
      button.textContent = "Recalculate estimate";
    } catch (error) {
      message.textContent = error.message || "We could not calculate this estimate. Please try again.";
      const button = form.querySelector('button[type="submit"]');
      button.disabled = false;
      button.textContent = "Calculate estimate";
    }
  }

  function renderEstimate(estimate) {
    result.classList.remove("hidden");
    result.innerHTML = `<p class="eyebrow">Your estimate is ready</p><h2>Estimated Project Price</h2><p class="price">${range(estimate.estimated_price_min, estimate.estimated_price_max)} CAD</p><div class="result-meta"><span><strong>Quantity:</strong> ${escapeHtml(calculatedPayload.p_quantity)}</span><span><strong>Approximate price per item:</strong> ${range(estimate.price_per_item_min, estimate.price_per_item_max)} CAD</span></div>${estimate.requires_manual_review ? '<p class="notice"><strong>File review required.</strong> This project needs manual confirmation before final pricing.</p>' : ""}<p>Estimate only. Final pricing is confirmed after your project and files are reviewed.</p><p>Submitting an estimate does not create an order or charge you. If you contacted us through Etsy, your final order and payment will be completed through Etsy.</p><div class="result-actions"><button id="submit-estimate" class="primary-button" type="button">SUBMIT ESTIMATE</button></div><p id="submit-message" role="alert"></p>`;
    document.querySelector("#submit-estimate").addEventListener("click", submitEstimate);
    result.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  async function submitEstimate() {
    const submitButton = document.querySelector("#submit-estimate");
    const submitMessage = document.querySelector("#submit-message");
    submitButton.disabled = true;
    submitButton.textContent = "Submitting…";
    submitMessage.textContent = "";
    try {
      const currentPayload = payloadFromForm();
      if (JSON.stringify(currentPayload) !== JSON.stringify(calculatedPayload)) throw new Error("Your project details changed. Please recalculate before submitting.");
      const values = Object.fromEntries(new FormData(form));
      const selectedFile = validateFile();
      let filePath = null;
      if (selectedFile) {
        filePath = `${crypto.randomUUID()}/${crypto.randomUUID()}.${selectedFile.extension}`;
        const { error: uploadError } = await client.storage.from("print-estimate-files").upload(filePath, selectedFile.file, { upsert:false, contentType:selectedFile.file.type || "application/octet-stream" });
        if (uploadError) throw new Error(`The file could not be uploaded: ${uploadError.message}`);
      }
      const { data, error } = await client.rpc("submit_print_estimate", {
        ...calculatedPayload,
        p_name: values.name.trim() || null, p_file_path: filePath,
        p_print_time_source: values.time_method, p_notes: values.notes.trim() || null
      });
      if (error) throw error;
      const submission = Array.isArray(data) ? data[0] : data;
      renderSuccess(submission);
    } catch (error) {
      submitMessage.textContent = error.message || "We could not submit your estimate. Please try again.";
      submitButton.disabled = false;
      submitButton.textContent = "SUBMIT ESTIMATE";
    }
  }

  function renderSuccess(submission) {
    const quoteCode = submission.quote_code;
    const etsyMessage = `Hi! I completed the Mucci Products 3D Printing Estimator.\n\nMy quote code is ${quoteCode}.\n\nPlease review my project and send me the final Etsy listing when ready.`;
    form.remove();
    result.classList.remove("hidden");
    result.innerHTML = `<p class="eyebrow">Estimate Submitted</p><h2>Estimated Price</h2><p class="price">${range(submission.estimated_price_min, submission.estimated_price_max)} CAD</p><p>Your Quote Code:</p><div class="quote-code">${escapeHtml(quoteCode)}</div><p class="etsy-instruction">Send this code to Mucci Products on Etsy.</p><div class="result-actions"><button class="secondary-button" type="button" data-copy-code>COPY CODE</button><button class="secondary-button" type="button" data-copy-message>COPY ETSY MESSAGE</button><a class="primary-button" href="${escapeHtml(config.etsyUrl || "#")}" target="_blank" rel="noreferrer">OPEN ETSY</a></div><p class="notice">This is an estimate only. Final pricing will be confirmed after Mucci Products reviews your project.</p><p id="copy-status" role="status"></p>`;
    const copy = async (text, confirmation) => { await navigator.clipboard.writeText(text); document.querySelector("#copy-status").textContent = confirmation; };
    document.querySelector("[data-copy-code]").addEventListener("click", () => copy(quoteCode, "Quote code copied."));
    document.querySelector("[data-copy-message]").addEventListener("click", () => copy(etsyMessage, "Etsy message copied."));
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "file_status") renderDesignOptions();
    if (["file_status", "time_method"].includes(event.target.name)) updateConditionalFields();
    if (calculatedPayload) { calculatedPayload = null; calculatedResult = null; result.classList.add("hidden"); result.innerHTML = ""; }
  });
  document.querySelector("#gcode-file").addEventListener("change", importGcode);
  form.addEventListener("submit", calculate);
  updateConditionalFields();
  (async function loadPublicOptions() {
    const button = form.querySelector('button[type="submit"]');
    const { data, error } = await client.rpc("get_print_estimator_public_options");
    if (error) {
      message.textContent = "The estimator is not configured yet. Please contact Mucci Products through Etsy.";
      button.textContent = "Estimator unavailable";
      return;
    }
    publicOptions = Array.isArray(data) ? data[0] : data;
    document.querySelector("#assembly-price").textContent = money(publicOptions.assembly_starting_price);
    renderDesignOptions();
    button.disabled = false;
    button.textContent = "Calculate estimate";
  })();
})();
