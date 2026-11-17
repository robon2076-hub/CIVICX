const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomBytes } = require("node:crypto");
const { GoogleGenAI } = require("@google/genai");
const { createCanvas, loadImage } = require("@napi-rs/canvas");
const multer = require("multer");

const REPORT_FORM_PATH = path.resolve(__dirname, "../../dashboard.html");
const EMERGENCY_NUMBER = "112";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const MAX_TEXT_LENGTH = 1200;
const RATE_LIMIT_SALT = randomBytes(32);

const SYSTEM_INSTRUCTION = [
  "You are the Civic X assistant. You only help with civic issue reporting and using this website.",
  "Use only the supplied report category list and return only the supplied JSON schema.",
  "Never invent facts, locations, dates, departments, or details. Describe only visible evidence or information the user gave.",
  "For an unclear, blurry, dark, unrelated, or low-confidence image, set confidence below 0.6, do not guess, and ask at most two short follow-up questions.",
  "For website-use questions, answer only from the supplied website facts, set is_civic_issue to false, category to unknown, and confidence to 1.",
  "Write in the user's language. For a clear civic issue, describe it factually in two or three sentences and use no more than eight words in the title.",
  "Suggested department must be empty because no department list was supplied.",
  "Do not identify people, faces, or vehicle number plates. If people are visible, say that the report only needs the issue and suggest retaking the photo without them.",
  "For an emergency, mark severity urgent and put the emergency advice first in user_message. Never claim an authority has been notified; the report is only prepared until the user submits it."
].join(" ");

function assistantError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function decodeHtmlEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (match, entity) => {
    if (entity[0] === "#") {
      const hexadecimal = entity[1].toLowerCase() === "x";
      const number = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      return Number.isFinite(number) ? String.fromCodePoint(number) : match;
    }
    return {
      amp: "&",
      quot: "\"",
      apos: "'",
      lt: "<",
      gt: ">"
    }[entity.toLowerCase()] || match;
  });
}

function extractReportCategories(html) {
  const select = html.match(/<select\b(?=[^>]*\bid=["']report-category["'])[^>]*>([\s\S]*?)<\/select>/i);
  if (!select) {
    throw assistantError("The report category list is unavailable.", 503, "ASSISTANT_CATEGORIES_UNAVAILABLE");
  }
  const categories = [];
  const optionPattern = /<option\b[^>]*\bvalue=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = optionPattern.exec(select[1]))) {
    const category = decodeHtmlEntities(match[1]).trim();
    if (category && !categories.includes(category)) categories.push(category);
  }
  if (!categories.length) {
    throw assistantError("The report category list is unavailable.", 503, "ASSISTANT_CATEGORIES_UNAVAILABLE");
  }
  return categories;
}

async function loadReportCategories(filePath = REPORT_FORM_PATH) {
  try {
    return extractReportCategories(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ASSISTANT_CATEGORIES_UNAVAILABLE") throw error;
    throw assistantError("The report category list is unavailable.", 503, "ASSISTANT_CATEGORIES_UNAVAILABLE");
  }
}

function buildResponseSchema(categories) {
  return {
    type: "object",
    properties: {
      is_civic_issue: { type: "boolean" },
      category: { type: "string", enum: [...categories, "unknown"] },
      subcategory: { type: "string" },
      title: { type: "string" },
      description: { type: "string" },
      severity: { type: "string", enum: ["low", "medium", "high", "urgent"] },
      severity_reason: { type: "string" },
      date_observed: { type: "string" },
      location_hint: { type: "string" },
      suggested_department: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      follow_up_questions: { type: "array", items: { type: "string" } },
      user_message: { type: "string" }
    },
    required: [
      "is_civic_issue",
      "category",
      "subcategory",
      "title",
      "description",
      "severity",
      "severity_reason",
      "date_observed",
      "location_hint",
      "suggested_department",
      "confidence",
      "follow_up_questions",
      "user_message"
    ],
    additionalProperties: false
  };
}

function validateHistory(history) {
  if (!Array.isArray(history) || history.length > 10) {
    throw assistantError("Chat history must contain no more than 10 messages.", 400, "INVALID_ASSISTANT_HISTORY");
  }
  let previousRole = "";
  return history.map((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn) ||
        !["user", "assistant"].includes(turn.role) ||
        typeof turn.content !== "string" ||
        !turn.content.trim() ||
        turn.content.length > MAX_TEXT_LENGTH ||
        turn.role === previousRole) {
      throw assistantError("Chat history contains an invalid message.", 400, "INVALID_ASSISTANT_HISTORY");
    }
    previousRole = turn.role;
    return { role: turn.role, content: turn.content.trim() };
  });
}

function validateAssistantInput({ message, history = [], selectedCategory = "", categories, image }) {
  if (typeof message !== "string" || message.length > MAX_TEXT_LENGTH) {
    throw assistantError("Your message must be 1 to 1200 characters.", 400, "INVALID_ASSISTANT_MESSAGE");
  }
  const text = message.trim();
  if (!text && !image) {
    throw assistantError("Add a short description or choose a photo.", 400, "EMPTY_ASSISTANT_REQUEST");
  }
  if (!Array.isArray(categories) || !categories.length) {
    throw assistantError("The report category list is unavailable.", 503, "ASSISTANT_CATEGORIES_UNAVAILABLE");
  }
  if (selectedCategory && !categories.includes(selectedCategory)) {
    throw assistantError("Choose a category from the report form.", 400, "INVALID_ASSISTANT_CATEGORY");
  }
  return { text, history: validateHistory(history), selectedCategory };
}

function validateAssistantResult(result, categories) {
  const requiredKeys = [
    "is_civic_issue", "category", "subcategory", "title", "description", "severity",
    "severity_reason", "date_observed", "location_hint", "suggested_department",
    "confidence", "follow_up_questions", "user_message"
  ];
  if (!result || typeof result !== "object" || Array.isArray(result) ||
      Object.keys(result).length !== requiredKeys.length ||
      requiredKeys.some((key) => !Object.hasOwn(result, key))) {
    throw assistantError("The assistant returned an invalid response. Please try again.", 503, "INVALID_ASSISTANT_RESPONSE");
  }
  const stringFields = [
    "subcategory", "title", "description", "severity_reason", "date_observed",
    "location_hint", "suggested_department", "user_message"
  ];
  const sentenceCount = typeof result.description === "string"
    ? (result.description.match(/[.!?。！？]+/gu) || []).length
    : 0;
  if (typeof result.is_civic_issue !== "boolean" ||
      stringFields.some((key) => typeof result[key] !== "string") ||
      ![...categories, "unknown"].includes(result.category) ||
      !["low", "medium", "high", "urgent"].includes(result.severity) ||
      !Number.isFinite(result.confidence) ||
      result.confidence < 0 || result.confidence > 1 ||
      !Array.isArray(result.follow_up_questions) ||
      result.follow_up_questions.length > 2 ||
      result.follow_up_questions.some((question) => typeof question !== "string" || question.length > 200) ||
      result.subcategory.length > 100 ||
      result.title.length > 120 ||
      (result.is_civic_issue && (!result.title.trim() || !result.description.trim() ||
        result.title.trim().split(/\s+/).length > 8 ||
        sentenceCount < 2 || sentenceCount > 3)) ||
      result.description.length > 2500 ||
      result.severity_reason.length > 500 ||
      result.location_hint.length > 200 ||
      result.suggested_department.length > 200 ||
      result.user_message.length > 1500) {
    throw assistantError("The assistant returned an invalid response. Please try again.", 503, "INVALID_ASSISTANT_RESPONSE");
  }
  return result;
}

function isEmergencyText(text) {
  return /\b(fire|burning|gas leak|gas smell|explosion|live wires?|exposed wires?|electrocution|collapsed?|collapse|injured|injury|person hurt|seriously hurt)\b/i.test(text);
}

function finalizeAssistantResult(result, categories, { text = "", now = new Date() } = {}) {
  const validated = validateAssistantResult(result, categories);
  const finalized = { ...validated, date_observed: now.toISOString(), suggested_department: "" };
  if (isEmergencyText(text) || finalized.severity === "urgent") {
    finalized.severity = "urgent";
    const emergencyPrefix = `Emergency: Contact local emergency services at ${EMERGENCY_NUMBER} now.`;
    if (!finalized.user_message.startsWith(emergencyPrefix)) {
      finalized.user_message = `${emergencyPrefix} ${finalized.user_message}`.trim();
    }
  }
  const fallback = finalized.confidence < 0.6 ||
    (finalized.is_civic_issue && finalized.category === "unknown");
  return {
    analysis: finalized,
    fallback,
    suggested_report: !fallback && finalized.is_civic_issue && finalized.category !== "unknown"
  };
}

function imageMimeMatches(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer)) return false;
  if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === "image/webp") return buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP";
  return false;
}

async function resizeImage(buffer, mimeType) {
  if (!imageMimeMatches(buffer, mimeType)) {
    throw assistantError("Upload a valid JPG, PNG, or WEBP photo.", 400, "INVALID_ASSISTANT_IMAGE");
  }
  let image;
  try {
    image = await loadImage(buffer);
  } catch {
    throw assistantError("That photo could not be opened. Choose a valid JPG, PNG, or WEBP image.", 400, "INVALID_ASSISTANT_IMAGE");
  }
  if (!image.width || !image.height || image.width * image.height > 40_000_000) {
    throw assistantError("That photo is too large to process. Choose a smaller image.", 400, "ASSISTANT_IMAGE_DIMENSIONS");
  }
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(image, 0, 0, width, height);
  return {
    data: canvas.toBuffer("image/jpeg", 82).toString("base64"),
    mimeType: "image/jpeg",
    width,
    height
  };
}

function buildUserPrompt({ text, history, selectedCategory, categories }) {
  const websiteFacts = [
    "The Dashboard has a Report an issue form and a My reported issues section.",
    "Preparing and saving a report in Civic X does not submit it to a government authority.",
    "The existing report form requires a category, description, street or landmark, registered city, and a map point.",
    "The Dashboard's existing Log in and Sign up controls handle account access.",
    "The Dashboard links to CPGRAMS for filing an official government grievance."
  ].join("\n");
  return [
    `Allowed report category values: ${JSON.stringify(categories)}.`,
    `Website facts you may use for website-help questions:\n${websiteFacts}`,
    `Selected category, if any: ${selectedCategory || "none"}.`,
    `Recent conversation (oldest first):\n${JSON.stringify(history)}`,
    `Current user message:\n${text || "(No text; analyze the attached photo.)"}`,
    "A date must not be inferred from the image. Use an empty date_observed; the server will set it."
  ].join("\n\n");
}

async function analyzeAssistant({
  apiKey,
  model = process.env.CIVICX_ASSISTANT_MODEL,
  message,
  history = [],
  selectedCategory = "",
  categories,
  image
}) {
  const input = validateAssistantInput({ message, history, selectedCategory, categories, image });
  if (!apiKey) {
    throw assistantError("The assistant is not configured on this server. You can report manually.", 503, "GEMINI_NOT_CONFIGURED");
  }
  if (!model || !model.trim()) {
    throw assistantError("The assistant model is not configured on this server.", 503, "ASSISTANT_MODEL_NOT_CONFIGURED");
  }

  const parts = [{ type: "text", text: buildUserPrompt({ ...input, categories }) }];
  if (image) {
    const resized = await resizeImage(image.buffer, image.mimetype);
    parts.push({ type: "image", data: resized.data, mime_type: resized.mimeType });
  }
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: {
      apiVersion: "v1beta",
      timeout: 30_000,
      retryOptions: { attempts: 1 }
    }
  });

  let response;
  try {
    response = await client.interactions.create({
      model: model.trim(),
      input: parts,
      system_instruction: `${SYSTEM_INSTRUCTION} Category values: ${JSON.stringify(categories)}.`,
      response_format: {
        type: "text",
        mime_type: "application/json",
        schema: buildResponseSchema(categories)
      },
      store: false
    });
  } catch (error) {
    const status = Number(error?.status || error?.response?.status);
    if (status === 429) {
      throw assistantError("The assistant is busy. Please wait a moment, then try again.", 429, "ASSISTANT_PROVIDER_RATE_LIMIT");
    }
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || error?.code === "TIMEOUT") {
      throw assistantError("The assistant took too long to respond. Your message and photo are still here; try again or report manually.", 504, "ASSISTANT_TIMEOUT");
    }
    throw assistantError("The assistant could not analyze this right now. Your message and photo are still here; try again or report manually.", 503, "ASSISTANT_PROVIDER_UNAVAILABLE");
  }
  if (typeof response?.output_text !== "string" || !response.output_text.trim()) {
    throw assistantError("The assistant returned no analysis. Your message and photo are still here; try again or report manually.", 503, "EMPTY_ASSISTANT_RESPONSE");
  }

  let result;
  try {
    result = JSON.parse(response.output_text);
  } catch {
    throw assistantError("The assistant returned an invalid response. Your message and photo are still here; try again or report manually.", 503, "INVALID_ASSISTANT_JSON");
  }
  return finalizeAssistantResult(result, categories, { text: input.text });
}

function allowedOrigin(request) {
  const origin = request.get("origin");
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.origin === `${request.protocol}://${request.get("host")}`;
  } catch {
    return false;
  }
}

function registerAssistantRoute(app, { apiKey = "", model = "", analyze = analyzeAssistant } = {}) {
  const requestsByIp = new Map();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 3, fieldSize: 20_000 },
    fileFilter(request, file, callback) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
        const error = assistantError("Upload a JPG, PNG, or WEBP photo.", 400, "INVALID_ASSISTANT_IMAGE");
        callback(error);
        return;
      }
      callback(null, true);
    }
  });

  function consumeRateLimit(ip) {
    const now = Date.now();
    for (const [knownIp, timestamps] of requestsByIp) {
      const recent = timestamps.filter((timestamp) => now - timestamp < 15 * 60 * 1000);
      if (recent.length) requestsByIp.set(knownIp, recent);
      else requestsByIp.delete(knownIp);
    }
    const recent = (requestsByIp.get(ip) || []).filter((timestamp) => now - timestamp < 15 * 60 * 1000);
    if (recent.length >= 10) return false;
    requestsByIp.set(ip, [...recent, now]);
    return true;
  }

  app.post("/api/assistant/analyze", (request, response) => {
    response.set("Cache-Control", "no-store");
    if (!allowedOrigin(request)) {
      response.status(403).json({ ok: false, error: "This assistant endpoint only accepts requests from this website." });
      return;
    }
    const ipKey = createHash("sha256")
      .update(RATE_LIMIT_SALT)
      .update(String(request.ip || request.socket.remoteAddress || "unknown"))
      .digest("hex");
    if (!consumeRateLimit(ipKey)) {
      response.status(429).json({ ok: false, error: "Too many assistant requests. Please try again later." });
      return;
    }
    if (!request.is("multipart/form-data")) {
      response.status(415).json({ ok: false, error: "Send a short description and optional JPG, PNG, or WEBP photo." });
      return;
    }

    upload.single("image")(request, response, async (uploadError) => {
      const file = request.file;
      try {
        if (uploadError) {
          const tooLarge = uploadError.code === "LIMIT_FILE_SIZE";
          response.status(tooLarge ? 413 : uploadError.statusCode || 400).json({
            ok: false,
            error: tooLarge ? "That photo is over 5 MB. Choose a smaller image." : uploadError.message
          });
          return;
        }
        const body = request.body || {};
        if (Object.keys(body).some((key) => !["message", "history", "category"].includes(key))) {
          response.status(400).json({ ok: false, error: "Send only a message, recent history, category, and optional photo." });
          return;
        }
        if (typeof body.message !== "string" ||
            (body.history !== undefined && typeof body.history !== "string") ||
            (body.category !== undefined && typeof body.category !== "string")) {
          response.status(400).json({ ok: false, error: "Send a valid message, history, and category." });
          return;
        }
        let history = [];
        if (body.history) {
          try {
            history = JSON.parse(body.history);
          } catch {
            response.status(400).json({ ok: false, error: "Chat history must be valid JSON." });
            return;
          }
        }
        if (!apiKey) {
          response.status(503).json({
            ok: false,
            error: "The assistant is not configured on this server. You can report manually."
          });
          return;
        }
        const categories = await loadReportCategories();
        const result = await analyze({
          apiKey,
          model,
          message: body.message,
          history,
          selectedCategory: body.category || "",
          categories,
          image: file
        });
        response.status(200).json({ ok: true, ...result, categories });
      } catch (error) {
        const knownMessage = error.statusCode === 400 ||
          ["GEMINI_NOT_CONFIGURED", "ASSISTANT_MODEL_NOT_CONFIGURED", "ASSISTANT_CATEGORIES_UNAVAILABLE",
            "ASSISTANT_TIMEOUT", "ASSISTANT_PROVIDER_RATE_LIMIT", "ASSISTANT_PROVIDER_UNAVAILABLE",
            "EMPTY_ASSISTANT_RESPONSE", "INVALID_ASSISTANT_JSON", "INVALID_ASSISTANT_RESPONSE",
            "ASSISTANT_IMAGE_DIMENSIONS"].includes(error.code);
        console.error("[CivicX assistant] Analysis failed", {
          code: error.code || "UNKNOWN",
          status: Number.isInteger(error.statusCode) ? error.statusCode : "unknown"
        });
        const status = [400, 429, 504].includes(error.statusCode) ? error.statusCode : 503;
        response.status(status).json({
          ok: false,
          error: knownMessage
            ? error.message
            : "The assistant could not analyze this right now. Your message and photo are still here; try again or report manually."
        });
      } finally {
        if (file?.buffer) file.buffer.fill(0);
      }
    });
  });
}

module.exports = {
  EMERGENCY_NUMBER,
  MAX_IMAGE_BYTES,
  analyzeAssistant,
  allowedOrigin,
  buildResponseSchema,
  extractReportCategories,
  finalizeAssistantResult,
  isEmergencyText,
  loadReportCategories,
  registerAssistantRoute,
  resizeImage,
  validateAssistantInput,
  validateAssistantResult
};
