import { createVirtualBoundingBoxModel, loadAndPreviewModel, sliceModel } from "./model-slicer.js";
import { SERVICE_INTENTS, dimensionsToMm, includesPhysicalPrinting, requiresPrintSplitting, resolveServiceIntent, serviceLabel, splitDimensionsForPrint, unitMaximum } from "./service-intent.mjs";

(function () {
  "use strict";

  const form = document.querySelector("#estimate-form");
  const result = document.querySelector("#estimate-result");
  const message = document.querySelector("#form-message");
  const config = window.MUCCI_CONFIG || {};
  const maxFileBytes = 25 * 1024 * 1024;
  const maxPrintableSectionDimensionMm = 250;
  const maxFinishedDimensionMm = 1000;
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
  // The public estimator must not inherit an administrator session saved by
  // another page on the same origin. Its database and Storage calls are
  // intentionally made with the anonymous role.
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
  });

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
  const serviceIntent = () => resolveServiceIntent(selected("file_status"), selected("service_intent"));
  const dimensionValues = () => ({
    length:form.elements.dimension_length.value,
    width:form.elements.dimension_width.value,
    height:form.elements.dimension_height.value,
    unit:form.elements.dimension_unit.value
  });

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
    const needsNoFileDetails = fileStatus === "design";
    const intent = serviceIntent();
    const designOnly = intent === SERVICE_INTENTS.DESIGN_ONLY;
    const designAndPrint = intent === SERVICE_INTENTS.DESIGN_AND_PRINT;
    document.querySelector("#file-upload-row").classList.toggle("hidden", !usesModel);
    document.querySelector("#model-file").required = usesModel;
    document.querySelector("#model-preview").classList.toggle("hidden", !usesModel || !loadedModel);
    document.querySelector("#service-intent-row").classList.toggle("hidden", !needsNoFileDetails);
    document.querySelector("#dimensions-row").classList.toggle("hidden", !needsNoFileDetails);
    form.querySelectorAll('[name="service_intent"]').forEach((input) => { input.required = needsNoFileDetails; input.disabled = !needsNoFileDetails; });
    ["dimension_length", "dimension_width", "dimension_height", "dimension_unit"].forEach((name) => {
      form.elements[name].required = needsNoFileDetails;
      form.elements[name].disabled = !needsNoFileDetails;
    });
    const splitInput = form.elements.split_and_assembly_accepted;
    splitInput.disabled = !needsNoFileDetails;
    if (!needsNoFileDetails) splitInput.checked = false;
    document.querySelector("#quantity-section").classList.toggle("hidden", designOnly || (needsNoFileDetails && !designAndPrint));
    document.querySelector("#print-profile-section").classList.toggle("hidden", needsNoFileDetails);
    document.querySelector("#colour-section").classList.toggle("hidden", designOnly || (needsNoFileDetails && !designAndPrint));
    document.querySelector("#assembly-section").classList.toggle("hidden", designOnly || (needsNoFileDetails && !designAndPrint));
    form.querySelectorAll('[name="print_profile"]').forEach((input) => { input.disabled = needsNoFileDetails; input.required = !needsNoFileDetails; });
    form.querySelectorAll('[name="colour_count"]').forEach((input) => { input.disabled = designOnly || (needsNoFileDetails && !designAndPrint); input.required = includesPhysicalPrinting(intent) && (!needsNoFileDetails || designAndPrint); });
    form.querySelectorAll('[name="assembly_required"]').forEach((input) => { input.disabled = designOnly || (needsNoFileDetails && !designAndPrint); input.required = includesPhysicalPrinting(intent) && (!needsNoFileDetails || designAndPrint); });
    document.querySelector("#service-intent-error").textContent = "";
    document.querySelector("#dimensions-error").textContent = "";
    updateSplitConfirmation();
    [...form.querySelectorAll("fieldset:not(.hidden)")].forEach((fieldset, index) => {
      const step = fieldset.querySelector("legend > span");
      if (step) step.textContent = String(index + 1);
    });
  }

  function validateNoFileDetails() {
    if (selected("file_status") !== "design") return null;
    if (!serviceIntent()) {
      document.querySelector("#service-intent-error").textContent = "Choose 3D Design Only or 3D Design + 3D Printing.";
      throw validationError("Choose what service you need.");
    }
    try {
      const dimensions = dimensionsToMm(dimensionValues(), maxFinishedDimensionMm);
      if (requiresPrintSplitting(dimensions, maxPrintableSectionDimensionMm) && !form.elements.split_and_assembly_accepted.checked) {
        throw new Error("Confirm that splitting the part into printable sections and assembly is acceptable.");
      }
      document.querySelector("#dimensions-error").textContent = "";
      return dimensions;
    } catch (error) {
      document.querySelector("#dimensions-error").textContent = error.message;
      throw validationError(error.message);
    }
  }

  function updateDimensionLimits() {
    const unit = form.elements.dimension_unit.value;
    const maximum = unitMaximum(unit, maxFinishedDimensionMm);
    ["dimension_length", "dimension_width", "dimension_height"].forEach((name) => { form.elements[name].max = String(maximum); });
  }

  function updateSplitConfirmation() {
    const row = document.querySelector("#split-confirmation-row");
    const input = form.elements.split_and_assembly_accepted;
    let oversized = false;
    if (selected("file_status") === "design") {
      try {
        oversized = requiresPrintSplitting(dimensionsToMm(dimensionValues(), maxFinishedDimensionMm), maxPrintableSectionDimensionMm);
      } catch (_) {}
    }
    row.classList.toggle("hidden", !oversized);
    input.required = oversized;
    input.disabled = selected("file_status") !== "design";
    if (!oversized) input.checked = false;
  }

  function payloadFromForm() {
    const values = Object.fromEntries(new FormData(form));
    const intent = resolveServiceIntent(values.file_status, values.service_intent);
    const physicalPrinting = includesPhysicalPrinting(intent);
    const usesSlicer = physicalPrinting && slicedPrintTime;
    const dimensions = values.file_status === "design" ? dimensionsToMm({ length:values.dimension_length, width:values.dimension_width, height:values.dimension_height, unit:values.dimension_unit }, maxFinishedDimensionMm) : null;
    const splitAccepted = Boolean(dimensions && requiresPrintSplitting(dimensions, maxPrintableSectionDimensionMm) && values.split_and_assembly_accepted === "true");
    return {
      p_file_status: values.file_status,
      p_service_intent: intent,
      p_quantity: intent === SERVICE_INTENTS.DESIGN_ONLY ? 1 : Number(values.quantity),
      p_print_hours_per_item: usesSlicer ? slicedPrintTime.hours : null,
      p_print_minutes_per_item: usesSlicer ? slicedPrintTime.minutes : null,
      p_filament_grams_per_item: usesSlicer ? slicedPrintTime.grams : null,
      p_colour_count: physicalPrinting ? values.colour_count : "1",
      p_design_level: values.design_level,
      p_assembly_required: physicalPrinting && (values.assembly_required === "true" || splitAccepted),
      p_split_and_assembly_accepted:splitAccepted,
      p_model_length_mm: dimensions?.x || loadedModel?.dimensions?.x || null,
      p_model_width_mm: dimensions?.y || loadedModel?.dimensions?.y || null,
      p_model_height_mm: dimensions?.z || loadedModel?.dimensions?.z || null
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
    if (event) status.textContent = "Preparing your estimate…";
  }

  async function calculate(event) {
    event.preventDefault();
    message.textContent = "";
    try {
      const noFileDimensions = validateNoFileDetails();
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      const fileStatus = selected("file_status");
      const intent = serviceIntent();
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
        document.querySelector("#slice-status").textContent = "";
      } else if (intent === SERVICE_INTENTS.DESIGN_AND_PRINT) {
        button.textContent = "Preparing preliminary print estimate…";
        const splitPlan = splitDimensionsForPrint(noFileDimensions, maxPrintableSectionDimensionMm);
        const virtualModel = createVirtualBoundingBoxModel(splitPlan.sectionDimensions);
        const sliced = await sliceModel(virtualModel, "preliminary", slicingProgress);
        if (!sliced.seconds) throw new Error("The preliminary print estimate could not be prepared from these dimensions.");
        slicedPrintTime = { ...gcodeTime.toHoursMinutes(sliced.seconds * splitPlan.sectionCount), grams:sliced.filamentGrams * splitPlan.sectionCount, sections:splitPlan.sectionCount };
        document.querySelector("#slice-status").textContent = "";
      } else {
        slicedPrintTime = null;
      }
      const payload = payloadFromForm();
      button.textContent = "Calculating price…";
      const { data, error } = await client.rpc("calculate_service_estimate", payload);
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
    const intent = calculatedPayload.p_service_intent;
    const plannedSectionCount = calculatedPayload.p_split_and_assembly_accepted
      ? splitDimensionsForPrint({ x:calculatedPayload.p_model_length_mm, y:calculatedPayload.p_model_width_mm, z:calculatedPayload.p_model_height_mm }, maxPrintableSectionDimensionMm).sectionCount
      : 1;
    const printingLabel = intent === SERVICE_INTENTS.DESIGN_AND_PRINT ? "Preliminary 3D Print Estimate" : "Physical 3D Printing";
    const designValue = range(estimate.design_estimate_min, estimate.design_estimate_max);
    const printValue = estimate.print_estimate_min == null ? "Not included" : `${range(estimate.print_estimate_min, estimate.print_estimate_max)} CAD`;
    const totalValue = range(estimate.estimated_total_min, estimate.estimated_total_max);
    const sectionNote = calculatedPayload.p_split_and_assembly_accepted ? ` The estimate plans for approximately ${escapeHtml(plannedSectionCount)} printable sections, with final cuts and joints confirmed during review.` : "";
    const preliminaryNote = intent === SERVICE_INTENTS.DESIGN_AND_PRINT ? `<p class="notice">This is a preliminary printing estimate based on the dimensions provided. Final printing cost may change once the finished 3D model is available. The overall dimensions are used as a conservative planning boundary; this does not assume the finished object is a solid block.${sectionNote}</p>` : "";
    const designOnlyNote = intent === SERVICE_INTENTS.DESIGN_ONLY ? `<p class="notice">This estimate covers creation of the 3D model only. Physical printing is not included.${sectionNote}</p>` : "";
    const quantityMeta = intent === SERVICE_INTENTS.DESIGN_ONLY ? "" : `<span><strong>Quantity:</strong> ${escapeHtml(calculatedPayload.p_quantity)}</span>`;
    result.classList.remove("hidden");
    result.innerHTML = `<p class="eyebrow">Your estimate is ready</p><h2>Estimate breakdown</h2><dl class="quote-breakdown"><div><dt>Service</dt><dd>${escapeHtml(serviceLabel(intent))}</dd></div>${intent === SERVICE_INTENTS.PRINT_ONLY ? "" : `<div><dt>3D Design Estimate</dt><dd>${designValue} CAD</dd></div>`}<div><dt>${printingLabel}</dt><dd>${printValue}</dd></div><div class="quote-total"><dt>Estimated ${intent === SERVICE_INTENTS.DESIGN_ONLY ? "Design" : "Project"} Total</dt><dd>${totalValue} CAD</dd></div></dl>${designOnlyNote}${preliminaryNote}<div class="result-meta">${quantityMeta}${estimate.print_price_per_item_min == null ? "" : `<span><strong>Approximate printing price per item:</strong> ${range(estimate.print_price_per_item_min, estimate.print_price_per_item_max)} CAD</span>`}</div>${estimate.requires_manual_review ? '<p class="notice"><strong>Review required.</strong> This project needs manual confirmation before final pricing.</p>' : ""}<p>Estimate only. Final pricing is confirmed after your project and files are reviewed.</p><p>Submitting an estimate does not create an order or charge you. If you contacted us through Etsy, your final order and payment will be completed through Etsy.</p><div class="result-actions"><button id="submit-estimate" class="primary-button" type="button">SUBMIT ESTIMATE</button></div><p id="submit-message" role="alert"></p>`;
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
      const intent = calculatedPayload.p_service_intent;
      const physicalPrinting = includesPhysicalPrinting(intent);
      const submittedDimensions = values.file_status === "design" ? dimensionsToMm({ length:values.dimension_length, width:values.dimension_width, height:values.dimension_height, unit:values.dimension_unit }, maxFinishedDimensionMm) : null;
      const selectedFile = validateFile();
      let filePath = null;
      if (selectedFile) {
        filePath = `${crypto.randomUUID()}/${crypto.randomUUID()}.${selectedFile.extension}`;
        const { error: uploadError } = await client.storage.from("print-estimate-files").upload(filePath, selectedFile.file, { upsert:false, contentType:selectedFile.file.type || "application/octet-stream" });
        if (uploadError) throw new Error(`The file could not be uploaded: ${uploadError.message}`);
      }
      const { data, error } = await client.rpc("submit_service_estimate", {
        ...calculatedPayload,
        p_name: values.name.trim() || null, p_file_path: filePath,
        p_original_file_name: selectedFile?.file.name || null,
        p_submitted_length: values.file_status === "design" ? Number(values.dimension_length) : null,
        p_submitted_width: values.file_status === "design" ? Number(values.dimension_width) : null,
        p_submitted_height: values.file_status === "design" ? Number(values.dimension_height) : null,
        p_dimension_unit: values.file_status === "design" ? values.dimension_unit : null,
        p_estimated_section_count: calculatedPayload.p_split_and_assembly_accepted ? splitDimensionsForPrint(submittedDimensions, maxPrintableSectionDimensionMm).sectionCount : 1,
        p_print_time_source: intent === SERVICE_INTENTS.DESIGN_AND_PRINT ? "virtual_bounding_box" : physicalPrinting ? "slicer" : "unknown",
        p_print_profile: intent === SERVICE_INTENTS.DESIGN_AND_PRINT ? "standard" : physicalPrinting ? values.print_profile : null,
        p_notes: values.notes.trim() || null
      });
      if (error) throw error;
      const submission = Array.isArray(data) ? data[0] : data;
      const processingBody = JSON.stringify({ quoteCode:submission.quote_code, notificationToken:submission.notification_token });
      const trigger = (url) => fetch(url, {
        method:"POST", headers:{ "Content-Type":"application/json" }, body:processingBody, keepalive:true
      }).then((response) => { if (!response.ok) console.error(`${url} could not process the saved estimate.`); });
      void Promise.allSettled([
        trigger("/api/estimate-notification"),
        ...(filePath ? [trigger("/api/estimate-drive")] : [])
      ]);
      renderSuccess(submission);
    } catch (error) {
      submitMessage.textContent = error.message || "We could not submit your estimate. Please try again.";
      submitButton.disabled = false;
      submitButton.textContent = "SUBMIT ESTIMATE";
    }
  }

  function renderSuccess(submission) {
    const quoteCode = submission.quote_code;
    const intent = calculatedPayload.p_service_intent;
    const etsyMessage = `Hi! I completed the Mucci Products 3D Printing Estimator.\n\nMy quote code is ${quoteCode}.\n\nPlease review my project and send me the final Etsy listing when ready.`;
    form.remove();
    result.classList.remove("hidden");
    const printing = submission.print_estimate_min == null ? "Not included" : `${range(submission.print_estimate_min, submission.print_estimate_max)} CAD`;
    result.innerHTML = `<p class="eyebrow">Estimate Submitted</p><h2>Saved estimate breakdown</h2><dl class="quote-breakdown"><div><dt>Service</dt><dd>${escapeHtml(serviceLabel(intent))}</dd></div>${intent === SERVICE_INTENTS.PRINT_ONLY ? "" : `<div><dt>3D Design</dt><dd>${range(submission.design_estimate_min, submission.design_estimate_max)} CAD</dd></div>`}<div><dt>${intent === SERVICE_INTENTS.DESIGN_AND_PRINT ? "Preliminary Printing" : "Physical Printing"}</dt><dd>${printing}</dd></div><div class="quote-total"><dt>Estimated Total</dt><dd>${range(submission.estimated_total_min, submission.estimated_total_max)} CAD</dd></div></dl><p>Your Quote Code:</p><div class="quote-code">${escapeHtml(quoteCode)}</div><p class="etsy-instruction">Send this code to Mucci Products on Etsy.</p><div class="result-actions"><button class="secondary-button" type="button" data-copy-code>COPY CODE</button><button class="secondary-button" type="button" data-copy-message>COPY ETSY MESSAGE</button><a class="primary-button" href="${escapeHtml(config.etsyUrl || "#")}" target="_blank" rel="noreferrer">OPEN ETSY</a></div><p class="notice">This is an estimate only. Final pricing will be confirmed after Mucci Products reviews your project.</p><p id="copy-status" role="status"></p>`;
    const copy = async (text, confirmation) => { await navigator.clipboard.writeText(text); document.querySelector("#copy-status").textContent = confirmation; };
    document.querySelector("[data-copy-code]").addEventListener("click", () => copy(quoteCode, "Quote code copied."));
    document.querySelector("[data-copy-message]").addEventListener("click", () => copy(etsyMessage, "Etsy message copied."));
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "file_status") renderDesignOptions();
    if (["file_status", "service_intent"].includes(event.target.name)) updateConditionalFields();
    if (event.target.name === "dimension_unit") updateDimensionLimits();
    if (["file_status", "dimension_length", "dimension_width", "dimension_height", "dimension_unit"].includes(event.target.name)) updateSplitConfirmation();
    if (calculatedPayload) { calculatedPayload = null; calculatedResult = null; result.classList.add("hidden"); result.innerHTML = ""; }
  });
  form.addEventListener("invalid", (event) => {
    if (event.target.name === "service_intent") document.querySelector("#service-intent-error").textContent = "Choose 3D Design Only or 3D Design + 3D Printing.";
    if (["dimension_length", "dimension_width", "dimension_height", "dimension_unit"].includes(event.target.name)) document.querySelector("#dimensions-error").textContent = "Complete the length, width, height, and unit with values greater than zero.";
  }, true);
  form.addEventListener("input", (event) => {
    if (event.target.name === "service_intent") document.querySelector("#service-intent-error").textContent = "";
    if (["dimension_length", "dimension_width", "dimension_height", "dimension_unit"].includes(event.target.name)) document.querySelector("#dimensions-error").textContent = "";
    if (["dimension_length", "dimension_width", "dimension_height", "dimension_unit"].includes(event.target.name)) updateSplitConfirmation();
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
