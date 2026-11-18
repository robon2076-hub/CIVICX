const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fetchWithRetry } = require("../civicx-startup");

test("startup requests retry transient server responses then return the successful response", async () => {
  const statuses = [503, 502, 200];
  const waits = [];
  const wakeMessages = [];
  const response = await fetchWithRetry(async () => ({
    status: statuses.shift(),
    ok: true
  }), "/api/public-config", {}, {
    delay: async (milliseconds) => waits.push(milliseconds),
    onRetry: () => wakeMessages.push("Waking up the server, please wait...")
  });

  assert.equal(response.status, 200);
  assert.deepEqual(waits, [700, 1400]);
  assert.deepEqual(wakeMessages, [
    "Waking up the server, please wait...",
    "Waking up the server, please wait..."
  ]);
});

test("startup requests retry connection failures and reject after the bounded attempts", async () => {
  let calls = 0;
  const waits = [];
  await assert.rejects(
    fetchWithRetry(async () => {
      calls += 1;
      throw new TypeError("fetch failed");
    }, "/api/jurisdictions", {}, {
      delay: async (milliseconds) => waits.push(milliseconds)
    }),
    /fetch failed/
  );
  assert.equal(calls, 3);
  assert.deepEqual(waits, [700, 1400]);
});

test("successful startup requests do not wait or retry", async () => {
  let calls = 0;
  const response = await fetchWithRetry(async () => {
    calls += 1;
    return { status: 200, ok: true };
  }, "/api/public-config", {}, {
    delay: async () => assert.fail("successful responses should not wait")
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 1);
});

test("dashboard loads startup retry support before auth and provides city retry controls", () => {
  const dashboard = fs.readFileSync(path.join(__dirname, "..", "dashboard.html"), "utf8");
  const auth = fs.readFileSync(path.join(__dirname, "..", "civicx-auth.js"), "utf8");
  const dashboardPage = fs.readFileSync(path.join(__dirname, "..", "dashboard-page.js"), "utf8");

  assert.ok(dashboard.indexOf('src="civicx-startup.js"') < dashboard.indexOf('src="civicx-auth.js"'));
  assert.match(auth, /CivicXStartup\.fetchWithRetry/);
  assert.match(dashboardPage, /CivicXStartup\.fetchWithRetry/);
  assert.match(dashboardPage, /Waking up the server, please wait\.\.\./);
  assert.match(dashboardPage, /Could not load cities\. Please refresh\./);
  assert.match(dashboard, /id="retry-jurisdictions-map"/);
  assert.match(dashboard, /id="retry-jurisdictions-report"/);
});
