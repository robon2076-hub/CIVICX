const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createCanvas } = require("@napi-rs/canvas");
const { createApp } = require("../server/app");
const TEST_ACCESS_TOKEN = "verified-test-access-token";

function createAuthenticatedApp(options = {}) {
  return createApp({
    ...options,
    authenticateUser: options.authenticateUser || (async (token) =>
      token === TEST_ACCESS_TOKEN ? { id: "verified-test-user" } : null)
  });
}

function makeJpeg(includeExif = false) {
  const canvas = createCanvas(64, 64);
  const context = canvas.getContext("2d");
  context.fillStyle = "#777";
  context.fillRect(0, 0, 64, 64);
  const jpeg = canvas.toBuffer("image/jpeg");
  if (!includeExif) return jpeg;
  const exifSegment = Buffer.from([0xff, 0xe1, 0x00, 0x04, 0x00, 0x00]);
  return Buffer.concat([jpeg.subarray(0, 2), exifSegment, jpeg.subarray(2)]);
}

async function postForm(server, fields, options = {}) {
  const address = server.address();
  const form = new FormData();
  form.append("photos", new Blob([options.photo || makeJpeg()], { type: options.type || "image/jpeg" }), "civicx-redacted-photo.jpg");
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  return fetch(`http://127.0.0.1:${address.port}/api/ai/describe`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TEST_ACCESS_TOKEN}` },
    body: form
  });
}

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    await callback(server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("empty GEMINI_API_KEY responds with the exact disabled message", async () => {
  await withServer(createAuthenticatedApp({ apiKey: "" }), async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "Pothole near the crossing" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: "AI is not configured" });
  });
});

test("personal form fields are rejected before the model adapter is called", async () => {
  let modelCalled = false;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    generateDescription: async () => { modelCalled = true; return {}; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, {
      city: "Kolkata",
      note: "Pothole near the crossing",
      phone: "9999999999"
    });
    assert.equal(response.status, 400);
    assert.equal(modelCalled, false);
  });
});

test("client redaction claims are rejected rather than trusted", async () => {
  let verifierCalled = false;
  let modelCalled = false;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    verifyPhotoPrivacy: async () => { verifierCalled = true; },
    generateDescription: async () => { modelCalled = true; return {}; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, {
      city: "Kolkata",
      note: "",
      redacted: "true"
    });
    assert.equal(response.status, 400);
    assert.equal(verifierCalled, false);
    assert.equal(modelCalled, false);
  });
});

test("the model receives only validated processed JPEGs and returns a single JSON result", async () => {
  let receivedInput;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    generateDescription: async (apiKey, input) => {
      receivedInput = input;
      return {
        category: "Pothole",
        evidence: "A damaged road surface is visible.",
        description: "A deep pothole disrupts safe passage for road users.",
        publicImpact: "Road users may need to avoid the damaged area.",
        confidence: "Medium",
        severity: "High",
        department: "Roads / Public Works"
      };
    }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, {
      city: "Kolkata",
      note: "Deep pothole by the school gate",
      mode: "improve",
      category: "Pothole"
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    const body = await response.json();
    assert.equal(body.result.category, "Pothole");
    assert.deepEqual(Object.keys(receivedInput).sort(), ["category", "city", "mode", "note", "photos", "registry"]);
    assert.deepEqual(Object.keys(receivedInput.photos[0]).sort(), ["base64", "mimeType"]);
    assert.equal(receivedInput.mode, "improve");
    assert.equal(receivedInput.category, "Pothole");
    assert.equal(receivedInput.photos[0].mimeType, "image/jpeg");
    assert.equal(Buffer.from(receivedInput.photos[0].base64, "base64").equals(makeJpeg()), true);
  });
});

test("invalid or unprocessed photo bytes are rejected before server detection or Gemini", async () => {
  let modelCalled = false;
  let verifierCalled = false;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    verifyPhotoPrivacy: async () => { verifierCalled = true; },
    generateDescription: async () => { modelCalled = true; return {}; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" }, { photo: Buffer.from("original image") });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /valid, locally processed JPEG/);
    assert.equal(verifierCalled, false);
    assert.equal(modelCalled, false);
  });
});

test("processed photos containing EXIF, IPTC, or comment metadata are rejected", async () => {
  let modelCalled = false;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    generateDescription: async () => { modelCalled = true; return {}; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" }, { photo: makeJpeg(true) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /identifying metadata/);
    assert.equal(modelCalled, false);
  });
});

test("server-side face or plate detection rejects the image before Gemini", async () => {
  let geminiCalled = false;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    verifyPhotoPrivacy: async () => {
      const error = new Error("Server-side privacy checks detected a vehicle number plate.");
      error.code = "PHOTO_PRIVACY_REJECTED";
      throw error;
    },
    generateDescription: async () => { geminiCalled = true; return {}; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" });
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /number plate/);
    assert.equal(geminiCalled, false);
  });
});

test("server-side privacy model failures block Gemini instead of falling back", async () => {
  let geminiCalled = false;
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    verifyPhotoPrivacy: async () => {
      const error = new Error("Server-side image privacy verification is unavailable. No photo was sent to Gemini.");
      error.code = "PHOTO_PRIVACY_VERIFICATION_UNAVAILABLE";
      throw error;
    },
    generateDescription: async () => { geminiCalled = true; return {}; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" });
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /No photo was sent to Gemini/);
    assert.equal(geminiCalled, false);
  });
});

test("Gemini failures return their actual message in a JSON response", async () => {
  const unavailable = new Error("Gemini is temporarily unavailable after one retry. Please wait up to 60 seconds before trying again.");
  unavailable.code = "GEMINI_UNAVAILABLE";
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    generateDescription: async () => { throw unavailable; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "Pothole near the crossing" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: unavailable.message });
  });
});

test("Gemini errors do not produce a partial or stream-shaped response", async () => {
  const unavailable = new Error("Gemini API returned HTTP 503: Temporarily busy.");
  unavailable.code = "GEMINI_UNAVAILABLE";
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    generateDescription: async () => { throw unavailable; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: unavailable.message });
  });
});

test("Gemini SDK connection errors are returned clearly without secrets", async () => {
  const unavailable = new Error("Gemini API connection error: The request timed out after 60 seconds.");
  unavailable.code = "GEMINI_CONNECTION_ERROR";
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    generateDescription: async () => { throw unavailable; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: unavailable.message });
  });
});

test("Gemini validation errors include their actual diagnostic in JSON", async () => {
  const invalid = new Error("Gemini response validation failed: model output was not valid JSON (finish reason: MAX_TOKENS)");
  invalid.code = "GEMINI_INVALID_RESPONSE";
  const app = createAuthenticatedApp({
    apiKey: "test-key",
    verifyPhotoPrivacy: async () => {},
    generateDescription: async () => { throw invalid; }
  });
  await withServer(app, async (server) => {
    const response = await postForm(server, { city: "Kolkata", note: "" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { message: invalid.message });
  });
});

test("the ignored server key file is not served to browsers", async () => {
  await withServer(createAuthenticatedApp({ apiKey: "" }), async (server) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/.env`);
    assert.equal(response.status, 404);
    const body = await response.text();
    assert.doesNotMatch(body, /AI_API_KEY/);
    assert.doesNotMatch(body, /GEMINI_API_KEY/);
  });
});

test("browser files never reference the Gemini key", () => {
  const root = path.resolve(__dirname, "..");
  for (const file of ["index.html", "app.js", "image-privacy.mjs", "image-privacy-core.mjs", "ads.js", "track.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /AI_API_KEY/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /GEMINI_API_KEY/);
  }
});

test("only the detector runtime assets are exposed from node_modules", async () => {
  await withServer(createAuthenticatedApp({ apiKey: "" }), async (server) => {
    const address = `http://127.0.0.1:${server.address().port}`;
    const assets = [
      "/vendor/mediapipe/vision_bundle.mjs",
      "/vendor/mediapipe/wasm/vision_wasm_internal.js",
      "/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
      "/vendor/onnxruntime/dist/ort.bundle.min.mjs",
      "/vendor/onnxruntime/dist/ort-wasm-simd-threaded.jsep.mjs",
      "/vendor/onnxruntime/dist/ort-wasm-simd-threaded.jsep.wasm"
    ];
    const responses = await Promise.all(assets.map((asset) => fetch(`${address}${asset}`)));
    assert.ok(responses.every((response) => response.status === 200));
    const [privatePackageFile, privateRuntimeFile] = await Promise.all([
      fetch(`${address}/node_modules/dotenv/package.json`),
      fetch(`${address}/vendor/mediapipe/README.md`)
    ]);
    assert.equal(privatePackageFile.status, 404);
    assert.equal(privateRuntimeFile.status, 404);
  });
});

test("the server reads the Gemini key from GEMINI_API_KEY without hardcoding it", () => {
  const root = path.resolve(__dirname, "..");
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /process\.env\.GEMINI_API_KEY/);
  assert.doesNotMatch(server, /AIza[0-9A-Za-z_-]{20,}/);
});
