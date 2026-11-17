const path = require("node:path");
const express = require("express");
const multer = require("multer");
const { assertOnlyPublicFields, buildModelInput } = require("./ai/privacy");
const { validateRedactedPhotos } = require("./ai/redaction");
const { verifyNoSensitiveRegions } = require("./ai/image-privacy");
const { chatWithCivicX, generateDescription } = require("./ai/gemini");
const { registerAssistantRoute } = require("./ai/assistant");
const { registerEnvironmentRoutes } = require("./environment");
const { parseMapBounds } = require("./public-map");
const {
  AuthorityError,
  validateAuthorityAttachmentRequest,
  validateAuthorityRequest
} = require("./authority");
const { PortalError } = require("./portal");
const portalRegistry = require("../data/portal-registry.json");

const root = path.resolve(__dirname, "..");
const imageTypes = new Set(["image/jpeg"]);
const CHAT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_CHAT_IMAGE_BYTES = 8 * 1024 * 1024;

function isValidChatSupportingImage(image, mimeType) {
  const maxBase64Length = 4 * Math.ceil(MAX_CHAT_IMAGE_BYTES / 3);
  if (typeof image !== "string" || typeof mimeType !== "string" ||
      !CHAT_IMAGE_TYPES.has(mimeType) || !image.length ||
      image.length > maxBase64Length || image.length % 4 !== 0) {
    return false;
  }
  const padding = image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0;
  const contentLength = image.length - padding;
  if ((padding === 2 && contentLength % 4 !== 2) ||
      (padding === 1 && contentLength % 4 !== 3) ||
      image.slice(0, contentLength).includes("=")) {
    return false;
  }
  for (let index = 0; index < contentLength; index += 1) {
    const character = image.charCodeAt(index);
    if (!((character >= 65 && character <= 90) ||
          (character >= 97 && character <= 122) ||
          (character >= 48 && character <= 57) ||
          character === 43 || character === 47)) {
      return false;
    }
  }
  const byteLength = image.length / 4 * 3 - padding;
  if (!byteLength || byteLength > MAX_CHAT_IMAGE_BYTES) return false;

  const bytes = Buffer.from(image, "base64");
  let valid = false;
  if (mimeType === "image/jpeg") {
    valid = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  } else if (mimeType === "image/png") {
    valid = bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  } else if (mimeType === "image/webp") {
    valid = bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  }
  bytes.fill(0);
  return valid;
}

function legacyChatRequest(body) {
  const invalid = () => {
    const error = new TypeError("Send a valid conversation with alternating user and assistant messages.");
    error.statusCode = 400;
    throw error;
  };
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "messages") ||
      !Array.isArray(body.messages) ||
      body.messages.length < 1 ||
      body.messages.length > 21) {
    invalid();
  }

  const turns = body.messages.map((turn, index) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn) ||
        Object.keys(turn).some((key) => !["role", "content"].includes(key)) ||
        !["user", "assistant"].includes(turn.role) ||
        typeof turn.content !== "string" ||
        !turn.content.trim() ||
        turn.content.length > 2000 ||
        (index === 0 && turn.role !== "user") ||
        (index > 0 && turn.role === body.messages[index - 1].role)) {
      invalid();
    }
    return {
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }]
    };
  });
  if (turns[turns.length - 1].role !== "user") invalid();

  const current = turns.pop();
  return { message: current.parts[0].text, history: turns };
}

function createApp(options = {}) {
  const app = express();
  const apiKey = (options.apiKey || process.env.GEMINI_API_KEY || "").trim();
  const generate = options.generateDescription || generateDescription;
  const chat = options.chatWithCivicX || chatWithCivicX;
  const verifyImages = options.verifyPhotoPrivacy || verifyNoSensitiveRegions;
  const authenticateUser = options.authenticateUser;
  const portalService = options.portalService;
  const publicMapService = options.publicMapService;
  const requestsByIp = new Map();
  const publicMapRequestsByIp = new Map();
  const portalRequestsByIp = new Map();
  const portalCredentialFailuresByIp = new Map();
  const PORTAL_CREDENTIAL_FAILURE_LIMIT = 5;
  const PORTAL_CREDENTIAL_FAILURE_WINDOW_MS = 15 * 60 * 1000;
  const mediaPipeRoot = path.join(root, "node_modules", "@mediapipe", "tasks-vision");
  const onnxRuntimeRoot = path.join(root, "node_modules", "onnxruntime-web", "dist");
  const runtimeAssets = {
    "/vendor/mediapipe/vision_bundle.mjs": path.join(mediaPipeRoot, "vision_bundle.mjs"),
    "/vendor/mediapipe/wasm/vision_wasm_internal.js": path.join(mediaPipeRoot, "wasm", "vision_wasm_internal.js"),
    "/vendor/mediapipe/wasm/vision_wasm_internal.wasm": path.join(mediaPipeRoot, "wasm", "vision_wasm_internal.wasm"),
    "/vendor/onnxruntime/dist/ort.bundle.min.mjs": path.join(onnxRuntimeRoot, "ort.bundle.min.mjs"),
    "/vendor/onnxruntime/dist/ort-wasm-simd-threaded.jsep.mjs": path.join(onnxRuntimeRoot, "ort-wasm-simd-threaded.jsep.mjs"),
    "/vendor/onnxruntime/dist/ort-wasm-simd-threaded.jsep.wasm": path.join(onnxRuntimeRoot, "ort-wasm-simd-threaded.jsep.wasm")
  };
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 3, fields: 4, fieldSize: 2048 },
    fileFilter(request, file, callback) {
      callback(null, imageTypes.has(file.mimetype));
    }
  });
  function consumeAiRateLimit(ip) {
    const now = Date.now();
    const recent = (requestsByIp.get(ip) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
    if (recent.length >= 10) return false;
    requestsByIp.set(ip, [...recent, now]);
    return true;
  }
  function getPortalCredentialFailures(ip) {
    const cutoff = Date.now() - PORTAL_CREDENTIAL_FAILURE_WINDOW_MS;
    const recent = (portalCredentialFailuresByIp.get(ip) || []).filter((timestamp) => timestamp > cutoff);
    if (recent.length) portalCredentialFailuresByIp.set(ip, recent);
    else portalCredentialFailuresByIp.delete(ip);
    return recent;
  }
  function portalCredentialAttemptsBlocked(ip) {
    return getPortalCredentialFailures(ip).length >= PORTAL_CREDENTIAL_FAILURE_LIMIT;
  }
  function recordPortalCredentialFailure(ip) {
    const recent = getPortalCredentialFailures(ip);
    recent.push(Date.now());
    portalCredentialFailuresByIp.set(ip, recent);
  }
  function consumePortalRateLimit(ip) {
    const now = Date.now();
    const recent = (portalRequestsByIp.get(ip) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
    if (recent.length >= 60) return false;
    portalRequestsByIp.set(ip, [...recent, now]);
    return true;
  }
  function consumePublicMapRateLimit(ip) {
    const now = Date.now();
    const recent = (publicMapRequestsByIp.get(ip) || [])
      .filter((timestamp) => now - timestamp < 15 * 60 * 1000);
    if (recent.length >= 180) return false;
    publicMapRequestsByIp.set(ip, [...recent, now]);
    return true;
  }
  async function requireAiUser(request, response, next) {
    const authorization = request.get("authorization") || "";
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    const responseBody = (message) => request.path === "/api/ai/describe"
      ? { message }
      : { ok: false, error: message };

    if (!match) {
      response.status(401).json(responseBody("Sign in to use CivicX AI."));
      return;
    }
    if (!consumeAiRateLimit(request.ip)) {
      response.status(429).json(responseBody("Too many AI requests. Please try again later."));
      return;
    }
    if (typeof authenticateUser !== "function") {
      response.status(503).json(responseBody("Sign-in verification is not configured on this server."));
      return;
    }

    try {
      const user = await authenticateUser(match[1]);
      if (!user || typeof user.id !== "string" || !user.id) {
        response.status(401).json(responseBody("Your sign-in session is invalid or expired. Please sign in again."));
        return;
      }
      request.authUser = user;
      next();
    } catch (error) {
      console.error("[CivicX auth] AI session verification failed", {
        code: error.code || "UNKNOWN",
        status: error.status || error.statusCode
      });
      response.status(503).json(responseBody("Sign-in verification is temporarily unavailable."));
    }
  }

  app.disable("x-powered-by");
  app.use(express.json({ limit: "15mb" }));
  app.use(["/api/portal", "/api/reports", "/api/jurisdictions"], (request, response, next) => {
    response.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Vary": "Authorization"
    });
    if ((request.originalUrl.startsWith("/api/portal/") || request.originalUrl.startsWith("/api/reports/")) &&
        portalCredentialAttemptsBlocked(request.ip)) {
      response.status(429).json({
        ok: false,
        error: "Portal access is temporarily blocked. Try again later."
      });
      return;
    }
    if (!consumePortalRateLimit(request.ip)) {
      response.status(429).json({ ok: false, error: "Too many portal requests. Try again later." });
      return;
    }
    next();
  });
  for (const [route, filePath] of Object.entries(runtimeAssets)) {
    app.get(route, (request, response) => response.sendFile(filePath));
  }
  app.use(["/vendor/mediapipe", "/vendor/onnxruntime"], (request, response) => response.sendStatus(404));
  app.use("/node_modules", (request, response) => response.sendStatus(404));
  app.use(express.static(root, {
    index: "index.html",
    setHeaders(response, filePath) {
      if (path.resolve(filePath) === path.join(root, "chat.js")) {
        response.setHeader("Cache-Control", "no-cache, max-age=0, must-revalidate");
      }
    }
  }));
  registerEnvironmentRoutes(app, options.environmentService);
  registerAssistantRoute(app, {
    apiKey,
    model: process.env.CIVICX_ASSISTANT_MODEL || "",
    analyze: options.analyzeAssistant
  });

  app.get("/api/public-config", (request, response) => {
    const url = process.env.SUPABASE_URL || "";
    const anonKey = process.env.SUPABASE_ANON_KEY || "";
    response.json({
      supabase: {
        url,
        anonKey,
        configured: Boolean(url && anonKey)
      }
    });
  });

  app.get("/api/public/map-reports", async (request, response) => {
    response.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
    if (!consumePublicMapRateLimit(request.ip)) {
      response.set("Cache-Control", "no-store");
      response.status(429).json({ ok: false, error: "Public map requests are temporarily limited. Try again shortly." });
      return;
    }
    if (typeof publicMapService?.listReports !== "function") {
      response.set("Cache-Control", "no-store");
      response.status(503).json({ ok: false, error: "Public report pins are temporarily unavailable." });
      return;
    }
    let bounds;
    try {
      bounds = parseMapBounds(request.query);
    } catch (error) {
      response.set("Cache-Control", "no-store");
      response.status(400).json({ ok: false, error: error.message });
      return;
    }
    try {
      response.json({ ok: true, result: { reports: await publicMapService.listReports(bounds) } });
    } catch (error) {
      console.error("[CivicX public map] Report pins could not be loaded", {
        code: error.code || "UNKNOWN"
      });
      response.set("Cache-Control", "no-store");
      response.status(503).json({ ok: false, error: "Public report pins are temporarily unavailable." });
    }
  });

  app.get("/api/public/map-reports/:communityPostId/photo", async (request, response) => {
    response.set({
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff"
    });
    if (!consumePublicMapRateLimit(request.ip)) {
      response.set("Cache-Control", "no-store");
      response.status(429).json({ ok: false, error: "Public map requests are temporarily limited. Try again shortly." });
      return;
    }
    if (typeof publicMapService?.getPhoto !== "function") {
      response.set("Cache-Control", "no-store");
      response.status(503).json({ ok: false, error: "The public report photo is temporarily unavailable." });
      return;
    }
    try {
      const photo = await publicMapService.getPhoto(request.params.communityPostId);
      if (!photo) {
        response.set("Cache-Control", "no-store");
        response.sendStatus(404);
        return;
      }
      response.type(photo.contentType).send(photo.body);
    } catch (error) {
      console.error("[CivicX public map] Report photo could not be loaded", {
        code: error.code || "UNKNOWN"
      });
      response.set("Cache-Control", "no-store");
      response.status(503).json({ ok: false, error: "The public report photo is temporarily unavailable." });
    }
  });

  app.get("/api/jurisdictions", async (request, response) => {
    if (typeof portalService?.listJurisdictions !== "function") {
      response.set("Cache-Control", "no-store");
      response.status(503).json({
        ok: false,
        error: "Jurisdiction options are unavailable. Configure the server database connection and apply the CivicX feature migration."
      });
      return;
    }
    try {
      response.set("Cache-Control", "public, max-age=300");
      response.json({ ok: true, result: await portalService.listJurisdictions() });
    } catch (error) {
      response.set("Cache-Control", "no-store");
      handlePortalError(error, response, "jurisdiction list", request);
    }
  });

  function portalRequest(request) {
    const match = /^Bearer\s+([^\s]+)$/i.exec(request.get("authorization") || "");
    const masterKey = request.get("x-civicx-master-key") || "";
    if (!match || masterKey.length > 512) {
      throw new PortalError("Portal access could not be verified. Sign in and try again.", 401, {
        credentialFailure: true
      });
    }
    return { accessToken: match[1], masterKey };
  }

  function portalSessionRequest(request) {
    const match = /^Bearer\s+([^\s]+)$/i.exec(request.get("authorization") || "");
    if (!match) {
      throw new PortalError("Sign in to check portal availability.", 401);
    }
    return { accessToken: match[1] };
  }

  function handlePortalError(error, response, action, request) {
    if (error instanceof PortalError) {
      if (error.credentialFailure && request.get("x-civicx-master-key")) {
        recordPortalCredentialFailure(request.ip);
      }
      response.status(error.status).json({ ok: false, error: error.message });
      return;
    }
    console.error(`[CivicX portal] ${action} failed`, { code: error.code || "UNKNOWN" });
    response.status(503).json({ ok: false, error: "Portal data could not be loaded or saved." });
  }

  function handleAuthorityError(error, response, action, request) {
    if (error instanceof AuthorityError) {
      if (error.credentialFailure && request.get("x-civicx-master-key")) {
        recordPortalCredentialFailure(request.ip);
      }
      response.status(error.status).json({ ok: false, error: error.message });
      return true;
    }
    console.error(`[CivicX authority] ${action} failed`, { code: error.code || "UNKNOWN" });
    response.status(503).json({ ok: false, error: "The authority request could not be completed." });
    return true;
  }

  app.get("/api/portal/entry-status", async (request, response) => {
    response.set({ "Cache-Control": "private, no-store", "Vary": "Authorization" });
    if (typeof portalService?.getEntryStatus !== "function") {
      response.status(503).json({ ok: false, error: "Portal availability is not configured on this server." });
      return;
    }
    try {
      response.json({ ok: true, result: await portalService.getEntryStatus(portalSessionRequest(request)) });
    } catch (error) {
      handlePortalError(error, response, "portal entry status", request);
    }
  });

  app.post("/api/portal/authority/entry", async (request, response) => {
    response.set({ "Cache-Control": "private, no-store", "Vary": "Authorization" });
    if (typeof portalService?.prepareAuthorityEntry !== "function") {
      response.status(503).json({ ok: false, error: "Authority access is not configured on this server." });
      return;
    }
    try {
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) ||
          Object.keys(request.body).length) {
        throw new PortalError("No extra fields are accepted for authority verification.", 400);
      }
      response.json({
        ok: true,
        result: await portalService.prepareAuthorityEntry(portalRequest(request))
      });
    } catch (error) {
      handlePortalError(error, response, "authority verification", request);
    }
  });

  app.get("/api/portal/reports", async (request, response) => {
    response.set({ "Cache-Control": "private, no-store", "Vary": "Authorization" });
    if (typeof portalService?.listReports !== "function") {
      response.status(503).json({ ok: false, error: "Portal access is not configured on this server." });
      return;
    }
    try {
      response.json({ ok: true, result: await portalService.listReports(portalRequest(request)) });
    } catch (error) {
      handlePortalError(error, response, "report list", request);
    }
  });

  app.get("/api/portal/reports/:reportId", async (request, response) => {
    response.set({ "Cache-Control": "private, no-store", "Vary": "Authorization" });
    if (typeof portalService?.getReport !== "function") {
      response.status(503).json({ ok: false, error: "Portal access is not configured on this server." });
      return;
    }
    try {
      response.json({ ok: true, result: await portalService.getReport({
        ...portalRequest(request),
        reportId: request.params.reportId
      }) });
    } catch (error) {
      handlePortalError(error, response, "report detail", request);
    }
  });

  app.get("/api/portal/reports/:reportId/attachment", async (request, response) => {
    response.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Vary": "Authorization"
    });
    if (typeof portalService?.getAttachment !== "function") {
      response.status(503).json({ ok: false, error: "Portal attachment access is not configured on this server." });
      return;
    }
    try {
      response.json({ ok: true, result: await portalService.getAttachment({
        ...portalRequest(request),
        reportId: request.params.reportId
      }) });
    } catch (error) {
      handlePortalError(error, response, "attachment access", request);
    }
  });

  app.get("/api/portal/owner/configuration", async (request, response) => {
    response.set({ "Cache-Control": "private, no-store", "Vary": "Authorization" });
    if (typeof portalService?.listOwnerConfiguration !== "function") {
      response.status(503).json({ ok: false, error: "Owner portal access is not configured on this server." });
      return;
    }
    try {
      response.json({ ok: true, result: await portalService.listOwnerConfiguration(portalRequest(request)) });
    } catch (error) {
      handlePortalError(error, response, "owner configuration", request);
    }
  });

  app.put("/api/portal/owner/authorities/:authorityUserId/jurisdictions", async (request, response) => {
    response.set({ "Cache-Control": "private, no-store", "Vary": "Authorization" });
    if (typeof portalService?.setAuthorityJurisdictions !== "function") {
      response.status(503).json({ ok: false, error: "Owner portal access is not configured on this server." });
      return;
    }
    try {
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) ||
          Object.keys(request.body).some((key) => key !== "jurisdictionKeys")) {
        throw new PortalError("Only jurisdictionKeys may be provided.", 400);
      }
      response.json({ ok: true, result: await portalService.setAuthorityJurisdictions({
        ...portalRequest(request),
        authorityUserId: request.params.authorityUserId,
        jurisdictionKeys: request.body.jurisdictionKeys
      }) });
    } catch (error) {
      handlePortalError(error, response, "owner assignment", request);
    }
  });

  app.post("/api/reports/:reportId/authority-actions", async (request, response) => {
    if (typeof options.authorityService !== "function") {
      response.status(503).json({ ok: false, error: "Authority actions are not configured on this server." });
      return;
    }

    try {
      const authorityRequest = validateAuthorityRequest(
        request.params.reportId,
        request.get("authorization"),
        request.body,
        request.get("x-civicx-master-key") || ""
      );
      const result = await options.authorityService(authorityRequest);
      response.json({ ok: true, result });
    } catch (error) {
      handleAuthorityError(error, response, "action", request);
    }
  });

  app.get("/api/reports/:reportId/attachment", async (request, response) => {
    response.set({
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "Vary": "Authorization"
    });
    if (typeof options.authorityAttachmentService !== "function") {
      response.status(503).json({ ok: false, error: "Authority attachment access is not configured on this server." });
      return;
    }

    try {
      const attachmentRequest = validateAuthorityAttachmentRequest(
        request.params.reportId,
        request.get("authorization"),
        request.get("x-civicx-master-key") || ""
      );
      const result = await options.authorityAttachmentService(attachmentRequest);
      response.json({ ok: true, result });
    } catch (error) {
      handleAuthorityError(error, response, "attachment access", request);
    }
  });

  app.post("/api/ai/describe", requireAiUser, (request, response) => {
    if (!request.is("multipart/form-data")) {
      const error = new Error("Upload issue photos with an optional note and city.");
      console.error("[AI] Request validation failed", error);
      response.status(415).json({ message: error.message });
      return;
    }
    upload.array("photos", 3)(request, response, async (uploadError) => {
      if (uploadError || (request.files || []).some((file) => !imageTypes.has(file.mimetype))) {
        const error = uploadError || new Error("Upload 1 to 3 locally processed JPG photos up to 8 MB each.");
        console.error("[AI] Photo upload validation failed", error);
        response.status(400).json({ message: error.message });
        return;
      }
      let publicInput;
      try {
        publicInput = assertOnlyPublicFields(request.body || {}, request.files);
      } catch (validationError) {
        console.error("[AI] Request validation failed", validationError);
        response.status(400).json({ message: validationError.message });
        return;
      }
      try {
        const redactedPhotos = validateRedactedPhotos(publicInput.photos);
        await verifyImages(redactedPhotos);
        const modelInput = buildModelInput({ ...publicInput, photos: redactedPhotos }, portalRegistry);
        const result = await generate(apiKey, modelInput);
        response.status(200).json({ result });
      } catch (error) {
        console.error("[AI] Photo analysis failed", error);
        const status = error.code === "PHOTO_PRIVACY_REJECTED" || error.statusCode === 400
          ? 400
          : error.statusCode === 429 || error.statusCode === 502
            ? error.statusCode
            : 503;
        response.status(status).json({
          message: error.code === "GEMINI_NOT_CONFIGURED"
            ? "AI is not configured"
            : error.message || "Photo analysis is temporarily unavailable. Please try again."
        });
      }
    });
  });

  async function handleChat(request, response, body = request.body) {
    try {
      if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.keys(body).some((key) => !["message", "history", "image", "mimeType", "imageAttached"].includes(key))) {
        const error = new TypeError("Send only a message, history, and optional redacted image.");
        error.statusCode = 400;
        throw error;
      }
      const history = body.history === undefined ? [] : body.history;
      if (typeof body.message !== "string" || !Array.isArray(history)) {
        const error = new TypeError("Send a text message, recent history, and an optional redacted JPEG.");
        error.statusCode = 400;
        throw error;
      }
      if (body.imageAttached !== undefined && typeof body.imageAttached !== "boolean") {
        const error = new TypeError("Image attachment status must be true or false.");
        error.statusCode = 400;
        throw error;
      }
      if (!body.message.trim()) {
        const error = new TypeError("Type a short description of the issue. CivicX AI cannot identify it from a photo alone.");
        error.statusCode = 400;
        throw error;
      }
      const hasImageData = body.image !== undefined && body.image !== null;
      const imageAttached = body.imageAttached === true || hasImageData;
      const imageWarning = hasImageData
        ? !isValidChatSupportingImage(body.image, body.mimeType)
        : body.mimeType !== undefined;
      delete body.image;
      delete body.mimeType;
      delete body.imageAttached;
      const reply = await chat({
        message: body.message,
        history,
        imageAttached,
        imageWarning
      }, apiKey);
      response.status(200).json({ ok: true, reply });
    } catch (error) {
      if (error.code === "PHOTO_PRIVACY_REJECTED" || error.statusCode === 400) {
        response.status(400).json({ ok: false, error: error.message });
        return;
      }
      console.error("[AI chat] Request failed", {
        code: error.code || "UNKNOWN",
        status: error.status || error.statusCode
      });
      const status = error.statusCode === 429 ? 429 : error.statusCode === 502 ? 502 : 503;
      response.status(status).json({
        ok: false,
        error: error.code === "GEMINI_NOT_CONFIGURED"
          ? "AI is not configured"
          : error.message || "The assistant is temporarily unavailable. Please try again."
      });
    }
  }

  app.post("/api/chat", requireAiUser, (request, response) => handleChat(request, response));
  app.post("/api/ai/chat", requireAiUser, (request, response) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) ||
        !Object.hasOwn(request.body, "messages")) {
      handleChat(request, response);
      return;
    }
    try {
      handleChat(request, response, legacyChatRequest(request.body));
    } catch (error) {
      response.status(400).json({ ok: false, error: error.message });
    }
  });

  app.use((error, request, response, next) => {
    if (request.path === "/api/chat" || request.path === "/api/ai/chat") {
      const tooLarge = error.type === "entity.too.large";
      console.error("[AI chat] Request parsing failed", {
        status: tooLarge ? 413 : error.status || error.statusCode || 400,
        type: ["entity.too.large", "entity.parse.failed", "request.aborted"].includes(error.type)
          ? error.type
          : "invalid_request"
      });
      response.status(tooLarge ? 413 : 400).json({
        ok: false,
        error: tooLarge ? "The chat request is too large. Start a new chat and try again." : "Send a valid JSON chat request."
      });
      return;
    }
    if (request.path.startsWith("/api")) {
      response.status(error.status || error.statusCode || 500).json({
        ok: false,
        error: error.message || "An unexpected error occurred processing your API request."
      });
      return;
    }
    next(error);
  });

  app.use("/api", (request, response) => {
    response.status(404).json({
      ok: false,
      error: `API route ${request.method} ${request.originalUrl} not found.`
    });
  });

  return app;
}

module.exports = { createApp };
