const test = require("node:test");
const assert = require("node:assert/strict");
const { PortalError, createPortalService } = require("../server/portal");
const { createApp } = require("../server/app");

const authorityId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const citizenId = "33333333-3333-4333-8333-333333333333";
const authorityKey = "a".repeat(40);
const ownerKey = "o".repeat(40);

async function withServer(app, callback) {
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    await callback(server);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function fakeClient(options = {}) {
  const calls = [];
  const rows = {
    civic_authorities: options.authorities ||
      (options.authority ? [{ user_id: options.userId || authorityId, is_active: true }] : []),
    civic_authority_jurisdictions: (options.assignments || []).map((jurisdiction_key) => ({
      authority_user_id: options.userId || authorityId,
      jurisdiction_key
    })),
    civic_jurisdictions: [
      ...(options.activeJurisdictions || []).map((jurisdiction_key) => ({
      jurisdiction_key,
      is_active: true,
      display_name: jurisdiction_key
      })),
      ...(options.jurisdictionRows || [])
    ],
    civic_reports: options.reports || [],
    civic_report_events: options.events || []
  };
  const matches = (table, filters) => (rows[table] || []).filter((row) =>
    filters.every((filter) => filter.kind === "eq"
      ? row[filter.column] === filter.value
      : filter.values.includes(row[filter.column]))
  );
  const client = {
    calls,
    auth: {
      async getUser(token) {
        calls.push(["getUser", token]);
        if (token !== "session") return { data: { user: null }, error: new Error("invalid") };
        return { data: { user: { id: options.userId || authorityId } }, error: null };
      }
    },
    from(table) {
      calls.push(["from", table]);
      const filters = [];
      let selectedColumns = "";
      let requestedRange = null;
      const query = {
        select(columns) {
          selectedColumns = columns;
          calls.push(["select", table, columns]);
          return query;
        },
        eq(column, value) { filters.push({ kind: "eq", column, value }); return query; },
        in(column, values) { filters.push({ kind: "in", column, values }); calls.push(["in", table, column, values]); return query; },
        order() { return query; },
        limit() { return query; },
        range(from, to) {
          requestedRange = [from, to];
          calls.push(["range", table, from, to]);
          return query;
        },
        async maybeSingle() { return { data: matches(table, filters)[0] || null, error: null }; },
        then(resolve, reject) {
          if (table === "civic_jurisdictions" &&
              options.missingJurisdictionCoordinates &&
              selectedColumns.includes("center_latitude")) {
            return Promise.resolve({
              data: null,
              error: { code: "42703", message: 'column "center_latitude" does not exist' }
            }).then(resolve, reject);
          }
          const matchingRows = matches(table, filters);
          const data = requestedRange
            ? matchingRows.slice(requestedRange[0], requestedRange[1] + 1)
            : matchingRows;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
      };
      return query;
    },
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      if (name === "civic_authority_can_access_report") {
        return { data: options.reportAllowed === true, error: null };
      }
      if (name === "civic_owner_set_authority_jurisdictions") {
        return { data: options.changedAssignments ?? 1, error: null };
      }
      return { data: null, error: new Error("unexpected rpc") };
    },
    storage: {
      from(bucket) {
        calls.push(["storage", bucket]);
        return {
          async createSignedUrl(path, expiresIn) {
            calls.push(["sign", path, expiresIn]);
            return { data: { signedUrl: "https://storage.example/short-lived" }, error: null };
          }
        };
      }
    }
  };
  return client;
}

function portal(client, options = {}) {
  return createPortalService({
    client,
    authorityMasterKey: options.authorityMasterKey ?? authorityKey,
    ownerMasterKey: options.ownerMasterKey ?? ownerKey,
    ownerUserIds: options.ownerUserIds ?? ownerId
  });
}

test("authority report lists are filtered by active database assignments, not caller values", async () => {
  const client = fakeClient({
    authority: true,
    assignments: ["kolkata", "inactive-city"],
    activeJurisdictions: ["kolkata"],
    reports: [
      { id: "CX-1", title: "Kolkata issue", jurisdiction_key: "kolkata" },
      { id: "CX-2", title: "Mumbai issue", jurisdiction_key: "mumbai" }
    ]
  });
  const service = portal(client);
  const result = await service.listReports({
    accessToken: "session",
    masterKey: authorityKey,
    jurisdictionKeys: ["mumbai"]
  });

  assert.equal(result.role, "authority");
  assert.deepEqual(result.reports.map((report) => report.id), ["CX-1"]);
  assert.deepEqual(client.calls.find((call) => call[0] === "in" && call[1] === "civic_reports"), [
    "in", "civic_reports", "jurisdiction_key", ["kolkata"]
  ]);
});

test("authority report lists page through every assigned report", async () => {
  const reports = Array.from({ length: 505 }, (_, index) => ({
    id: `CX-${index + 1}`,
    jurisdiction_key: "howrah",
    status: "Pending"
  }));
  const client = fakeClient({
    authority: true,
    assignments: ["howrah"],
    activeJurisdictions: ["howrah"],
    reports
  });
  const result = await portal(client).listReports({
    accessToken: "session",
    masterKey: authorityKey
  });

  assert.equal(result.reports.length, 505);
  assert.deepEqual(result.reports.map((report) => report.id), reports.map((report) => report.id));
  assert.deepEqual(
    client.calls.filter((call) => call[0] === "range" && call[1] === "civic_reports")
      .map((call) => call.slice(2)),
    [[0, 499], [500, 999]]
  );
});

test("public jurisdiction options contain active registry display names and optional centers", async () => {
  const client = fakeClient({
    jurisdictionRows: [
      {
        jurisdiction_key: "howrah",
        display_name: "Howrah",
        is_active: true,
        center_latitude: 22.5958,
        center_longitude: 88.2636
      }
    ]
  });
  const result = await portal(client).listJurisdictions();

  assert.deepEqual(result.jurisdictions, [{
    jurisdictionKey: "howrah",
    displayName: "Howrah",
    centerLatitude: 22.5958,
    centerLongitude: 88.2636,
    isActive: true
  }]);
  assert.deepEqual(
    client.calls.find((call) => call[0] === "select" && call[1] === "civic_jurisdictions"),
    ["select", "civic_jurisdictions", "jurisdiction_key,display_name,center_latitude,center_longitude"]
  );
});

test("public jurisdiction options fall back to required columns when optional map centers are not migrated", async () => {
  const client = fakeClient({
    missingJurisdictionCoordinates: true,
    jurisdictionRows: [{
      jurisdiction_key: "howrah",
      display_name: "Howrah",
      is_active: true
    }]
  });
  const result = await portal(client).listJurisdictions();

  assert.deepEqual(result.jurisdictions, [{
    jurisdictionKey: "howrah",
    displayName: "Howrah",
    centerLatitude: undefined,
    centerLongitude: undefined,
    isActive: true
  }]);
  assert.deepEqual(
    client.calls.filter((call) => call[0] === "select" && call[1] === "civic_jurisdictions")
      .map((call) => call[2]),
    [
      "jurisdiction_key,display_name,center_latitude,center_longitude",
      "jurisdiction_key,display_name"
    ]
  );
});

test("owner entry status uses the authenticated server identity, not a caller-supplied ID", async () => {
  const normalService = portal(fakeClient({ userId: citizenId }));
  assert.deepEqual(await normalService.getEntryStatus({
    accessToken: "session",
    userId: ownerId
  }), { isOwner: false });

  const ownerService = portal(fakeClient({ userId: ownerId }));
  assert.deepEqual(await ownerService.getEntryStatus({ accessToken: "session" }), { isOwner: true });
});

test("a correct Authority key does not grant or promote a normal signed-in user", async () => {
  const client = fakeClient({
    userId: citizenId,
    jurisdictionRows: [{
      jurisdiction_key: "howrah",
      display_name: "Howrah",
      is_active: true
    }]
  });

  await assert.rejects(
    portal(client).prepareAuthorityEntry({ accessToken: "session", masterKey: authorityKey }),
    (error) => error instanceof PortalError && error.status === 403 &&
      error.message === "Portal access could not be verified."
  );
  assert.equal(client.calls.some((call) => call[0] === "rpc"), false);
  assert.equal(client.calls.some((call) => call[0] === "from" && call[1] === "civic_authority_jurisdictions"), false);
});

test("an active assigned authority passes the Authority entry check", async () => {
  const client = fakeClient({
    authority: true,
    assignments: ["kolkata"],
    activeJurisdictions: ["kolkata"]
  });
  assert.deepEqual(await portal(client).prepareAuthorityEntry({
    accessToken: "session",
    masterKey: authorityKey
  }), { verified: true });
});

test("wrong Authority keys are denied without promoting or disclosing corporations", async () => {
  const client = fakeClient({
    userId: citizenId,
    jurisdictionRows: [{ jurisdiction_key: "howrah", display_name: "Howrah", is_active: true }]
  });
  await assert.rejects(
    portal(client).prepareAuthorityEntry({ accessToken: "session", masterKey: "wrong-key" }),
    (error) => error instanceof PortalError && error.status === 403 &&
      error.message === "Portal access could not be verified."
  );
  assert.equal(client.calls.some((call) => call[0] === "rpc"), false);
});

test("authority portal denies missing assignments and inactive jurisdictions", async () => {
  const client = fakeClient({ authority: true, assignments: ["old-city"], activeJurisdictions: [] });
  await assert.rejects(
    portal(client).prepareAuthorityEntry({ accessToken: "session", masterKey: authorityKey }),
    (error) => error instanceof PortalError && error.status === 403 &&
      error.message === "Portal access could not be verified."
  );
  await assert.rejects(
    portal(client).listReports({ accessToken: "session", masterKey: authorityKey }),
    (error) => error instanceof PortalError && error.status === 403
  );
  assert.equal(client.calls.some((call) => call[0] === "from" && call[1] === "civic_reports"), false);
});

test("wrong keys and accounts without an active authority record receive the same denial", async () => {
  let wrongKeyError;
  let unverifiedAccountError;
  await assert.rejects(
    portal(fakeClient({ authority: true })).listReports({
      accessToken: "session",
      masterKey: "wrong-key"
    }),
    (error) => {
      wrongKeyError = error;
      return error instanceof PortalError;
    }
  );
  await assert.rejects(
    portal(fakeClient({ authority: false })).listReports({
      accessToken: "session",
      masterKey: authorityKey
    }),
    (error) => {
      unverifiedAccountError = error;
      return error instanceof PortalError;
    }
  );

  assert.equal(wrongKeyError.status, 403);
  assert.equal(unverifiedAccountError.status, 403);
  assert.equal(wrongKeyError.message, unverifiedAccountError.message);
  assert.equal(wrongKeyError.credentialFailure, true);
  assert.equal(unverifiedAccountError.credentialFailure, true);
});

test("authority report detail rechecks jurisdiction before querying report data", async () => {
  const client = fakeClient({
    authority: true,
    assignments: ["kolkata"],
    activeJurisdictions: ["kolkata"],
    reportAllowed: false,
    reports: [{ id: "CX-1", jurisdiction_key: "mumbai" }]
  });
  await assert.rejects(
    portal(client).getReport({ accessToken: "session", masterKey: authorityKey, reportId: "CX-1" }),
    (error) => error instanceof PortalError && error.status === 403
  );
  assert.equal(client.calls.some((call) => call[0] === "from" && call[1] === "civic_reports"), false);
});

test("report history includes the authenticated actor ID for audit attribution", async () => {
  const event = {
    report_id: "CX-1",
    event_type: "status_update",
    actor_kind: "authority",
    actor_user_id: authorityId,
    summary: "Status updated"
  };
  const result = await portal(fakeClient({
    userId: ownerId,
    reports: [{ id: "CX-1", user_id: ownerId, photo_path: null }],
    events: [event]
  })).getReport({
    accessToken: "session",
    masterKey: ownerKey,
    reportId: "CX-1"
  });

  assert.equal(result.events[0].actor_user_id, authorityId);
});

test("owner global access requires both the owner key and an allowlisted signed-in account", async () => {
  const client = fakeClient({
    userId: ownerId,
    reports: [
      { id: "CX-1", jurisdiction_key: "kolkata", photo_path: null },
      { id: "CX-2", jurisdiction_key: "mumbai", photo_path: "private/path.jpg" }
    ]
  });
  const service = portal(client);
  const result = await service.listReports({ accessToken: "session", masterKey: ownerKey });

  assert.equal(result.role, "owner");
  assert.deepEqual(result.reports.map((report) => report.id), ["CX-1", "CX-2"]);
  assert.equal(result.reports[1].hasAttachment, true);
  assert.equal(client.calls.some((call) => call[0] === "in"), false);

  const unlisted = portal(fakeClient({ userId: authorityId }));
  await assert.rejects(
    unlisted.listReports({ accessToken: "session", masterKey: ownerKey }),
    (error) => error instanceof PortalError && error.status === 403
  );
});

test("a non-owner cannot load the Owner portal even with the correct Owner key", async () => {
  const service = portal(fakeClient({ userId: citizenId }));
  await assert.rejects(
    service.listOwnerConfiguration({ accessToken: "session", masterKey: ownerKey }),
    (error) => error instanceof PortalError && error.status === 403 &&
      error.message === "Portal access could not be verified."
  );
});

test("owner jurisdiction changes call the guarded RPC with the authenticated actor ID", async () => {
  const client = fakeClient({ userId: ownerId });
  const result = await portal(client).setAuthorityJurisdictions({
    accessToken: "session",
    masterKey: ownerKey,
    authorityUserId: authorityId,
    jurisdictionKeys: ["kolkata"]
  });

  assert.deepEqual(result, { changedAssignments: 1 });
  assert.deepEqual(client.calls.find((call) => call[0] === "rpc"), [
    "rpc",
    "civic_owner_set_authority_jurisdictions",
    {
      p_actor_user_id: ownerId,
      p_authority_user_id: authorityId,
      p_jurisdiction_keys: ["kolkata"]
    }
  ]);
});

test("portal access fails closed for weak secrets, invalid sessions, and malformed assignment input", async () => {
  const weak = portal(fakeClient(), { authorityMasterKey: "weak", ownerMasterKey: "weak" });
  await assert.rejects(
    weak.listReports({ accessToken: "session", masterKey: "weak" }),
    (error) => error instanceof PortalError && error.status === 503
  );
  await assert.rejects(
    portal(fakeClient()).listReports({ accessToken: "invalid", masterKey: authorityKey }),
    (error) => error instanceof PortalError && error.status === 403 &&
      error.message === "Portal access could not be verified."
  );
  await assert.rejects(
    portal(fakeClient({ userId: ownerId })).setAuthorityJurisdictions({
      accessToken: "session",
      masterKey: ownerKey,
      authorityUserId: authorityId,
      jurisdictionKeys: ["Kolkata"]
    }),
    (error) => error instanceof PortalError && error.status === 400
  );
});

test("portal HTTP routes require bearer authentication and keep the master key out of request bodies", async () => {
  const app = createApp({
    portalService: {
      async listReports(request) {
        assert.equal(request.accessToken, "session");
        assert.equal(request.masterKey, ownerKey);
        return { role: "owner", reports: [] };
      }
    }
  });
  await withServer(app, async (server) => {
    const url = `http://127.0.0.1:${server.address().port}/api/portal/reports`;
    const denied = await fetch(url);
    assert.equal(denied.status, 401);
    const allowed = await fetch(url, {
      headers: { authorization: "Bearer session", "x-civicx-master-key": ownerKey }
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true, result: { role: "owner", reports: [] } });
    for (let index = 0; index < 58; index += 1) {
      const response = await fetch(url, {
        headers: { authorization: "Bearer session", "x-civicx-master-key": ownerKey }
      });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(url, {
      headers: { authorization: "Bearer session", "x-civicx-master-key": ownerKey }
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("cache-control"), "private, no-store");
  });
});

test("portal key failures are generically reported and limited by client IP", async () => {
  const app = createApp({
    portalService: {
      async listReports() {
        throw new PortalError("Portal access could not be verified.", 403, { credentialFailure: true });
      }
    }
  });
  await withServer(app, async (server) => {
    const url = `http://127.0.0.1:${server.address().port}/api/portal/reports`;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(url, {
        headers: { authorization: "Bearer session", "x-civicx-master-key": "wrong-key" }
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {
        ok: false,
        error: "Portal access could not be verified."
      });
    }
    const blocked = await fetch(url, {
      headers: { authorization: "Bearer session", "x-civicx-master-key": "wrong-key" }
    });
    assert.equal(blocked.status, 429);
    assert.match((await blocked.json()).error, /temporarily blocked/i);
  });
});

test("jurisdiction endpoint serves safe public registry data without requiring portal credentials", async () => {
  const app = createApp({
    portalService: {
      async listJurisdictions() {
        return { jurisdictions: [{ jurisdictionKey: "kolkata", displayName: "Kolkata" }] };
      }
    }
  });
  await withServer(app, async (server) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jurisdictions`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.deepEqual(await response.json(), {
      ok: true,
      result: { jurisdictions: [{ jurisdictionKey: "kolkata", displayName: "Kolkata" }] }
    });
  });
});

test("portal navigation and Authority verification routes use bearer identity and reject promotion", async () => {
  const calls = [];
  const app = createApp({
    portalService: {
      async getEntryStatus(request) {
        calls.push(["entry-status", request]);
        return { isOwner: false };
      },
      async prepareAuthorityEntry(request) {
        calls.push(["authority-entry", request]);
        throw new PortalError("Portal access could not be verified.", 403, { credentialFailure: true });
      }
    }
  });
  await withServer(app, async (server) => {
    const root = `http://127.0.0.1:${server.address().port}/api/portal`;
    const authorization = { authorization: "Bearer session" };

    const deniedStatus = await fetch(`${root}/entry-status`);
    assert.equal(deniedStatus.status, 401);
    const status = await fetch(`${root}/entry-status`, { headers: authorization });
    assert.deepEqual(await status.json(), { ok: true, result: { isOwner: false } });

    const entry = await fetch(`${root}/authority/entry`, {
      method: "POST",
      headers: { ...authorization, "x-civicx-master-key": authorityKey, "content-type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(entry.status, 403);
    assert.deepEqual(await entry.json(), { ok: false, error: "Portal access could not be verified." });
    assert.deepEqual(calls.find((call) => call[0] === "authority-entry"), [
      "authority-entry",
      { accessToken: "session", masterKey: authorityKey }
    ]);

    const promotion = await fetch(`${root}/authority/promote`, {
      method: "POST",
      headers: { ...authorization, "x-civicx-master-key": authorityKey, "content-type": "application/json" },
      body: JSON.stringify({ jurisdictionKey: "howrah" })
    });
    assert.equal(promotion.status, 404);
  });
});
