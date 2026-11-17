const test = require("node:test");
const assert = require("node:assert/strict");
const { chatWithCivicX, generateDescription } = require("../server/ai/gemini");

const input = {
  city: "Kolkata",
  note: "Illustrative pothole test",
  mode: "detect",
  category: "Pothole",
  photos: [{ mimeType: "image/jpeg", base64: "c2FmZQ==" }],
  registry: {
    issueRouting: [{ issueType: "Pothole", suggestedDepartment: "Roads / Public Works" }]
  }
};

function mockResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function successPayload(text = JSON.stringify({
  category: "Pothole",
  evidence: "A damaged road surface is visible.",
  description: "A pothole disrupts safe passage for road users.",
  publicImpact: "Road users may need to avoid the visible damage.",
  confidence: "Medium",
  severity: "High",
  department: "Model suggestion"
})) {
  return {
    candidates: [{
      content: { parts: [{ text }] },
      finishReason: "STOP"
    }]
  };
}

test("photo generation uses the Gemini SDK request and validates structured output", async () => {
  let calls = 0;
  const result = await generateDescription("unit-test-key", input, async (url, options) => {
    calls += 1;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    assert.equal(options.method, "POST");
    assert.equal(new Headers(options.headers).get("x-goog-api-key"), "unit-test-key");
    assert.equal(new Headers(options.headers).get("x-server-timeout"), "60");

    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].role, "user");
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, "image/jpeg");
    assert.equal(body.contents[0].parts[1].inlineData.data, "c2FmZQ==");
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.temperature, 0.7);
    assert.deepEqual(body.generationConfig.responseSchema.required, [
      "category", "evidence", "description", "publicImpact", "confidence", "severity", "department"
    ]);
    assert.equal(body.generationConfig.maxOutputTokens, 2048);
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "MINIMAL");
    assert.equal("thinkingBudget" in body.generationConfig.thinkingConfig, false);
    return mockResponse(200, successPayload());
  });

  assert.equal(calls, 1);
  assert.equal(result.category, "Pothole");
  assert.equal(result.department, "Roads / Public Works");
});

test("chat sends sanitized conversation history and returns Gemini text", async () => {
  const history = [
    { role: "user", parts: [{ text: "Contact resident@example.com or +91 9876543210." }] },
    { role: "model", parts: [{ text: "I can help with a civic report." }] }
  ];
  const reply = await chatWithCivicX({
    message: "Can I file it here?",
    history
  }, "unit-test-key", async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.contents.map(({ role }) => role), ["user", "model", "user"]);
    assert.match(body.contents[0].parts[0].text, /\[email redacted\]/);
    assert.match(body.contents[0].parts[0].text, /\[phone redacted\]/);
    assert.doesNotMatch(JSON.stringify(body.contents), /resident@example\.com|9876543210/);
    assert.match(body.systemInstruction.parts[0].text, /does not file complaints with authorities or verify portal status/);
    return mockResponse(200, successPayload("CivicX prepares reports but does not file them."));
  });

  assert.equal(reply, "CivicX prepares reports but does not file them.");
});

test("a Gemini 503 is surfaced without retries or a success-shaped fallback", async () => {
  let calls = 0;
  await assert.rejects(
    generateDescription("unit-test-key", input, async () => {
      calls += 1;
      return mockResponse(503, { error: { message: "Temporarily busy" } });
    }),
    (error) => error.code === "GEMINI_UNAVAILABLE" && error.statusCode === 503
  );
  assert.equal(calls, 1);
});

test("a missing Gemini model falls back to the next configured model", async () => {
  const requestedModels = [];
  const result = await generateDescription("unit-test-key", input, async (url) => {
    requestedModels.push(url.match(/models\/([^:]+)/)?.[1]);
    return requestedModels.length === 1
      ? mockResponse(404, { error: { message: "Model not found" } })
      : mockResponse(200, successPayload());
  });

  assert.deepEqual(requestedModels, ["gemini-3.5-flash-lite", "gemini-3.6-flash"]);
  assert.equal(result.category, "Pothole");
});

test("provider configuration errors do not expose the API key", async () => {
  await assert.rejects(
    generateDescription("unit-test-key", input, async () =>
      mockResponse(401, { error: { message: "Invalid key: unit-test-key" } })
    ),
    (error) => error.code === "GEMINI_CONFIGURATION" &&
      error.statusCode === 502 &&
      !error.message.includes("unit-test-key")
  );
});

test("invalid structured model output is returned as an error instead of a draft", async () => {
  await assert.rejects(
    generateDescription("unit-test-key", input, async () =>
      mockResponse(200, successPayload("not JSON"))
    ),
    (error) => error.code === "GEMINI_INVALID_RESPONSE" &&
      error.statusCode === 503 &&
      !error.message.includes("not JSON")
  );
});
