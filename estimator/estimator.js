import { createVirtualBoundingBoxModel, loadAndPreviewModel, loadModelForSlicing } from "./model-slicer.js?v=a1-auto-beds-v1";
import { MAX_MODEL_FILES, removeUpload, validateUploadSelection } from "./multi-file.mjs?v=multi-file-v1";
import { SERVICE_INTENTS, dimensionsToMm, includesPhysicalPrinting, requiresPrintSplitting, resolveServiceIntent, serviceLabel, splitDimensionsForPrint, unitMaximum } from "./service-intent.mjs?v=multi-file-v1";

(function () {
  "use strict";
  const form = document.querySelector("#estimate-form");
  const result = document.querySelector("#estimate-result");
  const message = document.querySelector("#form-message");
  const config = window.MUCCI_CONFIG || {};
  const maxFileBytes = 25 * 1024 * 1024;
  const maxReferenceImageBytes = 10 * 1024 * 1024;
  const maxReferenceImages = 10;
  const maxModelDimensionMm = 250;
  const maxFinishedDimensionMm = 2500;
  const maxPrintableSections = 64;
  const supportedReferenceExtensions = ["png", "jpg", "jpeg", "webp", "heic", "heif", "gif"];
  const referenceContentTypes = Object.freeze({ png:"image/png", jpg:"image/jpeg", jpeg:"image/jpeg", webp:"image/webp", heic:"image/heic", heif:"image/heif", gif:"image/gif" });
  let calculatedRequest = null;
  let calculatedAnalysis = null;
  let analysisToken = "";
  let publicOptions = null;
  let modelItems = [];
  let uploadRoot = crypto.randomUUID();

  if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
    form.innerHTML = '<p class="notice">The estimator is temporarily unavailable. Please contact Mucci Products through Etsy.</p>';
    return;
  }
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, { auth:{ persistSession:false, autoRefreshToken:false, detectSessionInUrl:false } });
  const money = (value) => new Intl.NumberFormat("en-CA", { style:"currency", currency:"CAD" }).format(Number(value || 0));
  const selected = (name) => form.querySelector(`[name="${name}"]:checked`)?.value || "";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#39;", '"':"&quot;" })[character]);
  const validationError = (detail) => Object.assign(new Error(detail), { deviceIndependent:true });
  const serviceIntent = () => resolveServiceIntent(selected("file_status"), selected("service_intent"));
  const uploadMode = () => selected("upload_mode") || "individual";
  const formatSize = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  const dimensionValues = () => ({ length:form.elements.dimension_length.value, width:form.elements.dimension_width.value, height:form.elements.dimension_height.value, unit:form.elements.dimension_unit.value });
  const modelSectionPlan = (item) => item?.loaded?.dimensions ? splitDimensionsForPrint(item.loaded.dimensions, maxModelDimensionMm) : null;
  const oversizedModelItems = () => uploadMode() === "individual"
    ? modelItems.filter((item) => item.loaded && requiresPrintSplitting(item.loaded.dimensions, maxModelDimensionMm))
    : [];
  const uploadedSectionCount = () => modelItems.reduce((sum, item) => sum + (modelSectionPlan(item)?.sectionCount || 1) * Number(item.quantity || 1), 0);

  async function api(endpoint, body) {
    const response = await fetch(endpoint, { method:"POST", credentials:"same-origin", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "The estimate service could not complete this request.");
    return payload;
  }

  function invalidateEstimate() {
    if (!calculatedRequest) return;
    calculatedRequest = null;
    calculatedAnalysis = null;
    analysisToken = "";
    result.classList.add("hidden");
    result.innerHTML = "";
  }

  function renderDesignOptions() {
    if (!publicOptions) return;
    const ready = selected("file_status") === "ready";
    const options = ready ? [["none", "No design required", "$0"]] : [["simple", "Simple Design", `+${money(publicOptions.design_simple)} CAD`], ["medium", "Medium Design", `+${money(publicOptions.design_medium)} CAD`], ["complex", "Complex Design", `+${money(publicOptions.design_complex)} CAD`]];
    document.querySelector("#design-options").innerHTML = options.map(([value, label, price], index) => `<label class="choice"><input ${index === 0 ? "checked" : ""} required type="radio" name="design_level" value="${value}"><span><b>${label}</b><small>${price}</small></span></label>`).join("");
  }

  function updateAdvancedSettings() {
    const toggle = form.elements.advanced_settings_enabled;
    const panel = document.querySelector("#advanced-settings-panel");
    const canCustomize = ["ready", "modify"].includes(selected("file_status"));
    if (!canCustomize) toggle.checked = false;
    toggle.disabled = !canCustomize;
    const enabled = canCustomize && toggle.checked;
    toggle.setAttribute("aria-expanded", String(enabled));
    panel.classList.toggle("hidden", !enabled);
    ["infill_percent", "wall_loops", "infill_pattern"].forEach((name) => {
      form.elements[name].disabled = !enabled;
      form.elements[name].required = enabled;
    });
  }

  function updateConditionalFields() {
    const fileStatus = selected("file_status");
    const usesModel = ["ready", "modify"].includes(fileStatus);
    const noFile = fileStatus === "design";
    const intent = serviceIntent();
    const designOnly = intent === SERVICE_INTENTS.DESIGN_ONLY;
    document.querySelector("#file-upload-row").classList.toggle("hidden", !usesModel);
    document.querySelector("#model-preview").classList.toggle("hidden", !usesModel || !modelItems.some((item) => item.loaded));
    document.querySelector("#service-intent-row").classList.toggle("hidden", !noFile);
    document.querySelector("#dimensions-row").classList.toggle("hidden", !noFile);
    document.querySelector("#intended-use-row").classList.toggle("hidden", !noFile);
    form.querySelectorAll('[name="service_intent"]').forEach((input) => { input.required = noFile; input.disabled = !noFile; });
    ["dimension_length", "dimension_width", "dimension_height", "dimension_unit"].forEach((name) => { form.elements[name].required = noFile; form.elements[name].disabled = !noFile; });
    form.elements.application_description.required = noFile;
    form.elements.application_description.disabled = !noFile;
    form.elements.application_category.disabled = !noFile;
    document.querySelector("#quantity-section").classList.toggle("hidden", usesModel || designOnly);
    document.querySelector("#print-profile-section").classList.toggle("hidden", noFile);
    document.querySelector("#colour-section").classList.toggle("hidden", designOnly);
    document.querySelector("#assembly-section").classList.toggle("hidden", designOnly);
    form.querySelectorAll('[name="print_profile"]').forEach((input) => { input.disabled = noFile; input.required = !noFile; });
    updateAdvancedSettings();
    form.querySelectorAll('[name="colour_count"], [name="material"], [name="assembly_required"]').forEach((input) => { input.disabled = designOnly; input.required = includesPhysicalPrinting(intent); });
    form.elements.desired_colours.disabled = designOnly;
    form.elements.desired_colours.required = includesPhysicalPrinting(intent);
    updateSplitConfirmation();
    [...form.querySelectorAll("fieldset:not(.hidden)")].forEach((fieldset, index) => { const step = fieldset.querySelector("legend > span"); if (step) step.textContent = String(index + 1); });
  }

  function validateNoFileDetails() {
    if (selected("file_status") !== "design") return null;
    if (!serviceIntent()) throw validationError("Choose 3D Design Only or 3D Design + 3D Printing.");
    const dimensions = dimensionsToMm(dimensionValues(), maxFinishedDimensionMm);
    const splitPlan = splitDimensionsForPrint(dimensions, maxModelDimensionMm);
    if (splitPlan.sectionCount > maxPrintableSections) throw validationError(`These dimensions require more than ${maxPrintableSections} printable sections. Contact us through Etsy for manual review.`);
    if (splitPlan.sectionCount > 1 && !form.elements.split_and_assembly_accepted.checked) throw validationError("Confirm that splitting and assembly is acceptable.");
    return dimensions;
  }

  function updateDimensionLimits() {
    const unit = form.elements.dimension_unit.value;
    const maximum = unitMaximum(unit, maxFinishedDimensionMm);
    ["dimension_length", "dimension_width", "dimension_height"].forEach((name) => { form.elements[name].max = String(maximum); });
    document.querySelector("#dimension-limit-help").textContent = `Maximum ${maximum} ${unit || "mm"} per dimension.`;
  }

  function updateSplitConfirmation() {
    const row = document.querySelector("#split-confirmation-row");
    const input = form.elements.split_and_assembly_accepted;
    let oversized = false;
    let sections = 1;
    if (selected("file_status") === "design") {
      try {
        const plan = splitDimensionsForPrint(dimensionsToMm(dimensionValues(), maxFinishedDimensionMm), maxModelDimensionMm);
        oversized = plan.sectionCount > 1;
        sections = plan.sectionCount;
      } catch (_) {}
    } else if (["ready", "modify"].includes(selected("file_status"))) {
      oversized = oversizedModelItems().length > 0;
      sections = uploadedSectionCount();
    }
    row.classList.toggle("hidden", !oversized);
    input.required = oversized;
    input.disabled = !oversized;
    document.querySelector("#split-confirmation-help").textContent = oversized
      ? `This project needs approximately ${sections} printable section${sections === 1 ? "" : "s"} for the 250 × 250 × 250 mm print area. The estimator analyzes the complete geometry; exact cut and joint locations are confirmed during final review. This approval does not select the significant assembly option below.`
      : "This finished part is larger than the 250 × 250 × 250 mm print area. I understand the design may be divided into printable sections and reassembled after printing. This approval does not select the significant assembly option below.";
    if (!oversized) input.checked = false;
  }

  function renderModelFiles() {
    const project = uploadMode() === "project";
    document.querySelector("#model-file-count").textContent = `Files uploaded: ${modelItems.length} / ${project ? 1 : MAX_MODEL_FILES}`;
    document.querySelector("#model-file-list").innerHTML = modelItems.map((item) => `<article class="model-file-row">
      <div class="model-file-name"><strong title="${escapeHtml(item.file.name)}">${escapeHtml(item.file.name)}</strong><small>${escapeHtml(formatSize(item.file.size))} · <span>${escapeHtml(item.status)}</span></small></div>
      ${project ? '<span class="model-file-quantity">Complete project</span>' : `<label class="model-file-quantity">Qty <input type="number" min="1" max="999" step="1" inputmode="numeric" value="${escapeHtml(item.quantity)}" data-file-quantity="${escapeHtml(item.id)}" aria-label="Quantity for ${escapeHtml(item.file.name)}"></label>`}
      <button class="model-file-remove" type="button" data-remove-file="${escapeHtml(item.id)}">Remove</button></article>`).join("");
    document.querySelectorAll("[data-remove-file]").forEach((button) => button.addEventListener("click", () => {
      modelItems = removeUpload(modelItems, button.dataset.removeFile);
      renderModelFiles(); updateSplitConfirmation(); invalidateEstimate();
      if (!modelItems.length) document.querySelector("#model-preview").classList.add("hidden");
    }));
    document.querySelectorAll("[data-file-quantity]").forEach((input) => input.addEventListener("change", () => {
      const quantity = Number(input.value);
      input.setCustomValidity(Number.isInteger(quantity) && quantity >= 1 && quantity <= 999 ? "" : "Enter a quantity from 1 to 999.");
      if (!input.reportValidity()) return;
      const item = modelItems.find((candidate) => candidate.id === input.dataset.fileQuantity);
      if (item) item.quantity = quantity;
      updateSplitConfirmation();
      invalidateEstimate();
    }));
  }

  async function addModelFiles(files) {
    const mode = uploadMode();
    const incoming = validateUploadSelection(files, mode, maxFileBytes);
    if (mode === "individual" && modelItems.length + incoming.length > MAX_MODEL_FILES) throw validationError(`Choose no more than ${MAX_MODEL_FILES} individual model files.`);
    const additions = incoming.map((file) => ({ id:crypto.randomUUID(), file, extension:file.name.split(".").pop().toLowerCase(), quantity:1, status:"Preparing…", loaded:null, path:null, analysisPath:null, analysisPaths:[] }));
    modelItems = mode === "project" ? additions : [...modelItems, ...additions];
    renderModelFiles();
    document.querySelector("#model-upload-status").textContent = "Preparing model analysis…";
    for (const item of additions) {
      try {
        item.loaded = modelItems[0] === item ? await loadAndPreviewModel(item.file, document.querySelector("#model-viewer")) : await loadModelForSlicing(item.file);
        const { x, y, z } = item.loaded.dimensions;
        const sectionPlan = modelSectionPlan(item);
        item.status = mode === "project"
          ? `${item.loaded.objectCount} project group${item.loaded.objectCount === 1 ? "" : "s"} · ${item.loaded.plateCount} auto-arranged A1 bed${item.loaded.plateCount === 1 ? "" : "s"} · largest ${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm · Ready`
          : sectionPlan.sectionCount > 1
            ? `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm · approximately ${sectionPlan.sectionCount} printable sections · Split approval required`
            : `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm · Ready`;
      } catch (error) { item.status = error.message || "Analysis failed"; item.loaded = null; }
      renderModelFiles();
    }
    updateSplitConfirmation();
    document.querySelector("#model-upload-status").textContent = modelItems.every((item) => item.loaded) ? "All selected models are ready." : "One or more models could not be prepared.";
    document.querySelector("#model-preview").classList.toggle("hidden", !modelItems.some((item) => item.loaded));
    document.querySelector("#model-status").textContent = modelItems[0]?.status || "";
    invalidateEstimate();
  }

  function validateModels() {
    if (!["ready", "modify"].includes(selected("file_status"))) return [];
    validateUploadSelection(modelItems.map((item) => item.file), uploadMode(), maxFileBytes);
    if (modelItems.some((item) => !item.loaded)) throw validationError("Every selected model must finish preparing before pricing.");
    if (oversizedModelItems().length && !form.elements.split_and_assembly_accepted.checked) throw validationError("Confirm that splitting and assembly is acceptable for the oversized model.");
    if (modelItems.some((item) => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 999)) throw validationError("Each model quantity must be between 1 and 999.");
    if (modelItems.reduce((sum, item) => sum + item.quantity, 0) > 999) throw validationError("The combined model quantity cannot exceed 999 items.");
    return modelItems;
  }

  function validateReferenceImages() {
    const files = [...document.querySelector("#reference-images").files];
    if (files.length > maxReferenceImages) throw validationError(`Choose no more than ${maxReferenceImages} reference images.`);
    return files.map((file) => {
      const extension = file.name.split(".").pop().toLowerCase();
      if (!supportedReferenceExtensions.includes(extension)) throw validationError(`${file.name} is not a supported image.`);
      if (file.size <= 0 || file.size > maxReferenceImageBytes) throw validationError(`${file.name} must be 10 MB or smaller.`);
      return { file, extension, contentType:referenceContentTypes[extension] };
    });
  }

  async function uploadFile(path, file, contentType) {
    const { error } = await client.storage.from("print-estimate-files").upload(path, file, { upsert:false, contentType:contentType || file.type || "application/octet-stream" });
    if (error) throw new Error(`The file could not be uploaded: ${error.message}`);
  }

  async function ensureModelUploads(items, status) {
    for (const item of items) {
      if (!item.path) { status.textContent = `Uploading ${item.file.name}…`; item.path = `${uploadRoot}/${crypto.randomUUID()}.${item.extension}`; await uploadFile(item.path, item.file); }
      if (!item.analysisPaths.length) {
        if (item.extension === "stl") item.analysisPaths = [item.path];
        else {
          status.textContent = `Preparing ${item.loaded.analysisBeds.length} A1 print bed${item.loaded.analysisBeds.length === 1 ? "" : "s"} for ${item.file.name}…`;
          const uploadedPaths = [];
          for (const bed of item.loaded.analysisBeds) {
            const path = `${uploadRoot}/${crypto.randomUUID()}.stl`;
            await uploadFile(path, new Blob([bed.binaryStl], { type:"model/stl" }), "model/stl");
            uploadedPaths.push(path);
          }
          item.analysisPaths = uploadedPaths;
        }
        item.analysisPath = item.analysisPaths[0];
      }
    }
  }

  function baseRequest(values, dimensions) {
    const intent = resolveServiceIntent(values.file_status, values.service_intent);
    const physical = includesPhysicalPrinting(intent);
    const splitPlan = dimensions ? splitDimensionsForPrint(dimensions, maxModelDimensionMm) : null;
    const uploadedOversized = !dimensions && oversizedModelItems().length > 0;
    const splitAccepted = Boolean((splitPlan?.sectionCount > 1 || uploadedOversized) && values.split_and_assembly_accepted === "true");
    const quantity = ["ready", "modify"].includes(values.file_status) ? modelItems.reduce((sum, item) => sum + item.quantity, 0) : intent === SERVICE_INTENTS.DESIGN_ONLY ? 1 : Number(values.quantity);
    const advancedSettingsEnabled = values.advanced_settings_enabled === "true";
    return {
      fileStatus:values.file_status, serviceIntent:intent,
      applicationCategory:values.file_status === "design" ? values.application_category || null : null,
      applicationDescription:values.file_status === "design" ? values.application_description.trim() : null,
      uploadMode:["ready", "modify"].includes(values.file_status) ? uploadMode() : intent === SERVICE_INTENTS.DESIGN_AND_PRINT ? "virtual" : null,
      uploadRoot, quantity, printProfile:values.file_status === "design" ? "preliminary" : values.print_profile,
      advancedSettings:advancedSettingsEnabled ? {
        enabled:true,
        infillPercent:Number(values.infill_percent),
        wallLoops:Number(values.wall_loops),
        infillPattern:values.infill_pattern
      } : { enabled:false },
      material:physical ? values.material : null, colourCount:physical ? values.colour_count : "1",
      desiredColours:physical ? values.desired_colours.trim() : null, designLevel:values.design_level,
      assemblyRequired:physical && values.assembly_required === "true", splitAccepted,
      estimatedSectionCount:splitPlan?.sectionCount || (uploadedOversized ? uploadedSectionCount() : 1),
      modelLengthMm:dimensions?.x || Math.max(0, ...modelItems.map((item) => item.loaded?.dimensions?.x || 0)) || null,
      modelWidthMm:dimensions?.y || Math.max(0, ...modelItems.map((item) => item.loaded?.dimensions?.y || 0)) || null,
      modelHeightMm:dimensions?.z || Math.max(0, ...modelItems.map((item) => item.loaded?.dimensions?.z || 0)) || null,
      submittedLength:dimensions ? Number(values.dimension_length) : null, submittedWidth:dimensions ? Number(values.dimension_width) : null,
      submittedHeight:dimensions ? Number(values.dimension_height) : null, dimensionUnit:dimensions ? values.dimension_unit : null,
      shipping:0,
      modelFiles:modelItems.map((item) => ({ path:item.path, analysisPath:item.analysisPath, analysisPaths:item.analysisPaths, sectionCount:uploadMode() === "individual" ? modelSectionPlan(item)?.sectionCount || 1 : 1, name:item.file.name, sizeBytes:item.file.size, quantity:item.quantity }))
    };
  }

  async function calculate(event) {
    event.preventDefault(); message.textContent = "";
    const button = form.querySelector('button[type="submit"]');
    try {
      const dimensions = validateNoFileDetails();
      if (!form.reportValidity()) return;
      button.disabled = true;
      const values = Object.fromEntries(new FormData(form));
      const intent = serviceIntent();
      const status = document.querySelector("#slice-status");
      if (["ready", "modify"].includes(values.file_status)) await ensureModelUploads(validateModels(), status);
      const request = baseRequest(values, dimensions);
      if (intent === SERVICE_INTENTS.DESIGN_AND_PRINT) {
        const splitPlan = splitDimensionsForPrint(dimensions, maxModelDimensionMm);
        const virtual = createVirtualBoundingBoxModel(splitPlan.sectionDimensions);
        const path = `${uploadRoot}/${crypto.randomUUID()}.stl`;
        status.textContent = "Preparing the preliminary manufacturing analysis…";
        await uploadFile(path, new Blob([virtual.binaryStl], { type:"model/stl" }), "model/stl");
        request.virtualModels = [{ analysisPath:path, name:"Dimension-based preliminary model", quantity:splitPlan.sectionCount * Number(values.quantity) }];
      }
      button.textContent = "Analyzing models securely…";
      const response = await api("/api/estimate-analysis", { request });
      calculatedRequest = request; calculatedAnalysis = response.analysis; analysisToken = response.token;
      status.textContent = "";
      renderEstimate(response.estimate, response.analysis);
      button.textContent = "Recalculate estimate";
    } catch (error) { message.textContent = error.message || "We could not calculate this estimate."; button.textContent = "Calculate estimate"; }
    finally { button.disabled = false; }
  }

  function renderEstimate(estimate, analysis) {
    const intent = calculatedRequest.serviceIntent;
    const design = Number(estimate.design_fee || 0), assembly = Number(estimate.assembly_fee || 0), shipping = Number(estimate.shipping || 0);
    const assumptions = analysis.manufacturingAssumptions;
    const geometryLabels = { open_tray:"Open tray / organizer", enclosure:"Box / enclosure", thin_shell:"Thin shell / display", holder:"Holder / mount", bracket:"Bracket", structural:"Structural part", decorative:"Decorative object", mostly_solid:"Mostly solid part", unknown:"General-purpose part" };
    const categoryLabels = { organizer_tray:"Organizer / Tray", box_enclosure:"Box / Enclosure", holder_mount:"Holder / Mount", replacement_part:"Replacement Part", bracket_structural:"Bracket / Structural Part", decorative_item:"Decorative Item", prototype:"Prototype", sign_display:"Sign / Display", other:"Other" };
    const setupSummary = assumptions && intent !== SERVICE_INTENTS.DESIGN_ONLY
      ? `<section class="estimate-assumptions" aria-label="Preliminary manufacturing assumptions"><h3>Recommended print setup</h3><p><strong>${escapeHtml(assumptions.recommendedInfillPercent)}% infill · ${escapeHtml(assumptions.wallLoops)} walls</strong></p><p>Estimated construction: ${escapeHtml(categoryLabels[assumptions.category] || "Uncategorized")} / ${escapeHtml(geometryLabels[assumptions.geometryType] || assumptions.geometryType)}</p></section>`
      : "";
    const projectWarning = analysis.manualReview
      ? calculatedRequest.fileStatus === "design"
        ? '<p class="notice"><strong>May require printing in multiple sections.</strong> Exact cut, joint, and assembly details will be confirmed during final review.</p>'
        : '<p class="notice"><strong>Manual plate confirmation required.</strong> Mucci Products will verify the separate plate times before final pricing.</p>'
      : "";
    const shippingDisplay = shipping
      ? `<div><dt>Shipping</dt><dd>${escapeHtml(money(shipping))} CAD</dd></div>`
      : '<p class="shipping-note">Shipping is calculated separately once the destination and package details are confirmed.</p>';
    result.classList.remove("hidden");
    const estimateBasis = calculatedRequest.fileStatus === "design"
      ? "Because no printable 3D file was provided, material and print time are estimated from the dimensions and intended use. Final pricing is confirmed after the design is prepared."
      : "This is an automated estimate based on the uploaded 3D files and selected options.";
    result.innerHTML = `<p class="eyebrow">Your estimate is ready</p><h2>Estimate breakdown</h2><dl class="quote-breakdown"><div><dt>Service</dt><dd>${escapeHtml(serviceLabel(intent))}</dd></div>${intent === SERVICE_INTENTS.DESIGN_ONLY ? "" : `<div><dt>Estimated material</dt><dd>~${escapeHtml(Math.round(Number(analysis.totalGrams)))} g</dd></div><div><dt>Manufacturing estimate</dt><dd>${escapeHtml(money(estimate.manufacturing_total))} CAD</dd></div>`}${design ? `<div><dt>Design</dt><dd>${escapeHtml(money(design))} CAD</dd></div>` : ""}${assembly ? `<div><dt>Assembly</dt><dd>${escapeHtml(money(assembly))} CAD</dd></div>` : ""}${shipping ? shippingDisplay : ""}<div class="quote-total"><dt>Estimated total</dt><dd>${escapeHtml(money(estimate.estimated_total_max))} CAD</dd></div></dl>${shipping ? "" : shippingDisplay}${setupSummary}${projectWarning}${estimate.requires_manual_review ? '<p class="notice"><strong>Review required.</strong> Final pricing will be confirmed after project review.</p>' : ""}<section class="estimate-disclaimer" aria-labelledby="estimate-disclaimer-title"><h3 id="estimate-disclaimer-title">About this estimate</h3><p>${escapeHtml(estimateBasis)} Final pricing is confirmed after Mucci Products reviews the project for printability, sizing, material requirements and production setup. Changes to the files, quantity, material, colour or requested specifications may require a revised quote. Shipping and applicable taxes are not included unless shown above.</p><p>Submitting this estimate does not place an order or begin production. We’ll review your project and confirm the final quote before payment.</p></section><div class="result-actions"><button id="submit-estimate" class="primary-button" type="button">REQUEST FINAL QUOTE</button></div><p id="submit-message" role="alert"></p>`;
    document.querySelector("#submit-estimate").addEventListener("click", submitEstimate);
    result.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  async function submitEstimate() {
    const button = document.querySelector("#submit-estimate"), status = document.querySelector("#submit-message");
    button.disabled = true; button.textContent = "Submitting…"; status.textContent = "";
    try {
      if (!analysisToken || !calculatedRequest || !calculatedAnalysis) throw new Error("Recalculate this estimate before submitting.");
      const values = Object.fromEntries(new FormData(form));
      const referenceFiles = [];
      for (const reference of validateReferenceImages()) {
        button.textContent = `Uploading ${reference.file.name}…`;
        const path = `${uploadRoot}/references/${crypto.randomUUID()}.${reference.extension}`;
        await uploadFile(path, reference.file, reference.contentType);
        referenceFiles.push({ path, name:reference.file.name, content_type:reference.contentType, size_bytes:reference.file.size });
      }
      const submission = await api("/api/estimate-submit", { token:analysisToken, customer:{ name:values.name.trim() || null, notes:values.notes.trim() || null, referenceFiles } });
      const processingBody = JSON.stringify({ quoteCode:submission.quote_code, notificationToken:submission.notification_token });
      const trigger = (url) => fetch(url, { method:"POST", headers:{ "Content-Type":"application/json" }, body:processingBody, keepalive:true });
      void Promise.allSettled([trigger("/api/estimate-notification"), ...(calculatedRequest.modelFiles.length || referenceFiles.length ? [trigger("/api/estimate-drive")] : [])]);
      renderSuccess(submission);
    } catch (error) { status.textContent = error.message || "We could not submit your estimate."; button.disabled = false; button.textContent = "REQUEST FINAL QUOTE"; }
  }

  function renderSuccess(submission) {
    const code = submission.quote_code;
    const etsyMessage = `Hi! I completed the Mucci Products 3D Printing Estimator.\n\nMy quote code is ${code}.\n\nPlease review my project and send me the final Etsy listing when ready.`;
    form.remove(); result.classList.remove("hidden");
    result.innerHTML = `<p class="eyebrow">Estimate submitted</p><h2>Saved estimate</h2><dl class="quote-breakdown"><div><dt>Manufacturing</dt><dd>${money(submission.manufacturing_total)} CAD</dd></div>${Number(submission.design_fee) ? `<div><dt>Design</dt><dd>${money(submission.design_fee)} CAD</dd></div>` : ""}${Number(submission.assembly_fee) ? `<div><dt>Assembly</dt><dd>${money(submission.assembly_fee)} CAD</dd></div>` : ""}<div class="quote-total"><dt>Estimated total</dt><dd>${money(submission.estimated_total_max)} CAD</dd></div></dl><p>Your Quote Code:</p><div class="quote-code">${escapeHtml(code)}</div><p class="etsy-instruction">Send this code to Mucci Products on Etsy.</p><div class="result-actions"><button class="secondary-button" type="button" data-copy-code>COPY CODE</button><button class="secondary-button" type="button" data-copy-message>COPY ETSY MESSAGE</button><a class="primary-button" href="${escapeHtml(config.etsyUrl || "#")}" target="_blank" rel="noreferrer">OPEN ETSY</a></div><p class="notice">Shipping and final pricing are confirmed after review.</p><p id="copy-status" role="status"></p>`;
    const copy = async (text, confirmation) => { await navigator.clipboard.writeText(text); document.querySelector("#copy-status").textContent = confirmation; };
    document.querySelector("[data-copy-code]").addEventListener("click", () => copy(code, "Quote code copied."));
    document.querySelector("[data-copy-message]").addEventListener("click", () => copy(etsyMessage, "Etsy message copied."));
    window.scrollTo({ top:0, behavior:"smooth" });
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "file_status") { renderDesignOptions(); updateConditionalFields(); }
    if (event.target.name === "service_intent") updateConditionalFields();
    if (event.target.name === "advanced_settings_enabled") updateAdvancedSettings();
    if (event.target.name === "upload_mode") {
      modelItems = []; uploadRoot = crypto.randomUUID();
      document.querySelector("#individual-upload-row").classList.toggle("hidden", uploadMode() !== "individual");
      document.querySelector("#project-upload-row").classList.toggle("hidden", uploadMode() !== "project");
      document.querySelector("#model-files").value = ""; document.querySelector("#project-file").value = "";
      document.querySelector("#model-preview").classList.add("hidden"); renderModelFiles(); updateSplitConfirmation();
    }
    if (event.target.name === "dimension_unit") updateDimensionLimits();
    if (["file_status", "dimension_length", "dimension_width", "dimension_height", "dimension_unit"].includes(event.target.name)) updateSplitConfirmation();
    invalidateEstimate();
  });
  form.addEventListener("input", (event) => { if (["dimension_length", "dimension_width", "dimension_height", "dimension_unit"].includes(event.target.name)) updateSplitConfirmation(); });
  document.querySelector("#model-files").addEventListener("change", async (event) => { try { await addModelFiles(event.target.files); event.target.value = ""; } catch (error) { document.querySelector("#model-upload-status").textContent = error.message; } });
  document.querySelector("#project-file").addEventListener("change", async (event) => { try { await addModelFiles(event.target.files); } catch (error) { document.querySelector("#model-upload-status").textContent = error.message; } });
  document.querySelector("#reference-images").addEventListener("change", () => { try { const files = validateReferenceImages(); document.querySelector("#reference-images-status").textContent = files.length ? `${files.length} reference image${files.length === 1 ? "" : "s"} ready.` : ""; } catch (error) { document.querySelector("#reference-images-status").textContent = error.message; } });
  form.addEventListener("submit", calculate);
  renderModelFiles(); updateConditionalFields();
  (async function loadPublicOptions() {
    const button = form.querySelector('button[type="submit"]');
    const { data, error } = await client.rpc("get_print_estimator_public_options");
    if (error) { message.textContent = "The estimator is not configured yet."; button.textContent = "Estimator unavailable"; return; }
    publicOptions = Array.isArray(data) ? data[0] : data;
    document.querySelector("#assembly-price").textContent = money(publicOptions.assembly_starting_price);
    renderDesignOptions(); button.disabled = false; button.textContent = "Calculate estimate";
  })();
})();
