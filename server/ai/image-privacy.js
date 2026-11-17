const fs = require("node:fs");
const path = require("node:path");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const ort = require("onnxruntime-web");

const root = path.resolve(__dirname, "..", "..");
const FACE_MODEL = path.join(root, "assets", "models", "face_detection_yunet_2023mar.onnx");
const PLATE_MODEL = path.join(root, "assets", "models", "license-plate.onnx");
const FACE_STRIDES = [8, 16, 32];
const FACE_THRESHOLD = 0.45;
const MAX_SOURCE_DIMENSION = 3000;
const MAX_DETECTION_DIMENSION = 1280;
const TILE_SIZE = 640;
const PLATE_THRESHOLD = 0.2;
let modelsPromise;
let privacyCorePromise;

function verificationError(cause) {
  const error = new Error(
    "Server-side image privacy verification is unavailable. No photo was sent to Gemini.",
    cause ? { cause } : undefined
  );
  error.code = "PHOTO_PRIVACY_VERIFICATION_UNAVAILABLE";
  return error;
}

function rejectionError(message) {
  const error = new Error(message);
  error.code = "PHOTO_PRIVACY_REJECTED";
  return error;
}

function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      ort.env.wasm.numThreads = 1;
      let faceSession;
      let plateSession;
      try {
        faceSession = await ort.InferenceSession.create(
          new Uint8Array(fs.readFileSync(FACE_MODEL)),
          { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
        );
        plateSession = await ort.InferenceSession.create(
          new Uint8Array(fs.readFileSync(PLATE_MODEL)),
          { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
        );
        const faceOutputs = FACE_STRIDES.flatMap((stride) => [`cls_${stride}`, `obj_${stride}`, `bbox_${stride}`]);
        if (!faceSession.inputNames.includes("input") ||
            faceOutputs.some((name) => !faceSession.outputNames.includes(name)) ||
            !plateSession.inputNames.includes("images") ||
            !plateSession.outputNames.includes("output0")) {
          throw new Error("The server privacy models have incompatible input or output shapes.");
        }
        return { faceSession, plateSession };
      } catch (error) {
        if (faceSession) await faceSession.release();
        if (plateSession) await plateSession.release();
        throw error;
      }
    })().catch((error) => {
      modelsPromise = null;
      throw verificationError(error);
    });
  }
  return modelsPromise;
}

async function getPrivacyCore() {
  if (!privacyCorePromise) {
    privacyCorePromise = import("../../image-privacy-core.mjs");
  }
  return privacyCorePromise;
}

function makeLetterboxedTile(sourceCanvas, left, top, cropWidth, cropHeight) {
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
  const context = canvas.getContext("2d");
  const scale = Math.min(TILE_SIZE / cropWidth, TILE_SIZE / cropHeight);
  const drawnWidth = cropWidth * scale;
  const drawnHeight = cropHeight * scale;
  const offsetX = (TILE_SIZE - drawnWidth) / 2;
  const offsetY = (TILE_SIZE - drawnHeight) / 2;
  context.fillStyle = "#000";
  context.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
  context.drawImage(
    sourceCanvas,
    left, top, cropWidth, cropHeight,
    offsetX, offsetY, drawnWidth, drawnHeight
  );
  return { canvas, scale, offsetX, offsetY };
}

function makeFaceTensor(canvas) {
  const pixels = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  const planeSize = TILE_SIZE * TILE_SIZE;
  const values = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    values[pixel] = pixels[pixel * 4 + 2];
    values[planeSize + pixel] = pixels[pixel * 4 + 1];
    values[planeSize * 2 + pixel] = pixels[pixel * 4];
  }
  return new ort.Tensor("float32", values, [1, 3, TILE_SIZE, TILE_SIZE]);
}

function makePlateTensor(canvas) {
  const pixels = canvas.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
  const planeSize = TILE_SIZE * TILE_SIZE;
  const values = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    values[pixel] = pixels[pixel * 4] / 255;
    values[planeSize + pixel] = pixels[pixel * 4 + 1] / 255;
    values[planeSize * 2 + pixel] = pixels[pixel * 4 + 2] / 255;
  }
  return new ort.Tensor("float32", values, [1, 3, TILE_SIZE, TILE_SIZE]);
}

function containsFace(output, tile, sourceBounds) {
  for (const stride of FACE_STRIDES) {
    const count = (TILE_SIZE / stride) ** 2;
    const classes = output[`cls_${stride}`]?.data;
    const objects = output[`obj_${stride}`]?.data;
    const boxes = output[`bbox_${stride}`]?.data;
    if (!classes || !objects || !boxes || classes.length !== count ||
        objects.length !== count || boxes.length !== count * 4) {
      throw new Error("The face detector returned an unsupported output shape.");
    }
    for (let index = 0; index < count; index += 1) {
      const classScore = Math.max(0, Math.min(1, classes[index]));
      const objectScore = Math.max(0, Math.min(1, objects[index]));
      if (Math.sqrt(classScore * objectScore) < FACE_THRESHOLD) continue;

      const row = Math.floor(index / (TILE_SIZE / stride));
      const column = index % (TILE_SIZE / stride);
      const centerX = (column + boxes[index * 4]) * stride;
      const centerY = (row + boxes[index * 4 + 1]) * stride;
      const width = Math.exp(boxes[index * 4 + 2]) * stride;
      const height = Math.exp(boxes[index * 4 + 3]) * stride;
      if (![centerX, centerY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;

      const left = tile.left + (centerX - width / 2 - tile.offsetX) / tile.scale;
      const top = tile.top + (centerY - height / 2 - tile.offsetY) / tile.scale;
      const right = left + width / tile.scale;
      const bottom = top + height / tile.scale;
      if (right > sourceBounds.left && bottom > sourceBounds.top &&
          left < sourceBounds.right && top < sourceBounds.bottom) {
        return true;
      }
    }
  }
  return false;
}

async function containsFaceInPhoto(session, canvas, tilePositions) {
  for (const top of tilePositions(canvas.height, TILE_SIZE)) {
    for (const left of tilePositions(canvas.width, TILE_SIZE)) {
      const cropWidth = Math.min(TILE_SIZE, canvas.width - left);
      const cropHeight = Math.min(TILE_SIZE, canvas.height - top);
      const tile = makeLetterboxedTile(canvas, left, top, cropWidth, cropHeight);
      try {
        const output = await session.run({ input: makeFaceTensor(tile.canvas) });
        if (containsFace(output, { ...tile, left, top }, {
          left,
          top,
          right: left + cropWidth,
          bottom: top + cropHeight
        })) return true;
      } finally {
        tile.canvas.width = 0;
        tile.canvas.height = 0;
      }
    }
  }
  return false;
}

async function containsPlateInPhoto(session, canvas, decodeYoloPlateOutput, tilePositions) {
  for (const top of tilePositions(canvas.height, TILE_SIZE)) {
    for (const left of tilePositions(canvas.width, TILE_SIZE)) {
      const cropWidth = Math.min(TILE_SIZE, canvas.width - left);
      const cropHeight = Math.min(TILE_SIZE, canvas.height - top);
      const tile = makeLetterboxedTile(canvas, left, top, cropWidth, cropHeight);
      try {
        const output = await session.run({ images: makePlateTensor(tile.canvas) });
        const boxes = decodeYoloPlateOutput(output.output0, PLATE_THRESHOLD, TILE_SIZE);
        if (boxes.some((box) => {
          const x = left + (box.x - tile.offsetX) / tile.scale;
          const y = top + (box.y - tile.offsetY) / tile.scale;
          const right = x + box.width / tile.scale;
          const bottom = y + box.height / tile.scale;
          return right > left && bottom > top && x < left + cropWidth && y < top + cropHeight;
        })) return true;
      } finally {
        tile.canvas.width = 0;
        tile.canvas.height = 0;
      }
    }
  }
  return false;
}

async function verifyNoSensitiveRegions(photos) {
  const models = await loadModels();
  let privacyCore;
  try {
    privacyCore = await getPrivacyCore();
  } catch (error) {
    throw verificationError(error);
  }
  const { tilePositions, decodeYoloPlateOutput } = privacyCore;

  for (const photo of photos) {
    let image;
    let sourceCanvas;
    let detectionCanvas;
    try {
      image = await loadImage(photo.buffer);
    } catch {
      throw rejectionError("The processed photo could not be decoded for server-side privacy checks. No photo was sent to Gemini.");
    }

    if (!image.width || !image.height ||
        Math.max(image.width, image.height) > MAX_SOURCE_DIMENSION) {
      throw rejectionError("The processed photo has unsupported dimensions. No photo was sent to Gemini.");
    }

    try {
      sourceCanvas = createCanvas(image.width, image.height);
      sourceCanvas.getContext("2d").drawImage(image, 0, 0);
      const scale = Math.min(1, MAX_DETECTION_DIMENSION / Math.max(image.width, image.height));
      detectionCanvas = createCanvas(
        Math.max(1, Math.round(image.width * scale)),
        Math.max(1, Math.round(image.height * scale))
      );
      detectionCanvas.getContext("2d").drawImage(
        sourceCanvas, 0, 0, detectionCanvas.width, detectionCanvas.height
      );
      if (await containsPlateInPhoto(models.plateSession, detectionCanvas, decodeYoloPlateOutput, tilePositions)) {
        throw rejectionError("Server-side privacy checks detected a vehicle number plate. Cover it in the preview and submit again; no photo was sent to Gemini.");
      }
      if (await containsFaceInPhoto(models.faceSession, detectionCanvas, tilePositions)) {
        throw rejectionError("Server-side privacy checks detected a face. Cover it in the preview and submit again; no photo was sent to Gemini.");
      }
    } catch (error) {
      if (error.code === "PHOTO_PRIVACY_REJECTED") throw error;
      throw verificationError(error);
    } finally {
      if (detectionCanvas) {
        detectionCanvas.width = 0;
        detectionCanvas.height = 0;
      }
      if (sourceCanvas) {
        sourceCanvas.width = 0;
        sourceCanvas.height = 0;
      }
      image = null;
    }
  }
}

module.exports = { verifyNoSensitiveRegions };
