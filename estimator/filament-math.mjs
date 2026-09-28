export const DEFAULT_FILAMENT_DIAMETER_MM = 1.75;
export const DEFAULT_FILAMENT_DENSITY_G_CM3 = 1.24;
export const FILAMENT_DENSITY_G_CM3 = Object.freeze({ PLA:1.24, PETG:1.27 });

export function filamentDensity(material) {
  const density = FILAMENT_DENSITY_G_CM3[String(material || "").toUpperCase()];
  if (!density) throw new Error("Choose PLA or PETG for the material.");
  return density;
}

export function filamentGrams(
  filamentLengthMm,
  diameterMm = DEFAULT_FILAMENT_DIAMETER_MM,
  densityGPerCm3 = DEFAULT_FILAMENT_DENSITY_G_CM3
) {
  const length = Number(filamentLengthMm);
  const diameter = Number(diameterMm);
  const density = Number(densityGPerCm3);
  if (!Number.isFinite(length) || length < 0) throw new Error("The slicer returned invalid filament usage.");
  if (!Number.isFinite(diameter) || diameter <= 0) throw new Error("The filament diameter is invalid.");
  if (!Number.isFinite(density) || density <= 0) throw new Error("The filament density is invalid.");
  const volumeMm3 = length * Math.PI * Math.pow(diameter / 2, 2);
  return volumeMm3 * density / 1000;
}
