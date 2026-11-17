import { FilesetResolver, FaceDetector } from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web";
import {
  clampAndExpandBox,
  decodeYoloPlateOutput,
  suppressOverlaps,
  tilePositions
} from "./image-privacy-core.mjs";

const JPEG_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const FACE_MODELS = [
  "/assets/models/blaze_face_short_range.tflite",
  "/assets/models/blaze_face_full_range.tflite"
];
const PLATE_MODEL = "/assets/models/license-plate.onnx";
const MAX_SOURCE_DIMENSION = 3000;
const MAX_DETECTION_DIMENSION = 1280;
const PLATE_INPUT_SIZE = 640;
const MAX_UPLOAD_BYTES = 7.5 * 1024 * 1024;
let modelsPromise;

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("This browser cannot prepare a private image preview.");
  return { canvas, context };
}

function loadModels() {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      ort.env.wasm.wasmPaths = "/vendor/onnxruntime/dist/";
      ort.env.wasm.numThreads = 1;
      const vision = await FilesetResolver.forVisionTasks("/vendor/mediapipe/wasm");
      const faceDetectors = [];
      let plateDetector;
      try {
        for (const modelAssetPath of FACE_MODELS) {
          faceDetectors.push(await FaceDetector.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate: "CPU" },
          runningMode: "IMAGE",
          minDetectionConfidence: 0.25
          }));
        }
        plateDetector = await ort.InferenceSession.create(PLATE_MODEL, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all"
        });
        if (!plateDetector.inputNames.includes("images") || !plateDetector.outputNames.includes("output0")) {
          throw new Error("The local privacy models are incompatible with this browser.");
        }
        return { faceDetectors, plateDetector };
      } catch (error) {
        faceDetectors.forEach((faceDetector) => faceDetector.close());
        if (plateDetector) await plateDetector.release();
        throw error;
      }
    })().catch((error) => {
      modelsPromise = null;
      throw new Error(`Local privacy models could not be loaded. No photo was uploaded. ${error.message}`);
    });
  }
  return modelsPromise;
}

async function decodePhoto(file) {
  if (!JPEG_TYPES.has(file.type) || !file.size || file.size > 8 * 1024 * 1024) {
    throw new Error("Use a non-empty JPG, PNG, or WebP photo up to 8 MB.");
  }
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot decode photos safely. No photo was uploaded.");
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    if (!bitmap.width || !bitmap.height) throw new Error("The decoded photo has invalid dimensions.");
    const scale = Math.min(1, MAX_SOURCE_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const { canvas, context } = createCanvas(width, height);
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas;
  } catch (error) {
    throw new Error(`The photo could not be decoded or oriented safely. ${error.message}`);
  } finally {
    bitmap?.close();
  }
}

function makeDetectionCanvas(sourceCanvas) {
  const scale = Math.min(1, MAX_DETECTION_DIMENSION / Math.max(sourceCanvas.width, sourceCanvas.height));
  const width = Math.max(1, Math.round(sourceCanvas.width * scale));
  const height = Math.max(1, Math.round(sourceCanvas.height * scale));
  const { canvas, context } = createCanvas(width, height);
  context.drawImage(sourceCanvas, 0, 0, width, height);
  return canvas;
}

function appendFaceResults(faces, faceDetector, inputCanvas, tile, scaleX, scaleY) {
  const result = faceDetector.detect(inputCanvas);
  for (const detection of result.detections || []) {
    const box = detection.boundingBox;
    if (!box) throw new Error("The face detector returned a region without bounds.");
    const bounds = clampAndExpandBox({
      x: (tile.left + (box.originX - tile.offsetX) / tile.scale) * scaleX,
      y: (tile.top + (box.originY - tile.offsetY) / tile.scale) * scaleY,
      width: box.width / tile.scale * scaleX,
      height: box.height / tile.scale * scaleY
    }, scaleX * tile.imageWidth, scaleY * tile.imageHeight, 0.24);
    faces.push({
      ...bounds,
      score: detection.categories?.[0]?.score ?? 0.5
    });
  }
}

function detectFaces(faceDetectors, detectionCanvas, originalWidth, originalHeight) {
  const scaleX = originalWidth / detectionCanvas.width;
  const scaleY = originalHeight / detectionCanvas.height;
  const faces = [];
  const fullImage = {
    left: 0,
    top: 0,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    imageWidth: detectionCanvas.width,
    imageHeight: detectionCanvas.height
  };
  faceDetectors.forEach((faceDetector) =>
    appendFaceResults(faces, faceDetector, detectionCanvas, fullImage, scaleX, scaleY)
  );
  const tileSize = Math.min(640, detectionCanvas.width, detectionCanvas.height);
  for (const top of tilePositions(detectionCanvas.height, tileSize)) {
    for (const left of tilePositions(detectionCanvas.width, tileSize)) {
      const cropWidth = Math.min(tileSize, detectionCanvas.width - left);
      const cropHeight = Math.min(tileSize, detectionCanvas.height - top);
      const scale = Math.min(640 / cropWidth, 640 / cropHeight);
      const drawnWidth = cropWidth * scale;
      const drawnHeight = cropHeight * scale;
      const offsetX = (640 - drawnWidth) / 2;
      const offsetY = (640 - drawnHeight) / 2;
      const { canvas: tileCanvas, context } = createCanvas(640, 640);
      try {
        context.fillStyle = "rgb(114,114,114)";
        context.fillRect(0, 0, 640, 640);
        context.drawImage(
          detectionCanvas,
          left, top, cropWidth, cropHeight,
          offsetX, offsetY, drawnWidth, drawnHeight
        );
        appendFaceResults(faces, faceDetectors[1], tileCanvas, {
          left,
          top,
          offsetX,
          offsetY,
          scale,
          imageWidth: detectionCanvas.width,
          imageHeight: detectionCanvas.height
        }, scaleX, scaleY);
      } finally {
        tileCanvas.width = 0;
        tileCanvas.height = 0;
      }
    }
  }
  return suppressOverlaps(faces, 0.35);
}

function makePlateTensor(tileCanvas) {
  const context = tileCanvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, PLATE_INPUT_SIZE, PLATE_INPUT_SIZE).data;
  const planeSize = PLATE_INPUT_SIZE * PLATE_INPUT_SIZE;
  const values = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    values[pixel] = pixels[pixel * 4] / 255;
    values[planeSize + pixel] = pixels[pixel * 4 + 1] / 255;
    values[planeSize * 2 + pixel] = pixels[pixel * 4 + 2] / 255;
  }
  return new ort.Tensor("float32", values, [1, 3, PLATE_INPUT_SIZE, PLATE_INPUT_SIZE]);
}

async function detectPlates(plateDetector, detectionCanvas, originalWidth, originalHeight) {
  const boxes = [];
  const scaleX = originalWidth / detectionCanvas.width;
  const scaleY = originalHeight / detectionCanvas.height;
  const tileSize = Math.min(PLATE_INPUT_SIZE, detectionCanvas.width, detectionCanvas.height);
  const xPositions = tilePositions(detectionCanvas.width, tileSize);
  const yPositions = tilePositions(detectionCanvas.height, tileSize);
  for (const top of yPositions) {
    for (const left of xPositions) {
      const cropWidth = Math.min(tileSize, detectionCanvas.width - left);
      const cropHeight = Math.min(tileSize, detectionCanvas.height - top);
      const scale = Math.min(PLATE_INPUT_SIZE / cropWidth, PLATE_INPUT_SIZE / cropHeight);
      const drawnWidth = cropWidth * scale;
      const drawnHeight = cropHeight * scale;
      const offsetX = (PLATE_INPUT_SIZE - drawnWidth) / 2;
      const offsetY = (PLATE_INPUT_SIZE - drawnHeight) / 2;
      const { canvas: tile, context } = createCanvas(PLATE_INPUT_SIZE, PLATE_INPUT_SIZE);
      context.fillStyle = "rgb(114,114,114)";
      context.fillRect(0, 0, PLATE_INPUT_SIZE, PLATE_INPUT_SIZE);
      context.drawImage(
        detectionCanvas,
        left, top, cropWidth, cropHeight,
        offsetX, offsetY, drawnWidth, drawnHeight
      );
      const result = await plateDetector.run({ images: makePlateTensor(tile) });
      const output = result.output0;
      const detected = decodeYoloPlateOutput(output);
      for (const box of detected) {
        const x = (left + (box.x - offsetX) / scale) * scaleX;
        const y = (top + (box.y - offsetY) / scale) * scaleY;
        const width = box.width / scale * scaleX;
        const height = box.height / scale * scaleY;
        const clipped = clampAndExpandBox({ x, y, width, height }, originalWidth, originalHeight, 0.22);
        boxes.push({ ...clipped, score: box.score });
      }
      tile.width = 0;
      tile.height = 0;
    }
  }
  return suppressOverlaps(boxes, 0.35);
}

async function encodeCanvas(canvas) {
  for (const quality of [0.9, 0.84, 0.78, 0.72]) {
    const output = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (output && output.type === "image/jpeg" && output.size && output.size <= MAX_UPLOAD_BYTES) {
      return output;
    }
  }
  throw new Error("The redacted photo could not be safely encoded within the upload limit.");
}

export async function redactPhoto(file) {
  const { faceDetectors, plateDetector } = await loadModels();
  const sourceCanvas = await decodePhoto(file);
  let detectionCanvas;
  try {
    detectionCanvas = makeDetectionCanvas(sourceCanvas);
    const faces = detectFaces(faceDetectors, detectionCanvas, sourceCanvas.width, sourceCanvas.height);
    const plates = await detectPlates(plateDetector, detectionCanvas, sourceCanvas.width, sourceCanvas.height);

    const context = sourceCanvas.getContext("2d");
    context.fillStyle = "#111";
    for (const box of [...faces, ...plates]) context.fillRect(box.x, box.y, box.width, box.height);
    const blob = await encodeCanvas(sourceCanvas);
    return {
      blob,
      width: sourceCanvas.width,
      height: sourceCanvas.height,
      faceCount: faces.length,
      plateCount: plates.length,
      manualRegions: []
    };
  } catch (error) {
    throw new Error(`Photo privacy detection or redaction failed. No photo was uploaded. ${error.message}`);
  } finally {
    if (detectionCanvas) {
      detectionCanvas.width = 0;
      detectionCanvas.height = 0;
    }
    sourceCanvas.width = 0;
    sourceCanvas.height = 0;
  }
}

export async function applyManualRegions(photo) {
  if (!photo?.blob || !Array.isArray(photo.manualRegions)) {
    throw new Error("A reviewed redacted photo is required before upload.");
  }
  if (!photo.manualRegions.length) return makeUploadFile(photo.blob);
  let bitmap;
  try {
    bitmap = await createImageBitmap(photo.blob);
    if (bitmap.width !== photo.width || bitmap.height !== photo.height) {
      throw new Error("The redacted preview dimensions changed unexpectedly.");
    }
    const { canvas, context } = createCanvas(bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    context.fillStyle = "#111";
    for (const region of photo.manualRegions) {
      const box = clampAndExpandBox(region, canvas.width, canvas.height, 0);
      context.fillRect(box.x, box.y, box.width, box.height);
    }
    const blob = await encodeCanvas(canvas);
    canvas.width = 0;
    canvas.height = 0;
    return makeUploadFile(blob);
  } catch (error) {
    throw new Error(`Manual redaction could not be applied. No photo was uploaded. ${error.message}`);
  } finally {
    bitmap?.close();
  }
}

function makeUploadFile(blob) {
  if (!blob || blob.type !== "image/jpeg" || !blob.size || blob.size > MAX_UPLOAD_BYTES) {
    throw new Error("The redacted photo is invalid. No photo was uploaded.");
  }
  return new File([blob], "civicx-redacted-photo.jpg", { type: "image/jpeg" });
}

window.CivicXImagePrivacy = Object.freeze({ redactPhoto, applyManualRegions });
window.dispatchEvent(new Event("civicx-image-privacy-ready"));
