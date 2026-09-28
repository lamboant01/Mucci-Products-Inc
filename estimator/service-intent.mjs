export const SERVICE_INTENTS = Object.freeze({
  DESIGN_ONLY:"DESIGN_ONLY",
  DESIGN_AND_PRINT:"DESIGN_AND_PRINT",
  PRINT_ONLY:"PRINT_ONLY",
  MODIFY_AND_PRINT:"MODIFY_AND_PRINT"
});

const UNIT_TO_MM = Object.freeze({ mm:1, cm:10, inches:25.4 });

export function resolveServiceIntent(fileStatus, noFileIntent = "") {
  if (fileStatus === "ready") return SERVICE_INTENTS.PRINT_ONLY;
  if (fileStatus === "modify") return SERVICE_INTENTS.MODIFY_AND_PRINT;
  if (fileStatus === "design" && [SERVICE_INTENTS.DESIGN_ONLY, SERVICE_INTENTS.DESIGN_AND_PRINT].includes(noFileIntent)) return noFileIntent;
  return "";
}

export function dimensionsToMm({ length, width, height, unit }, maximumMm = 1000) {
  const factor = UNIT_TO_MM[unit];
  if (!factor) throw new Error("Choose mm, cm, or inches for the dimensions.");
  const values = [length, width, height].map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error("Enter a length, width, and height greater than zero.");
  const millimetres = values.map((value) => value * factor);
  if (millimetres.some((value) => value > maximumMm)) throw new Error(`Each finished dimension must be ${maximumMm} mm or less.`);
  return { x:millimetres[0], y:millimetres[1], z:millimetres[2] };
}

export function unitMaximum(unit, maximumMm = 1000) {
  const factor = UNIT_TO_MM[unit] || 1;
  return Number((maximumMm / factor).toFixed(unit === "inches" ? 3 : 2));
}

export function requiresPrintSplitting({ x, y, z }, printableMaximumMm = 250) {
  return [x, y, z].some((value) => Number(value) > printableMaximumMm);
}

export function splitDimensionsForPrint({ x, y, z }, printableMaximumMm = 250) {
  if (![x, y, z].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Enter valid finished dimensions before planning printable sections.");
  const counts = [x, y, z].map((value) => Math.ceil(value / printableMaximumMm));
  return {
    sectionDimensions:{ x:x / counts[0], y:y / counts[1], z:z / counts[2] },
    sectionCount:counts[0] * counts[1] * counts[2],
    axisCounts:{ x:counts[0], y:counts[1], z:counts[2] }
  };
}

export function includesPhysicalPrinting(intent) {
  return [SERVICE_INTENTS.DESIGN_AND_PRINT, SERVICE_INTENTS.PRINT_ONLY, SERVICE_INTENTS.MODIFY_AND_PRINT].includes(intent);
}

export function serviceLabel(intent) {
  return ({
    DESIGN_ONLY:"3D Design Only",
    DESIGN_AND_PRINT:"3D Design + 3D Printing",
    PRINT_ONLY:"3D Printing",
    MODIFY_AND_PRINT:"3D Model Modification + 3D Printing"
  })[intent] || "Not selected";
}
