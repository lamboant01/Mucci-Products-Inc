import { loadAndPreviewModel, sliceModel } from "./model-slicer.js";

(function () {
  "use strict";

  const form = document.querySelector("#estimate-form");
  const result = document.querySelector("#estimate-result");
  const message = document.querySelector("#form-message");
  const config = window.MUCCI_CONFIG || {};
  const maxFileBytes = 25 * 1024 * 1024;
  const maxModelDimensionMm = 250;
  const supportedExtensions = ["stl", "3mf", "obj", "step", "stp"];
  const gcodeTime = window.MucciGcodeTime;
  let calculatedPayload = null;
  let calculatedResult = null;
  let publicOptions = null;
  let loadedModel = null;
  let modelLoadPromise = null;
  let slicedPrintTime = null;

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    form.innerHTML = '<p class="notice">The estimator is temporarily unavailable. Please contact Mucci Products through Etsy.</p>';
    return;
  }
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

  const money = (value) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(Number(value));
  const range = (minimum, maximum) => Number(minimum) === Number(maximum) ? money(minimum) : `${money(minimum)}–${money(maximum)}`;
  const selected = (name) => form.querySelector(`[name="${name}"]:checked`)?.value || "";
  const escapeHtml = (value) => String(value || "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const isMobileDevice = () => window.matchMedia("(pointer: coarse)").matches || window.innerWidth <= 1024;
  const withDesktopFallback = (error) => {
    const detail = error?.message || "This model could not be processed.";
    return isMobileDevice() && !error?.deviceIndependent
      ? `${detail} Please use a desktop computer for this model.`
      : detail;
  };
  const validationError = (detail) => Object.assign(new Error(detail), { deviceIndependent:true });

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
    const usesModel = ["ready", "modify"].includes(fileStatus);
    document.querySelector("#file-upload-row").classList.toggle("hidden", !usesModel);
    document.querySelector("#model-file").required = usesModel;
    document.querySelector("#model-preview").classList.toggle("hidden", !usesModel || !loadedModel);
  }

  function payloadFromForm() {
    const values = Object.fromEntries(new FormData(form));
    const usesSlicer = ["ready", "modify"].includes(values.file_status) && slicedPrintTime;
    return {
      p_file_status: values.file_status,
      p_quantity: Number(values.quantity),
      p_print_hours_per_item: usesSlicer ? slicedPrintTime.hours : null,
      p_print_minutes_per_item: usesSlicer ? slicedPrintTime.minutes : null,
      p_filament_grams_per_item: usesSlicer ? slicedPrintTime.grams : null,
      p_size_category: usesSlicer ? null : "not_sure",
      p_colour_count: values.colour_count,
      p_design_level: values.design_level,
      p_assembly_required: values.assembly_required === "true"
    };
  }

  function validateFile() {
    if (!["ready", "modify"].includes(selected("file_status"))) return null;
    const file = document.querySelector("#model-file").files[0];
    if (!file) throw validationError("Choose a 3D model file so we can prepare the print-time estimate.");
    const extension = file.name.split(".").pop().toLowerCase();
    if (!supportedExtensions.includes(extension)) throw validationError("Choose an STL, 3MF, OBJ, STEP, or STP file.");
    if (file.size > maxFileBytes) throw validationError("The 3D file must be 25 MB or smaller.");
    return { file, extension };
  }

  async function handleModelFile(event) {
    const preview = document.querySelector("#model-preview");
    const status = document.querySelector("#model-status");
    loadedModel = null;
    slicedPrintTime = null;
    preview.classList.add("hidden");
    const file = event.target.files[0];
    if (!file) return;
    try {
      validateFile();
      preview.classList.remove("hidden");
      status.textContent = "Preparing the 3D preview…";
      modelLoadPromise = loadAndPreviewModel(file, document.querySelector("#model-viewer"));
      loadedModel = await modelLoadPromise;
      const { x, y, z } = loadedModel.dimensions;
      if (Math.max(x, y, z) > maxModelDimensionMm) {
        loadedModel = null;
        throw validationError("The model must fit within 250 × 250 × 250 mm.");
      }
      status.textContent = `Model ready: ${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm.`;
    } catch (error) {
      modelLoadPromise = null;
      status.textContent = withDesktopFallback(error);
    }
  }

  function slicingProgress(event) {
    const status = document.querySelector("#slice-status");
    if (event?.stage) status.textContent = `${event.stage}…`;
    else if (event?.slice !== undefined) status.textContent = "Slicing the model…";
    else if (event?.prepare !== undefined) status.textContent = "Preparing toolpaths…";
    else if (event?.export !== undefined) status.textContent = "Generating G-code…";
  }

  async function calculate(event) {
    event.preventDefault();
    message.textContent = "";
    if (!form.reportValidity()) return;
    try {
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      const fileStatus = selected("file_status");
      const printProfile = selected("print_profile");
      if (["ready", "modify"].includes(fileStatus)) {
        validateFile();
        button.textContent = "Preparing model…";
        if (modelLoadPromise) loadedModel = await modelLoadPromise;
        if (!loadedModel) throw new Error("Wait for the 3D model preview to finish, then try again.");
        const sliced = await sliceModel(loadedModel, printProfile, slicingProgress);
        const parsed = gcodeTime?.parse(sliced.gcode);
        const estimatedSeconds = sliced.seconds || parsed?.seconds;
        if (!estimatedSeconds) throw new Error("The slicer generated G-code but did not return a usable print-time estimate.");
        slicedPrintTime = { ...gcodeTime.toHoursMinutes(estimatedSeconds), grams:sliced.filamentGrams };
        document.querySelector("#slice-status").textContent = `Estimated print time: ${slicedPrintTime.hours} hours ${slicedPrintTime.minutes} minutes. Estimated filament: ${slicedPrintTime.grams.toFixed(1)} g per item.`;
      } else {
        slicedPrintTime = null;
      }
      const payload = payloadFromForm();
      button.textContent = "Calculating price…";
      const { data, error } = await client.rpc("calculate_print_estimate", payload);
      if (error) throw validationError(error.message || "The pricing service could not calculate this estimate.");
      calculatedPayload = payload;
      calculatedResult = Array.isArray(data) ? data[0] : data;
      renderEstimate(calculatedResult);
      button.disabled = false;
      button.textContent = "Recalculate estimate";
    } catch (error) {
      message.textContent = ["ready", "modify"].includes(selected("file_status"))
        ? withDesktopFallback(error)
        : (error.message || "We could not calculate this estimate. Please try again.");
      const button = form.querySelector('button[type="submit"]');
      button.disabled = false;
      button.textContent = "Calculate estimate";
    }
  }

  function renderEstimate(estimate) {
    result.classList.remove("hidden");
    const material = estimate.material_grams_per_item == null ? "File review" : `${Number(estimate.material_grams_per_item).toFixed(1)} g per item`;
    result.innerHTML = `<p class="eyebrow">Your estimate is ready</p><h2>Estimated Project Price</h2><p class="price">${range(estimate.estimated_price_min, estimate.estimated_price_max)} CAD</p><div class="result-meta"><span><strong>Quantity:</strong> ${escapeHtml(calculatedPayload.p_quantity)}</span><span><strong>Approximate price per item:</strong> ${range(estimate.price_per_item_min, estimate.price_per_item_max)} CAD</span><span><strong>Estimated filament:</strong> ${escapeHtml(material)}</span></div>${estimate.requires_manual_review ? '<p class="notice"><strong>File review required.</strong> This project needs manual confirmation before final pricing.</p>' : ""}<p>Estimate only. Final pricing is confirmed after your project and files are reviewed.</p><p>Submitting an estimate does not create an order or charge you. If you contacted us through Etsy, your final order and payment will be completed through Etsy.</p><div class="result-actions"><button id="submit-estimate" class="primary-button" type="button">SUBMIT ESTIMATE</button></div><p id="submit-message" role="alert"></p>`;
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
      const usedSlicer = calculatedPayload.p_size_category === null;
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
        p_print_time_source: usedSlicer ? "slicer" : "unknown",
        p_print_profile: usedSlicer ? values.print_profile : null,
        p_notes: values.notes.trim() || null
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
    if (event.target.name === "file_status") updateConditionalFields();
    if (calculatedPayload) { calculatedPayload = null; calculatedResult = null; result.classList.add("hidden"); result.innerHTML = ""; }
  });
  document.querySelector("#model-file").addEventListener("change", handleModelFile);
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
