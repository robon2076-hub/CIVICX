const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp } = require("../server/app");
const { createPublicMapService, parseMapBounds } = require("../server/public-map");

const postId = "11111111-1111-4111-8111-111111111111";

function filterRows(rows, filters) {
  return rows.filter((row) => filters.every((filter) => {
    if (filter.operator === "gte") return row[filter.column] >= filter.value;
    if (filter.operator === "lte") return row[filter.column] <= filter.value;
    if (filter.operator === "eq") return row[filter.column] === filter.value;
    if (filter.operator === "not-null") return row[filter.column] !== null;
    return false;
  }));
}

function queryFor(rows) {
  const filters = [];
  let range = null;
  const query = {
    select() { return query; },
    gte(column, value) { filters.push({ column, operator: "gte", value }); return query; },
    lte(column, value) { filters.push({ column, operator: "lte", value }); return query; },
    eq(column, value) { filters.push({ column, operator: "eq", value }); return query; },
    not(column, operator, value) {
      if (operator === "is" && value === null) filters.push({ column, operator: "not-null" });
      return query;
    },
    order() { return query; },
    range(from, to) { range = [from, to]; return query; },
    async maybeSingle() { return { data: filterRows(rows, filters)[0] || null, error: null }; },
    then(resolve, reject) {
      const selected = filterRows(rows, filters);
      const data = range ? selected.slice(range[0], range[1] + 1) : selected;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    }
  };
  return query;
}

function mapRow(overrides = {}) {
  return {
    community_post_id: postId,
    category: "Garbage and Sanitation",
    description: "Waste has collected around the public bin.",
    city: "Kolkata",
    locality: "Park Circus",
    status: "Prepared (awaiting user filing)",
    report_date: "2026-11-17T10:00:00.000Z",
    latitude: 22.54,
    longitude: 88.36,
    display_name: "Civic neighbour",
    has_photo: false,
    user_id: "private-user-id",
    report_id: "CX-private-report",
    location: "Private street address",
    photo_path: "private-user-id/private/photo.jpg",
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

test("map bounds accept wrapped longitude views but reject invalid or extra parameters", () => {
  assert.deepEqual(parseMapBounds({
    south: "-1",
    north: "1",
    west: "179",
    east: "-179"
  }), { south: -1, north: 1, west: 179, east: -179 });
  assert.throws(() => parseMapBounds({
    south: "-1",
    north: "1",
    west: "-181",
    east: "2"
  }), /valid map bounds/);
  assert.throws(() => parseMapBounds({
    south: "-1",
    north: "1",
    west: "0",
    east: "2",
    user_id: "untrusted"
  }), /only south, north, west, and east/);
});

test("public map service returns only safe public fields and skips reports without coordinates", async () => {
  const selectedViews = [];
  const client = {
    from(table) {
      assert.equal(table, "civicx_public_map_reports");
      return {
        ...queryFor([
          mapRow(),
          mapRow({ community_post_id: "22222222-2222-4222-8222-222222222222", latitude: null })
        ]),
        select(columns) {
          selectedViews.push(columns);
          return this;
        }
      };
    }
  };
  const service = createPublicMapService({ client });
  const reports = await service.listReports({
    south: 22,
    north: 23,
    west: 88,
    east: 89
  });
  assert.equal(reports.length, 1);
  assert.deepEqual(Object.keys(reports[0]).sort(), [
    "category", "city", "communityPostId", "date", "description", "displayName",
    "hasPhoto", "latitude", "locality", "longitude", "status"
  ].sort());
  assert.equal(reports[0].communityPostId, postId);
  assert.equal(reports[0].hasPhoto, false);
  assert.doesNotMatch(JSON.stringify(reports), /private-user-id|private-report|street address|photo_path/i);
  assert.equal(selectedViews[0].includes("user_id"), false);
  assert.equal(selectedViews[0].includes("photo_path"), false);
});

test("public map endpoint is visitor-readable and validates visible-area bounds", async () => {
  const calls = [];
  const safeReport = {
    communityPostId: postId,
    category: "Garbage and Sanitation",
    description: "Waste around a public bin.",
    city: "Kolkata",
    locality: "Park Circus",
    status: "Prepared",
    date: "2026-11-17T10:00:00.000Z",
    latitude: 22.54,
    longitude: 88.36,
    displayName: "Civic neighbour",
    hasPhoto: false
  };
  await withServer(createApp({
    publicMapService: {
      async listReports(bounds) {
        calls.push(bounds);
        return [safeReport];
      }
    }
  }), async (server) => {
    const root = `http://127.0.0.1:${server.address().port}/api/public/map-reports`;
    const response = await fetch(`${root}?south=22&north=23&west=88&east=89`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(payload.result.reports, [safeReport]);
    assert.deepEqual(calls, [{ south: 22, north: 23, west: 88, east: 89 }]);

    const invalid = await fetch(`${root}?south=23&north=22&west=88&east=89`);
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 1);
  });
});

test("public map photo endpoint serves only a cross-post photo without revealing its storage path", async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(["from", table]);
      if (table === "civicx_public_map_reports") {
        return queryFor([{ community_post_id: postId }]);
      }
      return queryFor([{
        id: postId,
        visibility: "published",
        linked_report_id: "CX-report",
        image_path: "private-user-id/unique-photo.jpg"
      }]);
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "civicx-community");
        return {
          async download(path) {
            calls.push(["download", path]);
            return { data: new Blob(["public image"], { type: "image/jpeg" }), error: null };
          }
        };
      }
    }
  };
  const service = createPublicMapService({ client });
  await withServer(createApp({ publicMapService: service }), async (server) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/public/map-reports/${postId}/photo`
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "public image");
  });
  assert.deepEqual(calls.map(([kind, value]) => [kind, value]), [
    ["from", "civicx_public_map_reports"],
    ["from", "community_posts"],
    ["download", "private-user-id/unique-photo.jpg"]
  ]);
});
