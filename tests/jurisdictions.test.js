const test = require("node:test");
const assert = require("node:assert/strict");
const jurisdictions = require("../civicx-jurisdictions");

test("the preferred registered region is Kolkata when it is available", () => {
  const registered = [
    { jurisdictionKey: "howrah", displayName: "Howrah" },
    { jurisdictionKey: "kolkata-main", displayName: "Kolkata - Central" }
  ];

  assert.equal(jurisdictions.defaultJurisdiction(registered), registered[1]);
});

test("nearest-city detection considers only registered jurisdictions and honors stored centers", () => {
  const registered = [
    { jurisdictionKey: "kolkata", displayName: "Kolkata", isActive: true },
    {
      jurisdictionKey: "howrah-ward-1",
      displayName: "Howrah - Ward 1",
      centerLatitude: 22.5958,
      centerLongitude: 88.2636,
      isActive: true
    },
    { jurisdictionKey: "inactive-mumbai", displayName: "Mumbai", isActive: false }
  ];

  assert.equal(jurisdictions.nearestJurisdiction(22.596, 88.264, registered), registered[1]);
  assert.equal(jurisdictions.getCenter({ displayName: "Unknown civic region" }), null);
});

test("missing stored centers fall back to city coordinates instead of [0, 0]", () => {
  assert.deepEqual(jurisdictions.getCenter({
    jurisdictionKey: "mumbai",
    displayName: "Mumbai",
    centerLatitude: null,
    centerLongitude: null
  }), [19.076, 72.8777]);
  assert.deepEqual(jurisdictions.getCenter({
    jurisdictionKey: "newdelhi",
    displayName: "New Delhi(NCR)",
    centerLatitude: null,
    centerLongitude: null
  }), [28.6139, 77.209]);
  assert.deepEqual(jurisdictions.getCenter({
    jurisdictionKey: "newtown",
    displayName: "New Town (Rajarhat)",
    centerLatitude: null,
    centerLongitude: null
  }), [22.5958, 88.4798]);
});
