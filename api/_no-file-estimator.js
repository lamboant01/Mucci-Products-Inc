"use strict";

const CATEGORIES = new Set([
  "organizer_tray", "box_enclosure", "holder_mount", "replacement_part",
  "bracket_structural", "decorative_item", "prototype", "sign_display", "other"
]);
const GEOMETRIES = new Set([
  "open_tray", "enclosure", "thin_shell", "holder", "bracket",
  "structural", "decorative", "mostly_solid", "unknown"
]);
const STRENGTHS = new Set(["light", "normal", "strong", "structural"]);
const GEOMETRY_LIMITS = Object.freeze({
  open_tray:[0.08, 0.22, 0.25], enclosure:[0.10, 0.25, 0.30], thin_shell:[0.06, 0.18, 0.22],
  holder:[0.12, 0.30, 0.40], bracket:[0.20, 0.45, 0.55], structural:[0.30, 0.60, 0.65],
  decorative:[0.15, 0.40, 0.45], mostly_solid:[0.45, 0.80, 0.85], unknown:[0.15, 0.35, 0.40]
});
const DEFAULTS = Object.freeze({
  organizer_tray:{ geometryType:"open_tray", recommendedInfillPercent:15, wallLoops:4, topBottomLayers:5, geometryUtilizationFactor:0.16, strengthLevel:"normal" },
  box_enclosure:{ geometryType:"enclosure", recommendedInfillPercent:15, wallLoops:4, topBottomLayers:5, geometryUtilizationFactor:0.20, strengthLevel:"normal" },
  holder_mount:{ geometryType:"holder", recommendedInfillPercent:25, wallLoops:4, topBottomLayers:5, geometryUtilizationFactor:0.25, strengthLevel:"strong" },
  replacement_part:{ geometryType:"structural", recommendedInfillPercent:30, wallLoops:5, topBottomLayers:5, geometryUtilizationFactor:0.35, strengthLevel:"strong" },
  bracket_structural:{ geometryType:"bracket", recommendedInfillPercent:40, wallLoops:5, topBottomLayers:6, geometryUtilizationFactor:0.45, strengthLevel:"structural" },
  decorative_item:{ geometryType:"decorative", recommendedInfillPercent:10, wallLoops:3, topBottomLayers:4, geometryUtilizationFactor:0.25, strengthLevel:"light" },
  prototype:{ geometryType:"unknown", recommendedInfillPercent:12, wallLoops:3, topBottomLayers:4, geometryUtilizationFactor:0.20, strengthLevel:"light" },
  sign_display:{ geometryType:"thin_shell", recommendedInfillPercent:12, wallLoops:3, topBottomLayers:4, geometryUtilizationFactor:0.15, strengthLevel:"light" },
  other:{ geometryType:"unknown", recommendedInfillPercent:20, wallLoops:4, topBottomLayers:5, geometryUtilizationFactor:0.30, strengthLevel:"normal" }
});

function clamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }

function inferredCategory(request) {
  const selected = String(request.applicationCategory || "");
  if (CATEGORIES.has(selected) && selected !== "other") return selected;
  const description = String(request.applicationDescription || "").toLowerCase();
  if (/tray|organizer|drawer|compartment|sorter/.test(description)) return "organizer_tray";
  if (/solid|machin(?:e|ing)|fixture|compression|press fit/.test(description)) return "replacement_part";
  if (/bracket|structural|load bearing|heavy load/.test(description)) return "bracket_structural";
  if (/holder|mount|stand|dock/.test(description)) return "holder_mount";
  if (/box|enclosure|case|housing/.test(description)) return "box_enclosure";
  if (/sign|display|plaque|letter/.test(description)) return "sign_display";
  if (/decor|ornament|sculpt|figur/.test(description)) return "decorative_item";
  if (/prototype|test fit|mockup/.test(description)) return "prototype";
  return "other";
}

function fallbackClassification(request, failureReason = "Deterministic intended-use fallback") {
  const category = inferredCategory(request);
  const description = String(request.applicationDescription || "").toLowerCase();
  const assumptions = /mostly solid|solid machine|solid fixture|solid block/.test(description)
    ? { geometryType:"mostly_solid", recommendedInfillPercent:50, wallLoops:6, topBottomLayers:6, geometryUtilizationFactor:0.65, strengthLevel:"structural" }
    : DEFAULTS[category];
  return { ...assumptions, source:"fallback", reason:failureReason, category };
}

function validateClassification(value, request) {
  if (!value || typeof value !== "object" || !GEOMETRIES.has(value.geometryType) || !STRENGTHS.has(value.strengthLevel)) return null;
  const infill = Number(value.recommendedInfillPercent);
  const walls = Number(value.wallLoops);
  const layers = Number(value.topBottomLayers);
  const utilization = Number(value.geometryUtilizationFactor);
  if (!Number.isInteger(infill) || infill < 5 || infill > 60 || !Number.isInteger(walls) || walls < 2 || walls > 6 ||
      !Number.isInteger(layers) || layers < 3 || layers > 8 || !Number.isFinite(utilization) || utilization < 0.05 || utilization > 0.85) return null;
  const [minimum, maximum] = GEOMETRY_LIMITS[value.geometryType];
  return {
    geometryType:value.geometryType, recommendedInfillPercent:infill, wallLoops:walls, topBottomLayers:layers,
    geometryUtilizationFactor:Number(clamp(utilization, minimum, maximum).toFixed(3)), strengthLevel:value.strengthLevel,
    source:"ai", reason:String(value.reason || "Intended-use classification").slice(0, 300),
    category:CATEGORIES.has(request.applicationCategory) ? request.applicationCategory : inferredCategory(request)
  };
}

function outputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) for (const content of item?.content || []) {
    if (typeof content?.text === "string") return content.text;
  }
  return "";
}

async function classifyNoFilePart(config, request, fetchImpl = globalThis.fetch) {
  if (!config.openaiKey || typeof fetchImpl !== "function") return fallbackClassification(request, "AI classification was unavailable");
  const schema = {
    type:"object", additionalProperties:false,
    properties:{
      geometryType:{ type:"string", enum:[...GEOMETRIES] }, recommendedInfillPercent:{ type:"integer" },
      wallLoops:{ type:"integer" }, topBottomLayers:{ type:"integer" }, geometryUtilizationFactor:{ type:"number" },
      strengthLevel:{ type:"string", enum:[...STRENGTHS] }, reason:{ type:"string" }
    },
    required:["geometryType", "recommendedInfillPercent", "wallLoops", "topBottomLayers", "geometryUtilizationFactor", "strengthLevel", "reason"]
  };
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method:"POST", headers:{ Authorization:`Bearer ${config.openaiKey}`, "Content-Type":"application/json" },
      signal:AbortSignal.timeout(12000),
      body:JSON.stringify({
        model:config.openaiModel || "gpt-6-luna", store:false,
        instructions:"Classify a proposed FDM part for preliminary estimating. Return conservative physical construction assumptions, not prose. Do not treat the full bounding box as solid material.",
        input:JSON.stringify({
          category:request.applicationCategory || null, description:request.applicationDescription,
          dimensionsMm:{ length:request.modelLengthMm, width:request.modelWidthMm, height:request.modelHeightMm },
          material:request.material, quantity:request.quantity, colourCount:request.colourCount
        }),
        text:{ format:{ type:"json_schema", name:"manufacturing_assumptions", strict:true, schema } }
      })
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const parsed = JSON.parse(outputText(await response.json()));
    return validateClassification(parsed, request) || fallbackClassification(request, "AI assumptions failed safety validation");
  } catch (_) {
    return fallbackClassification(request, "AI classification failed; deterministic intended-use defaults were used");
  }
}

function materialDensity(material) {
  if (material === "PLA") return 1.24;
  if (material === "PETG") return 1.27;
  throw new Error("Choose PLA or PETG for printing.");
}

function safeAssumptions(assumptions) {
  const { reason:internalReason, ...safe } = assumptions;
  void internalReason;
  return safe;
}

function estimateNoFileManufacturing(request, assumptions) {
  const x = Number(request.modelLengthMm), y = Number(request.modelWidthMm), z = Number(request.modelHeightMm);
  const quantity = Number(request.quantity), sections = Number(request.estimatedSectionCount || 1);
  if (![x, y, z].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw new Error("Invalid preliminary manufacturing dimensions or quantity.");
  const boundingVolume = x * y * z;
  let plasticVolume;
  if (assumptions.geometryType === "open_tray") {
    const bottomThickness = clamp(1.6 + assumptions.topBottomLayers * 0.16, 2.2, 3.2);
    const wallThickness = clamp(0.42 * assumptions.wallLoops, 1.2, 2.6);
    const dividerMultiplier = 0.75 + ((assumptions.geometryUtilizationFactor - 0.08) / 0.14) * 1.5;
    plasticVolume = (x * y * bottomThickness) + (2 * (x + y) * z * wallThickness) + ((x + y) * z * wallThickness * dividerMultiplier);
  } else {
    const occupiedVolume = boundingVolume * assumptions.geometryUtilizationFactor;
    const effectiveSolidFraction = clamp(0.22 + assumptions.wallLoops * 0.045 + assumptions.recommendedInfillPercent * 0.0055, 0.34, 0.82);
    plasticVolume = occupiedVolume * effectiveSolidFraction;
  }
  const maximumRatio = GEOMETRY_LIMITS[assumptions.geometryType][2];
  plasticVolume = clamp(plasticVolume, boundingVolume * 0.025, boundingVolume * maximumRatio);
  const gramsPerItem = plasticVolume / 1000 * materialDensity(request.material);
  const totalGrams = gramsPerItem * quantity;
  const complexity = ({ light:0.90, normal:1, strong:1.10, structural:1.18 })[assumptions.strengthLevel];
  const heightFactor = 1 + clamp(z / 500, 0, 0.35);
  const colourFactor = 1 + Math.max(0, Number(request.colourCount || 1) - 1) * 0.06;
  const totalHours = Math.max(0.35, (totalGrams / 18) * complexity * heightFactor * colourFactor + sections * quantity * 0.08);
  const analyzedQuantity = sections * quantity;
  const virtual = Array.isArray(request.virtualModels) ? request.virtualModels[0] : null;
  if (!virtual?.analysisPath) throw new Error("No preliminary analysis reference was supplied.");
  const printSettings = { custom:false, infill_percent:assumptions.recommendedInfillPercent, wall_loops:assumptions.wallLoops, infill_pattern:"grid", top_bottom_layers:assumptions.topBottomLayers };
  return {
    files:[{
      path:null, analysis_path:virtual.analysisPath, analysis_paths:[virtual.analysisPath], name:String(virtual.name || "Intended-use preliminary model").slice(0, 255),
      size_bytes:0, quantity:analyzedQuantity, hours:Number((totalHours / analyzedQuantity).toFixed(4)), grams:Number((totalGrams / analyzedQuantity).toFixed(3)),
      plate_count:1, max_single_plate_hours:null, analysis_status:sections > 1 ? "manual_cut_plan" : "intended_use_estimate", print_settings:printSettings
    }],
    totalHours:Number(totalHours.toFixed(4)), totalGrams:Number(totalGrams.toFixed(3)), plateCount:1,
    maxSinglePlateHours:0, manualReview:sections > 1,
    manufacturingAssumptions:{ ...safeAssumptions(assumptions), estimatedGramsPerItem:Number(gramsPerItem.toFixed(3)), estimatedSections:sections }
  };
}

module.exports = { CATEGORIES, classifyNoFilePart, estimateNoFileManufacturing, fallbackClassification, inferredCategory, safeAssumptions, validateClassification };
