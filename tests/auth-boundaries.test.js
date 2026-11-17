const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { createSupabaseAuthenticator } = require("../server/supabase-auth");

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    await callback(server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function post(server, route, body, accessToken) {
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return fetch(`http://127.0.0.1:${server.address().port}${route}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

test("AI endpoints reject guests before processing requests", async () => {
  let aiCalled = false;
  const app = createApp({
    apiKey: "test-key",
    authenticateUser: async () => null,
    chatWithCivicX: async () => { aiCalled = true; return "unexpected"; }
  });

  await withServer(app, async (server) => {
    const chat = await post(server, "/api/chat", { message: "question", history: [] });
    assert.equal(chat.status, 401);
    assert.deepEqual(await chat.json(), { ok: false, error: "Sign in to use CivicX AI." });

    const legacyChat = await post(server, "/api/ai/chat", {
      messages: [{ role: "user", content: "question" }]
    });
    assert.equal(legacyChat.status, 401);

    const describe = await post(server, "/api/ai/describe", { userId: "claimed-user" });
    assert.equal(describe.status, 401);
    assert.deepEqual(await describe.json(), { message: "Sign in to use CivicX AI." });
    assert.equal(aiCalled, false);
  });
});

test("caller-supplied identity does not bypass invalid-session rejection", async () => {
  let verifiedToken = "";
  const app = createApp({
    apiKey: "test-key",
    authenticateUser: async (token) => {
      verifiedToken = token;
      return null;
    }
  });

  await withServer(app, async (server) => {
    const response = await post(
      server,
      "/api/chat",
      { message: "question", history: [], userId: "claimed-user" },
      "invalid-token"
    );
    assert.equal(response.status, 401);
    assert.equal(verifiedToken, "invalid-token");
  });
});

test("AI requests proceed only when the server verifier returns an authenticated user", async () => {
  let modelCalled = false;
  const app = createApp({
    apiKey: "test-key",
    authenticateUser: async (token) => token === "verified-token" ? { id: "auth-user-id" } : null,
    chatWithCivicX: async ({ message }) => {
      modelCalled = true;
      return `verified: ${message}`;
    }
  });

  await withServer(app, async (server) => {
    const response = await post(server, "/api/chat", {
      message: "civic question",
      history: []
    }, "verified-token");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, reply: "verified: civic question" });
    assert.equal(modelCalled, true);
  });
});

test("AI requests fail closed when Supabase session verification is unavailable", async () => {
  const app = createApp({
    authenticateUser: async () => {
      const error = new Error("upstream unavailable");
      error.code = "SUPABASE_AUTH_UNAVAILABLE";
      throw error;
    }
  });

  await withServer(app, async (server) => {
    const response = await post(server, "/api/chat", {
      message: "civic question",
      history: []
    }, "some-token");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Sign-in verification is temporarily unavailable."
    });
  });
});

test("AI requests fail closed when no session verifier is configured", async () => {
  await withServer(createApp({ apiKey: "test-key" }), async (server) => {
    const response = await post(server, "/api/chat", {
      message: "civic question",
      history: []
    }, "some-token");
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Sign-in verification is not configured on this server."
    });
  });
});

test("Supabase authenticator verifies bearer tokens with the Auth user endpoint", async () => {
  let received;
  const authenticate = createSupabaseAuthenticator({
    supabaseUrl: "https://project.example.supabase.co/",
    anonKey: "public-anon-key",
    fetchImpl: async (url, options) => {
      received = { url, options };
      return new Response(JSON.stringify({ id: "verified-user-id" }), { status: 200 });
    }
  });

  assert.deepEqual(await authenticate("access-token"), { id: "verified-user-id" });
  assert.equal(received.url, "https://project.example.supabase.co/auth/v1/user");
  assert.equal(received.options.headers.apikey, "public-anon-key");
  assert.equal(received.options.headers.Authorization, "Bearer access-token");
});
