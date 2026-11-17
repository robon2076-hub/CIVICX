const test = require("node:test");
const assert = require("node:assert/strict");
const { mutation } = require("../community-votes");

test("vote transitions distinguish adding, changing, and removing a vote", () => {
  assert.deepEqual(mutation(null, 1), { operation: "upsert", vote: 1 });
  assert.deepEqual(mutation(1, -1), { operation: "upsert", vote: -1 });
  assert.deepEqual(mutation(-1, -1), { operation: "none" });
  assert.deepEqual(mutation(1, 0), { operation: "delete" });
});

test("vote transitions reject invalid values", () => {
  assert.throws(() => mutation(2, 1), /-1, 0, or 1/);
  assert.throws(() => mutation(null, 3), /-1, 0, or 1/);
});
