const EPSILON = 1e-6;

function contains(outer, inner) {
  return inner.x + EPSILON >= outer.x && inner.y + EPSILON >= outer.y
    && inner.x + inner.width <= outer.x + outer.width + EPSILON
    && inner.y + inner.height <= outer.y + outer.height + EPSILON;
}

function intersects(a, b) {
  return a.x < b.x + b.width - EPSILON && a.x + a.width > b.x + EPSILON
    && a.y < b.y + b.height - EPSILON && a.y + a.height > b.y + EPSILON;
}

function splitFreeRect(rect, used) {
  if (!intersects(rect, used)) return [rect];
  const next = [];
  if (used.x > rect.x + EPSILON) next.push({ x:rect.x, y:rect.y, width:used.x - rect.x, height:rect.height });
  if (used.x + used.width < rect.x + rect.width - EPSILON) next.push({ x:used.x + used.width, y:rect.y, width:rect.x + rect.width - used.x - used.width, height:rect.height });
  if (used.y > rect.y + EPSILON) next.push({ x:rect.x, y:rect.y, width:rect.width, height:used.y - rect.y });
  if (used.y + used.height < rect.y + rect.height - EPSILON) next.push({ x:rect.x, y:used.y + used.height, width:rect.width, height:rect.y + rect.height - used.y - used.height });
  return next.filter((candidate) => candidate.width > EPSILON && candidate.height > EPSILON);
}

function pruneFreeRects(rects) {
  return rects.filter((rect, index) => !rects.some((other, otherIndex) => otherIndex !== index && contains(other, rect)));
}

function padded(value, spacing, maximum) {
  return Math.min(maximum, value + spacing);
}

function candidateFor(plate, item, bedWidth, bedDepth, spacing) {
  let best = null;
  const orientations = item.width === item.depth
    ? [{ rotated:false, width:item.width, depth:item.depth }]
    : [{ rotated:false, width:item.width, depth:item.depth }, { rotated:true, width:item.depth, depth:item.width }];
  for (const orientation of orientations) {
    const packedWidth = padded(orientation.width, spacing, bedWidth);
    const packedDepth = padded(orientation.depth, spacing, bedDepth);
    for (const rect of plate.freeRects) {
      if (packedWidth > rect.width + EPSILON || packedDepth > rect.height + EPSILON) continue;
      const shortFit = Math.min(rect.width - packedWidth, rect.height - packedDepth);
      const longFit = Math.max(rect.width - packedWidth, rect.height - packedDepth);
      const score = [shortFit, longFit, rect.y, rect.x, orientation.rotated ? 1 : 0];
      if (!best || score.some((value, index) => value < best.score[index] - EPSILON && score.slice(0, index).every((prior, priorIndex) => Math.abs(prior - best.score[priorIndex]) <= EPSILON))) {
        best = { ...orientation, packedWidth, packedDepth, x:rect.x, y:rect.y, score };
      }
    }
  }
  return best;
}

function place(plate, item, candidate) {
  const used = { x:candidate.x, y:candidate.y, width:candidate.packedWidth, height:candidate.packedDepth };
  plate.freeRects = pruneFreeRects(plate.freeRects.flatMap((rect) => splitFreeRect(rect, used)));
  const placement = {
    item,
    rotated:candidate.rotated,
    x:candidate.x + (candidate.packedWidth - candidate.width) / 2,
    y:candidate.y + (candidate.packedDepth - candidate.depth) / 2,
    width:candidate.width,
    depth:candidate.depth
  };
  plate.placements.push(placement);
  return placement;
}

export function packPrintBeds(items, options = {}) {
  const bedWidth = Number(options.bedWidth || 250);
  const bedDepth = Number(options.bedDepth || 250);
  const bedHeight = Number(options.bedHeight || 250);
  const spacing = Math.max(0, Number(options.spacing ?? 4));
  const maximumBeds = Math.max(1, Number(options.maximumBeds || 64));
  if (![bedWidth, bedDepth, bedHeight].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Invalid printer bed dimensions.");
  const prepared = items.map((item, index) => {
    const width = Number(item.width), depth = Number(item.depth), height = Number(item.height);
    if (![width, depth, height].every((value) => Number.isFinite(value) && value > 0)) throw new Error(`Object ${index + 1} has invalid dimensions.`);
    if (height > bedHeight + EPSILON || (width > bedWidth + EPSILON || depth > bedDepth + EPSILON) && (depth > bedWidth + EPSILON || width > bedDepth + EPSILON)) {
      throw new Error(`${item.name || `Object ${index + 1}`} is ${width.toFixed(1)} × ${depth.toFixed(1)} × ${height.toFixed(1)} mm and does not fit on a ${bedWidth} × ${bedDepth} × ${bedHeight} mm A1 print bed.`);
    }
    return { ...item, width, depth, height, originalIndex:index };
  }).sort((a, b) => Math.max(b.width, b.depth) - Math.max(a.width, a.depth) || b.width * b.depth - a.width * a.depth || a.originalIndex - b.originalIndex);

  const plates = [];
  for (const item of prepared) {
    let choice = null;
    for (let index = 0; index < plates.length; index += 1) {
      const candidate = candidateFor(plates[index], item, bedWidth, bedDepth, spacing);
      if (candidate && (!choice || candidate.score[0] < choice.candidate.score[0] - EPSILON || (Math.abs(candidate.score[0] - choice.candidate.score[0]) <= EPSILON && candidate.score[1] < choice.candidate.score[1] - EPSILON))) choice = { plate:plates[index], candidate };
    }
    if (!choice) {
      if (plates.length >= maximumBeds) throw new Error(`This project needs more than ${maximumBeds} A1 print beds and cannot be estimated automatically.`);
      const plate = { placements:[], freeRects:[{ x:0, y:0, width:bedWidth, height:bedDepth }] };
      plates.push(plate);
      choice = { plate, candidate:candidateFor(plate, item, bedWidth, bedDepth, spacing) };
    }
    if (!choice.candidate) throw new Error(`${item.name || "An object"} could not be arranged on an A1 print bed.`);
    place(choice.plate, item, choice.candidate);
  }
  return plates;
}
