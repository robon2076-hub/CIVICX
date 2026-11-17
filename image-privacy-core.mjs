export function clampAndExpandBox(box, width, height, margin = 0.18) {
  const left = Number(box.x);
  const top = Number(box.y);
  const boxWidth = Number(box.width);
  const boxHeight = Number(box.height);
  if (![left, top, boxWidth, boxHeight, width, height].every(Number.isFinite) ||
      boxWidth <= 0 || boxHeight <= 0 || width <= 0 || height <= 0) {
    throw new Error("The privacy detector returned an invalid region.");
  }
  const padX = Math.max(4, boxWidth * margin);
  const padY = Math.max(4, boxHeight * margin);
  const x = Math.max(0, Math.floor(left - padX));
  const y = Math.max(0, Math.floor(top - padY));
  const right = Math.min(width, Math.ceil(left + boxWidth + padX));
  const bottom = Math.min(height, Math.ceil(top + boxHeight + padY));
  return { x, y, width: right - x, height: bottom - y };
}

export function tilePositions(length, tileSize, overlap = 0.2) {
  if (![length, tileSize, overlap].every(Number.isFinite) || length <= 0 || tileSize <= 0 ||
      overlap < 0 || overlap >= 1) {
    throw new Error("Invalid image tiling dimensions.");
  }
  if (length <= tileSize) return [0];
  const step = Math.max(1, Math.floor(tileSize * (1 - overlap)));
  const positions = [0];
  while (positions[positions.length - 1] + tileSize < length) {
    const next = Math.min(positions[positions.length - 1] + step, length - tileSize);
    if (next === positions[positions.length - 1]) break;
    positions.push(next);
  }
  return positions;
}

export function decodeYoloPlateOutput(output, confidenceThreshold = 0.2, inputSize = 640) {
  const data = output?.data;
  const dims = output?.dims;
  if (!data || !Array.isArray(dims) || dims.length !== 3 || dims[0] !== 1 ||
      dims[1] !== 5 || dims[2] < 1 || data.length !== dims[1] * dims[2]) {
    throw new Error("The plate detector returned an unsupported output shape.");
  }
  const candidates = [];
  const count = dims[2];
  for (let index = 0; index < count; index += 1) {
    const score = data[4 * count + index];
    if (!Number.isFinite(score) || score < confidenceThreshold) continue;
    const centerX = data[index];
    const centerY = data[count + index];
    const boxWidth = data[2 * count + index];
    const boxHeight = data[3 * count + index];
    if (![centerX, centerY, boxWidth, boxHeight].every(Number.isFinite) ||
        boxWidth <= 0 || boxHeight <= 0) continue;
    const left = Math.max(0, centerX - boxWidth / 2);
    const top = Math.max(0, centerY - boxHeight / 2);
    const right = Math.min(inputSize, centerX + boxWidth / 2);
    const bottom = Math.min(inputSize, centerY + boxHeight / 2);
    if (right > left && bottom > top) {
      candidates.push({ x: left, y: top, width: right - left, height: bottom - top, score });
    }
  }
  return suppressOverlaps(candidates);
}

export function suppressOverlaps(boxes, threshold = 0.45) {
  const ranked = [...boxes].sort((first, second) => second.score - first.score);
  const kept = [];
  while (ranked.length) {
    const current = ranked.shift();
    kept.push(current);
    for (let index = ranked.length - 1; index >= 0; index -= 1) {
      if (intersectionOverUnion(current, ranked[index]) > threshold) ranked.splice(index, 1);
    }
  }
  return kept;
}

function intersectionOverUnion(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = first.width * first.height + second.width * second.height - intersection;
  return union > 0 ? intersection / union : 0;
}
