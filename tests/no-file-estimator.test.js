const test = require("node:test");
const assert = require("node:assert/strict");

const estimator = require("../api/_no-file-estimator");
const analysisService = require("../api/_estimate-analysis");

const baseRequest = (overrides = {}) => ({
  applicationCategory:"organizer_tray",
  applicationDescription:"An open drawer organizer with six compartments, a bottom, outer walls, and thin dividers.",
  modelLengthMm:260, modelWidthMm:440, modelHeightMm:60,
  material:"PLA", quantity:1, colourCount:"1", estimatedSectionCount:2,
  virtualModels:[{ analysisPath:"11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.stl", name:"Preliminary intended-use reference" }],
  ...overrides
});

test("A: open organizer uses tray construction instead of a solid bounding box", () => {
  const request = baseRequest();
  const assumptions = estimator.fallbackClassification(request);
  const result = estimator.estimateNoFileManufacturing(request, assumptions);
  assert.equal(assumptions.geometryType, "open_tray");
  assert.ok(assumptions.recommendedInfillPercent >= 10 && assumptions.recommendedInfillPercent <= 20);
  assert.ok(assumptions.wallLoops >= 3 && assumptions.wallLoops <= 4);
  assert.ok(result.totalGrams > 450 && result.totalGrams < 1000);
  assert.equal(result.manualReview, true);
  assert.equal(result.plateCount, 1, "oversize review must not become a per-plate surcharge");
  assert.equal("reason" in result.manufacturingAssumptions, false, "internal AI reasoning must not be returned to the customer");
});

test("B: same dimensions described as a solid machine fixture estimate substantially more material", () => {
  const organizerRequest = baseRequest();
  const organizer = estimator.estimateNoFileManufacturing(organizerRequest, estimator.fallbackClassification(organizerRequest));
  const fixtureRequest = baseRequest({ applicationCategory:"other", applicationDescription:"A mostly solid machine fixture for compression and heavy loading." });
  const fixture = estimator.estimateNoFileManufacturing(fixtureRequest, estimator.fallbackClassification(fixtureRequest));
  assert.equal(fixture.manufacturingAssumptions.geometryType, "mostly_solid");
  assert.ok(fixture.totalGrams > organizer.totalGrams * 2);
});

test("C: decorative item receives low infill and bounded utilization", () => {
  const request = baseRequest({ applicationCategory:"decorative_item", applicationDescription:"A decorative sculpture with a hollow interior." });
  const assumptions = estimator.fallbackClassification(request);
  assert.equal(assumptions.geometryType, "decorative");
  assert.ok(assumptions.recommendedInfillPercent <= 15);
  assert.ok(assumptions.geometryUtilizationFactor >= 0.15 && assumptions.geometryUtilizationFactor <= 0.40);
});

test("small identical items apply the minimum production allowance to every requested item", () => {
  const singleRequest = baseRequest({
    applicationCategory:"decorative_item", applicationDescription:"Bear claw, long and thin.",
    modelLengthMm:5, modelWidthMm:7.5, modelHeightMm:40, estimatedSectionCount:1
  });
  const batchRequest = { ...singleRequest, quantity:28 };
  const assumptions = estimator.fallbackClassification(singleRequest);
  const single = estimator.estimateNoFileManufacturing(singleRequest, assumptions);
  const batch = estimator.estimateNoFileManufacturing(batchRequest, assumptions);
  assert.equal(batch.files[0].quantity, 28);
  assert.ok(Math.abs(batch.totalGrams - single.totalGrams * 28) < 0.02);
  assert.equal(batch.totalHours, Number((single.totalHours * 28).toFixed(4)));
});

test("D: unavailable AI uses deterministic intended-use fallback", async () => {
  const assumptions = await estimator.classifyNoFilePart({ openaiKey:"test", openaiModel:"test" }, baseRequest(), async () => { throw new Error("network unavailable"); });
  assert.equal(assumptions.source, "fallback");
  assert.equal(assumptions.geometryType, "open_tray");
});

test("E: malformed or unsafe AI output uses fallback rather than unsafe values", async () => {
  const response = async () => ({ ok:true, json:async () => ({ output_text:JSON.stringify({
    geometryType:"open_tray", recommendedInfillPercent:99, wallLoops:40, topBottomLayers:1,
    geometryUtilizationFactor:4, strengthLevel:"normal", reason:"unsafe"
  }) }) });
  const assumptions = await estimator.classifyNoFilePart({ openaiKey:"test", openaiModel:"test" }, baseRequest(), response);
  assert.equal(assumptions.source, "fallback");
  assert.equal(assumptions.recommendedInfillPercent, 15);
});

test("valid structured AI assumptions are accepted and geometry-bounded", async () => {
  const response = async () => ({ ok:true, json:async () => ({ output_text:JSON.stringify({
    geometryType:"open_tray", recommendedInfillPercent:18, wallLoops:4, topBottomLayers:5,
    geometryUtilizationFactor:0.50, strengthLevel:"normal", reason:"Open organizer with dividers"
  }) }) });
  const assumptions = await estimator.classifyNoFilePart({ openaiKey:"test", openaiModel:"test" }, baseRequest(), response);
  assert.equal(assumptions.source, "ai");
  assert.equal(assumptions.geometryUtilizationFactor, 0.22);
});

test("no-file server analysis bypasses the slicer while uploaded-model code remains separate", async () => {
  const result = await analysisService.analyze({ openaiKey:"" }, {
    ...baseRequest(), fileStatus:"design", serviceIntent:"DESIGN_AND_PRINT", uploadMode:"virtual", modelFiles:[]
  });
  assert.equal(result.manufacturingAssumptions.source, "fallback");
  assert.equal(result.files[0].analysis_status, "manual_cut_plan");
  assert.ok(result.totalGrams > 0);
});

test("no-file server validation requires the intended-use description", () => {
  assert.throws(() => analysisService.validateRequest({
    ...baseRequest({ applicationDescription:"" }), fileStatus:"design", serviceIntent:"DESIGN_AND_PRINT", modelFiles:[]
  }), /Describe what you are making/);
});
