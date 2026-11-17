const test = require("node:test");
const assert = require("node:assert/strict");
const communityPosts = require("../civicx-community-posts");
const civicReports = require("../civicx-reports");

const user = { id: "4e2ebcc8-63ba-4dcf-a207-9a039a33a6c1" };

function sampleReport() {
  return {
    id: "CX-8f97e0ca-5275-4db4-b6ec-b924efa96cda",
    category: "Electricity related problem",
    title: "Power outage near the crossing",
    city: "Kolkata",
    jurisdictionKey: "kolkata",
    location: "Park Circus, Kolkata",
    area: "Park Circus",
    description: "Streetlights and nearby homes lost power after a visible cable fault.",
    coordinates: [22.5398, 88.3651],
    priority: "Medium"
  };
}

function communityService(overrides = {}) {
  return {
    reportBody: communityPosts.reportBody,
    validatePost: communityPosts.validatePost,
    async uploadImage(client, imageOwner, file) {
      const path = `${imageOwner.id}/babababa-baba-4aba-8aba-babababababa.jpg`;
      const { error } = await client.storage.from("civicx-community").upload(path, file, {
        contentType: file.type,
        upsert: false
      });
      if (error) throw new Error("The Community image could not be uploaded.");
      return path;
    },
    removeImage: communityPosts.removeImage,
    ...overrides
  };
}

function fakeClient({
  rpcResult = { data: null, error: null },
  failRpc = false,
  persistOnRpcFailure = false,
  existingReport = null,
  existingPost = null
} = {}) {
  const uploads = [];
  const removals = [];
  let savedReport = existingReport;
  let savedPost = existingPost;
  let rpcCall;
  const client = {
    from(table) {
      assert.ok(["civic_reports", "community_posts"].includes(table));
      const query = {
        select() { return query; },
        eq() { return query; },
        limit() { return query; },
        async maybeSingle() {
          return { data: table === "civic_reports" ? savedReport : savedPost, error: null };
        }
      };
      return query;
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, file, options) {
            uploads.push({ bucket, path, file, options });
            return { error: null };
          },
          async remove(paths) {
            removals.push({ bucket, paths });
            return { error: null };
          }
        };
      }
    },
    async rpc(name, args) {
      rpcCall = { name, args };
      if (failRpc && persistOnRpcFailure) {
        savedReport = { id: args.p_report.id, user_id: user.id, photo_path: args.p_report.photo_path };
        savedPost = {
          id: "e67a557f-203c-4c33-827a-f6e789671ba0",
          author_id: user.id,
          image_path: args.p_community_photo_path
        };
      }
      return failRpc
        ? { data: null, error: new Error("Community insert failed") }
        : rpcResult;
    }
  };
  return {
    client,
    uploads,
    removals,
    get rpcCall() { return rpcCall; }
  };
}

test("report categories default to existing Community categories, including electricity", () => {
  assert.equal(communityPosts.defaultCategoryForReport("Pothole"), "Road and Infrastructure");
  assert.equal(communityPosts.defaultCategoryForReport("Garbage"), "Garbage and Sanitation");
  assert.equal(communityPosts.defaultCategoryForReport("Water leakage"), "Water and Drainage");
  assert.equal(communityPosts.defaultCategoryForReport("Streetlight"), "Public Safety");
  assert.equal(communityPosts.defaultCategoryForReport("Electricity related problem"), "Government Services");
  assert.equal(communityPosts.defaultCategoryForReport("Unknown"), "General Civic Discussions");
  assert.equal(communityPosts.categories.includes("Electricity related problem"), false);
});

test("Community validation reuses the post schema limits", () => {
  const valid = {
    category: "Government Services",
    body: communityPosts.reportBody("Power outage", "A utility outage is visible."),
    city: "Kolkata",
    locality: "Park Circus",
    displayName: "Civic neighbour"
  };
  assert.equal(communityPosts.validatePost(valid), "");
  assert.match(communityPosts.validatePost({ ...valid, category: "Electricity related problem" }), /category/i);
  assert.match(communityPosts.validatePost({ ...valid, city: "K" }), /city/i);
  assert.match(communityPosts.validatePost({ ...valid, locality: "" }), /locality/i);
  assert.match(communityPosts.validatePost({ ...valid, body: "short" }), /10 and 3000/i);
});

test("cross-post writes redacted images then invokes the atomic RPC without a client-supplied author ID", async () => {
  const result = {
    data: {
      report_id: sampleReport().id,
      community_post_id: "e67a557f-203c-4c33-827a-f6e789671ba0",
      already_created: false
    },
    error: null
  };
  const fake = fakeClient({ rpcResult: result });
  const service = communityService();
  const photo = new Blob(["redacted photo"], { type: "image/jpeg" });
  const created = await civicReports.createWithCommunity(
    fake.client,
    user,
    sampleReport(),
    photo,
    { category: "Government Services", displayName: "Civic neighbour", locality: "Park Circus" },
    service
  );

  assert.deepEqual(created, {
    reportId: sampleReport().id,
    communityPostId: result.data.community_post_id,
    alreadyCreated: false
  });
  assert.equal(fake.uploads.length, 2);
  assert.equal(fake.uploads[0].bucket, "civic-report-attachments");
  assert.equal(fake.uploads[0].path, `${user.id}/${sampleReport().id}/issue-photo.jpg`);
  assert.equal(fake.uploads[1].bucket, "civicx-community");
  assert.equal(fake.uploads[1].path, `${user.id}/babababa-baba-4aba-8aba-babababababa.jpg`);
  assert.equal(fake.rpcCall.name, "create_civic_report_with_community_post");
  assert.equal(fake.rpcCall.args.p_report.user_id, undefined);
  assert.equal(fake.rpcCall.args.p_report.photo_path, fake.uploads[0].path);
  assert.equal(fake.rpcCall.args.p_community_category, "Government Services");
  assert.equal(fake.rpcCall.args.p_community_photo_path, `${user.id}/babababa-baba-4aba-8aba-babababababa.jpg`);
  assert.equal(fake.removals.length, 0);
});

test("cross-post without a photo invokes the transaction without storage uploads", async () => {
  const fake = fakeClient({
    rpcResult: {
      data: {
        report_id: sampleReport().id,
        community_post_id: "e67a557f-203c-4c33-827a-f6e789671ba0",
        already_created: false
      },
      error: null
    }
  });
  const created = await civicReports.createWithCommunity(
    fake.client,
    user,
    sampleReport(),
    null,
    { category: "Government Services", displayName: "Civic neighbour", locality: "Park Circus" },
    communityService()
  );

  assert.equal(created.communityPostId, "e67a557f-203c-4c33-827a-f6e789671ba0");
  assert.equal(fake.uploads.length, 0);
  assert.equal(fake.rpcCall.args.p_report.photo_path, null);
  assert.equal(fake.rpcCall.args.p_community_photo_path, null);
});

test("a failed atomic RPC removes both uploaded photos and returns no success", async () => {
  const fake = fakeClient({ failRpc: true });
  const service = communityService();
  const photo = new Blob(["redacted photo"], { type: "image/jpeg" });

  await assert.rejects(
    civicReports.createWithCommunity(
      fake.client,
      user,
      sampleReport(),
      photo,
      { category: "Government Services", displayName: "Civic neighbour", locality: "Park Circus" },
      service
    ),
    /Community insert failed/
  );

  assert.deepEqual(fake.removals, [
    { bucket: "civicx-community", paths: [`${user.id}/babababa-baba-4aba-8aba-babababababa.jpg`] },
    { bucket: "civic-report-attachments", paths: [`${user.id}/${sampleReport().id}/issue-photo.jpg`] }
  ]);
});

test("a lost RPC response is reconciled before uploaded images are removed", async () => {
  const fake = fakeClient({ failRpc: true, persistOnRpcFailure: true });
  const created = await civicReports.createWithCommunity(
    fake.client,
    user,
    sampleReport(),
    new Blob(["redacted photo"], { type: "image/jpeg" }),
    { category: "Government Services", displayName: "Civic neighbour", locality: "Park Circus" },
    communityService()
  );

  assert.equal(created.alreadyCreated, true);
  assert.equal(fake.removals.length, 0);
});

test("a retry reuses an existing report link without uploading duplicate photos or calling the RPC", async () => {
  const fake = fakeClient({
    existingReport: { id: sampleReport().id, user_id: user.id },
    existingPost: { id: "e67a557f-203c-4c33-827a-f6e789671ba0" }
  });
  const created = await civicReports.createWithCommunity(
    fake.client,
    user,
    sampleReport(),
    new Blob(["redacted photo"], { type: "image/jpeg" }),
    { category: "Government Services", displayName: "Civic neighbour", locality: "Park Circus" },
    communityService()
  );

  assert.equal(created.alreadyCreated, true);
  assert.equal(fake.uploads.length, 0);
  assert.equal(fake.rpcCall, undefined);
});

test("invalid Community details fail before any report or image write", async () => {
  const fake = fakeClient();
  const service = communityService();
  const photo = new Blob(["redacted photo"], { type: "image/jpeg" });

  await assert.rejects(
    civicReports.createWithCommunity(
      fake.client,
      user,
      sampleReport(),
      photo,
      { category: "Other", displayName: "", locality: "" },
      service
    ),
    /Choose a valid Community category/
  );

  assert.equal(fake.uploads.length, 0);
  assert.equal(fake.rpcCall, undefined);
});

test("cross-post errors explain rejected public contact details", () => {
  assert.match(
    civicReports.communityCrosspostErrorMessage(new Error("Remove email addresses and phone numbers from public content.")),
    /Remove email addresses and phone numbers/
  );
});
