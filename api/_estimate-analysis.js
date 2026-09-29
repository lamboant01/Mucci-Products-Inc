"use strict";

const crypto = require("node:crypto");
const db = require("./_admin-supabase");

const PATH_PATTERN = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(stl|3mf|obj|step|stp)$/;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ANALYSIS_BYTES = 60 * 1024 * 1024;
const MAX_FILES = 8;

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
  try {
    for (const input of inputs) {
      const original = input.path ? storagePath(input.path) : null;
      const analysis = storagePath(input.analysisPath, "stl");
      root ||= analysis.root;
      if (analysis.root !== root || (original && original.root !== root)) throw new Error("All model files must belong to one private quote upload.");
      const quantity = Number(input.quantity || 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("Each model quantity must be between 1 and 999.");
      let platesPerProject = 1;
      if (original) {
        const originalBytes = await privateFile(config, original.path, MAX_FILE_BYTES);
        if (request.uploadMode === "project") {
          platesPerProject = projectPlateCount(originalBytes);
          if (platesPerProject > 1) manualReview = true;
        }
      }
      const stl = await privateFile(config, analysis.path, MAX_ANALYSIS_BYTES);
      const sliced = slicer.slice(stl, profile);
      const seconds = Number(sliced?.stats?.time_estimate);
      const filamentMm = Number(sliced?.stats?.filament_mm);
      if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(filamentMm) || filamentMm <= 0) throw new Error(`${input.name || "A model"} could not be analyzed reliably.`);
      const hours = seconds / 3600;
      const grams = gramsFromLength(filamentMm, density);
      analyses.push({
        path:original?.path || null, analysis_path:analysis.path, name:String(input.name || "Model").slice(0, 255),
        size_bytes:Number(input.sizeBytes || 0), quantity, hours:Number(hours.toFixed(4)), grams:Number(grams.toFixed(3)),
        plate_count:platesPerProject, max_single_plate_hours:platesPerProject === 1 ? Number(hours.toFixed(4)) : null,
        analysis_status:platesPerProject > 1 ? "manual_plate_confirmation" : "ready"
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

module.exports = { analyze, configuration, price, projectPlateCount, requestBody, sign, storagePath, validateRequest, verify };
