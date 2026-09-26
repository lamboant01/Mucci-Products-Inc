(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MucciGcodeTime = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function durationToSeconds(value) {
    const text = String(value || "").trim().toLowerCase();
    const clock = text.match(/\b(\d{1,3}):(\d{2}):(\d{2})\b/);
    if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    let seconds = 0;
    let matched = false;
    const units = [["d", 86400], ["h", 3600], ["m", 60], ["s", 1]];
    units.forEach(([unit, multiplier]) => {
      const match = text.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}(?:ays?|ours?|in(?:utes?)?|ec(?:onds?)?)?\\b`, "i"));
      if (match) { seconds += Number(match[1]) * multiplier; matched = true; }
    });
    return matched && seconds > 0 ? Math.round(seconds) : null;
  }

  function parse(text) {
    const content = String(text || "");
    const cura = content.match(/^;\s*TIME\s*:\s*(\d+(?:\.\d+)?)\s*$/im);
    if (cura && Number(cura[1]) > 0) return { seconds:Math.ceil(Number(cura[1])), source:"Cura" };
    const readablePatterns = [
      /^;\s*estimated printing time(?:\s*\([^)]*\))?\s*=\s*([^\r\n]+)/im,
      /^;\s*(?:total estimated time|model printing time|build time)\s*[:=]\s*([^\r\n]+)/im
    ];
    for (const pattern of readablePatterns) {
      const match = content.match(pattern);
      const seconds = match ? durationToSeconds(match[1]) : null;
      if (seconds) return { seconds, source:"slicer" };
    }
    return null;
  }

  function toHoursMinutes(seconds) {
    const totalMinutes = Math.ceil(Number(seconds) / 60);
    return { hours:Math.floor(totalMinutes / 60), minutes:totalMinutes % 60 };
  }

  return { parse, toHoursMinutes };
});
