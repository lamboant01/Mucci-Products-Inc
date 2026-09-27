function positiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function slicerTimeSeconds(result, parseGcode) {
  const direct = positiveSeconds(result?.stats?.time_estimate);
  if (direct) return direct;

  const layerTimes = result?.stats?.layer_times;
  if (Array.isArray(layerTimes) && layerTimes.length) {
    const total = layerTimes.reduce((sum, value) => sum + (positiveSeconds(value) || 0), 0);
    if (total > 0) return total;
  }

  if (typeof parseGcode === "function" && typeof result?.gcode === "string" && result.gcode) {
    const parsed = parseGcode(result.gcode);
    return positiveSeconds(parsed?.seconds);
  }
  return null;
}

export function slicerFilamentLength(result) {
  const length = Number(result?.stats?.filament_mm);
  return Number.isFinite(length) && length > 0 ? length : null;
}
