const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AuthorityError,
  createAuthorityAttachmentService,
  createAuthorityService,
  validateAuthorityAttachmentRequest,
  validateAuthorityRequest
} = require("../server/authority");
const { createApp } = require("../server/app");
const authorityKey = "a".repeat(40);

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    await callback(server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function request(accessToken, body = { action: "reopen", details: "New evidence shows the repair failed." }) {
  return {
    accessToken,
    masterKey: authorityKey,
    reportId: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    ...body
  };
}

test("authority requests require a bearer token, supported action, and bounded audit note", () => {
  const validated = validateAuthorityRequest(
    "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    "Bearer user-session-token",
    { action: "status_update", status: "Resolved", details: "Work verified on site." }
  );
  assert.equal(validated.accessToken, "user-session-token");
  assert.equal(validated.action, "status_update");
  assert.equal(validated.status, "Resolved");
  assert.equal(
    validateAuthorityRequest("CX-1", "Bearer token", {
      action: "status_update",
      status: "Pending",
      details: "Awaiting inspection."
    }).status,
    "Pending"
  );
  assert.equal(
    validateAuthorityRequest("CX-1", "Bearer token", {
      action: "status_update",
      status: "Cannot be Resolved",
      details: "No safe repair is currently feasible."
    }).status,
    "Cannot be Resolved"
  );
  assert.throws(
    () => validateAuthorityRequest("CX-1", "", { action: "reopen", details: "Reason" }),
    (error) => error instanceof AuthorityError && error.status === 401
  );
  assert.throws(
    () => validateAuthorityRequest("CX-1", "Bearer token", {
      action: "reopen",
      details: "Reason",
      actorUserId: "attacker-selected-id"
    }),
    (error) => error instanceof AuthorityError && error.status === 400
  );
  assert.throws(
    () => validateAuthorityRequest("CX-1", "Bearer token", {
      action: "reopen",
      details: "Reason",
      jurisdictionKey: "another-city"
    }),
    (error) => error instanceof AuthorityError && error.status === 400
  );
  assert.throws(
    () => validateAuthorityRequest("CX-1", "Bearer token", {
      action: "resolution_evidence_add",
      evidenceUrl: "http://example.test/evidence",
      details: "Evidence"
    }),
    (error) => error instanceof AuthorityError && error.status === 400
  );
});

test("attachment requests require a valid report reference and bearer session", () => {
  assert.deepEqual(
    validateAuthorityAttachmentRequest("CX-1", "Bearer authority-session"),
    { accessToken: "authority-session", masterKey: "", reportId: "CX-1" }
  );
  assert.throws(
    () => validateAuthorityAttachmentRequest("CX-1", ""),
    (error) => error instanceof AuthorityError && error.status === 401
  );
  assert.throws(
    () => validateAuthorityAttachmentRequest("../other-user/photo.jpg", "Bearer session"),
    (error) => error instanceof AuthorityError && error.status === 400
  );
});

test("authority service authenticates the bearer user and passes that ID to the guarded RPC", async () => {
  const calls = [];
  const client = {
    auth: {
      async getUser(token) {
        calls.push(["getUser", token]);
        return { data: { user: { id: "authority-user-id" } }, error: null };
      }
    },
    from(table) {
      assert.equal(table, "civic_authorities");
      const query = {
        select() { return query; },
        eq(column, value) { calls.push(["eq", column, value]); return query; },
        async maybeSingle() { return { data: { user_id: "authority-user-id" }, error: null }; }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      if (name === "civic_authority_can_access_report") {
        return { data: true, error: null };
      }
      return {
        data: {
          report: { id: args.p_report_id, status: "In progress" },
          event: { actor_user_id: args.p_actor_user_id, event_type: "reopened" }
        },
        error: null
      };
    }
  };
  const service = createAuthorityService({ client, authorityMasterKey: authorityKey });
  const result = await service(request("signed-user-token"));

  assert.equal(result.event.actor_user_id, "authority-user-id");
  assert.deepEqual(calls[0], ["getUser", "signed-user-token"]);
  const jurisdictionCall = calls.find(([, name]) => name === "civic_authority_can_access_report");
  assert.deepEqual(jurisdictionCall[2], {
    p_actor_user_id: "authority-user-id",
    p_report_id: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda"
  });
  const rpcCall = calls.find(([, name]) => name === "apply_civic_report_authority_action");
  assert.equal(rpcCall[1], "apply_civic_report_authority_action");
  assert.equal(rpcCall[2].p_actor_user_id, "authority-user-id");
});

test("authority actions fail closed when jurisdiction is unassigned or does not match", async () => {
  const calls = [];
  const client = {
    auth: { async getUser() { return { data: { user: { id: "authority-user-id" } }, error: null }; } },
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() { return { data: { user_id: "authority-user-id" }, error: null }; }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(name);
      if (name === "civic_authority_can_access_report") return { data: false, error: null };
      return { data: { event: { actor_user_id: args.p_actor_user_id } }, error: null };
    }
  };
  const service = createAuthorityService({ client, authorityMasterKey: authorityKey });
  await assert.rejects(service(request("authority-session")), (error) => error.status === 403);
  assert.deepEqual(calls, ["civic_authority_can_access_report"]);
});

test("authorized authority receives a short-lived URL for the report's stored attachment only", async () => {
  const calls = [];
  let jurisdictionAllowed = true;
  const client = {
    auth: {
      async getUser(token) {
        calls.push(["getUser", token]);
        return { data: { user: { id: "authority-user-id" } }, error: null };
      }
    },
    from(table) {
      calls.push(["from", table]);
      const query = {
        select(columns) { calls.push(["select", columns]); return query; },
        eq(column, value) { calls.push(["eq", column, value]); return query; },
        async maybeSingle() {
          if (table === "civic_authorities") {
            return { data: { user_id: "authority-user-id" }, error: null };
          }
          return {
            data: {
              id: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
              user_id: "report-owner-id",
              photo_path: "report-owner-id/CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda/issue-photo.jpg"
            },
            error: null
          };
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      assert.equal(name, "civic_authority_can_access_report");
      return { data: jurisdictionAllowed, error: null };
    },
    storage: {
      from(bucket) {
        calls.push(["storage", bucket]);
        return {
          async createSignedUrl(path, expiresIn) {
            calls.push(["sign", path, expiresIn]);
            return { data: { signedUrl: "https://storage.example/signed-token" }, error: null };
          }
        };
      }
    }
  };
  const service = createAuthorityAttachmentService({ client, authorityMasterKey: authorityKey });
  const result = await service({
    accessToken: "signed-authority-session",
    masterKey: authorityKey,
    reportId: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda"
  });

  assert.deepEqual(result, {
    reportId: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    signedUrl: "https://storage.example/signed-token",
    expiresIn: 60
  });
  assert.deepEqual(calls.find(([kind]) => kind === "storage"), ["storage", "civic-report-attachments"]);
  assert.deepEqual(calls.find(([kind]) => kind === "sign"), [
    "sign",
    "report-owner-id/CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda/issue-photo.jpg",
    60
  ]);
  assert.ok(calls.findIndex(([kind]) => kind === "sign") >
    calls.findIndex(([kind, table]) => kind === "from" && table === "civic_authorities"));
  assert.deepEqual(calls.find(([, name]) => name === "civic_authority_can_access_report")[2], {
    p_actor_user_id: "authority-user-id",
    p_report_id: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda"
  });
});

test("non-authorities, unassigned authorities, and invalid paths are denied before URL signing", async () => {
  let reportLookupCount = 0;
  let signCount = 0;
  let authorized = false;
  let jurisdictionAllowed = false;
  const client = {
    auth: { async getUser() { return { data: { user: { id: "ordinary-user-id" } }, error: null }; } },
    from(table) {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() {
          if (table === "civic_authorities") {
            return { data: authorized ? { user_id: "ordinary-user-id" } : null, error: null };
          }
          reportLookupCount += 1;
          return {
            data: {
              id: "CX-1",
              user_id: "report-owner-id",
              photo_path: "another-user/CX-1/issue-photo.jpg"
            },
            error: null
          };
        }
      };
      return query;
    },
    async rpc(name) {
      assert.equal(name, "civic_authority_can_access_report");
      return { data: jurisdictionAllowed, error: null };
    },
    storage: {
      from() {
        return {
          async createSignedUrl() {
            signCount += 1;
            return { data: { signedUrl: "https://storage.example/should-not-sign" }, error: null };
          }
        };
      }
    }
  };
  const service = createAuthorityAttachmentService({ client, authorityMasterKey: authorityKey });
  const request = { accessToken: "ordinary-session", masterKey: authorityKey, reportId: "CX-1" };

  await assert.rejects(service(request), (error) => error.status === 403);
  assert.equal(reportLookupCount, 0);

  authorized = true;
  await assert.rejects(service(request), (error) => error.status === 403);
  assert.equal(reportLookupCount, 0);

  jurisdictionAllowed = true;
  await assert.rejects(service(request), (error) => error.status === 503);
  assert.equal(reportLookupCount, 1);
  assert.equal(signCount, 0);
});

test("authority service denies inactive users and does not call the action RPC", async () => {
  let rpcCalled = false;
  const client = {
    auth: { async getUser() { return { data: { user: { id: "citizen-id" } }, error: null }; } },
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() { return { data: null, error: null }; }
      };
      return query;
    },
    async rpc() { rpcCalled = true; return { data: null, error: null }; }
  };
  const service = createAuthorityService({ client, authorityMasterKey: authorityKey });

  let inactiveAccountError;
  await assert.rejects(service(request("citizen-token")), (error) => {
    inactiveAccountError = error;
    return error.status === 403;
  });
  await assert.rejects(service({ ...request("citizen-token"), masterKey: "wrong-key" }), (error) => {
    assert.equal(error.status, inactiveAccountError.status);
    assert.equal(error.message, inactiveAccountError.message);
    assert.equal(error.credentialFailure, true);
    return true;
  });
  assert.equal(rpcCalled, false);
});

test("configured authority master key is required and preserves authenticated jurisdiction checks", async () => {
  const client = {
    auth: { async getUser() { return { data: { user: { id: "authority-user-id" } }, error: null }; } },
    from() {
      const query = {
        select() { return query; },
        eq() { return query; },
        async maybeSingle() { return { data: { user_id: "authority-user-id" }, error: null }; }
      };
      return query;
    },
    async rpc(name, args) {
      if (name === "civic_authority_can_access_report") return { data: true, error: null };
      return { data: { event: { actor_user_id: args.p_actor_user_id } }, error: null };
    }
  };
  const service = createAuthorityService({ client, authorityMasterKey: authorityKey });
  await assert.rejects(
    service({ ...request("signed-user-token"), masterKey: "wrong" }),
    (error) => error.status === 403
  );
  const result = await service(request("signed-user-token"));
  assert.equal(result.event.actor_user_id, "authority-user-id");
});

test("attachment route requires authority authentication and prevents response caching", async () => {
  let serviceCalled = false;
  await withServer(createApp({
    authorityAttachmentService: async (request) => {
      serviceCalled = true;
      return {
        reportId: request.reportId,
        signedUrl: "https://storage.example/signed",
        expiresIn: 60
      };
    }
  }), async (server) => {
    const base = `http://127.0.0.1:${server.address().port}/api/reports/CX-1/attachment`;
    const denied = await fetch(base);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("cache-control"), "private, no-store");
    assert.equal(serviceCalled, false);

    const allowed = await fetch(`${base}?path=another-user/private.jpg`, {
      headers: { Authorization: "Bearer authority-session" }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(await allowed.json(), {
      ok: true,
      result: {
        reportId: "CX-1",
        signedUrl: "https://storage.example/signed",
        expiresIn: 60
      }
    });
    assert.equal(serviceCalled, true);
  });
});

test("authority action HTTP route validates input and is disabled without server credentials", async () => {
  await withServer(createApp(), async (server) => {
    const disabled = await fetch(
      `http://127.0.0.1:${server.address().port}/api/reports/CX-1/authority-actions`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reopen" }) }
    );
    assert.equal(disabled.status, 503);
  });

  const received = [];
  await withServer(createApp({
    authorityService: async (value) => {
      received.push(value);
      return { event: { actor_user_id: "verified-authority-id" } };
    }
  }), async (server) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/reports/CX-1/authority-actions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer authority-session"
        },
        body: JSON.stringify({ action: "reopen", details: "The issue returned." })
      }
    );
    assert.equal(response.status, 200);
    assert.equal(received[0].accessToken, "authority-session");
    assert.equal(received[0].actorUserId, undefined);
  });
});

test("public Supabase configuration never includes the server-only service role key", async () => {
  const previous = {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY
  };
  process.env.SUPABASE_URL = "https://project.example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-server-only-key";

  try {
    await withServer(createApp(), async (server) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/public-config`);
      const body = await response.json();
      assert.deepEqual(body.supabase, {
        url: "https://project.example.supabase.co",
        anonKey: "test-anon-key",
        configured: true
      });
      assert.equal(JSON.stringify(body).includes("test-server-only-key"), false);
    });
  } finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previous.url;
    if (previous.anonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previous.anonKey;
    if (previous.serviceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previous.serviceRoleKey;
  }
});
