const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createCanvas } = require("@napi-rs/canvas");
const { createApp } = require("../server/app");
const {
  EMERGENCY_NUMBER,
  extractReportCategories,
  finalizeAssistantResult,
  registerAssistantRoute,
  resizeImage,
  validateAssistantResult
} = require("../server/ai/assistant");

const categories = ["Pothole", "Garbage", "Water leakage", "Streetlight", "Electricity related problem"];

function assistantResult(overrides = {}) {
  return {
    is_civic_issue: true,
    category: "Garbage",
    subcategory: "overflowing bin",
    title: "Waste beside a roadside bin",
    description: "Mixed waste is visible beside a roadside bin. The image does not show a readable street sign.",
    severity: "medium",
    severity_reason: "Waste is visible on the public roadside.",
    date_observed: "",
    location_hint: "",
    suggested_department: "",
    confidence: 0.9,
    follow_up_questions: [],
    user_message: "I prepared a draft based only on what is visible.",
    ...overrides
  };
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

async function withRoute(options, callback) {
  const app = express();
  registerAssistantRoute(app, options);
  return withServer(app, callback);
}

function assistantForm({ message = "", image, category = "", history = [] } = {}) {
  const body = new FormData();
  body.append("message", message);
  body.append("history", JSON.stringify(history));
  body.append("category", category);
  if (image) body.append("image", image, "upload.bin");
  return body;
}

test("category extraction follows the existing report form values", () => {
  const html = `<select id="report-category">
    <option value="" selected disabled>Choose an issue</option>
    <option value="Road">Road issue</option>
    <option value="Water &amp; drains">Water issue</option>
  </select>`;
  assert.deepEqual(extractReportCategories(html), ["Road", "Water & drains"]);
});

test("model output rejects categories not present in the report form", () => {
  assert.throws(
    () => validateAssistantResult(assistantResult({ category: "Flooding" }), categories),
    { code: "INVALID_ASSISTANT_RESPONSE" }
  );
  assert.throws(
    () => validateAssistantResult(assistantResult({ title: "One two three four five six seven eight nine" }), categories),
    { code: "INVALID_ASSISTANT_RESPONSE" }
  );
});

test("low-confidence analysis uses category fallback instead of a suggested report", () => {
  const result = finalizeAssistantResult(
    assistantResult({ is_civic_issue: false, category: "unknown", confidence: 0.42 }),
    categories,
    { now: new Date("2026-11-17T12:00:00.000Z") }
  );
  assert.equal(result.fallback, true);
  assert.equal(result.suggested_report, false);
  assert.equal(result.analysis.date_observed, "2026-11-17T12:00:00.000Z");
});

test("emergency text forces urgent severity and leads with the configured emergency number", () => {
  const result = finalizeAssistantResult(
    assistantResult({ severity: "low" }),
    categories,
    { text: "There are exposed live wires by the road.", now: new Date("2026-11-17T12:00:00.000Z") }
  );
  assert.equal(result.analysis.severity, "urgent");
  assert.ok(result.analysis.user_message.startsWith(`Emergency: Contact local emergency services at ${EMERGENCY_NUMBER} now.`));
});

test("photo resizing converts supported images to bounded JPEG data in memory", async () => {
  const canvas = createCanvas(2000, 1000);
  const png = canvas.toBuffer("image/png");
  const resized = await resizeImage(png, "image/png");
  assert.equal(resized.mimeType, "image/jpeg");
  assert.equal(resized.width, 1600);
  assert.equal(resized.height, 800);
  assert.ok(Buffer.from(resized.data, "base64").subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])));
});

test("analysis route loads report categories and handles text-only analysis", async () => {
  let received;
  await withRoute({
    apiKey: "test-key",
    model: "test-model",
    analyze: async (request) => {
      received = request;
      return finalizeAssistantResult(assistantResult({
        category: "Pothole",
        title: "Large hole in the road",
        description: "A large hole is visible in the road surface. The image does not show a readable location sign."
      }), request.categories, { text: request.message });
    }
  }, async (server) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/analyze`, {
      method: "POST",
      body: assistantForm({ message: "There is a big hole on the road." })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.categories, categories);
    assert.equal(payload.analysis.category, "Pothole");
    assert.equal(received.image, undefined);
  });
});

test("analysis route reports a missing server key without calling the model", async () => {
  let called = false;
  await withRoute({
    apiKey: "",
    analyze: async () => { called = true; }
  }, async (server) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/analyze`, {
      method: "POST",
      body: assistantForm({ message: "There is a big hole on the road." })
    });
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/i);
    assert.equal(called, false);
  });
});

test("analysis route rejects cross-origin requests and unsupported file types", async () => {
  let called = false;
  await withRoute({
    apiKey: "test-key",
    analyze: async () => { called = true; }
  }, async (server) => {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/assistant/analyze`;
    const crossOrigin = await fetch(endpoint, {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
      body: assistantForm({ message: "Road issue" })
    });
    assert.equal(crossOrigin.status, 403);

    const wrongType = await fetch(endpoint, {
      method: "POST",
      body: assistantForm({
        message: "Road issue",
        image: new Blob(["not an image"], { type: "text/plain" })
      })
    });
    assert.equal(wrongType.status, 400);
    assert.equal(called, false);
  });
});

test("analysis route rejects photos over 5 MB", async () => {
  await withRoute({ apiKey: "test-key" }, async (server) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/analyze`, {
      method: "POST",
      body: assistantForm({
        message: "Road issue",
        image: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" })
      })
    });
    assert.equal(response.status, 413);
    assert.match((await response.json()).error, /over 5 MB/i);
  });
});

test("createApp registers the assistant endpoint without changing existing route setup", async () => {
  const app = createApp({
    apiKey: "test-key",
    analyzeAssistant: async ({ categories, message }) => finalizeAssistantResult(
      assistantResult({ category: "Pothole", title: "Large hole in the road" }),
      categories,
      { text: message }
    )
  });
  await withServer(app, async (server) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/assistant/analyze`, {
      method: "POST",
      body: assistantForm({ message: "There is a large hole in the road." })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).analysis.category, "Pothole");
  });
});

test("analysis route limits repeated requests per IP", async () => {
  await withRoute({
    apiKey: "test-key",
    analyze: async ({ categories }) => finalizeAssistantResult(
      assistantResult({ category: "Pothole" }),
      categories
    )
  }, async (server) => {
    const endpoint = `http://127.0.0.1:${server.address().port}/api/assistant/analyze`;
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(endpoint, { method: "POST", body: assistantForm({ message: "Road issue" }) });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(endpoint, { method: "POST", body: assistantForm({ message: "Road issue" }) });
    assert.equal(limited.status, 429);
  });
});
