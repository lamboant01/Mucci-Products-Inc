export const MODEL_EXTENSIONS = Object.freeze(["stl", "obj", "step", "stp"]);
export const MAX_MODEL_FILES = 20;

const extension = (file) => String(file?.name || "").split(".").pop().toLowerCase();

export function validateUploadSelection(files, mode, maximumBytes = 25 * 1024 * 1024) {
  const selected = [...(files || [])];
  if (mode === "project") {
    if (selected.length !== 1 || extension(selected[0]) !== "3mf") throw new Error("Choose one 3MF project file.");
  } else if (mode === "individual") {
    if (!selected.length || selected.length > MAX_MODEL_FILES) throw new Error(`Choose between 1 and ${MAX_MODEL_FILES} individual model files.`);
    if (selected.some((file) => !MODEL_EXTENSIONS.includes(extension(file)))) throw new Error("Individual uploads support STL, OBJ, STEP, or STP files. Use 3MF Project for a .3mf file.");
  } else {
    throw new Error("Choose individual model files or one 3MF project.");
  }
  for (const file of selected) {
    if (!Number.isFinite(Number(file.size)) || Number(file.size) < 1 || Number(file.size) > maximumBytes) throw new Error(`${file.name || "A model file"} must be 25 MB or smaller.`);
  }
  return selected;
}

export function removeUpload(items, id) {
  return items.filter((item) => item.id !== id);
}

export function aggregateReadyAnalyses(items) {
  if (!items.length || items.some((item) => item.status !== "ready")) throw new Error("Every model must be analyzed before pricing.");
  return items.reduce((total, item) => ({
    hours:total.hours + Number(item.hours) * Number(item.quantity || 1),
    grams:total.grams + Number(item.grams) * Number(item.quantity || 1),
    plates:total.plates + Number(item.plates || 1) * Number(item.quantity || 1),
    maxSinglePlateHours:Math.max(total.maxSinglePlateHours, Number(item.maxSinglePlateHours || item.hours || 0))
  }), { hours:0, grams:0, plates:0, maxSinglePlateHours:0 });
}
