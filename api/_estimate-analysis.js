"use strict";

const crypto = require("node:crypto");
const db = require("./_admin-supabase");

const PATH_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(stl|3mf|obj|step|stp)$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ANALYSIS_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 8;
const MAX_ANALYSIS_PLATES = 64;

function configuration() {
  const values = {
    supabaseUrl:String(process.env.SUPABASE_URL || "").replace(/\/$/, ""),
    serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
    siteUrl:String(process.env.PUBLIC_SITE_URL || "https://mucciproducts.com").replace(/\/$/, "")
  };
  if (!values.supabaseUrl || !values.serviceKey) throw Object.assign(new Error("Estimate analysis is not configured."), { statusCode:503 });
  return values;
}

function requestBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (_) {} }
  return {};
}

function storagePath(value, extension) {
  const path = String(value || "").toLowerCase();
  const match = path.match(PATH_PATTERN);
  if (!match || (extension && match[3] !== extension)) throw new Error("Invalid private model path.");
  return { path, root:match[1], extension:match[3] };
}

async function privateFile(config, path, maximumBytes) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${config.supabaseUrl}/storage/v1/object/authenticated/print-estimate-files/${encoded}`, {
    headers:{ apikey:config.serviceKey, Authorization:`Bearer ${config.serviceKey}` },
    signal:AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error("A private model file could not be read for analysis.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) throw new Error("A model file exceeds the analysis limit.");
  return bytes;
}

function centralDirectoryNames(bytes) {
  const names = [];
  for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset += 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const count = bytes.readUInt16LE(offset + 10);
    let cursor = bytes.readUInt32LE(offset + 16);
    for (let index = 0; index < count && cursor + 46 <= bytes.length; index += 1) {
      if (bytes.readUInt32LE(cursor) !== 0x02014b50) break;
      const nameLength = bytes.readUInt16LE(cursor + 28);
      const extraLength = bytes.readUInt16LE(cursor + 30);
      const commentLength = bytes.readUInt16LE(cursor + 32);
      names.push(bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    break;
  }
  return names;
}

function projectPlateCount(bytes) {
  const indexes = new Set();
  for (const name of centralDirectoryNames(bytes)) {
    const match = name.match(/(?:^|\/)plate[_-]?(\d+)(?:\.|\/|_)/i);
    if (match) indexes.add(Number(match[1]));
  }
  return Math.max(1, indexes.size);
}

function validateRequest(value) {
  const request = value && typeof value === "object" ? value : {};
  const intent = String(request.serviceIntent || "");
  const files = Array.isArray(request.modelFiles) ? request.modelFiles : [];
  if (!["DESIGN_ONLY", "DESIGN_AND_PRINT", "PRINT_ONLY", "MODIFY_AND_PRINT"].includes(intent)) throw new Error("Invalid estimate service.");
  if (["PRINT_ONLY", "MODIFY_AND_PRINT"].includes(intent)) {
    if (request.uploadMode === "individual" && (files.length < 1 || files.length > MAX_FILES)) throw new Error("Upload between 1 and 8 model files.");
    if (request.uploadMode === "project" && (files.length !== 1 || !String(files[0]?.name || "").toLowerCase().endsWith(".3mf"))) throw new Error("Upload one 3MF project.");
    if (!["individual", "project"].includes(request.uploadMode)) throw new Error("Choose a model upload mode.");
  } else if (files.length) throw new Error("This design service does not accept an existing model upload.");
  if (files.length && new Set(files.map((file) => file.path)).size !== files.length) throw new Error("Duplicate model upload path.");
  return { ...request, modelFiles:files };
}

function materialDensity(material) {
  if (material === "PLA") return 1.24;
  if (material === "PETG") return 1.27;
  throw new Error("Choose PLA or PETG for printing.");
}

function gramsFromLength(lengthMm, density) {
  const radiusCm = 0.175 / 2;
  return Math.PI * radiusCm * radiusCm * (Number(lengthMm) / 10) * density;
}

function sliceForStatistics(slicer, stl, profile, name, options = {}) {
  try {
    // Quotes only need aggregate time and filament statistics. Discard each
    // streamed layer so large multi-part projects do not retain the complete
    // G-code and toolpath payload in server memory.
    const result = slicer.slice(stl, profile, { onLayer:() => {} });
    if (result?.error) throw new Error(result.error);
    if (result?.warnings?.includes("over_bed_model") && !options.allowOverBed) throw new Error(`${name || "This model"} does not fit within the print area.`);
    return result;
  } catch (error) {
    const detail = String(error?.message || error || "");
    if (/aborted|memory|out of bounds|allocation/i.test(detail)) {
      const safe = new Error(`${name || "This 3MF project"} is too complex for automatic slicing. Reduce the number of parts or submit the project for manual review through Etsy.`);
      safe.statusCode = 422;
      throw safe;
    }
    throw error;
  }
}

async function analyze(config, rawRequest) {
  const request = validateRequest(rawRequest);
  if (request.serviceIntent === "DESIGN_ONLY") return { files:[], totalHours:0, totalGrams:0, plateCount:0, maxSinglePlateHours:0, manualReview:false };
  const inputs = request.modelFiles.length ? request.modelFiles : request.virtualModels;
  if (!Array.isArray(inputs) || !inputs.length) throw new Error("No printable analysis geometry was supplied.");
  const { createSlicer } = await import("three-slicer");
  const { SLICER_PROFILES } = await import("../estimator/slicer-config.js");
  const profile = SLICER_PROFILES[String(request.printProfile || "")];
  if (!profile) throw new Error("Choose a valid print profile.");
  const density = materialDensity(request.material);
  const slicer = await createSlicer();
  const analyses = [];
  let root = "";
  let manualReview = false;
  let analysisPlateCount = 0;
  try {
    for (const input of inputs) {
      const original = input.path ? storagePath(input.path) : null;
      const requestedAnalysisPaths = Array.isArray(input.analysisPaths) && input.analysisPaths.length ? input.analysisPaths : [input.analysisPath];
      if (new Set(requestedAnalysisPaths).size !== requestedAnalysisPaths.length) throw new Error("Duplicate print-bed analysis path.");
      analysisPlateCount += requestedAnalysisPaths.length;
      if (analysisPlateCount > MAX_ANALYSIS_PLATES) throw new Error(`A project cannot exceed ${MAX_ANALYSIS_PLATES} automatically arranged print beds.`);
      const analysisFiles = requestedAnalysisPaths.map((path) => storagePath(path, "stl"));
      root ||= analysisFiles[0].root;
      if (analysisFiles.some((analysis) => analysis.root !== root) || (original && original.root !== root)) throw new Error("All model files must belong to one private quote upload.");
      const quantity = Number(input.quantity || 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("Each model quantity must be between 1 and 999.");
      const sectionCount = Number(input.sectionCount || 1);
      if (!Number.isInteger(sectionCount) || sectionCount < 1 || sectionCount > MAX_ANALYSIS_PLATES) throw new Error("Invalid printable section count.");
      const splitAnalysis = sectionCount > analysisFiles.length;
      if (splitAnalysis && request.splitAccepted !== true) throw new Error("Splitting and assembly approval is required for an oversized model.");
      const platesPerProject = Math.max(analysisFiles.length, sectionCount);
      analysisPlateCount += platesPerProject - analysisFiles.length;
      if (analysisPlateCount > MAX_ANALYSIS_PLATES) throw new Error(`A project cannot exceed ${MAX_ANALYSIS_PLATES} automatically arranged print beds.`);
      if (splitAnalysis) manualReview = true;
      if (original) {
        const originalBytes = await privateFile(config, original.path, MAX_FILE_BYTES);
        if (!originalBytes.length) throw new Error("The original model file is empty.");
      }
      let seconds = 0, filamentMm = 0, longestSeconds = 0;
      for (let plateIndex = 0; plateIndex < analysisFiles.length; plateIndex += 1) {
        const stl = await privateFile(config, analysisFiles[plateIndex].path, MAX_ANALYSIS_BYTES);
        const sliced = sliceForStatistics(slicer, stl, profile, `${input.name || "Model"} bed ${plateIndex + 1}`, { allowOverBed:splitAnalysis });
        const plateSeconds = Number(sliced?.stats?.time_estimate);
        const plateFilamentMm = Number(sliced?.stats?.filament_mm);
        if (!Number.isFinite(plateSeconds) || plateSeconds <= 0 || !Number.isFinite(plateFilamentMm) || plateFilamentMm <= 0) throw new Error(`${input.name || "A model"} could not be analyzed reliably.`);
        seconds += plateSeconds;
        filamentMm += plateFilamentMm;
        longestSeconds = Math.max(longestSeconds, plateSeconds);
      }
      const hours = seconds / 3600;
      const grams = gramsFromLength(filamentMm, density);
      analyses.push({
        path:original?.path || null, analysis_path:analysisFiles[0].path, analysis_paths:analysisFiles.map((analysis) => analysis.path), name:String(input.name || "Model").slice(0, 255),
        size_bytes:Number(input.sizeBytes || 0), quantity, hours:Number(hours.toFixed(4)), grams:Number(grams.toFixed(3)),
        plate_count:platesPerProject, max_single_plate_hours:splitAnalysis ? null : Number((longestSeconds / 3600).toFixed(4)),
        analysis_status:splitAnalysis ? "manual_cut_plan" : "ready"
      });
    }
  } finally {
    slicer.dispose();
  }
  const totalHours = analyses.reduce((sum, item) => sum + item.hours * item.quantity, 0);
  const totalGrams = analyses.reduce((sum, item) => sum + item.grams * item.quantity, 0);
  const plateCount = analyses.reduce((sum, item) => sum + item.plate_count * item.quantity, 0);
  const knownLongest = analyses.map((item) => item.max_single_plate_hours).filter(Number.isFinite);
  return {
    files:analyses, totalHours:Number(totalHours.toFixed(4)), totalGrams:Number(totalGrams.toFixed(3)), plateCount,
    maxSinglePlateHours:knownLongest.length ? Math.max(...knownLongest) : 0, manualReview
  };
}

function sign(config, payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", config.serviceKey).update(data).digest("base64url");
  return `${data}.${signature}`;
}

function verify(config, token) {
  const [data, signature, extra] = String(token || "").split(".");
  if (!data || !signature || extra) throw new Error("Invalid estimate analysis token.");
  const expected = crypto.createHmac("sha256", config.serviceKey).update(data).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error("Invalid estimate analysis token.");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  if (payload.version !== 1 || Number(payload.expiresAt) < Date.now()) throw new Error("The estimate analysis expired. Recalculate the quote.");
  return payload;
}

async function price(config, request, analysis) {
  const rows = await db.rpc(config, "calculate_multi_file_estimate", { p_request:request, p_analysis:analysis });
  return Array.isArray(rows) ? rows[0] : rows;
}

module.exports = { analyze, configuration, price, projectPlateCount, requestBody, sign, sliceForStatistics, storagePath, validateRequest, verify };
